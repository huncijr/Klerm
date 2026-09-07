export const MCP_COLORS = ["base", "green", "blue", "amber", "red", "purple", "teal"] as const;
export type McpColor = (typeof MCP_COLORS)[number];

export const MCP_COLOR_CSS: Record<McpColor, string> = {
	base: "#98a2a9",
	green: "#7dce8a",
	blue: "#8fb7e8",
	amber: "#d6b16e",
	red: "#f09b93",
	purple: "#c4a4e8",
	teal: "#7ec8c0",
};

export const MCP_COLOR_BG_CSS: Record<McpColor, string> = {
	base: "rgba(152, 162, 169, .14)",
	green: "rgba(125, 206, 138, .14)",
	blue: "rgba(143, 183, 232, .14)",
	amber: "rgba(214, 177, 110, .14)",
	red: "rgba(240, 155, 147, .14)",
	purple: "rgba(196, 164, 232, .14)",
	teal: "rgba(126, 200, 192, .14)",
};

export function isMcpColor(value: string | undefined): value is McpColor {
	return value !== undefined && (MCP_COLORS as readonly string[]).includes(value);
}

export function parseStdioArgs(value: string): string[] {
	const json = parseJsonStringArray(value);
	if (json) return json;
	return tokenizeStdioArgs(value).map(cleanStdioArg).filter(Boolean);
}

function parseJsonStringArray(value: string): string[] | undefined {
	const trimmed = value.trim();
	if (!trimmed.startsWith("[")) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return undefined;
		return parsed.map((item) => item.trim()).filter(Boolean);
	} catch {
		return undefined;
	}
}

