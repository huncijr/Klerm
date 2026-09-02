import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	getRunningServices,
	getWorkspaceDiff,
	getWorkspaceStatus,
	openLocalUrl,
	readWorkspaceTextFile,
	writeWorkspaceTextFile,
} from "../src/modes/rpc/workspace.ts";

describe("desktop workspace RPC helpers", () => {
	let tempDir: string | undefined;

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	});

	test("detects Git state, returns diffs, and confines text edits to the project", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "klerm-workspace-rpc-"));
		execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
		execFileSync("git", ["config", "user.email", "klerm@example.invalid"], { cwd: tempDir });
		execFileSync("git", ["config", "user.name", "Klerm Test"], { cwd: tempDir });
		writeFileSync(join(tempDir, "tracked.txt"), "before\n", "utf8");
		writeFileSync(join(tempDir, "renamed-before.txt"), "rename me\n", "utf8");
		execFileSync("git", ["add", "tracked.txt", "renamed-before.txt"], { cwd: tempDir });
		execFileSync("git", ["commit", "-m", "initial"], { cwd: tempDir, stdio: "ignore" });

		const nested = join(tempDir, "nested");
		mkdirSync(nested);
		writeFileSync(join(tempDir, "tracked.txt"), "after\n", "utf8");
		writeFileSync(join(tempDir, "new.txt"), "new\n", "utf8");
		writeFileSync(join(tempDir, "binary.dat"), Buffer.from([1, 0, 2]));
		execFileSync("git", ["mv", "renamed-before.txt", "renamed-after.txt"], { cwd: tempDir });

		const workspace = await getWorkspaceStatus(
			nested,
			new Map([
				["tracked.txt", { source: "local" as const, lane: "local" as const, provider: "ollama", model: "qwen" }],
			]),
		);
		expect(workspace).toMatchObject({ isGit: true, workspaceRoot: nested, projectRoot: tempDir, gitRoot: tempDir });
		expect(workspace.files).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "tracked.txt",
					status: "modified",
					attribution: expect.objectContaining({ source: "local" }),
				}),
				expect.objectContaining({ path: "new.txt", status: "untracked", attribution: { source: "external" } }),
				expect.objectContaining({
					path: "renamed-after.txt",
					oldPath: "renamed-before.txt",
					status: "renamed",
					staged: true,
				}),
			]),
		);

		const diff = await getWorkspaceDiff(nested, "tracked.txt");
		expect(diff.diff).toContain("-before");
		expect(diff.diff).toContain("+after");

		const preview = await readWorkspaceTextFile(nested, "tracked.txt");
		expect(preview.content).toBe("after\n");
		await writeWorkspaceTextFile(nested, "tracked.txt", "manual\n");
		expect((await readWorkspaceTextFile(nested, "tracked.txt")).content).toBe("manual\n");
		await expect(writeWorkspaceTextFile(nested, "binary.dat", "replacement\n")).rejects.toThrow(
			"Binary files cannot be edited",
		);
		await expect(readWorkspaceTextFile(nested, "../outside.txt")).rejects.toThrow("outside the workspace");
		expect(() => openLocalUrl("https://example.com")).toThrow("Only local HTTP services");

		const processes = await getRunningServices(nested);
		expect(processes[0]).toMatchObject({ kind: "backend", processName: "Klerm backend", cwd: nested });
		expect(
			processes
				.filter((process) => process.kind === "listener")
				.every((process) => process.cwd.startsWith(tempDir!)),
		).toBe(true);
	});
});
