import type { OllamaClient } from "../../extensions/ollama/client.ts";
import {
	createOllamaRuntimeProbe,
	discoverLocalRuntimes,
	formatLocalRuntimeModels,
	formatLocalRuntimeStatus,
	type LocalRuntimeProbe,
} from "../local-runtime-discovery.ts";

export interface RunKlermLocalCommandOptions {
	client?: OllamaClient;
	probes?: readonly LocalRuntimeProbe[];
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

	const probes = options.probes ?? (options.client ? [createOllamaRuntimeProbe(options.client)] : undefined);
	const results = await discoverLocalRuntimes(probes, AbortSignal.timeout(5000));
	if (args[1] === "status") stdout(formatLocalRuntimeStatus(results));
	else stdout(formatLocalRuntimeModels(results));
	if (results.every((result) => result.error)) {
		stderr("Error: No local model runtime is currently reachable.");
		process.exitCode = 1;
	}
	return true;
}
