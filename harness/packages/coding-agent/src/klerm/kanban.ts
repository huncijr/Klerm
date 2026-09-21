export const KANBAN_REGISTRY_VERSION = 1;

export type KanbanTaskKind = "build" | "fix" | "review" | "research" | "maintenance";
export type KanbanTaskStatus = "ideas" | "planned" | "ready" | "running" | "waiting" | "review" | "done";

export type KanbanRunStatus = "idle" | "running" | "succeeded" | "failed" | "stopped";
export type KanbanAttemptStatus = "running" | "succeeded" | "failed" | "stopped" | "interrupted";
export type KanbanAttemptStepStatus = "pending" | "active" | "completed" | "failed";

const runStatuses: Set<string> = new Set(["idle", "running", "succeeded", "failed", "stopped"]);
const attemptStatuses: Set<string> = new Set(["running", "succeeded", "failed", "stopped", "interrupted"]);
const attemptStepStatuses: Set<string> = new Set(["pending", "active", "completed", "failed"]);

export interface KanbanAttemptStep {
	id: string;
	label: string;
	status: KanbanAttemptStepStatus;
}

export interface KanbanRunAttempt {
	id: string;
	sequence: number;
	status: KanbanAttemptStatus;
	startedAt: string;
	finishedAt?: string;
	model: string;
	reasoning: string;
	workspaceRoot: string;
	stopReason?: string;
	error?: string;
	result?: string;
	steps: KanbanAttemptStep[];
}

export interface KanbanTask {
	id: string;
	title: string;
	prompt: string;
	workspaceRoot: string;
	kind: KanbanTaskKind;
	model?: string;
	reasoning: string;
	status: KanbanTaskStatus;
	targetMinutes?: number;
	repeatMinutes?: number;
	scheduledAt?: string;
	runStartedAt?: string;
	runStatus?: KanbanRunStatus;
	runCount?: number;
	runError?: string;
	lastRunAt?: string;
	lastResult?: string;
	attempts?: KanbanRunAttempt[];
	createdAt: string;
	updatedAt: string;
	createdSequence: number;
}

export interface KanbanBoard {
	id: string;
	name: string;
	workspaceRoot: string;
	createdAt: string;
	updatedAt: string;
	createdSequence: number;
	tasks: KanbanTask[];
}

export interface KanbanRegistry {
	version: typeof KANBAN_REGISTRY_VERSION;
	boards: KanbanBoard[];
}

const statuses = new Set<KanbanTaskStatus>(["ideas", "planned", "ready", "running", "waiting", "review", "done"]);
const kinds = new Set<KanbanTaskKind>(["build", "fix", "review", "research", "maintenance"]);

