import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureKlermWorkspaceSnapshot, changedKlermWorkspacePaths } from "../src/klerm/workspace-evidence.ts";

describe("Klerm workspace evidence", () => {
	let tempDir: string | undefined;

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	});

	it("detects a real content change even when the file was already dirty", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "klerm-workspace-evidence-"));
		execFileSync("git", ["init", "--quiet"], { cwd: tempDir });
		writeFileSync(join(tempDir, "app.ts"), "first\n");
		execFileSync("git", ["add", "app.ts"], { cwd: tempDir });
		const before = await captureKlermWorkspaceSnapshot(tempDir);
		writeFileSync(join(tempDir, "app.ts"), "second\n");
		const after = await captureKlermWorkspaceSnapshot(tempDir);

		expect(before).toBeDefined();
		expect(after).toBeDefined();
		expect(changedKlermWorkspacePaths(before!, after!)).toEqual(new Set([resolve(tempDir, "app.ts")]));
	});

	it("does not report a change when the workspace content is unchanged", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "klerm-workspace-evidence-"));
		execFileSync("git", ["init", "--quiet"], { cwd: tempDir });
		const before = await captureKlermWorkspaceSnapshot(tempDir);
		const after = await captureKlermWorkspaceSnapshot(tempDir);

		expect(before).toBeDefined();
		expect(after).toBeDefined();
		expect(changedKlermWorkspacePaths(before!, after!)).toEqual(new Set());
	});

	it("excludes Klerm's own decision log from project change evidence", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "klerm-workspace-evidence-"));
		execFileSync("git", ["init", "--quiet"], { cwd: tempDir });
		const before = await captureKlermWorkspaceSnapshot(tempDir);
		mkdirSync(join(tempDir, ".klerm"));
		writeFileSync(join(tempDir, ".klerm", "router-decisions.jsonl"), "{}\n");
		const after = await captureKlermWorkspaceSnapshot(tempDir);

		expect(before).toBeDefined();
		expect(after).toBeDefined();
		expect(changedKlermWorkspacePaths(before!, after!)).toEqual(new Set());
	});
});
