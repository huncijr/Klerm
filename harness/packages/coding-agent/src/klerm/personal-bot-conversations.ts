import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CodingHarnessKind, CodingHarnessRole } from "./coding-harness-setup.ts";
import type { PersonalBot } from "./personal-bots.ts";

export interface PersonalBotChatMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	timestamp: string;
}

export interface PersonalBotConversation {
	version: 1;
	id: string;
	botId: string;
	cwd: string;
	harness: CodingHarnessKind;
	model: string;
	role: CodingHarnessRole;
	nativeSessionId?: string;
	status: "idle" | "running" | "failed";
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
	event: "PROMPT_ACCEPTED" | "PROMPT_COMPLETED" | "PROMPT_FAILED" | "CONVERSATION_RESET";
	harness: CodingHarnessKind;
	model: string;
	reason: string;
	promptDigest?: string;
	responseDigest?: string;
}

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
		const parsed = JSON.parse(await readFile(conversationPath(agentDir, bot.id), "utf8")) as PersonalBotConversation;
		if (
			parsed.version !== 1 ||
			parsed.botId !== bot.id ||
			typeof parsed.id !== "string" ||
			!Array.isArray(parsed.messages)
		) {
			return createPersonalBotConversation(bot, cwd);
		}
		return { ...parsed, status: parsed.status === "running" ? "failed" : parsed.status };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return createPersonalBotConversation(bot, cwd);
		throw error;
	}
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
