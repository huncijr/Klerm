import { normalizeOpenAILocalServerUrl } from "./client.ts";

export interface OpenAILocalRuntimeDefinition {
	providerId: string;
	name: string;
	serverUrl: string;
	apiKey?: string;
}

function runtime(
	providerId: string,
	name: string,
	urlEnv: string,
	defaultUrl: string,
	apiKeyEnv: string,
): OpenAILocalRuntimeDefinition {
	return {
		providerId,
		name,
		serverUrl: normalizeOpenAILocalServerUrl(process.env[urlEnv] ?? defaultUrl),
		apiKey: process.env[apiKeyEnv]?.trim() || undefined,
	};
}

export function getOpenAILocalRuntimeDefinitions(): OpenAILocalRuntimeDefinition[] {
	const definitions = [
		runtime("lm-studio", "LM Studio", "KLERM_LM_STUDIO_URL", "http://127.0.0.1:1234", "KLERM_LM_STUDIO_API_KEY"),
		runtime("vllm", "vLLM", "KLERM_VLLM_URL", "http://127.0.0.1:8000", "KLERM_VLLM_API_KEY"),
		runtime(
			"llama.cpp-server",
			"llama.cpp server",
			"KLERM_LLAMA_CPP_SERVER_URL",
			"http://127.0.0.1:8080",
			"KLERM_LLAMA_CPP_SERVER_API_KEY",
		),
	];
	const genericUrl = process.env.KLERM_OPENAI_LOCAL_URL?.trim();
	if (genericUrl) {
		definitions.push({
			providerId: "openai-local",
			name: "Local OpenAI-compatible server",
			serverUrl: normalizeOpenAILocalServerUrl(genericUrl),
			apiKey: process.env.KLERM_OPENAI_LOCAL_API_KEY?.trim() || undefined,
		});
	}
	return definitions;
}
