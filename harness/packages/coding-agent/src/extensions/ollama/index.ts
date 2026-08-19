import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { getOllamaServerUrl, OllamaClient, type OllamaModelSummary } from "./client.ts";
import { createOllamaProvider } from "./provider.ts";

export default async function ollamaExtension(klerm: ExtensionAPI): Promise<void> {
	const serverUrl = getOllamaServerUrl();
	let catalog: OllamaModelSummary[] = [];
	if (process.env.PI_OFFLINE === undefined && process.env.KLERM_OFFLINE === undefined) {
		try {
			catalog = await new OllamaClient(serverUrl).list(AbortSignal.timeout(1000));
		} catch {
			// Local runtime discovery is optional; explicit status commands report failures.
		}
	}
	klerm.registerProvider(createOllamaProvider(serverUrl, catalog).provider);
}
