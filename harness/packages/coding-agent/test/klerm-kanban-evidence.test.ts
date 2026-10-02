import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeKanbanRegistry } from "../src/klerm/kanban.ts";
import {
	assessKanbanEvidence,
	captureKanbanFolder,
	describeKanbanTool,
	isKanbanCheck,
	kanbanChangedFiles,
	kanbanMode,
} from "../src/klerm/kanban-evidence.ts";
import { createKanbanRunAttempt, finishKanbanRunAttempt } from "../src/klerm/kanban-runs.ts";

describe("truthful Kanban evidence", () => {
	it("tracks additions, edits and deletions in non-Git folders and ignores runtime data and symlinks", async () => {
		const root = await mkdtemp(join(tmpdir(), "klerm-evidence-"));
		try {
			await writeFile(join(root, "old.ts"), "before");
			await writeFile(join(root, "edited.ts"), "original");
			const before = await captureKanbanFolder(root);
			await rm(join(root, "old.ts"));
			await writeFile(join(root, "new.ts"), "after");
			await writeFile(join(root, "edited.ts"), "modified");
			await mkdir(join(root, ".klerm"));
			await writeFile(join(root, ".klerm", "events.jsonl"), "runtime");
			await symlink(join(root, ".klerm"), join(root, "linked"));
			const after = await captureKanbanFolder(root);
			expect(kanbanChangedFiles(before, after)).toEqual(["edited.ts", "new.ts", "old.ts"]);
			expect(assessKanbanEvidence("build", before, after, 4, 3, ["npm test"]).outcome).toBe("unverified");
			expect(assessKanbanEvidence("build", before, after, 4, 5, ["npm test"]).outcome).toBe("implemented-verified");
			expect(assessKanbanEvidence("build", before, before, 4, 5, ["npm test"]).outcome).toBe("no-changes");
			expect(assessKanbanEvidence("review", before, before, 0, 0, []).outcome).toBe("analysis-only");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("rejects incomplete evidence rather than silently skipping oversized source files", async () => {
		const root = await mkdtemp(join(tmpdir(), "klerm-evidence-limit-"));
		try {
			const file = join(root, "large.dat");
			await writeFile(file, "");
			await truncate(file, 10 * 1024 * 1024 + 1);
			await expect(captureKanbanFolder(root)).rejects.toThrow("10 MiB");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("does not treat shell success or inspection as verification", () => {
		for (const command of ["git diff", "echo done", "npm test || true", "npm test; true", "npm test --help"])
			expect(isKanbanCheck(command)).toBe(false);
		for (const command of ["npm test", "cd app && npm run build", "node --check app.js"])
			expect(isKanbanCheck(command)).toBe(true);
	});
	it("keeps review and explicit planning read-only and redacts command secrets", () => {
		expect(kanbanMode("review", "Define acceptance criteria and provide an implementation outline")).toBe("review");
		expect(kanbanMode("build", "Provide a plan only")).toBe("plan");
		expect(kanbanMode("auto", "Create a working application")).toBe("build");
		expect(describeKanbanTool("write", { path: "src/app.ts", content: "private body" }).text).toBe(
			"Writing src/app.ts",
		);
		expect(describeKanbanTool("bash", { command: "API_KEY=super-secret npm test" }).text).not.toContain(
			"super-secret",
		);
	});
	it("persists evidence and history without checking unproven execution steps", () => {
		const attempt = createKanbanRunAttempt(
			{ workspaceRoot: "/tmp", reasoning: "medium" },
			"attempt",
			"provider/model",
			"2026-10-02T00:00:00Z",
		);
		const finished = finishKanbanRunAttempt(attempt, "succeeded", "2026-10-02T00:01:00Z", {
			result: "plan",
			evidence: {
				mode: "review",
				workspaceRoot: "/tmp",
				changedFiles: [],
				verification: [],
				outcome: "analysis-only",
			},
		});
		expect(finished.steps.map((step) => step.status)).toEqual(["completed", "skipped", "completed", "completed"]);
		finished.activity = [
			{ boardId: "board", taskId: "task", timestamp: "now", kind: "reading", text: "read: app.ts", sequence: 1 },
		];
		const registry = normalizeKanbanRegistry({
			boards: [
				{
					id: "board",
					name: "Board",
					workspaceRoot: "/tmp",
					tasks: [{ id: "task", title: "Review", prompt: "Review", workspaceRoot: "/tmp", attempts: [finished] }],
				},
			],
		});
		expect(registry.boards[0]?.tasks[0]?.attempts?.[0]?.evidence).toEqual(finished.evidence);
		expect(registry.boards[0]?.tasks[0]?.attempts?.[0]?.activity).toEqual(finished.activity);
	});
});
