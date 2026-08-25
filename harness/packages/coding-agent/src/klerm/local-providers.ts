export const LOCAL_PROVIDER_IDS = new Set([
	"ollama",
	"llama.cpp",
	"lm-studio",
	"vllm",
	"llama.cpp-server",
	"openai-local",
]);

export function isLocalProviderId(providerId: string): boolean {
	return LOCAL_PROVIDER_IDS.has(providerId);
}
