import { APP_NAME, getAgentDir } from "../../config.ts";
import {
	type KlermActiveStartLane,
	type KlermConfig,
	KlermConfigStore,
	type KlermRoutingMode,
	type KlermWorkerRole,
} from "../config.ts";

const CONFIG_USAGE = `${APP_NAME} config get [key] [--json]\n  ${APP_NAME} config set <key> <value> [--json]`;
const ROUTING_USAGE = `${APP_NAME} routing status [--json]`;
const MODE_USAGE = `${APP_NAME} mode [--json]\n  ${APP_NAME} mode <local|frontier> <planner|builder> [--json]`;

const configKeys = {
	routing: "routing",
	"active-start-lane": "activeStartLane",
	"local-model": "localModel",
	"frontier-model": "frontierModel",
	"local-role": "localRole",
	"frontier-role": "frontierRole",
	"allow-frontier-fallback": "allowFrontierFallback",
	"handback-enabled": "handbackEnabled",
	"max-delegation-cycles": "maxDelegationCycles",
	"local-max-turns": "localMaxTurns",
	"local-max-tool-errors": "localMaxToolErrors",
} as const satisfies Record<string, keyof KlermConfig>;

type ConfigCliKey = keyof typeof configKeys;

export interface RunKlermConfigCommandOptions {
	agentDir?: string;
	stdout?: (message: string) => void;
	stderr?: (message: string) => void;
}

function isConfigKey(value: string): value is ConfigCliKey {
	return value in configKeys;
}

function parseConfigValue(key: ConfigCliKey, value: string): KlermConfig[keyof KlermConfig] | undefined {
	if (key === "routing") {
		return (["off", "local", "frontier", "auto"] satisfies KlermRoutingMode[]).includes(value as KlermRoutingMode)
			? (value as KlermRoutingMode)
			: undefined;
	}
	if (key === "active-start-lane") {
		return (["auto", "local", "frontier", "frontier-local"] satisfies KlermActiveStartLane[]).includes(
			value as KlermActiveStartLane,
		)
			? (value as KlermActiveStartLane)
			: undefined;
	}
	if (key === "local-role" || key === "frontier-role") {
		return (["planner", "builder"] satisfies KlermWorkerRole[]).includes(value as KlermWorkerRole)
			? (value as KlermWorkerRole)
			: undefined;
	}
	if (key === "local-model" || key === "frontier-model") return value === "none" ? undefined : value || undefined;
	if (key === "allow-frontier-fallback" || key === "handback-enabled") {
		if (value === "true" || value === "on") return true;
		if (value === "false" || value === "off") return false;
		return undefined;
	}
	const number = Number(value);
	const minimum = key === "max-delegation-cycles" ? 0 : 1;
	return Number.isSafeInteger(number) && number >= minimum ? number : undefined;
}

function printableConfig(config: Readonly<KlermConfig>): Record<ConfigCliKey, string | number | boolean | null> {
	return Object.fromEntries(
		Object.entries(configKeys).map(([cliKey, configKey]) => [cliKey, config[configKey] ?? null]),
	) as Record<ConfigCliKey, string | number | boolean | null>;
}

