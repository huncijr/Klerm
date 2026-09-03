import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { compareStrength, describeModelProfile, formatPeerLookup } from "../src/klerm/model-profile.ts";

function model(provider: string, id: string, extras: Partial<Model<Api>> = {}): Model<Api> {
	return {
		provider,
		id,
		name: extras.name ?? id,
		api: "openai-completions",
		baseUrl: "http://localhost/v1",
		reasoning: extras.reasoning ?? false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: extras.contextWindow ?? 32768,
		maxTokens: 4096,
		...extras,
	};
}

describe("Klerm model profiles", () => {
	it("scores a small local coder below a frontier cloud model", () => {
		const local = describeModelProfile("ollama/qwen3.5:9b-q4_K_M", model("ollama", "qwen3.5:9b-q4_K_M"));
		const frontier = describeModelProfile("openai-codex/gpt-5.5", model("openai-codex", "gpt-5.5"));
		expect(local.kind).toBe("local-runtime");
		expect(local.band).toBe(2);
		expect(frontier.kind).toBe("cloud");
		expect(frontier.band).toBe(5);
		expect(compareStrength(local, frontier)).toBe("stronger");
		expect(compareStrength(frontier, local)).toBe("weaker");
	});

	it("builds a peer lookup that names both models and relative strength", () => {
		const agent1 = describeModelProfile("ollama/qwen2.5-coder:7b", model("ollama", "qwen2.5-coder:7b"));
		const agent2 = describeModelProfile("google/gemini-3.5-flash-lite", model("google", "gemini-3.5-flash-lite"));
		const lookup = formatPeerLookup("Agent 1", agent1, "Agent 2", agent2);
		expect(lookup).toContain("You are Agent 1 running ollama/qwen2.5-coder:7b");
		expect(lookup).toContain("Peer lookup for Agent 2 (google/gemini-3.5-flash-lite)");
		expect(lookup).toContain("Agent 2 is stronger than you");
		expect(lookup).toContain("Strength band");
	});
});
