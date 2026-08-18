import { appendKlermRouteDecision } from "../router/decision-log.ts";
import { routeWithMock } from "../router/mock-router.ts";

const KLERM_ROUTE_USAGE = "pi klerm route <task>";

export interface RunKlermCommandOptions {
	cwd?: string;
	now?: () => Date;
	stdout?: (message: string) => void;
	stderr?: (message: string) => void;
}

function printKlermHelp(output: (message: string) => void): void {
	output(
		`Klerm A2A routing\n\nUsage:\n  ${KLERM_ROUTE_USAGE}\n\nCommands:\n  route <task>  Select an agent and model for a task`,
	);
}

export async function runKlermCommand(args: string[], options: RunKlermCommandOptions = {}): Promise<boolean> {
	if (args[0] !== "klerm") return false;

	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	if (args.length === 1 || args[1] === "--help" || args[1] === "-h") {
		printKlermHelp(stdout);
		return true;
	}

	if (args[1] !== "route") {
		stderr(`Error: Unknown Klerm command "${args[1]}".\nUse "pi klerm --help" for usage.`);
		process.exitCode = 1;
		return true;
	}

	if (args[2] === "--help" || args[2] === "-h") {
		stdout(`Usage: ${KLERM_ROUTE_USAGE}`);
		return true;
	}

	const task = args.slice(2).join(" ").trim();
	if (!task) {
		stderr(`Error: Klerm route requires a task.\nUsage: ${KLERM_ROUTE_USAGE}`);
		process.exitCode = 1;
		return true;
	}

	const decision = routeWithMock({ task }, { now: options.now });
	await appendKlermRouteDecision(options.cwd ?? process.cwd(), decision);
	stdout(JSON.stringify(decision, null, 2));
	return true;
}