function tokenizeStdioArgs(value: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;
	for (const char of value) {
		if (inQuote) {
			if (char === inQuote) inQuote = null;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			inQuote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) args.push(current);
	return args;
}

function cleanStdioArg(value: string): string {
	let arg = value.trim().replace(/^\[/, "").replace(/\]$/, "").replace(/,$/, "").trim();
	if (
		(arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2) ||
		(arg.startsWith("'") && arg.endsWith("'") && arg.length >= 2)
	) {
		arg = arg.slice(1, -1).trim();
	}
	return arg.replace(/,$/, "").trim();
}

export function mcpServerIdFromName(value: string): string | undefined {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return /^[a-z0-9]+(?:[_-]?[a-z0-9]+)*$/.test(slug) ? slug : undefined;
}

export interface McpMentionServer {
	name: string;
	label?: string;
	color?: McpColor;
	tools: Array<{ name: string; remoteName: string }>;
}

export interface McpSuggestion {
	kind: "server" | "tool";
	serverName: string;
	displayName: string;
	color?: McpColor;
	toolName?: string;
	remoteName?: string;
	insertText: string;
}

export interface McpPromptMention {
	serverName: string;
	toolName?: string;
}

export interface MentionSegment {
	text: string;
	mention?: { displayName: string; color?: McpColor };
}

interface MentionMatcher {
	token: string;
	displayName: string;
	color?: McpColor;
	serverName: string;
	toolName?: string;
}

export function mcpDisplayName(server: Pick<McpMentionServer, "name" | "label">): string {
	return server.label?.trim() || server.name;
}

export function resolveMcpTool(
	servers: readonly McpMentionServer[],
	toolName: string,
): { server: McpMentionServer; tool: McpMentionServer["tools"][number] } | undefined {
	for (const server of servers) {
		const tool = server.tools.find((candidate) => candidate.name === toolName);
		if (tool) return { server, tool };
	}
	return undefined;
}

export function findActiveMention(
	text: string,
	cursor: number,
	servers: readonly McpMentionServer[] = [],
): { start: number; query: string } | undefined {
	const before = text.slice(0, cursor);
	const match = before.match(/(^|\s)@([^\n@]*)$/);
	if (!match || match.index === undefined) return undefined;
	const start = match.index + match[1].length;
	const rawMention = before.slice(start).toLowerCase();
	const completedMention = mentionMatchers(servers).find((candidate) =>
		rawMention.startsWith(candidate.token.toLowerCase()),
	);
	if (completedMention) {
		const rest = rawMention.slice(completedMention.token.length);
		if (/^\s/.test(rest)) return undefined;
	}
	return { start, query: match[2] ?? "" };
}

export function filterMcpSuggestions(servers: readonly McpMentionServer[], query: string): McpSuggestion[] {
	const needle = query.trim().toLowerCase();
	const slashIndex = needle.indexOf("/");
	const serverNeedle = slashIndex === -1 ? needle : needle.slice(0, slashIndex).trim();
	const toolNeedle = slashIndex === -1 ? "" : needle.slice(slashIndex + 1).trim();
	const suggestions: McpSuggestion[] = [];
	for (const server of servers) {
		const displayName = mcpDisplayName(server);
		const hay = `${displayName} ${server.name}`.toLowerCase();
		if (slashIndex === -1 && (!serverNeedle || hay.includes(serverNeedle))) {
			suggestions.push({
				kind: "server",
				serverName: server.name,
				displayName,
				color: server.color,
				insertText: `@${displayName} `,
			});
		}
		if (slashIndex === -1 || (serverNeedle && !hay.includes(serverNeedle))) continue;
		for (const tool of server.tools) {
			const toolHay = `${tool.remoteName} ${tool.name}`.toLowerCase();
			if (!toolNeedle || toolHay.includes(toolNeedle)) {
				suggestions.push({
					kind: "tool",
					serverName: server.name,
					displayName,
					color: server.color,
					toolName: tool.name,
					remoteName: tool.remoteName,
					insertText: `@${displayName}/${tool.remoteName} `,
				});
			}
		}
	}
	return suggestions.slice(0, 12);
}

function mentionMatchers(servers: readonly McpMentionServer[]): MentionMatcher[] {
	const matchers: MentionMatcher[] = [];
	for (const server of servers) {
		const displayName = mcpDisplayName(server);
		for (const tool of server.tools) {
			matchers.push({
				token: `@${displayName}/${tool.remoteName}`,
				displayName: `${displayName}/${tool.remoteName}`,
				color: server.color,
				serverName: server.name,
				toolName: tool.name,
			});
		}
		matchers.push({
			token: `@${displayName}`,
			displayName,
			color: server.color,
			serverName: server.name,
		});
		if (displayName.toLowerCase() !== server.name.toLowerCase()) {
			matchers.push({
				token: `@${server.name}`,
				displayName,
				color: server.color,
				serverName: server.name,
			});
		}
	}
	return matchers.sort((left, right) => right.token.length - left.token.length);
}

export function splitMcpMentions(text: string, servers: readonly McpMentionServer[]): MentionSegment[] {
	const matchers = mentionMatchers(servers);
	const segments: MentionSegment[] = [];
	let index = 0;
	while (index < text.length) {
		if (text[index] === "@" && (index === 0 || /\s/.test(text[index - 1] ?? ""))) {
			const rest = text.slice(index);
			const match = matchers.find((candidate) => rest.toLowerCase().startsWith(candidate.token.toLowerCase()));
			if (match) {
				segments.push({
					text: rest.slice(0, match.token.length),
					mention: { displayName: match.displayName, color: match.color },
				});
				index += match.token.length;
				continue;
			}
		}
		const nextAt = text.indexOf("@", index + 1);
		const end = nextAt === -1 ? text.length : nextAt;
		segments.push({ text: text.slice(index, end) });
		index = end;
	}
	return segments;
}

export function prepareMcpPrompt(
	text: string,
	servers: readonly McpMentionServer[],
): { message: string; mentions: McpPromptMention[] } {
	const matchers = mentionMatchers(servers);
	let result = "";
	const mentions = new Map<string, McpPromptMention>();
	let index = 0;
	while (index < text.length) {
		if (text[index] === "@" && (index === 0 || /\s/.test(text[index - 1] ?? ""))) {
			const rest = text.slice(index);
			const match = matchers.find((candidate) => rest.toLowerCase().startsWith(candidate.token.toLowerCase()));
			if (match) {
				const mention = { serverName: match.serverName, ...(match.toolName ? { toolName: match.toolName } : {}) };
				mentions.set(`${mention.serverName}\0${mention.toolName ?? ""}`, mention);
				result += match.toolName
					? `Use MCP tool ${match.toolName} from MCP server called ${match.serverName}`
					: `Use the MCP server called ${match.serverName}`;
				index += match.token.length;
				continue;
			}
		}
		result += text[index];
		index += 1;
	}
	return { message: result, mentions: [...mentions.values()] };
}

export function expandMcpMentions(text: string, servers: readonly McpMentionServer[]): string {
	return prepareMcpPrompt(text, servers).message;
}
