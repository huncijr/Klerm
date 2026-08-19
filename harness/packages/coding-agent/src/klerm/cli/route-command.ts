import { APP_NAME, getAgentDir } from "../../config.ts";
import { KlermConfigStore } from "../config.ts";
import {
	appendKlermRouteDecision,
	getKlermDecisionLogPath,
	readKlermRouteDecisionLog,
} from "../router/decision-log.ts";
import { routeWithMock } from "../router/mock-router.ts";

const KLERM_DEBUG_ROUTE_USAGE = `${APP_NAME} debug route <task>`;

export interface RunKlermCommandOptions {
	cwd?: string;
	agentDir?: string;
	now?: () => Date;
	stdout?: (message: string) => void;
	stderr?: (message: string) => void;
}

function printKlermDebugHelp(output: (message: string) => void): void {
	output(
		`Klerm router diagnostics\n\nUsage:\n  ${KLERM_DEBUG_ROUTE_USAGE}\n  ${APP_NAME} debug decisions\n  ${APP_NAME} debug registry\n\nCommands:\n  route <task>  Preview a mock routing decision\n  decisions     Print routing decisions\n  registry      Print configured routing profiles`,
	);
}

export async function runKlermDebugCommand(args: string[], options: RunKlermCommandOptions = {}): Promise<boolean> {
	if (args[0] !== "debug") return false;

	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	if (args.length === 1 || args[1] === "--help" || args[1] === "-h") {
		printKlermDebugHelp(stdout);
		return true;
	}

	if (args[1] === "decisions") {
		if (args.length > 2) {
			stderr(`Error: Klerm debug decisions does not accept arguments.\nUsage: ${APP_NAME} debug decisions`);
			process.exitCode = 1;
			return true;
		}

		const cwd = options.cwd ?? process.cwd();
		const log = await readKlermRouteDecisionLog(cwd);
		stdout(log.trimEnd() || `No Klerm route decisions found at ${getKlermDecisionLogPath(cwd)}.`);
		return true;
	}

	if (args[1] === "registry") {
		if (args.length > 2) {
			stderr(`Error: Klerm debug registry does not accept arguments.\nUsage: ${APP_NAME} debug registry`);
			process.exitCode = 1;
			return true;
		}
		const store = await KlermConfigStore.load(options.agentDir ?? getAgentDir());
		stdout(JSON.stringify(store.get(), null, 2));
		return true;
	}

	if (args[1] !== "route") {
		stderr(`Error: Unknown Klerm debug command "${args[1]}".\nUse "${APP_NAME} debug --help" for usage.`);
		process.exitCode = 1;
		return true;
	}

	if (args[2] === "--help" || args[2] === "-h") {
		stdout(`Usage: ${KLERM_DEBUG_ROUTE_USAGE}`);
		return true;
	}

	const task = args.slice(2).join(" ").trim();
	if (!task) {
		stderr(`Error: Klerm debug route requires a task.\nUsage: ${KLERM_DEBUG_ROUTE_USAGE}`);
		process.exitCode = 1;
		return true;
	}

	const decision = routeWithMock({ task }, { now: options.now });
	await appendKlermRouteDecision(options.cwd ?? process.cwd(), decision);
	stdout(JSON.stringify(decision, null, 2));
	return true;
}
