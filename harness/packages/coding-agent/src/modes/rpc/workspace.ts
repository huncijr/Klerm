import { execFile } from "node:child_process";
import { access, readdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnProcess } from "../../utils/child-process.ts";
import { openBrowser } from "../../utils/open-browser.ts";
import { canonicalizePath } from "../../utils/paths.ts";
import type {
	RpcEditorInfo,
	RpcRunningService,
	RpcWorkspaceAttribution,
	RpcWorkspaceFileStatus,
	RpcWorkspaceStatus,
} from "./rpc-types.ts";

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LISTED_FILES = 5000;
const SKIPPED_DIRECTORY_NAMES = new Set([
	".git",
	".klerm",
	"node_modules",
	"target",
	"dist",
	"build",
	"out",
	".next",
	".cache",
	".venv",
	"venv",
	"__pycache__",
	".idea",
	".vscode",
	"coverage",
]);

interface CommandResult {
	stdout: string;
	stderr: string;
	succeeded: boolean;
}

interface DockerComposePublisher {
	PublishedPort?: number;
}

interface DockerComposeProcess {
	Name?: string;
	Service?: string;
	Publishers?: DockerComposePublisher[];
}

function runCommand(command: string, args: string[], cwd: string, allowFailure = false): Promise<CommandResult> {
	return new Promise((resolveCommand, rejectCommand) => {
		execFile(command, args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error && !allowFailure) {
				rejectCommand(new Error(stderr.trim() || error.message));
				return;
			}
			resolveCommand({ stdout, stderr, succeeded: !error });
		});
	});
}

function statusKind(indexStatus: string, worktreeStatus: string): RpcWorkspaceFileStatus["status"] {
	const combined = `${indexStatus}${worktreeStatus}`;
	if (combined.includes("?")) return "untracked";
	if (combined.includes("R")) return "renamed";
	if (combined.includes("D")) return "deleted";
	if (combined.includes("A")) return "added";
	return "modified";
}

async function gitRoot(cwd: string): Promise<string | undefined> {
	const result = await runCommand("git", ["rev-parse", "--show-toplevel"], cwd, true);
	const root = result.stdout.trim();
	return root || undefined;
}

function parseStatus(
	output: string,
	attributions: ReadonlyMap<string, RpcWorkspaceAttribution>,
): RpcWorkspaceFileStatus[] {
	const fields = output.split("\0");
	const files: RpcWorkspaceFileStatus[] = [];
	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index];
		if (!field || field.length < 4) continue;
		const indexStatus = field[0] ?? " ";
		const worktreeStatus = field[1] ?? " ";
		const path = field.slice(3);
		let oldPath: string | undefined;
		if (indexStatus === "R" || worktreeStatus === "R") {
			oldPath = fields[index + 1] || undefined;
			index += 1;
		}
		files.push({
			path,
			oldPath,
			indexStatus,
			worktreeStatus,
			status: statusKind(indexStatus, worktreeStatus),
			staged: indexStatus !== " " && indexStatus !== "?",
			attribution: attributions.get(path) ?? { source: "external" },
		});
	}
	return files;
}

export async function getWorkspaceStatus(
	cwd: string,
	attributions: ReadonlyMap<string, RpcWorkspaceAttribution> = new Map(),
): Promise<RpcWorkspaceStatus> {
	const root = await gitRoot(cwd);
	if (!root) {
		const recommendation = await gitInitializationRecommendation(cwd);
		return {
			workspaceRoot: cwd,
			projectRoot: cwd,
			isGit: false,
			files: [],
			...(recommendation ? { gitInitializationRecommendation: recommendation } : {}),
		};
	}
	const status = await runCommand("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
	return {
		workspaceRoot: cwd,
		projectRoot: root,
		gitRoot: root,
		isGit: true,
		files: parseStatus(status.stdout, attributions),
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function gitInitializationRecommendation(cwd: string): Promise<string | undefined> {
	const manifestNames = ["package.json", "Cargo.toml", "pyproject.toml", "go.mod", "Gemfile"];
	const lockfileNames = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "poetry.lock", "go.sum"];
	const [hasManifest, hasLockfile] = await Promise.all([
		Promise.all(manifestNames.map((name) => pathExists(join(cwd, name)))).then((matches) => matches.some(Boolean)),
		Promise.all(lockfileNames.map((name) => pathExists(join(cwd, name)))).then((matches) => matches.some(Boolean)),
	]);
	if (!hasManifest) return undefined;
	const runtimeDirectories = ["node_modules", "target", ".venv", "venv", ".next", "dist", "build"];
	const hasRunArtifacts = (await Promise.all(runtimeDirectories.map((name) => pathExists(join(cwd, name))))).some(
		Boolean,
	);
	if (hasLockfile || hasRunArtifacts) {
		return "This project has a dependency lockfile or build artifacts. Initialize Git before more work accumulates.";
	}
	let sourceFiles = 0;
	const walk = async (directory: string): Promise<void> => {
		if (sourceFiles >= 12) return;
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (sourceFiles >= 12 || SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) await walk(absolute);
			else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|rb|php|cs|cpp|c|h)$/i.test(entry.name))
				sourceFiles++;
		}
	};
	await walk(cwd);
	return sourceFiles >= 12
		? "This project already has a substantial source tree. Initialize Git before more work accumulates."
		: undefined;
}

