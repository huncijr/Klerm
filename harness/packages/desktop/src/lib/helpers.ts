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
	for (const part of content) {
		if (part && typeof part === "object" && (part as { isError?: unknown }).isError) {
			const parts = (part as { content?: unknown }).content;
			if (Array.isArray(parts)) {
				const text = parts
					.filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "text")
					.map((item) => String((item as { text?: unknown }).text ?? ""))
					.join("\n")
					.trim();
				if (text) return text;
			}
		}
	}
	return undefined;
}

export function describeToolCall(
	toolName: string,
	args: unknown,
): { label: string; detail: string; tone: TimelineTone } {
	const record = (args && typeof args === "object" && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
	if (MCP_TOOL_PATTERN.test(toolName)) {
		const [, rest] = toolName.split("__");
		const slashIndex = (rest ?? "").indexOf("__");
		const label =
			rest !== undefined && slashIndex > 0
				? `MCP ${rest.slice(0, slashIndex)}/${rest.slice(slashIndex + 2)}`
				: `MCP ${toolName}`;
		return { label, detail: "", tone: "blue" };
	}
	const path = typeof record.path === "string" ? record.path : undefined;
	if (toolName === "edit" || toolName === "write") {
		return {
			label: `${toolName === "edit" ? "Edited" : "Wrote"} ${path ?? "file"}`,
			detail: path ?? "",
			tone: "green",
		};
	}
	if (toolName === "read") return { label: `Read ${path ?? "file"}`, detail: path ?? "", tone: "neutral" };
	if (toolName === "bash") {
		const command = typeof record.command === "string" ? truncateText(record.command, 4) : "";
		return { label: command || "Ran command", detail: command, tone: "neutral" };
	}
	return { label: toolName, detail: "", tone: "neutral" };
}
