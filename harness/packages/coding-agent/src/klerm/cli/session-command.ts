import { existsSync } from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { APP_NAME } from "../../config.ts";
import { type SessionEntry, type SessionInfo, SessionManager } from "../../core/session-manager.ts";
import { isKlermSessionTransitionData, KLERM_SESSION_TRANSITION_CUSTOM_TYPE } from "../router/types.ts";
import { deriveLegacyKlermTranscriptTransitions, type KlermTranscriptTransition } from "../session-transitions.ts";

const SESSION_TIMELINE_USAGE = `${APP_NAME} session timeline <session-id|path> [--json] [--compact] [--with-tools] [--with-cost]`;
const SESSION_LIST_USAGE = `${APP_NAME} session list [--json] [--dir <dir>]`;
const SESSION_USAGE = `Usage:\n  ${SESSION_LIST_USAGE}\n  ${SESSION_TIMELINE_USAGE}`;

interface SessionTimelineEvent {
	timestamp: string;
	type: "message" | "model" | "transition" | "tool";
	role?: string;
	text?: string;
	target?: string;
	transition?: KlermTranscriptTransition;
	tool?: string;
	isError?: boolean;
	usage?: { tokens: number; costUsd: number };
}

export interface RunKlermSessionCommandOptions {
	sessionsDir?: string;
	listSessions?: () => Promise<SessionInfo[]>;
	openSession?: (path: string) => Pick<SessionManager, "getEntries" | "getHeader" | "getSessionId">;
	stdout?: (message: string) => void;
	stderr?: (message: string) => void;
}

function messageText(message: AgentMessage): string | undefined {
	if (!("content" in message)) return undefined;
	if (typeof message.content === "string") return message.content.trim() || undefined;
	const text = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
	return text || undefined;
}

function messageUsage(message: AgentMessage): { tokens: number; costUsd: number } | undefined {
	if (!("usage" in message) || !message.usage) return undefined;
	return { tokens: message.usage.totalTokens, costUsd: message.usage.cost.total };
}

function buildTimeline(
	entries: readonly SessionEntry[],
	options: { compact: boolean; withTools: boolean; withCost: boolean },
) {
	const legacyTransitions = deriveLegacyKlermTranscriptTransitions(entries);
	const events: SessionTimelineEvent[] = [];
	for (const entry of entries) {
		const legacyTransition = legacyTransitions.get(entry.id);
		if (legacyTransition) {
			events.push({ timestamp: entry.timestamp, type: "transition", transition: legacyTransition });
			continue;
		}
		if (
			entry.type === "custom" &&
			entry.customType === KLERM_SESSION_TRANSITION_CUSTOM_TYPE &&
			isKlermSessionTransitionData(entry.data)
		) {
			events.push({ timestamp: entry.timestamp, type: "transition", transition: entry.data.transition });
			continue;
		}
		if (entry.type === "model_change") {
			events.push({ timestamp: entry.timestamp, type: "model", target: `${entry.provider}/${entry.modelId}` });
			continue;
		}
		if (entry.type !== "message") continue;
		if (entry.message.role === "toolResult") {
			if (options.withTools) {
				events.push({
					timestamp: entry.timestamp,
					type: "tool",
					tool: entry.message.toolName,
					isError: entry.message.isError,
					...(options.withCost ? { usage: messageUsage(entry.message) } : {}),
				});
			}
			continue;
		}
		if (options.compact) continue;
		const event: SessionTimelineEvent = {
			timestamp: entry.timestamp,
			type: "message",
			role: entry.message.role,
			text: messageText(entry.message),
		};
		if (entry.message.role === "assistant") {
			event.target = `${entry.message.provider}/${entry.message.model}`;
			if (options.withTools) {
				const tools = entry.message.content.filter((part) => part.type === "toolCall").map((part) => part.name);
				if (tools.length > 0) event.tool = tools.join(", ");
			}
			if (options.withCost) event.usage = messageUsage(entry.message);
		}
		events.push(event);
	}
	return events;
}

function formatTimelineEvent(event: SessionTimelineEvent): string {
	const timestamp = event.timestamp;
	if (event.type === "transition" && event.transition) {
		return `${timestamp} ${event.transition.kind.toUpperCase()} ${event.transition.fromLane} -> ${event.transition.toLane} (${event.transition.toTarget}): ${event.transition.reason}`;
	}
	if (event.type === "model") return `${timestamp} MODEL ${event.target}`;
	if (event.type === "tool") {
		const usage = event.usage ? `, ${event.usage.tokens} tokens, $${event.usage.costUsd.toFixed(6)}` : "";
		return `${timestamp} TOOL ${event.tool} ${event.isError ? "error" : "ok"}${usage}`;
	}
	const text = event.text?.replace(/\s+/g, " ").slice(0, 240) ?? "";
	const target = event.target ? ` ${event.target}` : "";
	const tool = event.tool ? ` tools=${event.tool}` : "";
	const usage = event.usage ? ` ${event.usage.tokens} tokens $${event.usage.costUsd.toFixed(6)}` : "";
	return `${timestamp} ${(event.role ?? "message").toUpperCase()}${target}${tool}${usage}${text ? `: ${text}` : ""}`;
}

