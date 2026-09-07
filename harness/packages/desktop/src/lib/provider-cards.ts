import type { LocalRuntime, SelectOption } from "./model.ts";

export interface ProviderCard {
	id: string;
	label: string;
	count: number;
	detected?: string;
	custom?: boolean;
}

const PROVIDER_ORDER = [
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

export function providerLabel(id: string): string {
	return PROVIDER_LABELS[id] ?? id;
}

export function groupModelProviders(
	models: readonly SelectOption[],
	runtimes: readonly LocalRuntime[],
): ProviderCard[] {
	const counts = new Map<string, number>();
	for (const model of models) {
		if (!model.value) continue;
		const provider = providerFromRef(model.value);
		counts.set(provider, (counts.get(provider) ?? 0) + 1);
	}
	const cards: ProviderCard[] = [];
	const seen = new Set<string>();
	for (const id of PROVIDER_ORDER) {
		const runtime = runtimes.find((item) => item.providerId === id);
		const count = counts.get(id) ?? runtime?.models.length ?? 0;
		seen.add(id);
		cards.push({
			id,
			label: providerLabel(id),
			count,
			detected: runtime && !runtime.error ? runtime.name : runtime?.error ? "unavailable" : undefined,
		});
	}
	for (const id of [...counts.keys()].sort()) {
		if (seen.has(id)) continue;
		cards.push({ id, label: providerLabel(id), count: counts.get(id) ?? 0 });
	}
	for (const runtime of runtimes) {
		if (seen.has(runtime.providerId) || counts.has(runtime.providerId)) continue;
		cards.push({
			id: runtime.providerId,
			label: runtime.name || providerLabel(runtime.providerId),
			count: runtime.models.length,
			detected: runtime.error ? "unavailable" : runtime.name,
		});
	}
	cards.push({ id: "custom", label: "Add a custom model", count: 0, custom: true });
	return cards;
}

export function modelsForProvider(models: readonly SelectOption[], providerId: string): SelectOption[] {
	return models.filter((model) => providerFromRef(model.value) === providerId);
}
