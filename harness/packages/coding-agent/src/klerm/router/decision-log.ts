import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KlermRouteDecision } from "./types.ts";

export const KLERM_DECISION_LOG_DIRECTORY = ".klerm";
export const KLERM_DECISION_LOG_FILE = "router-decisions.jsonl";

export function getKlermDecisionLogPath(cwd: string): string {
	return join(cwd, KLERM_DECISION_LOG_DIRECTORY, KLERM_DECISION_LOG_FILE);
}

export async function appendKlermRouteDecision(cwd: string, decision: KlermRouteDecision): Promise<void> {
	const directory = join(cwd, KLERM_DECISION_LOG_DIRECTORY);
	await mkdir(directory, { recursive: true });
	await appendFile(getKlermDecisionLogPath(cwd), `${JSON.stringify(decision)}\n`, "utf8");
}

export async function readKlermRouteDecisionLog(cwd: string): Promise<string> {
	try {
		return await readFile(getKlermDecisionLogPath(cwd), "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
		throw error;
	}
}
