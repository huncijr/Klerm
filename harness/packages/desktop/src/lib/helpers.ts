import type { AgentMessage, TimelineTone } from "./model.ts";

export const TIMELINE_PREVIEW_LINES = 24;
const MCP_TOOL_PATTERN = /^mcp__/;

export function messageText(message: AgentMessage): string {
	if (typeof message.content === "string") return message.content;
	return (message.content ?? [])
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

export function toDisplayText(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, undefined, 2);
	} catch {
		return String(value);
	}
}

export function truncateText(text: string, maxLines = TIMELINE_PREVIEW_LINES): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	return `${lines.slice(0, maxLines).join("\n")}\n… ${lines.length - maxLines} more lines`;
}

export function resultErrorText(result: unknown): string | undefined {
	if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
	const candidate = result as Record<string, unknown>;
	const content = candidate.content;
	if (!Array.isArray(content)) return undefined;
	const text = content
		.filter((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text")
		.map((part) => String((part as { text?: unknown }).text ?? ""))
		.join("\n")
		.trim();
	return text || undefined;
}

export function describeToolCall(
	toolName: string,
	args: unknown,
): { kind: string; label: string; detail: string; detailType?: "text" | "diff" | "code"; tone: TimelineTone } {
	const record = (args && typeof args === "object" && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
	if (MCP_TOOL_PATTERN.test(toolName)) {
		const [, server, ...toolParts] = toolName.split("__");
		const tool = toolParts.join("__");
		return {
			kind: "mcp",
			label: server && tool ? `${server}/${tool}` : toolName,
			detail: "",
			tone: "blue",
		};
	}
	const path =
		typeof record.path === "string"
			? record.path
			: typeof record.file_path === "string"
				? record.file_path
				: undefined;
	if (toolName === "edit" || toolName === "write") {
		const content = typeof record.content === "string" ? truncateText(record.content) : "";
		const writeDiff = content
			? content
					.split("\n")
					.map((line, index) => `+${index + 1} ${line}`)
					.join("\n")
			: "";
		return {
			kind: "modification",
			label: `${toolName === "edit" ? "Modified" : "Wrote"} ${path ?? "file"}`,
			detail: toolName === "write" ? writeDiff : "",
			detailType: "diff",
			tone: toolName === "write" ? "green" : "neutral",
		};
	}
	if (toolName === "read") {
		return { kind: "read", label: `Read ${path ?? "file"}`, detail: path ?? "", tone: "neutral" };
	}
	if (toolName === "bash") {
		const command = typeof record.command === "string" ? truncateText(record.command, 4) : "";
		return { kind: "command", label: command || "Ran command", detail: command, detailType: "code", tone: "neutral" };
	}
	return { kind: toolName, label: toolName, detail: "", tone: "neutral" };
}

export function toolResultDetails(result: unknown): Record<string, unknown> | undefined {
	if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
	const details = (result as Record<string, unknown>).details;
	return details && typeof details === "object" && !Array.isArray(details)
		? (details as Record<string, unknown>)
		: undefined;
}
