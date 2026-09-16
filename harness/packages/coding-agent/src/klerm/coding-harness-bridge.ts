import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunnableCodingHarnessAgent } from "./coding-harness-setup.ts";
import type { KlermTaskIntent, KlermTaskOutcomeStatus } from "./router/types.ts";

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
	kind: "root" | "peer-review" | "planning" | "implementation" | "review" | "repair" | "finalization";
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
	outcomeStatus?: KlermTaskOutcomeStatus;
	taskIntent?: KlermTaskIntent;
	changedFileCount?: number;
	verificationCount?: number;
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

export function selectCodingHarnessPeers(
	roster: readonly RunnableCodingHarnessAgent[],
	coordinatorId: string,
): RunnableCodingHarnessAgent[] {
	return roster
		.filter((agent) => agent.agentId !== coordinatorId)
		.sort((left, right) => {
			const score = (agent: RunnableCodingHarnessAgent) =>
				agent.strengthBand * 100 +
				(agent.role === "planner" ? 12 : 8) +
				agent.specialties.length * 3 +
				(agent.tools.length > 0 ? 1 : 0);
			return score(right) - score(left) || left.order - right.order;
		});
}

function rosterPrompt(roster: readonly RunnableCodingHarnessAgent[]): string {
	if (roster.length === 0) return "- No runnable external agents are currently available.";
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
		"Default collaboration instructions:",
		"- Use only the active agents listed in this snapshot.",
		"- Respect each agent's assigned role, tools, strengths, and limits.",
		"- Keep handoffs concrete and return verifiable results to the coordinator.",
		"Active agent roster:",
		rosterPrompt(roster),
		userMemory.trim() ? `User-authored shared memory:\n${userMemory.trim()}` : "User-authored shared memory: none",
	].join("\n");
}

