export const KANBAN_REGISTRY_VERSION = 1;

export type KanbanTaskKind = "auto" | "build" | "fix" | "review" | "research" | "maintenance";
export type KanbanTaskStatus = "ideas" | "planned" | "ready" | "running" | "waiting" | "review" | "done";

export type KanbanRunStatus = "idle" | "running" | "succeeded" | "failed" | "stopped";
export type KanbanAttemptStatus = "running" | "succeeded" | "failed" | "stopped" | "interrupted";
export type KanbanAttemptStepStatus = "pending" | "active" | "completed" | "failed" | "skipped";
export interface KanbanActivityRecord {
	boardId: string;
	taskId: string;
	timestamp: string;
	kind: string;
	text: string;
	sequence?: number;
	attemptId?: string;
	workspaceRoot?: string;
	mode?: string;
	agent?: string;
}
export interface KanbanAttemptEvidence {
	mode: string;
	workspaceRoot: string;
	changedFiles: string[];
	verification: string[];
	outcome: string;
}

const runStatuses: Set<string> = new Set(["idle", "running", "succeeded", "failed", "stopped"]);
const attemptStatuses: Set<string> = new Set(["running", "succeeded", "failed", "stopped", "interrupted"]);
const attemptStepStatuses: Set<string> = new Set(["pending", "active", "completed", "failed", "skipped"]);

export interface KanbanAttemptStep {
	id: string;
	label: string;
	status: KanbanAttemptStepStatus;
}

export interface KanbanRunAttempt {
	mode?: string;
	agentName?: string;
	evidence?: KanbanAttemptEvidence;
	activity?: KanbanActivityRecord[];
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
	personalBotId?: string;
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
const kinds = new Set<KanbanTaskKind>(["auto", "build", "fix", "review", "research", "maintenance"]);

export function normalizeKanbanEvidence(value: object): KanbanAttemptEvidence {
	const input = value as Record<string, unknown>;
	return {
		mode: typeof input.mode === "string" ? input.mode.slice(0, 30) : "unknown",
		workspaceRoot: typeof input.workspaceRoot === "string" ? input.workspaceRoot : "",
		changedFiles: Array.isArray(input.changedFiles)
			? input.changedFiles.filter((item): item is string => typeof item === "string").slice(0, 5000)
			: [],
		verification: Array.isArray(input.verification)
			? input.verification.filter((item): item is string => typeof item === "string").slice(-100)
			: [],
		outcome: typeof input.outcome === "string" ? input.outcome.slice(0, 80) : "unknown",
	};
}

export function normalizeKanbanActivity(value: unknown): KanbanActivityRecord[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const input = value as Record<string, unknown>;
	if (
		typeof input.boardId !== "string" ||
		typeof input.taskId !== "string" ||
		typeof input.timestamp !== "string" ||
		typeof input.kind !== "string" ||
		typeof input.text !== "string"
	)
		return [];
	return [
		{
			boardId: input.boardId,
			taskId: input.taskId,
			timestamp: input.timestamp,
			kind: input.kind.slice(0, 80),
			text: input.text.slice(0, 500),
			...(typeof input.sequence === "number" && Number.isSafeInteger(input.sequence) && input.sequence > 0
				? { sequence: input.sequence }
				: {}),
			...(typeof input.attemptId === "string" ? { attemptId: input.attemptId } : {}),
			...(typeof input.workspaceRoot === "string" ? { workspaceRoot: input.workspaceRoot } : {}),
			...(typeof input.mode === "string" ? { mode: input.mode.slice(0, 30) } : {}),
			...(typeof input.agent === "string" ? { agent: input.agent.slice(0, 80) } : {}),
		},
	];
}

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
						: "auto";
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
							...(typeof attempt.result === "string" ? { result: attempt.result.slice(0, 32_000) } : {}),
							...(typeof attempt.mode === "string" ? { mode: attempt.mode } : {}),
							...(typeof attempt.agentName === "string" ? { agentName: attempt.agentName.slice(0, 80) } : {}),
							...(attempt.evidence && typeof attempt.evidence === "object"
								? { evidence: normalizeKanbanEvidence(attempt.evidence) }
								: {}),
							...(Array.isArray(attempt.activity)
								? { activity: attempt.activity.flatMap(normalizeKanbanActivity).slice(-100) }
								: {}),
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
					...(typeof task.personalBotId === "string" ? { personalBotId: task.personalBotId } : {}),
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
					...(typeof task.lastResult === "string" ? { lastResult: task.lastResult.slice(0, 32_000) } : {}),
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
