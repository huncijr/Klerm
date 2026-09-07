import { describe, expect, it } from "vitest";
import {
	expandMcpMentions,
	filterMcpSuggestions,
	findActiveMention,
	mcpServerIdFromName,
	parseStdioArgs,
	prepareMcpPrompt,
	resolveMcpTool,
	splitMcpMentions,
} from "../../desktop/src/lib/mcp-mentions.ts";

const servers = [
	{
		name: "google-maps",
		label: "Google Maps",
		color: "green" as const,
		tools: [{ name: "mcp_google-maps_search", remoteName: "search" }],
	},
];

const supabaseServers = [{ name: "supabase", label: "Supabase", color: "green" as const, tools: [] }];

describe("MCP mentions", () => {
	it("turns a single display name into a server id", () => {
		expect(mcpServerIdFromName("Google Maps")).toBe("google-maps");
		expect(mcpServerIdFromName("google-maps")).toBe("google-maps");
		expect(mcpServerIdFromName("   ")).toBeUndefined();
	});

	it("keeps @ queries that include spaces", () => {
		const text = "look at @google maps";
		expect(findActiveMention(text, text.length)).toEqual({ start: 8, query: "google maps" });
	});

	it("stops the active query after a selected mention and a space", () => {
		const text = "ask @Supabase please";
		expect(findActiveMention(text, text.length, supabaseServers)).toBeUndefined();
	});

	it("matches display names without duplicating server tool rows", () => {
		const suggestions = filterMcpSuggestions(servers, "google maps");
		expect(suggestions[0]).toMatchObject({ kind: "server", displayName: "Google Maps", insertText: "@Google Maps " });
		expect(suggestions.some((item) => item.kind === "tool")).toBe(false);
	});

	it("lists tools only after an explicit server slash", () => {
		const suggestions = filterMcpSuggestions(servers, "google maps/se");
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]).toMatchObject({ kind: "tool", displayName: "Google Maps", remoteName: "search" });
	});

	it("styles complete mentions and expands them for the model", () => {
		const text = "@Google Maps then @Google Maps/search";
		expect(splitMcpMentions(text, servers).some((segment) => segment.mention?.color === "green")).toBe(true);
		expect(expandMcpMentions(text, servers)).toBe(
			"Use the MCP server called google-maps then Use MCP tool mcp_google-maps_search from MCP server called google-maps",
		);
	});

	it("returns deduplicated structured MCP selections with the expanded prompt", () => {
		expect(prepareMcpPrompt("Use @Google Maps then @Google Maps/search and @Google Maps", servers)).toEqual({
			message:
				"Use Use the MCP server called google-maps then Use MCP tool mcp_google-maps_search from MCP server called google-maps and Use the MCP server called google-maps",
			mentions: [{ serverName: "google-maps" }, { serverName: "google-maps", toolName: "mcp_google-maps_search" }],
		});
	});

	it("uses base appearance when no custom color is selected", () => {
		const baseServers = [{ name: "docs", color: "base" as const, tools: [] }];
		expect(filterMcpSuggestions(baseServers, "docs")[0]).toMatchObject({ color: "base", insertText: "@docs " });
		expect(splitMcpMentions("Use @docs", baseServers)[1]?.mention?.color).toBe("base");
	});

	it("keeps a quoted database URL as one stdio argument", () => {
		expect(
			parseStdioArgs('-y @modelcontextprotocol/server-postgres "postgresql://user:pass@example.com:6543/postgres"'),
		).toEqual(["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@example.com:6543/postgres"]);
	});

	it("parses a pasted JSON argv array", () => {
		expect(
			parseStdioArgs(
				'["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@example.com:6543/postgres"]',
			),
		).toEqual(["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@example.com:6543/postgres"]);
	});

	it("strips JSON commas from loosely pasted npx args", () => {
		expect(parseStdioArgs('"-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@host/db"')).toEqual(
			["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@host/db"],
		);
	});

	it("resolves a called tool to its server appearance", () => {
		expect(resolveMcpTool(servers, "mcp_google-maps_search")).toMatchObject({
			server: { name: "google-maps", label: "Google Maps", color: "green" },
			tool: { remoteName: "search" },
		});
	});
});
