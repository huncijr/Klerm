import type { AuthResult, Model, Provider, ProviderStreamOptions, RefreshModelsContext } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/compat";
import { OpenAILocalClient, type OpenAILocalModelSummary, openAILocalInferenceUrl } from "./client.ts";
import type { OpenAILocalRuntimeDefinition } from "./runtimes.ts";

function toModel(runtime: OpenAILocalRuntimeDefinition, model: OpenAILocalModelSummary): Model<"openai-completions"> {
	return {
		id: model.id,
		name: model.id,
		api: "openai-completions",
		provider: runtime.providerId,
		baseUrl: openAILocalInferenceUrl(runtime.serverUrl),
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

export function createOpenAILocalProvider(
	runtime: OpenAILocalRuntimeDefinition,
	initialCatalog: readonly OpenAILocalModelSummary[] = [],
): Provider<"openai-completions"> {
	let models: readonly Model<"openai-completions">[] = initialCatalog.map((model) => toModel(runtime, model));
	const inferenceUrl = openAILocalInferenceUrl(runtime.serverUrl);
	return {
		id: runtime.providerId,
		name: runtime.name,
		baseUrl: inferenceUrl,
		auth: {
			apiKey: {
				name: runtime.name,
				check: async () => ({ type: "api_key", source: `local ${runtime.name}` }),
				resolve: async (): Promise<AuthResult> => ({
					auth: { apiKey: runtime.apiKey ?? runtime.providerId, baseUrl: inferenceUrl },
					source: `local ${runtime.name}`,
				}),
			},
		},
		getModels: () => models,
		refreshModels: async (context: RefreshModelsContext): Promise<void> => {
			if (!context.allowNetwork || context.signal.aborted) return;
			const catalog = await new OpenAILocalClient(runtime.serverUrl, runtime.apiKey).list(context.signal);
			const refreshed = catalog.map((model) => toModel(runtime, model));
			await context.publish({
				update: () => {
					models = refreshed;
				},
			});
		},
		stream: (model, context, options) => stream(model, context, options as ProviderStreamOptions | undefined),
		streamSimple: (model, context, options) => streamSimple(model, context, options),
	};
}
