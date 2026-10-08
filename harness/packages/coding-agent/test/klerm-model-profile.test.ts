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
	it("does not rank quality or invent cloud/privacy facts from model families or sizes", () => {
		const local = describeModelProfile("ollama/qwen3.5:9b-q4_K_M", model("ollama", "qwen3.5:9b-q4_K_M"));
		const frontier = describeModelProfile("openai-codex/gpt-5.5", model("openai-codex", "gpt-5.5"));
		expect(local.kind).toBe("local-runtime");
		expect(local.band).toBe(3);
		expect(frontier.kind).toBe("unknown");
		expect(frontier.band).toBe(3);
		expect(local.strengths).toEqual([]);
		expect(frontier.strengths).toEqual([]);
		expect(compareStrength(local, frontier)).toBe("unknown");
		expect(compareStrength(frontier, local)).toBe("unknown");
	});

	it("names both exact models while keeping comparative quality explicitly unknown", () => {
		const agent1 = describeModelProfile("ollama/qwen2.5-coder:7b", model("ollama", "qwen2.5-coder:7b"));
		const agent2 = describeModelProfile("google/gemini-3.5-flash-lite", model("google", "gemini-3.5-flash-lite"));
		const lookup = formatPeerLookup("Agent 1", agent1, "Agent 2", agent2);
		expect(lookup).toContain("You are Agent 1 running ollama/qwen2.5-coder:7b");
		expect(lookup).toContain("Peer lookup for Agent 2 (google/gemini-3.5-flash-lite)");
		expect(lookup).toContain("Comparative model quality is unknown");
		expect(lookup).not.toContain("Strength band");
		expect(lookup).not.toContain("is stronger");
	});
	it("reports missing metadata as unknown and preserves arbitrary native model references", () => {
		const profile = describeModelProfile("Vendor/Custom Max 700b");
		expect(profile).toMatchObject({
			reference: "Vendor/Custom Max 700b",
			provider: "unknown",
			kind: "unknown",
			band: 3,
		});
		expect(profile.reasoning).toBeUndefined();
		expect(formatPeerLookup("Agent 1", profile, "Agent 2", profile)).toContain("reasoning unknown");
	});
});
