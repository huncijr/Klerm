import type { ProviderAccount } from "./model.ts";

export const PROVIDER_ORDER = [
	"anthropic",
	"openai",
	"openai-codex",
	"google",
	"ollama",
	"qwen-token-plan",
	"groq",
	"xai",
	"openrouter",
	"deepseek",
	"mistral",
	"huggingface",
	"github-copilot",
	"fireworks",
	"together",
	"amazon-bedrock",
	"moonshotai",
	"kimi-coding",
	"minimax",
	"nvidia",
	"zai",
	"cerebras",
];

const PROVIDER_LABELS: Record<string, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	"openai-codex": "Codex",
	google: "Google",
	"google-vertex": "Vertex",
	ollama: "Ollama",
	"qwen-token-plan": "Qwen",
	"qwen-token-plan-cn": "Qwen CN",
	"qwen-token-plan-individual": "Qwen Individual",
	openrouter: "OpenRouter",
	groq: "Groq",
	xai: "xAI",
	deepseek: "DeepSeek",
	mistral: "Mistral",
	huggingface: "Hugging Face",
	"github-copilot": "Copilot",
	fireworks: "Fireworks",
	together: "Together",
	"amazon-bedrock": "Bedrock",
	moonshotai: "Kimi",
	"kimi-coding": "Kimi Coding",
	minimax: "MiniMax",
	nvidia: "NVIDIA",
	zai: "Z.AI",
	cerebras: "Cerebras",
};

export function providerFromRef(value: string): string {
	const slash = value.indexOf("/");
	return slash > 0 ? value.slice(0, slash) : value;
}

export function providerLabel(id: string, fallback?: string): string {
	if (fallback && fallback !== id) return fallback;
	return PROVIDER_LABELS[id] ?? id;
}

export interface ProviderGroup {
	id: string;
	label: string;
	members: ProviderAccount[];
}

/** Provider ids merged into one card (e.g. OpenAI + Codex). */
const PROVIDER_GROUPS: Record<string, { label: string; members: string[] }> = {
	openai: { label: "OpenAI", members: ["openai", "openai-codex"] },
};

export function groupLabel(id: string, fallback?: string): string {
	for (const group of Object.values(PROVIDER_GROUPS)) {
		if (group.members.includes(id)) return group.label;
	}
	return providerLabel(id, fallback);
}

/** Merge grouped ids (OpenAI + Codex) into single cards. */
export function groupProviderAccounts(providers: readonly ProviderAccount[]): ProviderGroup[] {
	const byId = new Map(providers.map((provider) => [provider.id, provider]));
	const groups: ProviderGroup[] = [];
	const consumed = new Set<string>();
	for (const [groupId, group] of Object.entries(PROVIDER_GROUPS)) {
		const members = group.members.map((id) => byId.get(id)).filter((item) => item !== undefined);
		if (members.length === 0) continue;
		for (const member of members) consumed.add(member.id);
		groups.push({ id: groupId, label: group.label, members });
	}
	for (const provider of providers) {
		if (!consumed.has(provider.id)) groups.push({ id: provider.id, label: provider.label, members: [provider] });
	}
	return groups;
}

/** Curated groups first (by first member order), then the rest alphabetically. */
export function orderProviderGroups(groups: readonly ProviderGroup[]): ProviderGroup[] {
	const rank = (group: ProviderGroup): number => {
		const ranks = group.members.map((member) => PROVIDER_ORDER.indexOf(member.id)).filter((index) => index >= 0);
		return ranks.length > 0 ? Math.min(...ranks) : PROVIDER_ORDER.length;
	};
	return [...groups].sort((left, right) => rank(left) - rank(right) || left.label.localeCompare(right.label));
}

/** Curated providers first, then the rest alphabetically, custom card last. */
export function orderProviderAccounts(providers: readonly ProviderAccount[]): ProviderAccount[] {
	const byId = new Map(providers.map((provider) => [provider.id, provider]));
	const ordered: ProviderAccount[] = [];
	for (const id of PROVIDER_ORDER) {
		const provider = byId.get(id);
		if (provider) {
			ordered.push(provider);
			byId.delete(id);
		}
	}
	for (const provider of [...byId.values()].sort((left, right) => left.label.localeCompare(right.label))) {
		if (provider.id !== "custom") ordered.push(provider);
	}
	return ordered;
}
