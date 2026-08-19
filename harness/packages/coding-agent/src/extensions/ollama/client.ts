export const DEFAULT_OLLAMA_SERVER_URL = "http://127.0.0.1:11434";

export interface OllamaModelSummary {
	name?: string;
	model?: string;
	modified_at?: string;
	size?: number;
	digest?: string;
	remote_host?: string;
	remote_model?: string;
	details?: {
		format?: string;
		family?: string;
		families?: string[];
		parameter_size?: string;
		quantization_level?: string;
	};
}

interface OllamaTagsResponse {
	models: OllamaModelSummary[];
}

export function normalizeOllamaServerUrl(value: string): string {
	const withProtocol = /^https?:\/\//iu.test(value.trim()) ? value.trim() : `http://${value.trim()}`;
	const url = new URL(withProtocol);
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Ollama URL must use http or https");
	url.pathname = url.pathname.replace(/\/v1\/?$/u, "").replace(/\/$/u, "");
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/u, "");
}

export function getOllamaServerUrl(): string {
	return normalizeOllamaServerUrl(
		process.env.KLERM_OLLAMA_URL ?? process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_SERVER_URL,
	);
}

export function ollamaInferenceUrl(serverUrl: string): string {
	return `${normalizeOllamaServerUrl(serverUrl)}/v1`;
}

export function ollamaModelId(model: OllamaModelSummary): string | undefined {
	const id = model.model?.trim() || model.name?.trim();
	return id || undefined;
}

export function isRemoteOllamaModel(model: OllamaModelSummary): boolean {
	return Boolean(model.remote_host?.trim());
}

export class OllamaClient {
	readonly serverUrl: string;

	constructor(serverUrl = getOllamaServerUrl()) {
		this.serverUrl = normalizeOllamaServerUrl(serverUrl);
	}

	async list(signal?: AbortSignal): Promise<OllamaModelSummary[]> {
		const response = await fetch(`${this.serverUrl}/api/tags`, { signal });
		if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
		const payload = (await response.json()) as Partial<OllamaTagsResponse>;
		if (!Array.isArray(payload.models)) throw new Error("Ollama returned an invalid model catalog");

		const seen = new Set<string>();
		const models: OllamaModelSummary[] = [];
		for (const model of payload.models) {
			if (!model || typeof model !== "object") throw new Error("Ollama returned an invalid model entry");
			const id = ollamaModelId(model);
			if (!id) throw new Error("Ollama returned a model without an id");
			if (seen.has(id)) continue;
			seen.add(id);
			models.push(model);
		}
		return models.sort((a, b) => ollamaModelId(a)!.localeCompare(ollamaModelId(b)!));
	}
}

export function formatOllamaSize(bytes: number | undefined): string {
	if (bytes === undefined || !Number.isFinite(bytes)) return "-";
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
