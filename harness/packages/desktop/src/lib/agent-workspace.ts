import type { CodingHarnessBridgeEvent, FeedItem, TimelineItem, TimelineTone, WorkerRole } from "./model.ts";

export interface WorkspaceEditDraft {
	content: string;
	original: string;
}

export function teamRoleChange(
	role: WorkerRole,
	taskActive: boolean,
): { pendingRole?: WorkerRole; applyRole?: WorkerRole } {
	return taskActive ? { pendingRole: role } : { applyRole: role };
}

export function agentFeedItems(items: readonly FeedItem[], agentId: string, clearThrough: number): FeedItem[] {
	return items.filter(
		(item) =>
			item.id > clearThrough &&
			(item.type === "message" ? item.message.agentId === agentId : item.activity.agentId === agentId),
	);
}

export function bridgeEventCard(event: CodingHarnessBridgeEvent): {
	dedupeId: string;
	title: string;
	detail: string;
	tone: TimelineTone;
	status: TimelineItem["status"];
	bridgeStatus: CodingHarnessBridgeEvent["status"];
	agentId?: string;
} {
	const noDelegation = event.event === "NO_DELEGATION";
	const statusLabel = event.status.charAt(0).toUpperCase() + event.status.slice(1);
	const taskLabel = noDelegation ? "No delegation" : event.parentTaskId ? "↳ Peer task" : "Root task";
	const terminalError = event.status === "failed" || event.status === "cancelled";
	return {
		dedupeId: noDelegation
			? `bridge-${event.correlationId}-no-delegation`
			: `bridge-${event.correlationId}-${event.taskId}`,
		title: `${taskLabel} · ${statusLabel}`,
		detail: [
			event.reason,
			`${event.sender} → ${event.recipient}`,
			`Task ${event.taskId}${event.parentTaskId ? ` · parent ${event.parentTaskId}` : ""}`,
			event.harness && event.model ? `${event.harness} / ${event.model}` : undefined,
			event.nativeSessionId ? `Native session ${event.nativeSessionId}` : undefined,
			event.artifact ? `Artifact ${event.artifact.kind}: ${event.artifact.reference}` : undefined,
		]
			.filter((value): value is string => Boolean(value))
			.join("\n"),
		tone: terminalError ? "red" : event.status === "completed" ? "green" : "amber",
		status: terminalError ? "error" : event.status === "completed" ? "settled" : "running",
		bridgeStatus: event.status,
		...(event.agentId ? { agentId: event.agentId } : {}),
	};
}

export function resolveWorkspaceEditDraft(
	drafts: Readonly<Record<string, WorkspaceEditDraft>>,
	path: string,
	loadedContent: string,
): WorkspaceEditDraft {
	const existing = drafts[path];
	if (!existing || (existing.content === existing.original && existing.original !== loadedContent)) {
		return { content: loadedContent, original: loadedContent };
	}
	return existing;
}

export function setWorkspaceEditDraft(
	drafts: Readonly<Record<string, WorkspaceEditDraft>>,
	path: string,
	content: string,
	original: string,
): Record<string, WorkspaceEditDraft> {
	return { ...drafts, [path]: { content, original } };
}

export function workspaceEditDraftKey(projectRoot: string, path: string): string {
	return `${projectRoot}\0${path}`;
}

export function preventDesktopContextMenu(event: Pick<Event, "preventDefault">): void {
	event.preventDefault();
}
