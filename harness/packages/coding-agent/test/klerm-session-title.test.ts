import { describe, expect, it } from "vitest";
import { createSessionTitle } from "../src/klerm/session-title.ts";

describe("Klerm session titles", () => {
	it("creates a concise title from the first prompt", () => {
		expect(createSessionTitle("Please implement Notion MCP credential editing and reload support.")).toBe(
			"implement Notion MCP credential editing and reload",
		);
	});

	it("keeps titles bounded and handles empty prompts", () => {
		expect(createSessionTitle("")).toBe("New task");
		expect(createSessionTitle("one two three four five six seven eight nine")).toBe(
			"one two three four five six seven",
		);
	});
});
