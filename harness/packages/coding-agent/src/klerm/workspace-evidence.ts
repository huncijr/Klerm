import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { KLERM_DECISION_LOG_DIRECTORY, KLERM_DECISION_LOG_FILE } from "./router/decision-log.ts";

export interface KlermWorkspaceSnapshot {
	root: string;
	files: Map<string, string>;
}

function runGit(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolveResult) => {
		execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
			resolveResult(error ? undefined : stdout);
		});
	});
}

function hashFile(path: string): Promise<string> {
	return new Promise((resolveHash) => {
		const digest = createHash("sha256");
		const stream = createReadStream(path);
		stream.on("data", (chunk) => digest.update(chunk));
		stream.on("error", () => resolveHash("missing"));
		stream.on("end", () => resolveHash(digest.digest("hex")));
	});
}

export async function captureKlermWorkspaceSnapshot(cwd: string): Promise<KlermWorkspaceSnapshot | undefined> {
	const root = (await runGit(["rev-parse", "--show-toplevel"], cwd))?.trim();
	if (!root) return undefined;
	const output = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
	if (output === undefined) return undefined;
	const fields = output.split("\0");
	const files = new Map<string, string>();
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index];
		if (!field || field.length < 4) continue;
		const status = field.slice(0, 2);
		const path = field.slice(3);
		const absolutePath = resolve(root, path);
		if (
			basename(absolutePath) !== KLERM_DECISION_LOG_FILE ||
			basename(dirname(absolutePath)) !== KLERM_DECISION_LOG_DIRECTORY
		) {
			files.set(absolutePath, `${status}:${await hashFile(absolutePath)}`);
		}
		if (status.includes("R")) index++;
	}
	return { root, files };
}

export function changedKlermWorkspacePaths(before: KlermWorkspaceSnapshot, after: KlermWorkspaceSnapshot): Set<string> {
	if (before.root !== after.root) return new Set(after.files.keys());
	const paths = new Set([...before.files.keys(), ...after.files.keys()]);
	return new Set([...paths].filter((path) => before.files.get(path) !== after.files.get(path)));
}
