import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunnableCodingHarnessAgent } from "./coding-harness-setup.ts";

export const KLERM_BRIDGE_EVENT_CUSTOM_TYPE = "klerm-bridge-event";
export const KLERM_BRIDGE_LOG_DIRECTORY = ".klerm";
export const KLERM_BRIDGE_LOG_FILE = "bridge-events.jsonl";

export type CodingHarnessBridgeTaskStatus =
	| "assigned"
	| "running"
	| "waiting"
	| "returned"
	| "completed"
	| "failed"
	| "cancelled";

export type CodingHarnessBridgeEventType =
	| "TASK_CREATED"
	| "TASK_ASSIGNED"
	| "TASK_STARTED"
	| "TASK_WAITING"
	| "TASK_RETURNED"
	| "TASK_COMPLETED"
	| "TASK_FAILED"
	| "TASK_CANCELLED"
	| "NO_DELEGATION";

export interface CodingHarnessBridgeArtifact {
	kind: "file" | "diff" | "report";
	reference: string;
	digest?: string;
}

export interface CodingHarnessBridgeTask {
	version: 1;
	taskId: string;
	parentTaskId?: string;
	correlationId: string;
	kind: "root" | "peer-review" | "finalization";
	sender: "user" | string;
	recipient: string;
	sequence: number;
	reason: string;
	status: CodingHarnessBridgeTaskStatus;
	artifacts?: CodingHarnessBridgeArtifact[];
}

export interface CodingHarnessBridgeEvent {
	version: 1;
	timestamp: string;
	event: CodingHarnessBridgeEventType;
	taskId: string;
	parentTaskId?: string;
	correlationId: string;
	sequence: number;
	sender: "user" | "klerm" | string;
	recipient: "user" | "klerm" | string;
	status: CodingHarnessBridgeTaskStatus;
	reason: string;
	agentId?: string;
	harness?: string;
	model?: string;
	nativeSessionId?: string;
	responseHash?: string;
	artifact?: CodingHarnessBridgeArtifact;
}

export function getCodingHarnessBridgeLogPath(cwd: string): string {
	return join(cwd, KLERM_BRIDGE_LOG_DIRECTORY, KLERM_BRIDGE_LOG_FILE);
}

export async function appendCodingHarnessBridgeEvent(cwd: string, event: CodingHarnessBridgeEvent): Promise<void> {
	await mkdir(join(cwd, KLERM_BRIDGE_LOG_DIRECTORY), { recursive: true });
	await appendFile(getCodingHarnessBridgeLogPath(cwd), `${JSON.stringify(event)}\n`, "utf8");
}

export async function readCodingHarnessBridgeLog(cwd: string): Promise<string> {
	try {
		return await readFile(getCodingHarnessBridgeLogPath(cwd), "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
		throw error;
	}
}

export function bridgeResponseHash(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

export function shouldDelegateCodingHarnessTask(prompt: string, agentCount: number): boolean {
	if (agentCount < 2) return false;
	const normalized = prompt.toLowerCase();
	const numberedRequirements = prompt.match(/(?:^|\s)\d+[.)]/g)?.length ?? 0;
	const breadthTerms = [
		"architecture",
		"architectural",
		"mvp",
		"frontend",
		"backend",
		"database",
		"security",
		"test",
		"deploy",
		"review",
		"refactor",
		"multi-file",
		"több",
		"architekt",
		"biztonság",
		"teszt",
	];
	const matchedTerms = breadthTerms.filter((term) => normalized.includes(term)).length;
	return prompt.length >= 500 || numberedRequirements >= 3 || matchedTerms >= 3;
}

export function selectCodingHarnessPeer(
	roster: readonly RunnableCodingHarnessAgent[],
	coordinatorId: string,
): RunnableCodingHarnessAgent | undefined {
	return roster
		.filter((agent) => agent.agentId !== coordinatorId)
		.sort((left, right) => {
			const score = (agent: RunnableCodingHarnessAgent) =>
				agent.strengthBand * 100 +
				(agent.role === "planner" ? 12 : 8) +
				agent.specialties.length * 3 +
				(agent.tools.length > 0 ? 1 : 0);
			return score(right) - score(left) || left.order - right.order;
		})[0];
}

function rosterPrompt(roster: readonly RunnableCodingHarnessAgent[]): string {
	return roster
		.map(
			(agent) =>
				`- ${agent.agentId}: available; harness ${agent.harness}; model ${agent.model}; role ${agent.role}; effort ${agent.effort}; strength ${agent.strengthBand}/5; strengths ${agent.strengths.join(", ")}; limits ${agent.limits.join(", ")}; tools ${agent.tools.join(", ") || "native defaults"}; specialties ${agent.specialties.join(", ") || "none"}; native session resume ${agent.adapterCapabilities.resumeSession ? "supported" : "unsupported"}; role enforcement ${agent.adapterCapabilities.roleEnforcement ? "supported" : "prompt-only"}; capability source ${agent.capabilitySource}`,
		)
		.join("\n");
}

export function sharedCodingHarnessContext(roster: readonly RunnableCodingHarnessAgent[], userMemory: string): string {
	return [
		"Shared collaboration context (task-start snapshot):",
		"Active agent roster:",
		rosterPrompt(roster),
		userMemory.trim() ? `User-authored shared memory:\n${userMemory.trim()}` : "User-authored shared memory: none",
	].join("\n");
}

export function coordinatorBridgePrompt(
	prompt: string,
	coordinator: RunnableCodingHarnessAgent,
	peer: RunnableCodingHarnessAgent | undefined,
	sharedContext: string,
): string {
	return [
		"<klerm_bridge>",
		`You are ${coordinator.agentId}, the coordinator for this task.`,
		"Only the runnable agents below are active. Never refer work to any other configured agent.",
		sharedContext,
		peer
			? `Klerm selected ${peer.agentId} for a focused second pass. Complete your own focused work first, then provide a precise result that Klerm can send to ${peer.agentId}. Do not claim that peer work already happened.`
			: "No peer handoff is scheduled. Complete the task directly.",
		"</klerm_bridge>",
		"",
		prompt,
	].join("\n");
}

export function peerBridgePrompt(
	originalPrompt: string,
	coordinator: RunnableCodingHarnessAgent,
	peer: RunnableCodingHarnessAgent,
	coordinatorResult: string,
	sharedContext: string,
): string {
	return [
		"<klerm_bridge>",
		`You are ${peer.agentId}. ${coordinator.agentId} remains the coordinator and final answer owner.`,
		sharedContext,
		"Perform a focused independent second pass: inspect the current workspace, find missing requirements, correctness risks, and verification gaps, then fix or clearly report them within your configured role.",
		"Return concrete findings, changed files, verification, and open issues. Do not restart completed work without a reason.",
		`Coordinator result:\n${coordinatorResult}`,
		"</klerm_bridge>",
		"",
		`Original user task:\n${originalPrompt}`,
	].join("\n");
}

export function finalizationBridgePrompt(
	originalPrompt: string,
	coordinator: RunnableCodingHarnessAgent,
	peer: RunnableCodingHarnessAgent,
	peerResult: string,
	sharedContext: string,
): string {
	return [
		"<klerm_bridge>",
		`Resume as ${coordinator.agentId}, the coordinator and final answer owner.`,
		sharedContext,
		`${peer.agentId} completed the focused second pass below. Review it against the current workspace, resolve any remaining issue allowed by your role, and give the final user answer.`,
		`Peer result:\n${peerResult}`,
		"</klerm_bridge>",
		"",
		`Original user task:\n${originalPrompt}`,
	].join("\n");
}
