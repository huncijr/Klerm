import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CodingHarnessKind } from "./coding-harness-setup.ts";
import type { PersonalBot } from "./personal-bots.ts";

export interface PersonalBotChatMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	timestamp: string;
}

export interface PersonalBotConversationSummary {
	readonly id: string;
	readonly ordinal: number;
	readonly source: "legacy-conversation" | "linked-agent-tasks";
	readonly linkedPromptRange: { readonly start: number; readonly end: number };
	readonly text: string;
	readonly timestamp: string;
	readonly sourceMessageCount: number;
	readonly digest: string;
}

export interface PersonalBotSummarySource {
	readonly id: string;
	readonly agentId: string;
	readonly linkedPromptOrdinal: number;
	readonly userPrompt: string;
	readonly finalResponse: string;
	readonly timestamp: string;
}

export interface PersonalBotConversation {
	version: 1;
	id: string;
	botId: string;
	cwd: string;
	harness: CodingHarnessKind;
	model: string;
	role: "planner";
	nativeSessionId?: string;
	sessionContextDigest?: string;
	peerSummaryDigest?: string;
	linkedSuccessfulPromptCount: number;
	pendingSummarySources: readonly PersonalBotSummarySource[];
	summaries: readonly PersonalBotConversationSummary[];
	status: "idle" | "running" | "summarizing" | "failed";
	eventSequence: number;
	messages: PersonalBotChatMessage[];
	updatedAt: string;
}

export interface PersonalBotConversationEvent {
	version: 1;
	timestamp: string;
	sequence: number;
	conversationId: string;
	botId: string;
	event:
		| "PROMPT_ACCEPTED"
		| "PROMPT_COMPLETED"
		| "PROMPT_FAILED"
		| "SUMMARY_CREATED"
		| "SUMMARY_DELETED"
		| "CONVERSATION_RESET";
	harness: CodingHarnessKind;
	model: string;
	reason: string;
	promptDigest?: string;
	responseDigest?: string;
	summaryId?: string;
}

interface LegacyPersonalBotConversationSummary {
	text: string;
	updatedAt: string;
	sourceMessageCount: number;
	digest: string;
}

type StoredPersonalBotConversation = Omit<
	PersonalBotConversation,
	"linkedSuccessfulPromptCount" | "pendingSummarySources" | "summaries"
> & {
	linkedSuccessfulPromptCount?: number;
	pendingSummarySources?: PersonalBotSummarySource[];
	summaries?: PersonalBotConversationSummary[];
	summary?: LegacyPersonalBotConversationSummary;
};

function conversationPath(agentDir: string, botId: string): string {
	return join(agentDir, "personal-bots", botId, "conversation.json");
}

export function createPersonalBotConversation(bot: PersonalBot, cwd: string): PersonalBotConversation {
	return {
		version: 1,
		id: `bot-conversation-${randomUUID()}`,
		botId: bot.id,
		cwd,
		harness: bot.harness,
		model: bot.model ?? "",
		role: bot.role,
		linkedSuccessfulPromptCount: 0,
		pendingSummarySources: [],
		summaries: [],
		status: "idle",
		eventSequence: 0,
		messages: [],
		updatedAt: new Date().toISOString(),
	};
}