function listSessionInfo(session: SessionInfo): Record<string, unknown> {
	return {
		id: session.id,
		name: session.name,
		path: session.path,
		cwd: session.cwd,
		created: session.created.toISOString(),
		modified: session.modified.toISOString(),
		messageCount: session.messageCount,
		firstMessage: session.firstMessage,
	};
}

async function runSessionList(
	args: string[],
	options: RunKlermSessionCommandOptions,
	stdout: (message: string) => void,
	stderr: (message: string) => void,
): Promise<boolean> {
	const rest = args.slice(2);
	let json = false;
	let dir: string | undefined;
	for (let index = 0; index < rest.length; index++) {
		const arg = rest[index];
		if (arg === "--json") json = true;
		else if (arg === "--dir") {
			const value = rest[++index];
			if (!value) {
				stderr(`Error: --dir requires a directory.\nUsage: ${SESSION_LIST_USAGE}`);
				process.exitCode = 1;
				return true;
			}
			dir = value;
		} else if (arg === "--help" || arg === "-h") {
			stdout(`Usage: ${SESSION_LIST_USAGE}`);
			return true;
		} else {
			stderr(`Error: Unknown session list option "${arg}".\nUsage: ${SESSION_LIST_USAGE}`);
			process.exitCode = 1;
			return true;
		}
	}

	const sessions = await (options.listSessions?.() ?? SessionManager.listAll(dir ?? options.sessionsDir));
	if (json) {
		stdout(JSON.stringify({ sessions: sessions.map(listSessionInfo) }, null, 2));
		return true;
	}
	if (sessions.length === 0) {
		stdout(dir ? `No sessions found in ${dir}.` : "No sessions found.");
		return true;
	}
	const lines = sessions.map((session) => {
		const name = session.name ?? session.firstMessage.replace(/\s+/g, " ").slice(0, 60);
		const modified = session.modified.toISOString();
		return `${modified}  ${session.id}  msgs=${String(session.messageCount).padStart(5)}  ${name}${session.cwd ? `  (${session.cwd})` : ""}`;
	});
	stdout(lines.join("\n"));
	return true;
}

export async function runKlermSessionCommand(
	args: string[],
	options: RunKlermSessionCommandOptions = {},
): Promise<boolean> {
	if (args[0] !== "session") return false;
	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	if (args.length === 1 || args[1] === "--help" || args[1] === "-h") {
		stdout(SESSION_USAGE);
		return true;
	}
	if (args[1] === "list") {
		return runSessionList(args, options, stdout, stderr);
	}
	if (args[1] !== "timeline") {
		stderr(`Error: Unknown session command "${args[1]}".\n${SESSION_USAGE}`);
		process.exitCode = 1;
		return true;
	}
	if (args[2] === "--help" || args[2] === "-h") {
		stdout(`Usage: ${SESSION_TIMELINE_USAGE}`);
		return true;
	}
	const reference = args[2];
	const flags = new Set(args.slice(3));
	const validFlags = new Set(["--json", "--compact", "--with-tools", "--with-cost"]);
	const invalidFlag = [...flags].find((flag) => !validFlags.has(flag));
	if (!reference || invalidFlag) {
		stderr(
			`Error: ${invalidFlag ? `Unknown timeline option "${invalidFlag}"` : "Session timeline requires an id or path"}.\nUsage: ${SESSION_TIMELINE_USAGE}`,
		);
		process.exitCode = 1;
		return true;
	}

	let path: string | undefined;
	if (existsSync(reference)) path = reference;
	else {
		const sessions = await (options.listSessions?.() ?? SessionManager.listAll(options.sessionsDir));
		const matches = sessions.filter((session) => session.id === reference || session.id.startsWith(reference));
		if (matches.length === 1) path = matches[0].path;
		else if (matches.length > 1) {
			stderr(`Error: Session reference "${reference}" is ambiguous.`);
			process.exitCode = 1;
			return true;
		}
	}
	if (!path) {
		stderr(`Error: Session "${reference}" was not found.`);
		process.exitCode = 1;
		return true;
	}

	try {
		const session = (options.openSession ?? ((sessionPath) => SessionManager.open(sessionPath)))(path);
		const events = buildTimeline(session.getEntries(), {
			compact: flags.has("--compact"),
			withTools: flags.has("--with-tools"),
			withCost: flags.has("--with-cost"),
		});
		if (flags.has("--json")) {
			stdout(JSON.stringify({ sessionId: session.getSessionId(), header: session.getHeader(), events }, null, 2));
		} else {
			stdout(
				events.map(formatTimelineEvent).join("\n") || `Session ${session.getSessionId()} has no timeline events.`,
			);
		}
	} catch (error) {
		stderr(`Error: Could not read session "${reference}": ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
	return true;
}
