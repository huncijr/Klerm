import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { redactBrowserSecretText } from "./browser-agent.ts";
import type { KanbanTaskKind } from "./kanban.ts";

export type KanbanMode = "build" | "review" | "research" | "plan";
export interface KanbanEvidence {
	mode: KanbanMode;
	workspaceRoot: string;
	changedFiles: string[];
	verification: string[];
	outcome: "implemented-verified" | "analysis-only" | "no-changes" | "unverified";
}
export interface KanbanFolderSnapshot {
	root: string;
	files: Map<string, string>;
}

export function kanbanMode(kind: KanbanTaskKind, brief: string): KanbanMode {
	if (kind === "review" || kind === "research") return kind;
	if (
		/\b(?:plan|proposal|guide|snippets?)\s+only\b|\b(?:provide|give|prepare)\b[\s\S]{0,60}\b(?:plan|implementation outline)\b|\bcsak\s+(?:terv|javaslat)\b/i.test(
			brief,
		)
	)
		return "plan";
	if (kind === "build" || kind === "fix" || kind === "maintenance") return "build";
	if (/^(?:review|inspect|audit|check|vizsg[aá]ld|ellen[oő]riz)/i.test(brief.trim())) return "review";
	if (/^(?:research|investigate|keress|n[eé]zz)/i.test(brief.trim())) return "research";
	return /\b(?:implement|build|fix|create|write|edit|modify|refactor|scaffold|install|configure|k[eé]sz[ií]ts|jav[ií]tsd|implement[aá]ld|csin[aá]ld)\b/i.test(
		brief,
	)
		? "build"
		: "plan";
}

const ignored = new Set([".git", ".klerm", "node_modules", ".venv", "dist", "build", "target", ".next", "__pycache__"]);
/** Snapshot source files even in an empty, non-Git task folder. Never follow symlinks. */
export async function captureKanbanFolder(cwd: string): Promise<KanbanFolderSnapshot> {
	const root = await realpath(cwd);
	if (!(await stat(root)).isDirectory()) throw new Error("Kanban task folder is not a directory.");
	const files = new Map<string, string>();
	async function visit(directory: string): Promise<void> {
		const entries = await readdir(directory, { withFileTypes: true });
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) {
				if (files.size >= 5000) throw new Error("Task folder is too large for complete execution evidence.");
				const size = (await stat(path)).size;
				if (size > 10 * 1024 * 1024)
					throw new Error(
						`Task folder exceeds the 10 MiB per-file execution evidence limit: ${relative(root, path)}`,
					);
				files.set(
					path,
					createHash("sha256")
						.update(await readFile(path))
						.digest("hex"),
				);
			}
		}
	}
	await visit(root);
	return { root, files };
}

export function kanbanChangedFiles(before: KanbanFolderSnapshot, after: KanbanFolderSnapshot): string[] {
	return [...new Set([...before.files.keys(), ...after.files.keys()])]
		.filter((path) => before.files.get(path) !== after.files.get(path))
		.map((path) => relative(after.root, path))
		.sort();
}

export function isKanbanCheck(command: string): boolean {
	if (/\|\||[;|>`]|\$\(|\n|\r|--help|--version/.test(command)) return false;
	const parts = command.split("&&").map((part) => part.trim());
	const check =
		/^(?:npm\s+(?:test|run\s+(?:check|test|typecheck|build)(?::[\w-]+)?)|npx\s+(?:vitest|tsc|svelte-check)|node\s+(?:--check|--test)|node\s+[^;&|>]*vitest[^;&|>]*--run|cargo\s+(?:check|test|build)|python(?:3)?\s+-m\s+(?:unittest|pytest|compileall)|pytest|tsc)(?:\s|$)/;
	return (
		parts.some((part) => check.test(part)) &&
		parts.every((part) => check.test(part) || /^cd\s+(?:[\w./-]+|"[^"\n]+"|'[^'\n]+')$/.test(part))
	);
}

export function describeKanbanTool(
	name: string,
	args: unknown,
): { kind: string; text: string; path?: string; command?: string } {
	const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
	const path = typeof input.path === "string" ? redactBrowserSecretText(input.path) : undefined;
	const command = typeof input.command === "string" ? redactBrowserSecretText(input.command) : undefined;
	const kind = name === "write" ? "writing" : name === "edit" ? "editing" : name === "bash" ? "command" : "reading";
	return {
		kind,
		text:
			name === "write"
				? `Writing ${path ?? "file"}`
				: name === "edit"
					? `Editing ${path ?? "file"}`
					: name === "bash"
						? `Running ${command ?? "command"}`
						: `${name}: ${path ?? (typeof input.url === "string" ? redactBrowserSecretText(input.url) : "workspace")}`,
		path,
		command,
	};
}

export function assessKanbanEvidence(
	mode: KanbanMode,
	before: KanbanFolderSnapshot,
	after: KanbanFolderSnapshot,
	mutationSequence: number,
	verificationSequence: number,
	checks: string[],
): KanbanEvidence {
	const changedFiles = kanbanChangedFiles(before, after);
	const outcome =
		mode !== "build"
			? "analysis-only"
			: !changedFiles.length || !mutationSequence
				? "no-changes"
				: verificationSequence <= mutationSequence || !checks.length
					? "unverified"
					: "implemented-verified";
	return { mode, workspaceRoot: resolve(after.root), changedFiles, verification: [...checks], outcome };
}
