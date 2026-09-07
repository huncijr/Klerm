export const MCP_COLORS = ["green", "blue", "amber", "red", "purple", "teal"] as const;
export type McpColor = (typeof MCP_COLORS)[number];

export const MCP_COLOR_CSS: Record<McpColor, string> = {
	green: "#7dce8a",
	blue: "#8fb7e8",
	amber: "#d6b16e",
	red: "#f09b93",
	purple: "#c4a4e8",
	teal: "#7ec8c0",
};

export function isMcpColor(value: string | undefined): value is McpColor {
	return value !== undefined && (MCP_COLORS as readonly string[]).includes(value);
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

export function findActiveMention(text: string, cursor: number): { start: number; query: string } | undefined {
	const before = text.slice(0, cursor);
	const match = before.match(/(^|\s)@([^\n@]*)$/);
	if (!match || match.index === undefined) return undefined;
	return { start: match.index + match[1].length, query: match[2] ?? "" };
}

export function filterMcpSuggestions(servers: readonly McpMentionServer[], query: string): McpSuggestion[] {
	const needle = query.trim().toLowerCase();
	const suggestions: McpSuggestion[] = [];
	for (const server of servers) {
		const displayName = mcpDisplayName(server);
		const hay = `${displayName} ${server.name}`.toLowerCase();
		if (!needle || hay.includes(needle)) {
			suggestions.push({
				kind: "server",
				serverName: server.name,
				displayName,
				color: server.color,
				insertText: `@${displayName} `,
			});
		}
		for (const tool of server.tools) {
			const toolHay = `${displayName} ${server.name} ${tool.remoteName} ${tool.name}`.toLowerCase();
			if (!needle || toolHay.includes(needle)) {
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

export function expandMcpMentions(text: string, servers: readonly McpMentionServer[]): string {
	const matchers = mentionMatchers(servers);
	let result = "";
	let index = 0;
	while (index < text.length) {
		if (text[index] === "@" && (index === 0 || /\s/.test(text[index - 1] ?? ""))) {
			const rest = text.slice(index);
			const match = matchers.find((candidate) => rest.toLowerCase().startsWith(candidate.token.toLowerCase()));
			if (match) {
				result += match.toolName ? `Use MCP tool ${match.toolName}` : `Use MCP server ${match.serverName}`;
				index += match.token.length;
				continue;
			}
		}
		result += text[index];
		index += 1;
	}
	return result;
}
