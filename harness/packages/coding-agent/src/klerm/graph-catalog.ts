import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodingHarnessSetup } from "./coding-harness-setup.ts";
import type { KanbanRegistry } from "./kanban.ts";
import type { PersonalBotConversation } from "./personal-bot-conversations.ts";
import type { PersonalBot } from "./personal-bots.ts";
import {
	type GraphCatalogItem,
	type GraphCatalogPage,
	type GraphCatalogQuery,
	type GraphSourceDetails,
	type GraphSourceRef,
	graphSourceKey,
} from "./workflows.ts";

export interface GraphCatalogContext {
	bots: PersonalBot[];
	kanban: KanbanRegistry;
	harnesses: CodingHarnessSetup;
	agentDir: string;
	conversations?: ReadonlyMap<string, PersonalBotConversation>;
}

async function conversations(context: GraphCatalogContext): Promise<PersonalBotConversation[]> {
	const result: PersonalBotConversation[] = [];
	for (const bot of context.bots) {
		let conversation = context.conversations?.get(bot.id);
		if (!conversation) {
			try {
				const parsed = JSON.parse(
					await readFile(join(context.agentDir, "personal-bots", bot.id, "conversation.json"), "utf8"),
				) as PersonalBotConversation;
				if (
					parsed.version === 1 &&
					parsed.botId === bot.id &&
					typeof parsed.id === "string" &&
					typeof parsed.cwd === "string" &&
					Array.isArray(parsed.messages)
				)
					conversation = parsed;
			} catch (error) {
				if (
					!(error instanceof SyntaxError) &&
					!(error instanceof Error && "code" in error && error.code === "ENOENT")
				)
					throw error;
			}
		}
		if (conversation) result.push(conversation);
	}
	return result;
}

function* catalogItems(context: GraphCatalogContext, chats: PersonalBotConversation[]): Generator<GraphCatalogItem> {
	for (const bot of context.bots) {
		const sourceRef: GraphSourceRef = { kind: "personal-agent", botId: bot.id };
		yield {
			key: graphSourceKey(sourceRef),
			category: "agents",
			nodeKind: "personal-agent",
			title: bot.name,
			subtitle: `${bot.model ?? "No model"} · ${bot.effort}`,
			status: bot.enabled ? "configured" : "disabled",
			workspaceRoot: "",
			sourceRef,
			ownerBotId: bot.id,
			model: bot.model,
			mode: "Personal Agent",
			available: bot.enabled && Boolean(bot.model),
			kanbanEnabled: bot.kanbanEnabled === true,
			explanation: !bot.enabled
				? "Personal Agent is disabled."
				: !bot.kanbanEnabled
					? "Kanban access is disabled; this reference grants no additional permissions."
					: undefined,
		};
	}
	for (const agent of context.harnesses.slots.agents) {
		const sourceRef: GraphSourceRef = { kind: "harness-agent", agentId: agent.id };
		const discovered = context.harnesses.harnesses.find((item) => item.kind === agent.kind);
		const excluded = context.harnesses.excludedAgents.find((item) => item.agentId === agent.id);
		yield {
			key: graphSourceKey(sourceRef),
			category: "agents",
			nodeKind: "harness-agent",
			title: `${agent.id} · ${agent.kind ?? "Unassigned harness"}`,
			subtitle: `${agent.model ?? "No model"} · ${agent.role}`,
			status: !agent.enabled ? "disabled" : discovered?.available ? "configured" : "unavailable",
			workspaceRoot: "",
			sourceRef,
			ownerBotId: agent.personalBotId,
			model: agent.model,
			mode: agent.role,
			available: context.harnesses.runnableAgents.some((item) => item.agentId === agent.id),
			explanation:
				excluded?.reason ??
				"Configuration reference only; native authentication/session readiness is not asserted.",
		};
	}
	for (const board of context.kanban.boards) {
		const boardRef: GraphSourceRef = { kind: "kanban-board", boardId: board.id };
		yield {
			key: graphSourceKey(boardRef),
			category: "kanban",
			nodeKind: "board",
			title: board.name,
			subtitle: `${board.tasks.length} cards · shared board`,
			status: "saved",
			workspaceRoot: board.workspaceRoot,
			sourceRef: boardRef,
			available: true,
			updatedAt: board.updatedAt,
		};
		for (const task of board.tasks) {
			const taskRef: GraphSourceRef = { kind: "kanban-card", boardId: board.id, taskId: task.id };
			const last = task.attempts?.at(-1);
			yield {
				key: graphSourceKey(taskRef),
				category: "kanban",
				nodeKind: "kanban-card",
				title: task.title || "Untitled card",
				subtitle: `${board.name} · ${task.kind} · ${task.runCount ?? 0} runs`,
				status: task.runStatus === "running" ? "running" : task.status,
				workspaceRoot: task.workspaceRoot,
				sourceRef: taskRef,
				ownerBotId: task.personalBotId,
				model: last?.model ?? task.model,
				mode: last?.mode ?? task.kind,
				available: true,
				updatedAt: task.updatedAt,
			};
			for (const attempt of [...(task.attempts ?? [])].reverse()) {
				const ref: GraphSourceRef = {
					kind: "kanban-attempt",
					boardId: board.id,
					taskId: task.id,
					attemptId: attempt.id,
				};
				yield {
					key: graphSourceKey(ref),
					category: "history",
					nodeKind: "history",
					title: `${task.title || "Untitled card"} · attempt ${attempt.sequence}`,
					subtitle: `${attempt.agentName ?? "Klerm"} · ${attempt.model}`,
					status: attempt.status,
					workspaceRoot: attempt.workspaceRoot,
					sourceRef: ref,
					ownerBotId: task.personalBotId,
					model: attempt.model,
					mode: attempt.mode,
					available: true,
					updatedAt: attempt.finishedAt ?? attempt.startedAt,
				};
			}
		}
	}
	for (const conversation of chats) {
		const bot = context.bots.find((item) => item.id === conversation.botId)!;
		const ref: GraphSourceRef = { kind: "personal-conversation", botId: bot.id, conversationId: conversation.id };
		yield {
			key: graphSourceKey(ref),
			category: "history",
			nodeKind: "history",
			title: `${bot.name} · conversation`,
			subtitle: "Current stored conversation; not a frozen task attempt",
			status: conversation.status,
			workspaceRoot: conversation.cwd,
			sourceRef: ref,
			ownerBotId: bot.id,
			model: conversation.model,
			available: true,
			updatedAt: conversation.updatedAt,
		};
	}
}

