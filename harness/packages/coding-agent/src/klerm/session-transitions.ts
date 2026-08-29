import type { SessionEntry } from "../core/session-manager.ts";
import { isLocalProviderId } from "./local-providers.ts";
import {
	isKlermSessionTransitionData,
	KLERM_SESSION_TRANSITION_CUSTOM_TYPE,
	type KlermTransitionState,
} from "./router/types.ts";

export type KlermTranscriptTransition = Pick<
	KlermTransitionState,
	"id" | "kind" | "fromLane" | "toLane" | "fromTarget" | "toTarget" | "reason"
>;

function getSessionEntryText(entry: SessionEntry | undefined): string | undefined {
	if (entry?.type !== "message" || entry.message.role !== "user") return undefined;
	const content = entry.message.content;
	return (
		typeof content === "string"
			? content
			: content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n")
	).trim();
}

function getRoutingTool(entry: SessionEntry | undefined): { name: string; reason?: string } | undefined {
	if (entry?.type !== "message") return undefined;
	if (entry.message.role === "toolResult") {
		const name = entry.message.toolName;
		if (!name || !["delegate_frontier", "delegate_local", "return_to_local", "return_to_frontier"].includes(name)) {
			return undefined;
		}
		const details = entry.message.details;
		const reason =
			details && typeof details === "object" && "reason" in details && typeof details.reason === "string"
				? details.reason
				: undefined;
		return { name, reason };
	}
	if (entry.message.role !== "assistant") return undefined;
	for (let i = entry.message.content.length - 1; i >= 0; i--) {
		const part = entry.message.content[i];
		if (
			part.type === "toolCall" &&
			["delegate_frontier", "delegate_local", "return_to_local", "return_to_frontier"].includes(part.name)
		) {
			const args = part.arguments;
			return { name: part.name, reason: typeof args.reason === "string" ? args.reason : undefined };
		}
	}
	return undefined;
}

/** Reconstruct display-only handoffs from sessions written before transition entries were persisted. */
export function deriveLegacyKlermTranscriptTransitions(
	entries: readonly SessionEntry[],
): ReadonlyMap<string, KlermTranscriptTransition> {
	const claimedModelChanges = new Set<string>();
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (
			entry.type !== "custom" ||
			entry.customType !== KLERM_SESSION_TRANSITION_CUSTOM_TYPE ||
			!isKlermSessionTransitionData(entry.data)
		) {
			continue;
		}
		for (let j = i - 1; j >= 0; j--) {
			const candidate = entries[j];
			if (candidate.type === "thinking_level_change") continue;
			if (candidate.type === "model_change") claimedModelChanges.add(candidate.id);
			break;
		}
	}

	const transitions = new Map<string, KlermTranscriptTransition>();
	let previousTarget: string | undefined;
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.type !== "model_change") continue;
		const toTarget = `${entry.provider}/${entry.modelId}`;
		if (claimedModelChanges.has(entry.id)) {
			previousTarget = toTarget;
			continue;
		}

		let previousIndex = i - 1;
		while (previousIndex >= 0 && entries[previousIndex].type === "thinking_level_change") previousIndex--;
		let nextIndex = i + 1;
		while (nextIndex < entries.length && entries[nextIndex].type === "thinking_level_change") nextIndex++;
		const tool = getRoutingTool(entries[previousIndex]);
		const nextText = getSessionEntryText(entries[nextIndex]);
		const handoffHeader = nextText?.startsWith("[Klerm ") ? nextText.split("\n", 1)[0] : undefined;
		if (!tool && !handoffHeader) {
			previousTarget = toTarget;
			continue;
		}

		const kind = tool?.name.startsWith("return_to_") || handoffHeader?.includes(" return]") ? "return" : "delegate";
		const toLane = tool?.name.endsWith("_local") || isLocalProviderId(entry.provider) ? "local" : "frontier";
		const reasonLine = nextText?.split("\n").find((line) => line.startsWith("Reason: "));
		transitions.set(entry.id, {
			id: `legacy-${entry.id}`,
			kind,
			fromLane: toLane === "local" ? "frontier" : "local",
			toLane,
			fromTarget: previousTarget,
			toTarget,
			reason: tool?.reason ?? reasonLine?.slice("Reason: ".length) ?? "restored Klerm model transition",
		});
		previousTarget = toTarget;
	}
	return transitions;
}
