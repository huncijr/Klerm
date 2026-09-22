import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KanbanAttemptStatus, KanbanRegistry, KanbanRunAttempt, KanbanTask, KanbanTaskKind } from "./kanban.ts";

export const KANBAN_RUN_LOG_DIRECTORY = ".klerm";
export const KANBAN_RUN_LOG_FILE = "kanban-runs.jsonl";

export type KanbanRunEventType =
	| "RUN_STARTED"
	| "RUN_SUCCEEDED"
	| "RUN_FAILED"
	| "RUN_STOPPED"
	| "RUN_SCHEDULED"
	| "RUN_INTERRUPTED";

export interface KanbanRunEvent {
	version: 1;
	timestamp: string;
	event: KanbanRunEventType;
	boardId: string;
	taskId: string;
	/** Deterministic per-task run number, persisted as KanbanTask.runCount. */
	sequence: number;
	sender: "user" | "klerm-scheduler";
	recipient: "kanban-task";
	status: "running" | "succeeded" | "failed" | "stopped" | "scheduled" | "interrupted";
	reason: string;
	model?: string;
	resultDigest?: string;
}

export interface DueKanbanTask {
	boardId: string;
	taskId: string;
	scheduledAt: string;
}

export function getKanbanRunLogPath(cwd: string): string {
	return join(cwd, KANBAN_RUN_LOG_DIRECTORY, KANBAN_RUN_LOG_FILE);
}

export async function appendKanbanRunEvent(cwd: string, event: KanbanRunEvent): Promise<void> {
	await mkdir(join(cwd, KANBAN_RUN_LOG_DIRECTORY), { recursive: true });
	await appendFile(getKanbanRunLogPath(cwd), `${JSON.stringify(event)}\n`, "utf8");
}

