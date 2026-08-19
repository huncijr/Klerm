import type { ModelRuntime } from "../../core/model-runtime.ts";

export async function runKlermProvidersCommand(args: string[], modelRuntime: ModelRuntime): Promise<boolean> {
	if (args[0] !== "providers") return false;
	if (args.length > 1 && args[1] !== "--help" && args[1] !== "-h") {
		console.error("Error: klerm providers does not accept arguments");
		process.exitCode = 1;
		return true;
	}
	if (args[1] === "--help" || args[1] === "-h") {
		console.log("Usage: klerm providers");
		return true;
	}

	const lines: string[] = [];
	for (const provider of [...modelRuntime.getProviders()].sort((a, b) => a.name.localeCompare(b.name))) {
		const status = modelRuntime.getProviderAuthStatus(provider.id);
		const methods = [
			provider.auth.oauth ? "subscription" : undefined,
			provider.auth.apiKey ? "API key/local" : undefined,
		]
			.filter(Boolean)
			.join(", ");
		lines.push(
			`${provider.id.padEnd(28)} ${(status.configured ? "configured" : "unconfigured").padEnd(14)} models: ${String(modelRuntime.getModels(provider.id).length).padEnd(4)} ${methods}`,
		);
	}
	console.log(lines.join("\n"));
	return true;
}
