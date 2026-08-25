import {
	formatOllamaSize,
	getOllamaServerUrl,
	isRemoteOllamaModel,
	OllamaClient,
	ollamaModelId,
} from "../extensions/ollama/client.ts";
import { OpenAILocalClient } from "../extensions/openai-local/client.ts";
import { getOpenAILocalRuntimeDefinitions } from "../extensions/openai-local/runtimes.ts";

export interface DetectedLocalModel {
	id: string;
	details?: string;
}

export interface LocalRuntimeProbe {
	providerId: string;
	name: string;
	serverUrl: string;
	detect(signal?: AbortSignal): Promise<{ models: DetectedLocalModel[]; statusDetails?: string[] }>;
}

export interface LocalRuntimeDiscoveryResult {
	providerId: string;
	name: string;
	serverUrl: string;
	models: DetectedLocalModel[];
	statusDetails?: string[];
	error?: string;
}

export function createOllamaRuntimeProbe(client = new OllamaClient(getOllamaServerUrl())): LocalRuntimeProbe {
	return {
		providerId: "ollama",
		name: "Ollama",
		serverUrl: client.serverUrl,
		detect: async (signal) => {
			const catalog = await client.list(signal);
			const local = catalog.filter((model) => !isRemoteOllamaModel(model));
			return {
				models: local.map((model) => {
					const details = [
						model.details?.parameter_size,
						model.details?.quantization_level,
						model.size === undefined ? undefined : formatOllamaSize(model.size),
					]
						.filter(Boolean)
						.join(" · ");
					return { id: ollamaModelId(model)!, details: details || undefined };
				}),
				statusDetails: [`Local models: ${local.length}`, `Remote models: ${catalog.length - local.length}`],
			};
		},
	};
}

export function getLocalRuntimeProbes(): LocalRuntimeProbe[] {
	return [
		createOllamaRuntimeProbe(),
		...getOpenAILocalRuntimeDefinitions().map(
			(runtime): LocalRuntimeProbe => ({
				providerId: runtime.providerId,
				name: runtime.name,
				serverUrl: runtime.serverUrl,
				detect: async (signal) => {
					const models = await new OpenAILocalClient(runtime.serverUrl, runtime.apiKey).list(signal);
					return { models: models.map((model) => ({ id: model.id })) };
				},
			}),
		),
	];
}

export async function discoverLocalRuntimes(
	probes: readonly LocalRuntimeProbe[] = getLocalRuntimeProbes(),
	signal?: AbortSignal,
): Promise<LocalRuntimeDiscoveryResult[]> {
	return Promise.all(
		probes.map(async (probe) => {
			try {
				const detected = await probe.detect(signal);
				return {
					providerId: probe.providerId,
					name: probe.name,
					serverUrl: probe.serverUrl,
					...detected,
				};
			} catch (error) {
				return {
					providerId: probe.providerId,
					name: probe.name,
					serverUrl: probe.serverUrl,
					models: [],
					error: error instanceof Error ? error.message : String(error),
				};
			}
		}),
	);
}

export function formatLocalRuntimeStatus(results: readonly LocalRuntimeDiscoveryResult[]): string {
	return results
		.map((result) =>
			result.error
				? `${result.name}: unavailable\nEndpoint: ${result.serverUrl}\nReason: ${result.error}`
				: [
						`${result.name}: running`,
						`Endpoint: ${result.serverUrl}`,
						`Models: ${result.models.length}`,
						...(result.statusDetails ?? []),
					].join("\n"),
		)
		.join("\n\n");
}

export function formatLocalRuntimeModels(results: readonly LocalRuntimeDiscoveryResult[]): string {
	const models = results.flatMap((result) =>
		result.error
			? []
			: result.models.map((model) => {
					const reference = `${result.providerId}/${model.id}`;
					return model.details ? `${reference}  ${model.details}` : reference;
				}),
	);
	if (models.length > 0) return models.join("\n");
	if (results.some((result) => !result.error)) return "No models were reported by the detected local runtimes.";
	return "No local model runtime is currently reachable.";
}
