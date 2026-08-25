import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { OpenAILocalClient, type OpenAILocalModelSummary } from "./client.ts";
import { createOpenAILocalProvider } from "./provider.ts";
import { getOpenAILocalRuntimeDefinitions } from "./runtimes.ts";

export default async function openAILocalExtension(klerm: ExtensionAPI): Promise<void> {
	const offline = process.env.PI_OFFLINE !== undefined || process.env.KLERM_OFFLINE !== undefined;
	const discoveries = await Promise.all(
		getOpenAILocalRuntimeDefinitions().map(async (runtime) => {
			let catalog: OpenAILocalModelSummary[] = [];
			if (!offline) {
				try {
					catalog = await new OpenAILocalClient(runtime.serverUrl, runtime.apiKey).list(AbortSignal.timeout(1000));
				} catch {
					// Local runtime discovery is optional; status commands report endpoint failures.
				}
			}
			return { runtime, catalog };
		}),
	);
	for (const { runtime, catalog } of discoveries) {
		klerm.registerProvider(createOpenAILocalProvider(runtime, catalog));
	}
}
