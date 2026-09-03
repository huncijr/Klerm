import type { Model } from "@earendil-works/pi-ai";
import { isLocalProviderId } from "./local-providers.ts";

export type KlermModelKind = "local-runtime" | "cloud";
export type KlermStrengthBand = 1 | 2 | 3 | 4 | 5;
export type KlermRelativeStrength = "stronger" | "similar" | "weaker";

export interface KlermModelProfile {
	reference: string;
	name: string;
	provider: string;
	kind: KlermModelKind;
	band: KlermStrengthBand;
	contextWindow?: number;
	reasoning: boolean;
	strengths: string[];
	limits: string[];
}

const FRONTIER_FAMILIES = /(?:gpt-5|\bo3\b|opus|grok-4|codex|claude-4|gemini-3(?:\.\d+)?(?:-pro)?)/i;
const STRONG_FAMILIES = /(?:sonnet|gpt-4\.1|gpt-4o|gemini-2\.5-pro|grok-3|grok-2)/i;
const LIGHT_FAMILIES = /(?:flash|haiku|mini|lite|nano)/i;

export function modelReference(model: Pick<Model<any>, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

export function describeModelProfile(reference: string | undefined, model?: Model<any>): KlermModelProfile {
	const resolved = reference?.trim() || "not configured";
	const slash = resolved.indexOf("/");
	const provider = model?.provider ?? (slash >= 0 ? resolved.slice(0, slash) : "unknown");
	const id = model?.id ?? (slash >= 0 ? resolved.slice(slash + 1) : resolved);
	const kind: KlermModelKind = isLocalProviderId(provider) ? "local-runtime" : "cloud";
	const band = strengthBand(kind, id, model?.name ?? id, model?.contextWindow, model?.reasoning === true);
	return {
		reference: resolved,
		name: model?.name ?? id,
		provider,
		kind,
		band,
		contextWindow: model?.contextWindow,
		reasoning: model?.reasoning === true,
		strengths: strengthsFor(kind, band),
		limits: limitsFor(kind, band),
	};
}

export function compareStrength(self: KlermModelProfile, other: KlermModelProfile): KlermRelativeStrength {
	if (other.band > self.band) return "stronger";
	if (other.band < self.band) return "weaker";
	return "similar";
}

export function formatPeerLookup(
	selfAgent: "Agent 1" | "Agent 2",
	self: KlermModelProfile,
	otherAgent: "Agent 1" | "Agent 2",
	other: KlermModelProfile,
): string {
	const relative = compareStrength(self, other);
	const relativeLine =
		relative === "stronger"
			? `${otherAgent} is stronger than you (${other.band}/5 vs ${self.band}/5). Delegate when the task exceeds your band or needs ${otherAgent} strengths.`
			: relative === "weaker"
				? `${otherAgent} is weaker than you (${other.band}/5 vs ${self.band}/5). Keep hard work yourself unless the user explicitly asks for ${otherAgent}.`
				: `${otherAgent} is similar strength (${other.band}/5). Delegate only for a second opinion or an explicit user request.`;
	return [
		"<klerm_identity>",
		`You are ${selfAgent} running ${self.reference}.`,
		formatProfileLine(self),
		`You are good at: ${self.strengths.join("; ")}.`,
		`You are weak at: ${self.limits.join("; ")}.`,
		"",
		`Peer lookup for ${otherAgent} (${other.reference}):`,
		formatProfileLine(other),
		relativeLine,
		`${otherAgent} is good at: ${other.strengths.join("; ")}.`,
		`${otherAgent} is weak at: ${other.limits.join("; ")}.`,
		"</klerm_identity>",
	].join("\n");
}

function formatProfileLine(profile: KlermModelProfile): string {
	const runtime = profile.kind === "local-runtime" ? `local ${profile.provider}` : "cloud";
	const context = profile.contextWindow ? `, context ${formatContextWindow(profile.contextWindow)}` : "";
	const reasoning = profile.reasoning ? ", reasoning yes" : ", reasoning no";
	return `Runtime: ${runtime}. Strength band ${profile.band}/5${context}${reasoning}.`;
}

function formatContextWindow(tokens: number): string {
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
	return String(tokens);
}

function strengthBand(
	kind: KlermModelKind,
	id: string,
	name: string,
	contextWindow: number | undefined,
	reasoning: boolean,
): KlermStrengthBand {
	const text = `${id} ${name}`;
	if (FRONTIER_FAMILIES.test(text)) return 5;
	if (STRONG_FAMILIES.test(text)) return 4;
	if (LIGHT_FAMILIES.test(text)) return kind === "cloud" ? 3 : 2;
	const params = parameterBillions(id);
	let band = kind === "cloud" ? 4 : 2;
	if (params !== undefined) {
		if (params >= 70) band = kind === "cloud" ? 5 : 4;
		else if (params >= 30) band = 4;
		else if (params >= 14) band = 3;
		else if (params >= 7) band = 2;
		else band = 1;
	}
	if (reasoning && band < 5) band += 1;
	if (contextWindow && contextWindow >= 200000 && band < 5) band += 1;
	return clampBand(band);
}

function parameterBillions(id: string): number | undefined {
	const match = id.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b(?:\b|[-_:])/);
	return match ? Number(match[1]) : undefined;
}

function clampBand(value: number): KlermStrengthBand {
	if (value <= 1) return 1;
	if (value >= 5) return 5;
	return value as KlermStrengthBand;
}

function strengthsFor(kind: KlermModelKind, band: KlermStrengthBand): string[] {
	if (kind === "local-runtime") {
		if (band <= 2) {
			return [
				"fast private workspace edits",
				"short refactors",
				"listing nearby files without a network round-trip",
			];
		}
		return ["private local coding", "medium refactors", "iteration without cloud latency"];
	}
	if (band >= 5) {
		return [
			"frontier coding",
			"architecture and multi-file design",
			"specialist reasoning and blocked-work recovery",
		];
	}
	if (band >= 4) {
		return ["strong cloud coding", "broader refactors", "longer-context planning"];
	}
	return ["quick cloud answers", "lightweight coding", "cheap second-pass review"];
}

function limitsFor(kind: KlermModelKind, band: KlermStrengthBand): string[] {
	if (kind === "local-runtime") {
		if (band <= 2) {
			return ["small context", "weak architecture and specialist security/auth work", "novel multi-package design"];
		}
		return ["weaker than frontier cloud models", "limited specialist reasoning", "less recovery from novel failures"];
	}
	if (band >= 4) {
		return ["higher latency", "requires network", "not private"];
	}
	return ["shallower reasoning than frontier models", "requires network", "not private"];
}
