import type { Model } from "@earendil-works/pi-ai";
import { isLocalProviderId } from "./local-providers.ts";

export type KlermModelKind = "local-runtime" | "cloud" | "unknown";
export type KlermStrengthBand = 1 | 2 | 3 | 4 | 5;
export type KlermRelativeStrength = "stronger" | "similar" | "weaker" | "unknown";

export interface KlermModelProfile {
	reference: string;
	name: string;
	provider: string;
	kind: KlermModelKind;
	/** Neutral legacy field, not an estimated quality rank. Never used for selection. */
	band: KlermStrengthBand;
	contextWindow?: number;
	reasoning?: boolean;
	strengths: string[];
	limits: string[];
}

export function modelReference(model: Pick<Model<string>, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

export function describeModelProfile(reference: string | undefined, model?: Model<string>): KlermModelProfile {
	return {
		reference: reference ?? "not configured",
		name: model?.name ?? reference ?? "not configured",
		provider: model?.provider ?? "unknown",
		kind: model && isLocalProviderId(model.provider) ? "local-runtime" : "unknown",
		band: 3,
		contextWindow: model?.contextWindow,
		reasoning: model?.reasoning,
		strengths: [],
		limits: ["Quality, privacy, latency and task strengths are not inferred from model names."],
	};
}

export function compareStrength(_self: KlermModelProfile, _other: KlermModelProfile): KlermRelativeStrength {
	return "unknown";
}

export function formatPeerLookup(
	selfAgent: "Agent 1" | "Agent 2",
	self: KlermModelProfile,
	otherAgent: "Agent 1" | "Agent 2",
	other: KlermModelProfile,
): string {
	const metadata = (profile: KlermModelProfile) =>
		`Declared metadata: provider ${profile.provider}; context ${profile.contextWindow ?? "unknown"}; reasoning ${profile.reasoning === undefined ? "unknown" : profile.reasoning ? "yes" : "no"}.`;
	return [
		"<klerm_identity>",
		`You are ${selfAgent} running ${self.reference}.`,
		metadata(self),
		`Peer lookup for ${otherAgent} (${other.reference}):`,
		metadata(other),
		"Comparative model quality is unknown. Do not infer strengths, weaknesses, privacy or latency from the model or provider name.",
		"Choose handoffs using configured roles, available tools, task requirements and observed results.",
		"</klerm_identity>",
	].join("\n");
}