export async function readKanbanRunLog(cwd: string): Promise<string> {
	try {
		return await readFile(getKanbanRunLogPath(cwd), "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
		throw error;
	}
}

/** Tasks whose scheduledAt has passed and which are not currently running. */
export function findDueKanbanTasks(registry: KanbanRegistry, nowMs: number): DueKanbanTask[] {
	const due: DueKanbanTask[] = [];
	for (const board of registry.boards) {
		for (const task of board.tasks) {
			if (task.runStatus === "running") continue;
			if (!task.scheduledAt) continue;
			const scheduledMs = Date.parse(task.scheduledAt);
			if (!Number.isFinite(scheduledMs) || scheduledMs > nowMs) continue;
			due.push({ boardId: board.id, taskId: task.id, scheduledAt: task.scheduledAt });
		}
	}
	due.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
	return due;
}

export function nextRepeatAt(fromMs: number, repeatMinutes: number): string {
	return new Date(fromMs + Math.max(1, Math.round(repeatMinutes)) * 60_000).toISOString();
}

export function effectiveKanbanTaskPrompt(task: Pick<KanbanTask, "prompt" | "title">): string {
	return task.prompt.trim();
}

const kanbanTaskGuidance: Record<KanbanTaskKind, string> = {
	build: "Implement the requested behavior in the workspace. Inspect the relevant code first, make the required changes, run relevant verification, and report concrete results.",
	fix: "Reproduce or establish the reported failure and identify its root cause. Make the smallest correct fix, add regression coverage where practical, run relevant verification, and report concrete results.",
	review:
		"Review the relevant code and evidence with findings first, ordered by severity and including file references. Do not modify files unless the task brief explicitly requests changes.",
	research:
		"Investigate the relevant code and available evidence. Distinguish verified facts from inference, cite concrete sources or file references, and provide evidence-based conclusions without modifying files by default.",
	maintenance:
		"Perform only the bounded maintenance requested, preserve existing behavior outside that scope, run relevant checks, and report exactly what changed.",
};

export function kanbanTaskSystemGuidance(kind: KanbanTaskKind, autoModel: boolean): string {
	const selected = `Current task type: ${kind}. Follow the ${kind} guidance for this run.`;
	if (!autoModel) return `${selected}\n${kanbanTaskGuidance[kind]}`;
	const definitions = (Object.entries(kanbanTaskGuidance) as Array<[KanbanTaskKind, string]>)
		.map(([taskKind, guidance]) => `${taskKind}: ${guidance}`)
		.join("\n");
	return `Kanban task type guidance:\n${definitions}\n\n${selected}`;
}

export function validateRunnableKanbanTask(task: Pick<KanbanTask, "title" | "prompt" | "workspaceRoot">): string[] {
	const missing: string[] = [];
	if (!task.title.trim()) missing.push("title");
	if (!task.prompt.trim()) missing.push("task brief");
	if (!task.workspaceRoot.trim()) missing.push("task folder");
	return missing;
}

export function createKanbanRunAttempt(
	task: Pick<KanbanTask, "runCount" | "workspaceRoot" | "reasoning">,
	id: string,
	model: string,
	startedAt: string,
): KanbanRunAttempt {
	return {
		id,
		sequence: (task.runCount ?? 0) + 1,
		status: "running",
		startedAt,
		model,
		reasoning: task.reasoning,
		workspaceRoot: task.workspaceRoot,
		steps: [
			{ id: "brief", label: "Read the task brief", status: "completed" },
			{ id: "inspect", label: "Inspect the selected folder", status: "active" },
			{ id: "execute", label: "Execute the task", status: "pending" },
			{ id: "report", label: "Verify and report the result", status: "pending" },
		],
	};
}

export function advanceKanbanRunAttempt(
	attempt: KanbanRunAttempt,
	stepId: "inspect" | "execute" | "report",
): KanbanRunAttempt {
	const activeIndex = attempt.steps.findIndex((step) => step.id === stepId);
	if (attempt.status !== "running" || activeIndex < 0) return attempt;
	return {
		...attempt,
		steps: attempt.steps.map((step, index) => ({
			...step,
			status: index < activeIndex ? "completed" : index === activeIndex ? "active" : "pending",
		})),
	};
}

export function finishKanbanRunAttempt(
	attempt: KanbanRunAttempt,
	status: KanbanAttemptStatus,
	finishedAt: string,
	detail: { error?: string; result?: string; stopReason?: string },
): KanbanRunAttempt {
	return {
		...attempt,
		status,
		finishedAt,
		...(detail.error ? { error: detail.error } : {}),
		...(detail.result ? { result: detail.result } : {}),
		...(detail.stopReason ? { stopReason: detail.stopReason } : {}),
		steps: attempt.steps.map((step) => ({
			...step,
			status: status === "succeeded" ? "completed" : step.status === "active" ? "failed" : step.status,
		})),
	};
}

export interface InterruptedKanbanTask {
	boardId: string;
	taskId: string;
}

/**
 * Mark tasks left in `running` state (e.g. after a backend restart) as
 * interrupted so the scheduler never treats a stale run as live.
 */
export function markInterruptedKanbanTasks(
	registry: KanbanRegistry,
	timestamp: string,
	reason: string,
): { registry: KanbanRegistry; interrupted: InterruptedKanbanTask[] } {
	const interrupted: InterruptedKanbanTask[] = [];
	const boards = registry.boards.map((board) => ({
		...board,
		tasks: board.tasks.map((task) => {
			if (task.runStatus !== "running") return task;
			interrupted.push({ boardId: board.id, taskId: task.id });
			const attempts = task.attempts?.map((attempt) =>
				attempt.status === "running"
					? finishKanbanRunAttempt(attempt, "interrupted", timestamp, { error: reason })
					: attempt,
			);
			return {
				...task,
				status: task.status === "running" ? ("waiting" as const) : task.status,
				runStatus: "failed" as const,
				runError: reason,
				lastRunAt: timestamp,
				updatedAt: timestamp,
				...(attempts ? { attempts } : {}),
			};
		}),
	}));
	return { registry: { ...registry, boards }, interrupted };
}