export async function graphCatalog(
	context: GraphCatalogContext,
	query: GraphCatalogQuery = {},
): Promise<GraphCatalogPage> {
	const offset = Number.isInteger(query.offset) && query.offset! >= 0 ? Math.min(query.offset!, 100_000) : 0;
	const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(query.limit!, 100)) : 60;
	const search = (query.search ?? "").slice(0, 200).toLocaleLowerCase();
	const items: GraphCatalogItem[] = [];
	let matched = 0;
	for (const item of catalogItems(context, await conversations(context))) {
		if (query.category && item.category !== query.category) continue;
		if (query.ownerBotId && item.ownerBotId !== query.ownerBotId) continue;
		if (
			search &&
			!`${item.title} ${item.subtitle} ${item.status} ${item.workspaceRoot} ${item.key}`
				.toLocaleLowerCase()
				.includes(search)
		)
			continue;
		if (matched++ < offset) continue;
		if (items.length === limit) return { items, offset, nextOffset: offset + limit, executionSupported: false };
		items.push(item);
	}
	return { items, offset, executionSupported: false };
}

export async function graphSources(
	context: GraphCatalogContext,
	refs: GraphSourceRef[],
): Promise<Map<string, GraphCatalogItem>> {
	const wanted = new Set(refs.map(graphSourceKey)),
		found = new Map<string, GraphCatalogItem>();
	for (const item of catalogItems(context, await conversations(context)))
		if (wanted.has(item.key)) found.set(item.key, item);
	return found;
}

export async function graphSourceDetails(
	context: GraphCatalogContext,
	ref: GraphSourceRef,
): Promise<GraphSourceDetails> {
	const key = graphSourceKey(ref),
		item = (await graphSources(context, [ref])).get(key);
	if (!item) throw new Error("Graph source no longer exists.");
	const detail: GraphSourceDetails = {
		item,
		summary: "",
		steps: [],
		activity: [],
		changedFiles: [],
		verification: [],
	};
	const board = context.kanban.boards.find((value) => value.id === ref.boardId);
	const task = board?.tasks.find((value) => value.id === ref.taskId);
	if (ref.kind === "kanban-board")
		detail.summary = `${board!.tasks.length} cards. A board reference does not run its cards.`;
	if (ref.kind === "personal-agent") {
		const bot = context.bots.find((value) => value.id === ref.botId)!;
		detail.summary = `Model/reasoning/profile are owned by this Personal Agent. Kanban: ${bot.kanbanEnabled ? "enabled" : "disabled"}; Browser: ${bot.browserEnabled ? "enabled" : "disabled"}. Chat/native sessions are not copied or prompted.`;
	}
	if (ref.kind === "harness-agent")
		detail.summary =
			item.explanation ?? "Native model, authentication, memory and session remain owned by this harness.";
	if (task) {
		const attempt =
			ref.kind === "kanban-attempt"
				? task.attempts?.find((value) => value.id === ref.attemptId)
				: task.attempts?.at(-1);
		detail.summary =
			ref.kind === "kanban-card" ? task.prompt : (attempt?.result ?? attempt?.error ?? "No final report recorded.");
		detail.steps = attempt?.steps ?? [];
		detail.activity = attempt?.activity ?? [];
		detail.changedFiles = attempt?.evidence?.changedFiles ?? [];
		detail.verification = attempt?.evidence?.verification ?? [];
	}
	if (ref.kind === "personal-conversation") {
		const conversation = (await conversations(context)).find(
			(value) => value.id === ref.conversationId && value.botId === ref.botId,
		)!;
		detail.summary = conversation.messages
			.slice(-20)
			.filter((message) => typeof message.text === "string")
			.map((message) => `${message.role}: ${message.text}`)
			.join("\n\n")
			.slice(-32_000);
	}
	return detail;
}
