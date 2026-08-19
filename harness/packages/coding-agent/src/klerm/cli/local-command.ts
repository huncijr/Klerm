import {
	formatOllamaSize,
	getOllamaServerUrl,
	isRemoteOllamaModel,
	OllamaClient,
	ollamaModelId,
} from "../../extensions/ollama/client.ts";

export interface RunKlermLocalCommandOptions {
	client?: OllamaClient;
	stdout?: (message: string) => void;
	stderr?: (message: string) => void;
}

export async function runKlermLocalCommand(
	args: string[],
	options: RunKlermLocalCommandOptions = {},
): Promise<boolean> {
	if (args[0] !== "local") return false;
	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	if (args.length === 1 || args[1] === "--help" || args[1] === "-h") {
		stdout("Usage:\n  klerm local status\n  klerm local models");
		return true;
	}
	if ((args[1] !== "status" && args[1] !== "models") || args.length > 2) {
		stderr(`Error: Unknown local command "${args.slice(1).join(" ")}".\nUsage: klerm local status|models`);
		process.exitCode = 1;
		return true;
	}

	const client = options.client ?? new OllamaClient(getOllamaServerUrl());
	try {
		const models = await client.list(AbortSignal.timeout(5000));
		const local = models.filter((model) => !isRemoteOllamaModel(model));
		const remote = models.length - local.length;
		if (args[1] === "status") {
			stdout(
				`Ollama: running\nEndpoint: ${client.serverUrl}\nLocal models: ${local.length}\nRemote models: ${remote}`,
			);
			return true;
		}
		if (local.length === 0) {
			stdout("No local Ollama models are installed.\nSuggested: ollama pull qwen2.5-coder:7b");
			return true;
		}
		stdout(
			local
				.map((model) => {
					const details = [
						model.details?.parameter_size,
						model.details?.quantization_level,
						formatOllamaSize(model.size),
					]
						.filter(Boolean)
						.join(" · ");
					return details ? `${ollamaModelId(model)}  ${details}` : ollamaModelId(model)!;
				})
				.join("\n"),
		);
		return true;
	} catch (error) {
		stderr(
			`Error: Cannot connect to Ollama at ${client.serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
		return true;
	}
}
