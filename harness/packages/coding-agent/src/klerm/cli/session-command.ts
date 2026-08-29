import { existsSync } from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { APP_NAME } from "../../config.ts";
import { type SessionEntry, type SessionInfo, SessionManager } from "../../core/session-manager.ts";
import { isKlermSessionTransitionData, KLERM_SESSION_TRANSITION_CUSTOM_TYPE } from "../router/types.ts";
import { deriveLegacyKlermTranscriptTransitions, type KlermTranscriptTransition } from "../session-transitions.ts";

const SESSION_TIMELINE_USAGE = `${APP_NAME} session timeline <session-id|path> [--json] [--compact] [--with-tools] [--with-cost]`;

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

export async function runKlermSessionCommand(
	args: string[],
	options: RunKlermSessionCommandOptions = {},
): Promise<boolean> {
	if (args[0] !== "session") return false;
	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	if (args.length === 1 || args[1] === "--help" || args[1] === "-h") {
		stdout(`Usage:\n  ${SESSION_TIMELINE_USAGE}`);
		return true;
	}
	if (args[1] !== "timeline") {
		stderr(`Error: Unknown session command "${args[1]}".\nUsage: ${SESSION_TIMELINE_USAGE}`);
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
