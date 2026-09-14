import { describe, expect, test, vi } from "vitest";
import {
	agentFeedItems,
	bridgeEventCard,
	preventDesktopContextMenu,
	resolveWorkspaceEditDraft,
	setWorkspaceEditDraft,
	teamRoleChange,
	workspaceEditDraftKey,
} from "../src/lib/agent-workspace.ts";
import type { CodingHarnessBridgeEvent, FeedItem } from "../src/lib/model.ts";

const bridgeEvent = (update: Partial<CodingHarnessBridgeEvent> = {}): CodingHarnessBridgeEvent => ({
	version: 1,
	timestamp: "2026-09-14T00:00:00.000Z",
	event: "TASK_STARTED",
	taskId: "task-1",
	correlationId: "task-1",
	sequence: 1,
	sender: "klerm",
	recipient: "agent6",
	status: "running",
	reason: "start coordinator",
	agentId: "agent6",
	harness: "opencode",
	model: "openai/gpt-5.6-terra",
	...update,
});

describe("desktop agent workspace state", () => {
	test("queues active team role changes for the next prompt", () => {
		expect(teamRoleChange("planner", true)).toEqual({ pendingRole: "planner" });
		expect(teamRoleChange("builder", false)).toEqual({ applyRole: "builder" });
	});

	test("uses stable task ids to update live and replayed bridge cards", () => {
		const started = bridgeEventCard(bridgeEvent());
		const completed = bridgeEventCard(
			bridgeEvent({ event: "TASK_COMPLETED", sequence: 2, status: "completed", reason: "done" }),
		);
		const peer = bridgeEventCard(
			bridgeEvent({ taskId: "task-1-peer-1", parentTaskId: "task-1", agentId: "agent7" }),
		);
		expect(started.dedupeId).toBe(completed.dedupeId);
		expect(completed).toMatchObject({
			title: "Root task · Completed",
			tone: "green",
			status: "settled",
			bridgeStatus: "completed",
		});
		expect(peer).toMatchObject({ title: "↳ Peer task · Running", agentId: "agent7", bridgeStatus: "running" });
	});

	test("clears only one agent view through an output boundary", () => {
		const items: FeedItem[] = [
			{ id: 1, type: "message", message: { id: 1, role: "assistant", text: "old", agentId: "agent6", streaming: false } },
			{
				id: 2,
				type: "activity",
				activity: { id: 2, kind: "bridge", tone: "amber", title: "peer", detail: "", status: "running", open: false, agentId: "agent7" },
			},
			{ id: 3, type: "message", message: { id: 3, role: "assistant", text: "new", agentId: "agent6", streaming: false } },
			{
				id: 4,
				type: "activity",
				activity: { id: 4, kind: "bridge", tone: "green", title: "done", detail: "", status: "settled", open: false, agentId: "agent6" },
			},
		];
		expect(agentFeedItems(items, "agent6", 2).map((item) => item.id)).toEqual([3, 4]);
		expect(agentFeedItems(items, "agent7", 0).map((item) => item.id)).toEqual([2]);
		expect(items).toHaveLength(4);
	});

	test("retains independent file drafts until save or discard", () => {
		const projectA = workspaceEditDraftKey("/project-a", "src/index.ts");
		const projectB = workspaceEditDraftKey("/project-b", "src/index.ts");
		let drafts = setWorkspaceEditDraft({}, projectA, "edited a", "original a");
		drafts = setWorkspaceEditDraft(drafts, projectB, "edited b", "original b");
		expect(resolveWorkspaceEditDraft(drafts, projectA, "new server a")).toEqual({
			content: "edited a",
			original: "original a",
		});
		expect(resolveWorkspaceEditDraft(drafts, projectB, "original b")).toEqual({
			content: "edited b",
			original: "original b",
		});
		drafts = setWorkspaceEditDraft(drafts, projectA, "original a", "original a");
		expect(resolveWorkspaceEditDraft(drafts, projectA, "new server a")).toEqual({
			content: "new server a",
			original: "new server a",
		});
	});

	test("suppresses the desktop webview context menu", () => {
		const preventDefault = vi.fn();
		preventDesktopContextMenu({ preventDefault });
		expect(preventDefault).toHaveBeenCalledOnce();
	});
});
