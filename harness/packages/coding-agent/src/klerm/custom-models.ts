import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stripJsonComments } from "../utils/json.ts";

export interface CustomModelEntry {
	provider: string;
	id: string;
	name?: string;
	api: string;
	baseUrl: string;
	apiKey?: string;
}

const CUSTOM_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;

export function isCustomModelApi(value: unknown): value is (typeof CUSTOM_APIS)[number] {
	return typeof value === "string" && (CUSTOM_APIS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function parseCustomModels(raw: unknown): CustomModelEntry[] {
	const root = asRecord(raw);
	const providers = asRecord(root?.providers);
	if (!providers) return [];
	const models: CustomModelEntry[] = [];
	for (const [provider, config] of Object.entries(providers)) {
		const record = asRecord(config);
		if (!record || !Array.isArray(record.models)) continue;
		const providerApi = typeof record.api === "string" ? record.api : undefined;
		const providerBaseUrl = typeof record.baseUrl === "string" ? record.baseUrl : undefined;
		for (const model of record.models) {
			const item = asRecord(model);
			const id = typeof item?.id === "string" ? item.id.trim() : "";
			if (!id) continue;
			const api = typeof item?.api === "string" ? item.api : providerApi;
			const baseUrl = typeof item?.baseUrl === "string" ? item.baseUrl : providerBaseUrl;
			if (!isCustomModelApi(api) || !baseUrl) continue;
			models.push({
				provider,
				id,
				name: typeof item?.name === "string" ? item.name : undefined,
				api,
				baseUrl,
			});
		}
	}
	return models;
}

export async function loadCustomModels(modelsPath: string): Promise<CustomModelEntry[]> {
	try {
		const content = await readFile(modelsPath, "utf-8");
		return parseCustomModels(JSON.parse(stripJsonComments(content)));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function readModelsFile(modelsPath: string): Promise<Record<string, unknown>> {
	try {
		const content = await readFile(modelsPath, "utf-8");
		const parsed = JSON.parse(stripJsonComments(content));
		return asRecord(parsed) ?? { providers: {} };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { providers: {} };
		throw error;
	}
}

async function writeModelsFile(modelsPath: string, value: Record<string, unknown>): Promise<void> {
	await mkdir(dirname(modelsPath), { recursive: true });
	const tempPath = `${modelsPath}.${process.pid}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
	await rename(tempPath, modelsPath);
}

export async function upsertCustomModel(modelsPath: string, entry: CustomModelEntry): Promise<CustomModelEntry> {
	const provider = entry.provider.trim();
	const id = entry.id.trim();
	if (!/^[A-Za-z0-9._-]+$/.test(provider) || id.length === 0) {
		throw new Error("Custom model provider and id are required.");
	}
	if (!isCustomModelApi(entry.api)) throw new Error("Unsupported custom model API.");
	const baseUrl = entry.baseUrl.trim();
	if (!baseUrl) throw new Error("A custom model base URL is required.");
	const file = await readModelsFile(modelsPath);
	const providers = asRecord(file.providers) ?? {};
	const existing = asRecord(providers[provider]) ?? {};
	const models = Array.isArray(existing.models) ? [...existing.models] : [];
	const nextModel = {
		id,
		name: entry.name?.trim() || id,
		api: entry.api,
		baseUrl,
		contextWindow: 128000,
		maxTokens: 8192,
		input: ["text"],
	};
	const index = models.findIndex((model) => asRecord(model)?.id === id);
	if (index >= 0) models[index] = nextModel;
	else models.push(nextModel);
	providers[provider] = {
		...existing,
		baseUrl,
		api: entry.api,
		...(entry.apiKey?.trim() ? { apiKey: entry.apiKey.trim() } : {}),
		models,
	};
	file.providers = providers;
	await writeModelsFile(modelsPath, file);
	return { provider, id, name: nextModel.name, api: entry.api, baseUrl };
}

export async function removeCustomModel(modelsPath: string, provider: string, id: string): Promise<boolean> {
	const file = await readModelsFile(modelsPath);
	const providers = asRecord(file.providers);
	const existing = asRecord(providers?.[provider]);
	if (!existing || !Array.isArray(existing.models)) return false;
	const next = existing.models.filter((model) => asRecord(model)?.id !== id);
	if (next.length === existing.models.length) return false;
	if (next.length === 0) delete providers![provider];
	else existing.models = next;
	file.providers = providers;
	await writeModelsFile(modelsPath, file);
	return true;
}