export function coordinatorBridgePrompt(
	prompt: string,
	coordinator: RunnableCodingHarnessAgent,
	peers: readonly RunnableCodingHarnessAgent[],
	sharedContext: string,
): string {
	return [
		"<klerm_bridge>",
		`You are ${coordinator.agentId}, the coordinator for this task.`,
		"Only the runnable agents below are active. Never refer work to any other configured agent.",
		sharedContext,
		peers.length > 0
			? `Klerm scheduled focused passes in this order: ${peers.map((peer) => peer.agentId).join(", ")}. Complete your own focused work first, then provide a precise result for those peers. Do not claim that peer work already happened.`
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
	priorPeerResults: ReadonlyArray<{ agentId: string; result: string }>,
	sharedContext: string,
	passNumber: number,
	passCount: number,
): string {
	return [
		"<klerm_bridge>",
		`You are ${peer.agentId}. ${coordinator.agentId} remains the coordinator and final answer owner.`,
		sharedContext,
		`This is focused peer pass ${passNumber} of ${passCount}. Inspect the current workspace, find missing requirements, correctness risks, and verification gaps, then fix or clearly report them within your configured role.`,
		"Return concrete findings, changed files, verification, and open issues. Do not restart completed work without a reason.",
		`Coordinator result:\n${coordinatorResult}`,
		...priorPeerResults.map(({ agentId, result }) => `Prior ${agentId} result:\n${result}`),
		"</klerm_bridge>",
		"",
		`Original user task:\n${originalPrompt}`,
	].join("\n");
}

export function finalizationBridgePrompt(
	originalPrompt: string,
	coordinator: RunnableCodingHarnessAgent,
	peerResults: ReadonlyArray<{ agentId: string; result: string }>,
	sharedContext: string,
): string {
	return [
		"<klerm_bridge>",
		`Resume as ${coordinator.agentId}, the coordinator and final answer owner.`,
		sharedContext,
		`${peerResults.map(({ agentId }) => agentId).join(", ")} completed the focused passes below. Review them against the current workspace, resolve any remaining issue allowed by your role, and give the final user answer.`,
		...peerResults.map(({ agentId, result }) => `${agentId} result:\n${result}`),
		"</klerm_bridge>",
		"",
		`Original user task:\n${originalPrompt}`,
	].join("\n");
}

export function planningBridgePrompt(
	originalPrompt: string,
	planner: RunnableCodingHarnessAgent,
	sharedContext: string,
): string {
	return [
		"<klerm_prompt_together>",
		`You are ${planner.agentId}, temporarily assigned as the read-only Planner for this workflow.`,
		sharedContext,
		"Inspect the workspace and produce a concrete implementation plan for the Builder. Include requirements, files, risks, and exact verification steps. Do not modify the workspace.",
		"</klerm_prompt_together>",
		"",
		`Original user task:\n${originalPrompt}`,
	].join("\n");
}

export function implementationBridgePrompt(
	originalPrompt: string,
	builder: RunnableCodingHarnessAgent,
	plan: string,
	sharedContext: string,
): string {
	return [
		"<klerm_prompt_together>",
		`You are ${builder.agentId}, assigned as the Builder for this workflow.`,
		sharedContext,
		"Implement the plan in the workspace. Run relevant verification after the final mutation and report changed files, checks, and blockers.",
		`Planner result:\n${plan}`,
		"</klerm_prompt_together>",
		"",
		`Original user task:\n${originalPrompt}`,
	].join("\n");
}

export function reviewBridgePrompt(
	originalPrompt: string,
	reviewer: RunnableCodingHarnessAgent,
	plan: string,
	implementation: string,
	sharedContext: string,
	iteration: number,
): string {
	return [
		"<klerm_prompt_together>",
		`You are ${reviewer.agentId}, a read-only Reviewer in iteration ${iteration}.`,
		sharedContext,
		"Inspect the current workspace, diff, requirements, and verification evidence. Do not modify the workspace.",
		"Your first non-empty line must be exactly KLERM_VERDICT: APPROVED when no further work is needed, or KLERM_VERDICT: REPAIR when a concrete defect remains.",
		"After the verdict, list precise findings and required fixes. Missing or malformed verdicts are treated as REPAIR.",
		`Planner result:\n${plan}`,
		`Builder result:\n${implementation}`,
		"</klerm_prompt_together>",
		"",
		`Original user task:\n${originalPrompt}`,
	].join("\n");
}

export function repairBridgePrompt(
	originalPrompt: string,
	builder: RunnableCodingHarnessAgent,
	plan: string,
	implementation: string,
	reviews: ReadonlyArray<{ agentId: string; result: string }>,
	sharedContext: string,
	iteration: number,
): string {
	return [
		"<klerm_prompt_together>",
		`Resume as ${builder.agentId}, the Builder for repair iteration ${iteration}.`,
		sharedContext,
		"Resolve every concrete reviewer finding that is valid, preserve correct existing work, then run relevant verification after the final mutation.",
		`Planner result:\n${plan}`,
		`Previous Builder result:\n${implementation}`,
		...reviews.map(({ agentId, result }) => `${agentId} review:\n${result}`),
		"</klerm_prompt_together>",
		"",
		`Original user task:\n${originalPrompt}`,
	].join("\n");
}

export function promptTogetherFinalizationPrompt(
	originalPrompt: string,
	planner: RunnableCodingHarnessAgent,
	plan: string,
	implementation: string,
	reviews: ReadonlyArray<{ agentId: string; result: string }>,
	sharedContext: string,
	unresolvedReason?: string,
): string {
	return [
		"<klerm_prompt_together>",
		`Resume as ${planner.agentId}, the Planner and final answer owner.`,
		sharedContext,
		unresolvedReason
			? `The workflow stopped without approval: ${unresolvedReason}. Report the unresolved work truthfully and do not claim success.`
			: "All reviewers approved the current workspace. Summarize the implemented result, verification, and any remaining limitations without doing more workspace work.",
		`Original plan:\n${plan}`,
		`Latest Builder result:\n${implementation}`,
		...reviews.map(({ agentId, result }) => `${agentId} review:\n${result}`),
		"</klerm_prompt_together>",
		"",
		`Original user task:\n${originalPrompt}`,
	].join("\n");
}

export function promptTogetherVerdict(response: string): "approved" | "repair" {
	const firstLine = response
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean);
	return firstLine === "KLERM_VERDICT: APPROVED" ? "approved" : "repair";
}