export function normalizeKanbanRegistry(value: unknown): KanbanRegistry {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { version: KANBAN_REGISTRY_VERSION, boards: [] };
	const input = value as Record<string, unknown>;
	const boards: KanbanBoard[] = [];
	if (!Array.isArray(input.boards)) return { version: KANBAN_REGISTRY_VERSION, boards };
	for (const candidate of input.boards.slice(0, 100)) {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
		const board = candidate as Record<string, unknown>;
		if (typeof board.id !== "string" || typeof board.name !== "string" || typeof board.workspaceRoot !== "string")
			continue;
		const tasks: KanbanTask[] = [];
		if (Array.isArray(board.tasks))
			for (const taskValue of board.tasks.slice(0, 500)) {
				if (!taskValue || typeof taskValue !== "object" || Array.isArray(taskValue)) continue;
				const task = taskValue as Record<string, unknown>;
				if (
					typeof task.id !== "string" ||
					typeof task.title !== "string" ||
					typeof task.prompt !== "string" ||
					typeof task.workspaceRoot !== "string"
				)
					continue;
				const status =
					typeof task.status === "string" && statuses.has(task.status as KanbanTaskStatus)
						? (task.status as KanbanTaskStatus)
						: "ideas";
				const kind =
					typeof task.kind === "string" && kinds.has(task.kind as KanbanTaskKind)
						? (task.kind as KanbanTaskKind)
						: "build";
				const attempts: KanbanRunAttempt[] = [];
				if (Array.isArray(task.attempts))
					for (const attemptValue of task.attempts.slice(-20)) {
						if (!attemptValue || typeof attemptValue !== "object" || Array.isArray(attemptValue)) continue;
						const attempt = attemptValue as Record<string, unknown>;
						if (
							typeof attempt.id !== "string" ||
							typeof attempt.sequence !== "number" ||
							typeof attempt.status !== "string" ||
							!attemptStatuses.has(attempt.status) ||
							typeof attempt.startedAt !== "string" ||
							typeof attempt.model !== "string" ||
							typeof attempt.reasoning !== "string" ||
							typeof attempt.workspaceRoot !== "string"
						)
							continue;
						const steps: KanbanAttemptStep[] = [];
						if (Array.isArray(attempt.steps))
							for (const stepValue of attempt.steps.slice(0, 12)) {
								if (!stepValue || typeof stepValue !== "object" || Array.isArray(stepValue)) continue;
								const step = stepValue as Record<string, unknown>;
								if (
									typeof step.id === "string" &&
									typeof step.label === "string" &&
									typeof step.status === "string" &&
									attemptStepStatuses.has(step.status)
								)
									steps.push({
										id: step.id.slice(0, 100),
										label: step.label.slice(0, 160),
										status: step.status as KanbanAttemptStepStatus,
									});
							}
						attempts.push({
							id: attempt.id.slice(0, 100),
							sequence: Math.max(1, Math.floor(attempt.sequence)),
							status: attempt.status as KanbanAttemptStatus,
							startedAt: attempt.startedAt,
							model: attempt.model.slice(0, 200),
							reasoning: attempt.reasoning.slice(0, 30),
							workspaceRoot: attempt.workspaceRoot,
							...(typeof attempt.finishedAt === "string" ? { finishedAt: attempt.finishedAt } : {}),
							...(typeof attempt.stopReason === "string"
								? { stopReason: attempt.stopReason.slice(0, 100) }
								: {}),
							...(typeof attempt.error === "string" ? { error: attempt.error.slice(0, 1000) } : {}),
							...(typeof attempt.result === "string" ? { result: attempt.result.slice(0, 4000) } : {}),
							steps,
						});
					}
				tasks.push({
					id: task.id,
					title: task.title.slice(0, 160),
					prompt: task.prompt.slice(0, 8000),
					workspaceRoot: task.workspaceRoot,
					kind,
					status,
					reasoning: typeof task.reasoning === "string" ? task.reasoning : "medium",
					...(typeof task.model === "string" ? { model: task.model } : {}),
					...(typeof task.targetMinutes === "number" ? { targetMinutes: task.targetMinutes } : {}),
					...(typeof task.repeatMinutes === "number" ? { repeatMinutes: task.repeatMinutes } : {}),
					...(typeof task.scheduledAt === "string" ? { scheduledAt: task.scheduledAt } : {}),
					...(typeof task.runStartedAt === "string" ? { runStartedAt: task.runStartedAt } : {}),
					...(typeof task.runStatus === "string" && runStatuses.has(task.runStatus)
						? { runStatus: task.runStatus as KanbanRunStatus }
						: {}),
					...(typeof task.runCount === "number" && Number.isFinite(task.runCount)
						? { runCount: Math.max(0, Math.floor(task.runCount)) }
						: {}),
					...(typeof task.runError === "string" ? { runError: task.runError.slice(0, 500) } : {}),
					...(typeof task.lastRunAt === "string" ? { lastRunAt: task.lastRunAt } : {}),
					...(typeof task.lastResult === "string" ? { lastResult: task.lastResult.slice(0, 2000) } : {}),
					...(attempts.length > 0 ? { attempts } : {}),
					createdAt: typeof task.createdAt === "string" ? task.createdAt : new Date(0).toISOString(),
					updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : new Date(0).toISOString(),
					createdSequence: typeof task.createdSequence === "number" ? task.createdSequence : tasks.length + 1,
				});
			}
		boards.push({
			id: board.id,
			name: board.name.slice(0, 100),
			workspaceRoot: board.workspaceRoot,
			createdAt: typeof board.createdAt === "string" ? board.createdAt : new Date(0).toISOString(),
			updatedAt: typeof board.updatedAt === "string" ? board.updatedAt : new Date(0).toISOString(),
			createdSequence: typeof board.createdSequence === "number" ? board.createdSequence : boards.length + 1,
			tasks,
		});
	}
	return { version: KANBAN_REGISTRY_VERSION, boards };
}
