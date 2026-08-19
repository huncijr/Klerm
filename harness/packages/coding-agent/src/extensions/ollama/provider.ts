import type { AuthResult, Model, Provider, ProviderStreamOptions, RefreshModelsContext } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/compat";
import {
	isRemoteOllamaModel,
	OllamaClient,
	type OllamaModelSummary,
	ollamaInferenceUrl,
	ollamaModelId,
} from "./client.ts";

export const OLLAMA_PROVIDER_ID = "ollama";

function toModel(model: OllamaModelSummary, serverUrl: string): Model<"openai-completions"> {
	const id = ollamaModelId(model)!;
	return {
		id,
		name: id,
		api: "openai-completions",
		provider: OLLAMA_PROVIDER_ID,
		baseUrl: ollamaInferenceUrl(serverUrl),
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 16384,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
			supportsStrictMode: false,
			maxTokensField: "max_tokens",
		},
	};
}

export interface OllamaProviderController {
	provider: Provider<"openai-completions">;
	setCatalog(catalog: readonly OllamaModelSummary[]): void;
}

export function createOllamaProvider(
	serverUrl: string,
	initialCatalog: readonly OllamaModelSummary[] = [],
): OllamaProviderController {
	let models: readonly Model<"openai-completions">[] = [];
	const setCatalog = (catalog: readonly OllamaModelSummary[]): void => {
		models = catalog.filter((model) => !isRemoteOllamaModel(model)).map((model) => toModel(model, serverUrl));
	};
	setCatalog(initialCatalog);

	const provider: Provider<"openai-completions"> = {
		id: OLLAMA_PROVIDER_ID,
		name: "Ollama",
		baseUrl: ollamaInferenceUrl(serverUrl),
		auth: {
			apiKey: {
				name: "Local Ollama",
				check: async () => ({ type: "api_key", source: "local Ollama" }),
				resolve: async (): Promise<AuthResult> => ({
					auth: { apiKey: "ollama", baseUrl: ollamaInferenceUrl(serverUrl) },
					source: "local Ollama",
				}),
			},
		},
		getModels: () => models,
		refreshModels: async (context: RefreshModelsContext): Promise<void> => {
			if (!context.allowNetwork || context.signal.aborted) return;
			const catalog = await new OllamaClient(serverUrl).list(context.signal);
			const refreshed = catalog
				.filter((model) => !isRemoteOllamaModel(model))
				.map((model) => toModel(model, serverUrl));
			await context.publish({
				update: () => {
					models = refreshed;
				},
			});
		},
		stream: (model, context, options) => stream(model, context, options as ProviderStreamOptions | undefined),
		streamSimple: (model, context, options) => streamSimple(model, context, options),
	};

	return { provider, setCatalog };
}
