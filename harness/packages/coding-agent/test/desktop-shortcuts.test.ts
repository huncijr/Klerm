import { describe, expect, it } from "vitest";
import { groupModelProviders } from "../../desktop/src/lib/provider-cards.ts";
import { shortcutConflicts } from "../../desktop/src/lib/shortcuts.ts";

describe("desktop settings helpers", () => {
	it("marks duplicate shortcut chords", () => {
		const conflicts = shortcutConflicts([
			{ action: "Send", keys: "Ctrl+Enter" },
			{ action: "Stop", keys: "Escape" },
			{ action: "Save", keys: "ctrl+enter" },
		]);
		expect(conflicts.has("ctrl+enter")).toBe(true);
		expect(conflicts.has("escape")).toBe(false);
	});

	it("groups providers and appends a custom card", () => {
		const cards = groupModelProviders(
			[
				{ value: "anthropic/claude", label: "anthropic / claude" },
				{ value: "anthropic/haiku", label: "anthropic / haiku" },
				{ value: "openai/gpt", label: "openai / gpt" },
			],
			[{ providerId: "ollama", name: "Ollama", serverUrl: "http://127.0.0.1", models: [{ id: "qwen" }] }],
		);
		expect(cards[0]).toMatchObject({ id: "anthropic", count: 2 });
		expect(cards.some((card) => card.id === "openai-codex")).toBe(true);
		expect(cards.some((card) => card.id === "qwen-token-plan")).toBe(true);
		expect(cards.some((card) => card.id === "ollama" && card.count === 1)).toBe(true);
		expect(cards.at(-1)?.custom).toBe(true);
	});
});