export async function loadPersonalBotConversation(
	agentDir: string,
	bot: PersonalBot,
	cwd: string,
): Promise<PersonalBotConversation> {
	try {
		const parsed = JSON.parse(
			await readFile(conversationPath(agentDir, bot.id), "utf8"),
		) as StoredPersonalBotConversation;
		if (
			parsed.version !== 1 ||
			parsed.botId !== bot.id ||
			typeof parsed.id !== "string" ||
			!Array.isArray(parsed.messages)
		) {
			return createPersonalBotConversation(bot, cwd);
		}
		const migratedText = parsed.summary
			? formatPersonalBotSummaryMarkdown(parsed.summary.text, { start: 0, end: 0 })
			: undefined;
		const migratedSummary =
			parsed.summary && migratedText
				? {
						id: `summary-migrated-${parsed.summary.digest.slice(0, 16)}`,
						ordinal: 1,
						source: "legacy-conversation" as const,
						linkedPromptRange: { start: 0, end: 0 },
						text: migratedText,
						timestamp: parsed.summary.updatedAt,
						sourceMessageCount: parsed.summary.sourceMessageCount,
						digest: createHash("sha256").update(migratedText).digest("hex"),
					}
				: undefined;
		const hasLinkedTaskState = Array.isArray(parsed.pendingSummarySources);
		const summaries = Array.isArray(parsed.summaries)
			? parsed.summaries.map((summary) => ({
					...summary,
					source:
						summary.source === "legacy-conversation" || summary.source === "linked-agent-tasks"
							? summary.source
							: hasLinkedTaskState
								? ("linked-agent-tasks" as const)
								: ("legacy-conversation" as const),
				}))
			: migratedSummary
				? [migratedSummary]
				: [];
		const { summary: _legacySummary, ...conversation } = parsed;
		return {
			...conversation,
			role: "planner",
			linkedSuccessfulPromptCount:
				hasLinkedTaskState &&
				typeof parsed.linkedSuccessfulPromptCount === "number" &&
				parsed.linkedSuccessfulPromptCount >= 0
					? Math.floor(parsed.linkedSuccessfulPromptCount)
					: 0,
			pendingSummarySources: Array.isArray(parsed.pendingSummarySources) ? parsed.pendingSummarySources : [],
			summaries,
			status: parsed.status === "running" || parsed.status === "summarizing" ? "failed" : parsed.status,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return createPersonalBotConversation(bot, cwd);
		throw error;
	}
}

export function formatPersonalBotSummaryMarkdown(
	content: string,
	linkedPromptRange: { start: number; end: number },
	maxCharacters = 1200,
): string {
	const prefix = [
		"# Personal Bot Summary",
		"",
		"## Linked Agent Task Range",
		"",
		`${linkedPromptRange.start}-${linkedPromptRange.end}`,
		"",
		"## Summary",
		"",
		"",
	].join("\n");
	const available = Math.max(0, maxCharacters - prefix.length);
	const source = content.trim();
	let body = source.slice(0, available).trimEnd();
	if (source.length > available) {
		const boundary = Math.max(body.lastIndexOf("\n\n"), body.lastIndexOf("\n"));
		if (boundary >= Math.floor(available * 0.6)) body = body.slice(0, boundary).trimEnd();
	}
	const closures = [
		(body.match(/```/g)?.length ?? 0) % 2 === 1 ? "\n```" : "",
		(body.match(/\*\*/g)?.length ?? 0) % 2 === 1 ? "**" : "",
	].join("");
	if (closures.length > 0) body = `${body.slice(0, Math.max(0, available - closures.length)).trimEnd()}${closures}`;
	return `${prefix}${body}`;
}

export function createPersonalBotConversationSummary(
	content: string,
	ordinal: number,
	linkedPromptRange: { start: number; end: number },
	sourceMessageCount: number,
	timestamp: string,
): PersonalBotConversationSummary {
	const text = formatPersonalBotSummaryMarkdown(content, linkedPromptRange);
	const digest = createHash("sha256").update(text).digest("hex");
	return {
		id: `bot-summary-${linkedPromptRange.end}`,
		ordinal,
		source: "linked-agent-tasks",
		linkedPromptRange,
		text,
		timestamp,
		sourceMessageCount,
		digest,
	};
}

export async function savePersonalBotConversation(
	agentDir: string,
	conversation: PersonalBotConversation,
): Promise<void> {
	const path = conversationPath(agentDir, conversation.botId);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(conversation, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	await rename(temporaryPath, path);
}

export async function deletePersonalBotConversation(agentDir: string, botId: string): Promise<void> {
	try {
		await unlink(conversationPath(agentDir, botId));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export async function appendPersonalBotConversationEvent(
	cwd: string,
	event: PersonalBotConversationEvent,
): Promise<void> {
	const directory = join(cwd, ".klerm");
	await mkdir(directory, { recursive: true });
	await appendFile(join(directory, "personal-bot-events.jsonl"), `${JSON.stringify(event)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
}
