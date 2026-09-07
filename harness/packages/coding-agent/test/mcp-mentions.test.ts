import { describe, expect, it } from "vitest";
import {
	expandMcpMentions,
	filterMcpSuggestions,
	findActiveMention,
	mcpServerIdFromName,
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

	it("matches display names and lists servers before tools", () => {
		const suggestions = filterMcpSuggestions(servers, "google maps");
		expect(suggestions[0]).toMatchObject({ kind: "server", displayName: "Google Maps", insertText: "@Google Maps " });
		expect(suggestions.some((item) => item.kind === "tool" && item.remoteName === "search")).toBe(true);
	});

	it("styles complete mentions and expands them for the model", () => {
		const text = "@Google Maps then @Google Maps/search";
		expect(splitMcpMentions(text, servers).some((segment) => segment.mention?.color === "green")).toBe(true);
		expect(expandMcpMentions(text, servers)).toBe(
			"Use MCP server google-maps then Use MCP tool mcp_google-maps_search",
		);
	});
});