export async function initializeGitRepository(cwd: string): Promise<RpcWorkspaceStatus> {
	const existing = await gitRoot(cwd);
	if (existing) throw new Error("The selected workspace is already inside a Git repository.");
	await runCommand("git", ["init"], cwd);
	return getWorkspaceStatus(cwd);
}

export async function getGitHubStatus(cwd: string): Promise<{ available: boolean; authenticated: boolean }> {
	const available = await executableAvailable("gh");
	if (!available) return { available: false, authenticated: false };
	const result = await runCommand("gh", ["auth", "status", "--hostname", "github.com"], cwd, true);
	return { available: true, authenticated: result.succeeded };
}

export async function loginGitHub(cwd: string): Promise<{ authenticated: boolean }> {
	if (!(await executableAvailable("gh"))) throw new Error("GitHub CLI (gh) is not installed.");
	await runCommand("gh", ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"], cwd);
	return getGitHubStatus(cwd);
}

export async function listWorkspaceFiles(
	cwd: string,
): Promise<{ projectRoot: string; files: string[]; truncated: boolean }> {
	const status = await getWorkspaceStatus(cwd);
	const projectRoot = status.projectRoot;
	const files: string[] = [];
	let truncated = false;
	const walk = async (directory: string): Promise<void> => {
		if (truncated) return;
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			if (files.length >= MAX_LISTED_FILES) {
				truncated = true;
				return;
			}
			if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(absolute);
				continue;
			}
			if (!entry.isFile()) continue;
			files.push(relative(projectRoot, absolute).split(sep).join("/"));
		}
	};
	await walk(projectRoot);
	return { projectRoot, files, truncated };
}

function resolveWorkspaceFile(root: string, filePath: string): string {
	if (!filePath || isAbsolute(filePath) || filePath.includes("\0"))
		throw new Error("A workspace-relative file path is required.");
	const canonicalRoot = canonicalizePath(resolve(root));
	const target = resolve(canonicalRoot, filePath);
	const relation = relative(canonicalRoot, target);
	if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
		if (!relation) throw new Error("A workspace-relative file path is required.");
		throw new Error("The requested file is outside the workspace.");
	}
	const canonicalTarget = canonicalizePath(target);
	const canonicalRelation = relative(canonicalRoot, canonicalTarget);
	if (canonicalRelation.startsWith("..") || isAbsolute(canonicalRelation)) {
		throw new Error("The requested file resolves outside the workspace.");
	}
	return canonicalTarget;
}

export async function readWorkspaceTextFile(
	cwd: string,
	filePath: string,
): Promise<{ path: string; content: string; size: number }> {
	const status = await getWorkspaceStatus(cwd);
	const target = resolveWorkspaceFile(status.projectRoot, filePath);
	const fileStats = await stat(target);
	if (!fileStats.isFile()) throw new Error("The requested path is not a file.");
	if (fileStats.size > MAX_TEXT_FILE_BYTES) throw new Error("The file is too large to preview in Klerm.");
	const bytes = await readFile(target);
	if (bytes.includes(0)) throw new Error("Binary files cannot be previewed in Klerm.");
	return { path: filePath, content: bytes.toString("utf8"), size: fileStats.size };
}

export async function writeWorkspaceTextFile(cwd: string, filePath: string, content: string): Promise<void> {
	if (Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_BYTES)
		throw new Error("The edited file is too large to save in Klerm.");
	const status = await getWorkspaceStatus(cwd);
	const target = resolveWorkspaceFile(status.projectRoot, filePath);
	const fileStats = await stat(target);
	if (!fileStats.isFile()) throw new Error("Only existing text files can be edited in Klerm.");
	if (fileStats.size > MAX_TEXT_FILE_BYTES) throw new Error("The existing file is too large to edit in Klerm.");
	if ((await readFile(target)).includes(0)) throw new Error("Binary files cannot be edited in Klerm.");
	await writeFile(target, content, "utf8");
}

export async function getWorkspaceDiff(cwd: string, filePath: string): Promise<{ path: string; diff: string }> {
	const status = await getWorkspaceStatus(cwd);
	if (!status.gitRoot) return { path: filePath, diff: "" };
	resolveWorkspaceFile(status.gitRoot, filePath);
	const unstaged = await runCommand("git", ["diff", "--no-ext-diff", "--unified=80", "--", filePath], status.gitRoot);
	const staged = await runCommand(
		"git",
		["diff", "--cached", "--no-ext-diff", "--unified=80", "--", filePath],
		status.gitRoot,
	);
	let diff = [staged.stdout.trim(), unstaged.stdout.trim()].filter(Boolean).join("\n\n");
	const file = status.files.find((candidate) => candidate.path === filePath);
	if (!diff && file?.status === "untracked") {
		const preview = await readWorkspaceTextFile(cwd, filePath);
		diff = preview.content
			.split("\n")
			.map((line) => `+${line}`)
			.join("\n");
	}
	return { path: filePath, diff };
}

