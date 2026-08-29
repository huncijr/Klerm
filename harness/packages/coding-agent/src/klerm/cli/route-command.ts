import { APP_NAME, getAgentDir } from "../../config.ts";
import { KlermConfigStore } from "../config.ts";
import {
	appendKlermRouteDecision,
	getKlermDecisionLogPath,
	readKlermRouteDecisionLog,
} from "../router/decision-log.ts";
import { routeWithMock } from "../router/mock-router.ts";
import type { KlermRouteDecision } from "../router/types.ts";

const KLERM_DEBUG_ROUTE_USAGE = `${APP_NAME} debug route <task>`;
const KLERM_DEBUG_DECISIONS_USAGE = `${APP_NAME} debug decisions [--event <type>] [--route <route>] [--task-id <id>] [--since <ISO date>] [--limit <count>] [--summary]`;

export interface RunKlermCommandOptions {
	cwd?: string;
	agentDir?: string;
	now?: () => Date;
	stdout?: (message: string) => void;
	stderr?: (message: string) => void;
}

function printKlermDebugHelp(output: (message: string) => void): void {
	output(
		`Klerm router diagnostics\n\nUsage:\n  ${KLERM_DEBUG_ROUTE_USAGE}\n  ${KLERM_DEBUG_DECISIONS_USAGE}\n  ${APP_NAME} debug registry\n\nCommands:\n  route <task>  Preview a mock routing decision\n  decisions     Print or summarize routing decisions\n  registry      Print configured routing profiles`,
	);
}

function parseDecisionLog(log: string): KlermRouteDecision[] {
	return log
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as KlermRouteDecision);
}

function summarizeDecisions(decisions: readonly KlermRouteDecision[]): object {
	const countBy = (key: "event" | "route"): Record<string, number> => {
		const counts: Record<string, number> = {};
		for (const decision of decisions) counts[decision[key]] = (counts[decision[key]] ?? 0) + 1;
		return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
	};
	return {
		total: decisions.length,
		firstTimestamp: decisions[0]?.timestamp,
		lastTimestamp: decisions.at(-1)?.timestamp,
		events: countBy("event"),
		routes: countBy("route"),
		totalTokens: decisions.reduce((total, decision) => total + (decision.totalTokens ?? 0), 0),
		totalCostUsd: decisions.reduce((total, decision) => total + (decision.costUsd ?? 0), 0),
	};
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
		const cwd = options.cwd ?? process.cwd();
		if (args[2] === "--help" || args[2] === "-h") {
			stdout(`Usage: ${KLERM_DEBUG_DECISIONS_USAGE}`);
			return true;
		}
		const filters: {
			event?: string;
			route?: string;
			taskId?: string;
			since?: number;
			limit?: number;
			summary: boolean;
		} = {
			summary: false,
		};
		for (let index = 2; index < args.length; index++) {
			const flag = args[index];
			if (flag === "--summary") {
				filters.summary = true;
				continue;
			}
			const value = args[++index];
			if (!value || !["--event", "--route", "--task-id", "--since", "--limit"].includes(flag)) {
				stderr(`Error: Invalid decisions argument "${flag}".\nUsage: ${KLERM_DEBUG_DECISIONS_USAGE}`);
				process.exitCode = 1;
				return true;
			}
			if (flag === "--event") filters.event = value;
			else if (flag === "--route") filters.route = value.toUpperCase();
			else if (flag === "--task-id") filters.taskId = value;
			else if (flag === "--since") {
				filters.since = Date.parse(value);
				if (Number.isNaN(filters.since)) {
					stderr(`Error: --since requires a valid ISO date.\nUsage: ${KLERM_DEBUG_DECISIONS_USAGE}`);
					process.exitCode = 1;
					return true;
				}
			} else {
				filters.limit = Number(value);
				if (!Number.isSafeInteger(filters.limit) || filters.limit < 1) {
					stderr(`Error: --limit requires a positive integer.\nUsage: ${KLERM_DEBUG_DECISIONS_USAGE}`);
					process.exitCode = 1;
					return true;
				}
			}
		}

		try {
			const log = await readKlermRouteDecisionLog(cwd);
			let decisions = parseDecisionLog(log).filter(
				(decision) =>
					(!filters.event || decision.event === filters.event) &&
					(!filters.route || decision.route === filters.route) &&
					(!filters.taskId || decision.taskId === filters.taskId) &&
					(filters.since === undefined || Date.parse(decision.timestamp) >= filters.since),
			);
			if (filters.limit !== undefined) decisions = decisions.slice(-filters.limit);
			if (filters.summary) stdout(JSON.stringify(summarizeDecisions(decisions), null, 2));
			else {
				stdout(
					decisions.map((decision) => JSON.stringify(decision)).join("\n") ||
						`No Klerm route decisions found at ${getKlermDecisionLogPath(cwd)}.`,
				);
			}
		} catch {
			stderr(`Error: Klerm decision log contains invalid JSONL at ${getKlermDecisionLogPath(cwd)}.`);
			process.exitCode = 1;
		}
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
