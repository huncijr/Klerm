import { describe, expect, it } from "vitest";
import type { KanbanRegistry } from "../src/klerm/kanban.ts";
import { findDueKanbanTasks, markInterruptedKanbanTasks, nextRepeatAt } from "../src/klerm/kanban-runs.ts";

function registryWith(
	tasks: Array<Partial<import("../src/klerm/kanban.ts").KanbanTask> & { id: string }>,
): KanbanRegistry {
	const now = "2026-09-20T10:00:00.000Z";
	return {
		version: 1,
		boards: [
			{
				id: "board-1",
				name: "Board",
				workspaceRoot: "/tmp",
				createdAt: now,
				updatedAt: now,
				createdSequence: 1,
				tasks: tasks.map((task, index) => ({
					title: task.id,
					prompt: "do it",
					workspaceRoot: "/tmp",
					kind: "build" as const,
					reasoning: "medium",
					status: "ready" as const,
					createdAt: now,
					updatedAt: now,
					createdSequence: index + 1,
					...task,
				})),
			},
		],
	};
}

describe("findDueKanbanTasks", () => {
	it("returns past-scheduled idle tasks in schedule order and skips running tasks", () => {
		const registry = registryWith([
			{ id: "later", scheduledAt: "2026-09-20T10:05:00.000Z" },
			{ id: "due-first", scheduledAt: "2026-09-20T09:00:00.000Z" },
			{ id: "due-second", scheduledAt: "2026-09-20T09:30:00.000Z" },
			{ id: "future", scheduledAt: "2026-09-20T11:00:00.000Z" },
			{ id: "busy", scheduledAt: "2026-09-20T08:00:00.000Z", runStatus: "running" },
			{ id: "unscheduled" },
		]);
		const due = findDueKanbanTasks(registry, Date.parse("2026-09-20T10:00:00.000Z"));
		expect(due.map((task) => task.taskId)).toEqual(["due-first", "due-second"]);
	});
});

describe("nextRepeatAt", () => {
	it("advances by whole repeat minutes", () => {
		expect(nextRepeatAt(Date.parse("2026-09-20T10:00:00.000Z"), 30)).toBe("2026-09-20T10:30:00.000Z");
	});
});

describe("markInterruptedKanbanTasks", () => {
	it("moves stale running tasks back to waiting with a reason", () => {
		const registry = registryWith([
			{ id: "stale", status: "running", runStatus: "running", runStartedAt: "2026-09-20T09:00:00.000Z" },
			{ id: "calm", status: "ready", runStatus: "succeeded" },
		]);
		const { registry: next, interrupted } = markInterruptedKanbanTasks(
			registry,
			"2026-09-20T10:00:00.000Z",
			"Backend restarted during run.",
		);
		expect(interrupted).toEqual([{ boardId: "board-1", taskId: "stale" }]);
		const stale = next.boards[0]!.tasks.find((task) => task.id === "stale")!;
		expect(stale.status).toBe("waiting");
		expect(stale.runStatus).toBe("failed");
		expect(stale.runError).toBe("Backend restarted during run.");
		const calm = next.boards[0]!.tasks.find((task) => task.id === "calm")!;
		expect(calm.runStatus).toBe("succeeded");
	});
});