export async function runKlermConfigCommand(
	args: string[],
	options: RunKlermConfigCommandOptions = {},
): Promise<boolean> {
	if (args[0] !== "config" && args[0] !== "routing" && args[0] !== "mode") return false;
	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	const json = args.includes("--json");
	if (args[0] === "mode") {
		const positional = args.slice(1).filter((arg) => arg !== "--json");
		if (positional.length === 0) {
			const config = (await KlermConfigStore.load(options.agentDir ?? getAgentDir())).get();
			const roles = { local: config.localRole, frontier: config.frontierRole };
			stdout(json ? JSON.stringify(roles, null, 2) : `Local role: ${roles.local}\nFrontier role: ${roles.frontier}`);
			return true;
		}
		const [lane, role] = positional;
		if (
			positional.length !== 2 ||
			(lane !== "local" && lane !== "frontier") ||
			(role !== "planner" && role !== "builder")
		) {
			stderr(`Error: Invalid mode command.\nUsage:\n  ${MODE_USAGE}`);
			process.exitCode = 1;
			return true;
		}
		const store = await KlermConfigStore.load(options.agentDir ?? getAgentDir());
		await store.update(lane === "local" ? { localRole: role } : { frontierRole: role });
		stdout(json ? JSON.stringify({ lane, role, path: store.path }, null, 2) : `Updated ${lane} role=${role}`);
		return true;
	}

	if (args[0] === "routing") {
		if (args.length === 1 || args[1] === "--help" || args[1] === "-h") {
			stdout(`Usage: ${ROUTING_USAGE}`);
			return true;
		}
		if (args[1] !== "status" || args.some((arg, index) => index > 1 && arg !== "--json")) {
			stderr(`Error: Invalid routing command.\nUsage: ${ROUTING_USAGE}`);
			process.exitCode = 1;
			return true;
		}
		const store = await KlermConfigStore.load(options.agentDir ?? getAgentDir());
		const config = store.get();
		const status = {
			mode: config.routing,
			activeStartLane: config.activeStartLane,
			localModel: config.localModel ?? null,
			frontierModel: config.frontierModel ?? null,
			allowFrontierFallback: config.allowFrontierFallback,
			handbackEnabled: config.handbackEnabled,
			maxDelegationCycles: config.maxDelegationCycles,
		};
		stdout(
			json
				? JSON.stringify(status, null, 2)
				: [
						`Routing: ${status.mode}`,
						`Active start lane: ${status.activeStartLane}`,
						`Local model: ${status.localModel ?? "not set"}`,
						`Frontier model: ${status.frontierModel ?? "not set"}`,
						`Frontier fallback: ${status.allowFrontierFallback ? "enabled" : "disabled"}`,
						`Handback: ${status.handbackEnabled ? "enabled" : "disabled"}`,
						`Maximum delegation cycles: ${status.maxDelegationCycles}`,
					].join("\n"),
		);
		return true;
	}

	if (args[1] !== "get" && args[1] !== "set") {
		// Bare "config", "config -l", and "config --help" belong to the
		// package-resources TUI; only "config get"/"config set" are Klerm's.
		return false;
	}
	const store = await KlermConfigStore.load(options.agentDir ?? getAgentDir());
	if (args[1] === "get") {
		const positional = args.slice(2).filter((arg) => arg !== "--json");
		const key = positional[0];
		if (positional.length > 1 || (key !== undefined && !isConfigKey(key))) {
			stderr(`Error: Unknown config key "${positional[0] ?? ""}".\nUsage:\n  ${CONFIG_USAGE}`);
			process.exitCode = 1;
			return true;
		}
		const config = printableConfig(store.get());
		if (key === undefined) stdout(JSON.stringify(config, null, 2));
		else {
			const value = config[key];
			stdout(json ? JSON.stringify({ key, value }, null, 2) : String(value ?? "none"));
		}
		return true;
	}
	if (args[1] === "set") {
		const positional = args.slice(2).filter((arg) => arg !== "--json");
		const [key, rawValue] = positional;
		if (positional.length !== 2 || !key || !isConfigKey(key) || rawValue === undefined) {
			stderr(`Error: Config set requires a known key and value.\nUsage:\n  ${CONFIG_USAGE}`);
			process.exitCode = 1;
			return true;
		}
		const value = parseConfigValue(key, rawValue);
		const clearingModel = rawValue === "none" && (key === "local-model" || key === "frontier-model");
		if (value === undefined && !clearingModel) {
			stderr(`Error: Invalid value "${rawValue}" for ${key}.`);
			process.exitCode = 1;
			return true;
		}
		await store.update({ [configKeys[key]]: value });
		stdout(
			json
				? JSON.stringify({ key, value: value ?? null, path: store.path }, null, 2)
				: `Updated ${key}=${value ?? "none"}`,
		);
		return true;
	}

	stderr(`Error: Unknown config command "${args[1]}".\nUsage:\n  ${CONFIG_USAGE}`);
	process.exitCode = 1;
	return true;
}
