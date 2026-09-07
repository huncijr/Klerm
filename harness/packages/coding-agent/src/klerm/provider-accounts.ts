import type { ModelRuntime } from "../core/model-runtime.ts";
import { loadCustomModels, updateModelsProviderFields } from "./custom-models.ts";

export interface ProviderAccountStatus {
	id: string;
	label: string;
	models: string[];
	configured: boolean;
	source?: string;
	local: boolean;
	detected?: string;
}

function labelFor(id: string, fallback?: string): string {
	if (fallback && fallback !== id) return fallback;
	return id
		.split(/[-_]/)
		.map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
		.join(" ");
}

export function getProviderAccountStatus(
	modelRuntime: Pick<ModelRuntime, "getProviders" | "getModels" | "getProviderAuthStatus">,
	runtimes: Array<{ providerId: string; name: string; models: Array<{ id: string }>; error?: string }>,
	customProviders: Map<string, string[]>,
): ProviderAccountStatus[] {
	const byId = new Map<string, ProviderAccountStatus>();
	for (const provider of modelRuntime.getProviders()) {
		const models = modelRuntime.getModels(provider.id).map((model) => model.id);
		const auth = modelRuntime.getProviderAuthStatus(provider.id);
		byId.set(provider.id, {
			id: provider.id,
			label: provider.name || labelFor(provider.id),
			models,
			configured: auth.configured,
			source: auth.source ?? auth.label,
			local: false,
		});
	}
	for (const runtime of runtimes) {
		const existing = byId.get(runtime.providerId);
		const detected = runtime.error ? "unavailable" : runtime.name;
		if (existing) {
			existing.local = true;
			existing.detected = detected;
			if (!existing.configured && !runtime.error && runtime.models.length > 0) {
				existing.configured = true;
				existing.source = "local runtime";
			}
			continue;
		}
		byId.set(runtime.providerId, {
			id: runtime.providerId,
			label: runtime.name || labelFor(runtime.providerId),
			models: runtime.models.map((model) => model.id),
			configured: !runtime.error && runtime.models.length > 0,
			source: runtime.error ? undefined : "local runtime",
			local: true,
			detected,
		});
	}
	for (const [providerId, models] of customProviders) {
		const existing = byId.get(providerId);
		if (existing) {
			for (const id of models) {
				if (!existing.models.includes(id)) existing.models.push(id);
			}
			continue;
		}
		byId.set(providerId, {
			id: providerId,
			label: labelFor(providerId),
			models,
			configured: true,
			source: "models.json",
			local: false,
		});
	}
	return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export interface ProviderConnectInput {
	provider: string;
	apiKey?: string;
	baseUrl?: string;
}

export async function connectProviderAccount(
	modelRuntime: Pick<ModelRuntime, "getProvider" | "login" | "refresh">,
	modelsPath: string,
	input: ProviderConnectInput,
): Promise<void> {
	const providerId = input.provider.trim();
	if (!modelRuntime.getProvider(providerId)) throw new Error(`Unknown provider: ${providerId || "(empty)"}`);
	const apiKey = input.apiKey?.trim();
	const baseUrl = input.baseUrl?.trim();
	if (!apiKey && !baseUrl) throw new Error("Provide an API key or an endpoint override.");
	if (apiKey) {
		await modelRuntime.login(providerId, "api_key", {
			prompt: async () => apiKey,
			notify: () => {},
		});
	}
	if (baseUrl !== undefined) {
		await updateModelsProviderFields(modelsPath, providerId, { baseUrl });
	}
	await modelRuntime.refresh({ allowNetwork: false });
}

export async function disconnectProviderAccount(
	modelRuntime: Pick<ModelRuntime, "getProvider" | "logout" | "refresh">,
	modelsPath: string,
	providerId: string,
): Promise<void> {
	const id = providerId.trim();
	if (!modelRuntime.getProvider(id)) throw new Error(`Unknown provider: ${id || "(empty)"}`);
	await modelRuntime.logout(id).catch(() => {});
	await updateModelsProviderFields(modelsPath, id, { apiKey: "", baseUrl: "" });
	await modelRuntime.refresh({ allowNetwork: false });
}

export async function customProviderModelIds(modelsPath: string): Promise<Map<string, string[]>> {
	const grouped = new Map<string, string[]>();
	for (const model of await loadCustomModels(modelsPath)) {
		const list = grouped.get(model.provider) ?? [];
		if (!list.includes(model.id)) list.push(model.id);
		grouped.set(model.provider, list);
	}
	return grouped;
}
