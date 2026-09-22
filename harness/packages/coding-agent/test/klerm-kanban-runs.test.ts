import { describe, expect, it } from "vitest";
import { type KanbanRegistry, normalizeKanbanRegistry } from "../src/klerm/kanban.ts";
import {
	advanceKanbanRunAttempt,
	createKanbanRunAttempt,
	effectiveKanbanTaskPrompt,
	findDueKanbanTasks,
	finishKanbanRunAttempt,
	kanbanTaskSystemGuidance,
	markInterruptedKanbanTasks,
	nextRepeatAt,
	validateRunnableKanbanTask,
} from "../src/klerm/kanban-runs.ts";

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

describe("effectiveKanbanTaskPrompt", () => {
	it("requires an explicit brief and never falls back to the title", () => {
		expect(effectiveKanbanTaskPrompt({ title: "Inspect workspace health", prompt: "  " })).toBe("");
		expect(effectiveKanbanTaskPrompt({ title: "Fallback", prompt: "Run the focused check" })).toBe(
			"Run the focused check",
		);
	});
});

describe("kanbanTaskSystemGuidance", () => {
	it.each([
		["build", "Implement the requested behavior"],
		["fix", "Reproduce or establish the reported failure"],
		["review", "findings first"],
		["research", "evidence-based conclusions"],
		["maintenance", "bounded maintenance"],
	] as const)("adds targeted %s guidance", (kind, expected) => {
		const guidance = kanbanTaskSystemGuidance(kind, false);
		expect(guidance).toContain(`Current task type: ${kind}.`);
		expect(guidance).toContain(expected);
		expect(guidance).not.toContain("Kanban task type guidance:");
	});

	it("lists every type for Auto model selection and clearly selects the card type", () => {
		const guidance = kanbanTaskSystemGuidance("review", true);
		for (const kind of ["build", "fix", "review", "research", "maintenance"] as const) {
			expect(guidance).toContain(`${kind}:`);
		}
		expect(guidance).toContain("Current task type: review. Follow the review guidance for this run.");
	});
});

describe("validateRunnableKanbanTask", () => {
	it("requires title, brief, and folder", () => {
		expect(validateRunnableKanbanTask({ title: "  ", prompt: "work", workspaceRoot: "/tmp" })).toEqual(["title"]);
		expect(validateRunnableKanbanTask({ title: "Task", prompt: "  ", workspaceRoot: "/tmp" })).toEqual([
			"task brief",
		]);
		expect(validateRunnableKanbanTask({ title: "", prompt: "", workspaceRoot: "" })).toEqual([
			"title",
			"task brief",
			"task folder",
		]);
		expect(validateRunnableKanbanTask({ title: "Task", prompt: "work", workspaceRoot: "/tmp" })).toEqual([]);
	});
});

describe("kanban run attempts", () => {
	it("creates, advances, and finishes attempts without losing provider errors", () => {
		const attempt = createKanbanRunAttempt(
			{ runCount: 2, workspaceRoot: "/tmp", reasoning: "medium" },
			"attempt-1",
			"provider/model",
			"2026-09-20T10:00:00.000Z",
		);
		expect(attempt.sequence).toBe(3);
		expect(attempt.steps.map((step) => step.status)).toEqual(["completed", "active", "pending", "pending"]);
		const advanced = advanceKanbanRunAttempt(attempt, "execute");
		expect(advanced.steps.map((step) => step.status)).toEqual(["completed", "completed", "active", "pending"]);
		const failed = finishKanbanRunAttempt(advanced, "failed", "2026-09-20T10:01:00.000Z", {
			error: "Provider returned an error.",
			stopReason: "error",
		});
		expect(failed.status).toBe("failed");
		expect(failed.error).toBe("Provider returned an error.");
		expect(failed.stopReason).toBe("error");
	});

	it("preserves attempt bounds and history through normalization", () => {
		const registry = normalizeKanbanRegistry({
			version: 1,
			boards: [
				{
					id: "board-1",
					name: "Board",
					workspaceRoot: "/tmp",
					createdAt: "2026-09-20T10:00:00.000Z",
					updatedAt: "2026-09-20T10:00:00.000Z",
					createdSequence: 1,
					tasks: [
						{
							id: "task-1",
							title: "",
							prompt: "",
							workspaceRoot: "",
							kind: "build",
							reasoning: "",
							status: "ideas",
							createdAt: "2026-09-20T10:00:00.000Z",
							updatedAt: "2026-09-20T10:00:00.000Z",
							createdSequence: 1,
							attempts: [
								{
									id: "attempt-1",
									sequence: 1,
									status: "failed",
									startedAt: "2026-09-20T10:00:00.000Z",
									model: "provider/model",
									reasoning: "medium",
									workspaceRoot: "/tmp",
									error: "Provider returned an error.",
									steps: [
										{ id: "brief", label: "Read the task brief", status: "completed" },
										{ id: "bogus", label: "x", status: "bogus" },
									],
								},
							],
						},
					],
				},
			],
		});
		const task = registry.boards[0]!.tasks[0]!;
		expect(task.title).toBe("");
		expect(task.attempts?.length).toBe(1);
		expect(task.attempts?.[0]?.error).toBe("Provider returned an error.");
		expect(task.attempts?.[0]?.steps.map((step) => step.id)).toEqual(["brief"]);
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

	it("marks the active attempt interrupted", () => {
		const attempt = createKanbanRunAttempt(
			{ runCount: 0, workspaceRoot: "/tmp", reasoning: "medium" },
			"attempt-1",
			"provider/model",
			"2026-09-20T09:00:00.000Z",
		);
		const registry = registryWith([
			{
				id: "stale",
				status: "running",
				runStatus: "running",
				runStartedAt: "2026-09-20T09:00:00.000Z",
				attempts: [attempt],
			},
		]);
		const { registry: next } = markInterruptedKanbanTasks(
			registry,
			"2026-09-20T10:00:00.000Z",
			"Backend restarted during run.",
		);
		const stale = next.boards[0]!.tasks.find((task) => task.id === "stale")!;
		expect(stale.attempts?.[0]?.status).toBe("interrupted");
		expect(stale.attempts?.[0]?.error).toBe("Backend restarted during run.");
	});
});