async function executableAvailable(command: string): Promise<boolean> {
	const lookup = process.platform === "win32" ? "where" : "which";
	const result = await runCommand(lookup, [command], process.cwd(), true);
	return result.stdout.trim().length > 0;
}

export async function getAvailableEditors(): Promise<RpcEditorInfo[]> {
	const vimAvailable =
		process.platform === "linux" &&
		(await executableAvailable("x-terminal-emulator")) &&
		(await executableAvailable("vim"));
	return [
		{ id: "zed", label: "Zed", available: await executableAvailable("zed") },
		{ id: "vscode", label: "VS Code", available: await executableAvailable("code") },
		{ id: "vim", label: "Vim", available: vimAvailable },
	];
}

export async function openWorkspaceEditor(cwd: string, editor: RpcEditorInfo["id"]): Promise<void> {
	const status = await getWorkspaceStatus(cwd);
	const available = await getAvailableEditors();
	if (!available.find((candidate) => candidate.id === editor)?.available)
		throw new Error("The selected editor is not installed.");
	const command = editor === "zed" ? "zed" : editor === "vscode" ? "code" : "x-terminal-emulator";
	const args = editor === "vim" ? ["-e", "vim", status.projectRoot] : [status.projectRoot];
	const child = spawnProcess(command, args, { cwd: status.projectRoot, detached: true, stdio: "ignore" });
	child.unref();
}

export async function getRunningServices(cwd: string): Promise<RpcRunningService[]> {
	const workspace = await getWorkspaceStatus(cwd);
	const projectRoot = canonicalizePath(resolve(workspace.projectRoot));
	const services: RpcRunningService[] = [];
	if (process.platform !== "linux") return services;
	const result = await runCommand("ss", ["-ltnpH"], cwd, true);
	const seenPorts = new Set<number>();
	for (const line of result.stdout.split("\n")) {
		const address = line.trim().split(/\s+/)[3];
		const match = address?.match(/:(\d+)$/);
		if (!match) continue;
		const port = Number(match[1]);
		if (!Number.isInteger(port) || port <= 0 || seenPorts.has(port)) continue;
		const processMatch = line.match(/\(\("([^"]+)".*pid=(\d+)/);
		const pid = processMatch?.[2] ? Number(processMatch[2]) : undefined;
		if (!pid) continue;
		let processCwd: string;
		try {
			processCwd = canonicalizePath(await readlink(`/proc/${pid}/cwd`));
		} catch {
			continue;
		}
		const relation = relative(projectRoot, processCwd);
		if (relation.startsWith("..") || isAbsolute(relation)) continue;
		seenPorts.add(port);
		services.push({
			id: `listener-${pid}-${port}`,
			kind: "listener",
			port,
			url: `http://localhost:${port}`,
			processName: processMatch?.[1] ?? "Workspace listener",
			pid,
			cwd: processCwd,
		});
	}
	const composeFiles = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
	const hasComposeFile = (
		await Promise.all(
			composeFiles.map(async (file) => {
				try {
					return (await stat(resolve(projectRoot, file))).isFile();
				} catch {
					return false;
				}
			}),
		)
	).some(Boolean);
	if (hasComposeFile) {
		const compose = await runCommand("docker", ["compose", "ps", "--format", "json"], projectRoot, true);
		const output = compose.stdout.trim();
		let processes: DockerComposeProcess[] = [];
		try {
			const parsed: unknown = output.startsWith("[")
				? JSON.parse(output)
				: output
						.split("\n")
						.filter(Boolean)
						.map((line) => JSON.parse(line));
			if (Array.isArray(parsed)) processes = parsed as DockerComposeProcess[];
		} catch {
			processes = [];
		}
		for (const process of processes) {
			for (const publisher of process.Publishers ?? []) {
				const port = publisher.PublishedPort;
				if (!Number.isInteger(port) || !port || port <= 0 || seenPorts.has(port)) continue;
				seenPorts.add(port);
				services.push({
					id: `listener-docker-${process.Name ?? process.Service ?? "service"}-${port}`,
					kind: "listener",
					port,
					url: `http://localhost:${port}`,
					processName: `Docker ${process.Service ?? process.Name ?? "service"}`,
					pid: 0,
					cwd: projectRoot,
				});
			}
		}
	}
	return services.sort((left, right) => (left.port ?? 0) - (right.port ?? 0));
}

export function openLocalUrl(target: string): void {
	const url = new URL(target);
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		!["localhost", "127.0.0.1", "::1"].includes(url.hostname)
	) {
		throw new Error("Only local HTTP services can be opened from the workspace panel.");
	}
	openBrowser(url.toString());
}
