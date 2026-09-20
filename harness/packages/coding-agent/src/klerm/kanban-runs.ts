import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KanbanRegistry } from "./kanban.ts";

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
			return {
				...task,
				status: task.status === "running" ? ("waiting" as const) : task.status,
				runStatus: "failed" as const,
				runError: reason,
				lastRunAt: timestamp,
				updatedAt: timestamp,
			};
		}),
	}));
	return { registry: { ...registry, boards }, interrupted };
}
