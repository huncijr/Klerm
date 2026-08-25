export interface OpenAILocalModelSummary {
	id: string;
	ownedBy?: string;
}

interface OpenAIModelsResponse {
	data: unknown[];
}

export function normalizeOpenAILocalServerUrl(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error("Local OpenAI-compatible URL cannot be empty");
	const withProtocol = /^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
	const url = new URL(withProtocol);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Local OpenAI-compatible URL must use http or https");
	}
	url.pathname = url.pathname.replace(/\/v1\/?$/u, "").replace(/\/$/u, "");
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/u, "");
}

export function openAILocalInferenceUrl(serverUrl: string): string {
	return `${normalizeOpenAILocalServerUrl(serverUrl)}/v1`;
}

export class OpenAILocalClient {
	readonly serverUrl: string;
	private readonly apiKey?: string;

	constructor(serverUrl: string, apiKey?: string) {
		this.serverUrl = normalizeOpenAILocalServerUrl(serverUrl);
		this.apiKey = apiKey?.trim() || undefined;
	}

	async list(signal?: AbortSignal): Promise<OpenAILocalModelSummary[]> {
		const headers = this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined;
		const response = await fetch(`${this.serverUrl}/v1/models`, { headers, signal });
		if (!response.ok) throw new Error(`Local OpenAI-compatible runtime returned HTTP ${response.status}`);
		const payload = (await response.json()) as Partial<OpenAIModelsResponse>;
		if (!Array.isArray(payload.data)) throw new Error("Local OpenAI-compatible runtime returned an invalid catalog");

		const seen = new Set<string>();
		const models: OpenAILocalModelSummary[] = [];
		for (const entry of payload.data) {
			if (!entry || typeof entry !== "object") {
				throw new Error("Local OpenAI-compatible runtime returned an invalid model entry");
			}
			const id = "id" in entry && typeof entry.id === "string" ? entry.id.trim() : "";
			if (!id) throw new Error("Local OpenAI-compatible runtime returned a model without an id");
			if (seen.has(id)) continue;
			seen.add(id);
			models.push({
				id,
				ownedBy: "owned_by" in entry && typeof entry.owned_by === "string" ? entry.owned_by : undefined,
			});
		}
		return models.sort((a, b) => a.id.localeCompare(b.id));
	}
}
