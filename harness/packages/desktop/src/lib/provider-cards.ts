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
