import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	appendCodingHarnessBridgeEvent,
	bridgeResponseHash,
	coordinatorBridgePrompt,
	getCodingHarnessBridgeLogPath,
	implementationBridgePrompt,
	planningBridgePrompt,
	promptTogetherVerdict,
	readCodingHarnessBridgeLog,
	reviewBridgePrompt,
	selectCodingHarnessPeers,
	sharedCodingHarnessContext,
	shouldDelegateCodingHarnessTask,
} from "../src/klerm/coding-harness-bridge.ts";
import type { RunnableCodingHarnessAgent } from "../src/klerm/coding-harness-setup.ts";

const tempDirs: string[] = [];

const runnableAgent = (
	agentId: string,
	overrides: Partial<RunnableCodingHarnessAgent> = {},
): RunnableCodingHarnessAgent => ({
	order: Number(agentId.slice(5)),
	agentId,
	harness: "opencode",
	model: `provider/${agentId}`,
	role: "builder",
	effort: "off",
	tools: [],
	specialties: [],
	strengthBand: 3,
	strengths: ["General coding"],
	limits: ["No native child task events"],
	capabilitySource: "model-profile-inference",
	adapterCapabilities: {
		prompt: true,
		abort: true,
		resumeSession: true,
		roleEnforcement: false,
		childTaskEvents: false,
	},
	...overrides,
});

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("coding harness bridge", () => {
	test("delegates only broad tasks when at least two agents are runnable", () => {
		expect(shouldDelegateCodingHarnessTask("Rename this variable.", 2)).toBe(false);
		expect(shouldDelegateCodingHarnessTask("Review the frontend, backend, security, and tests.", 1)).toBe(false);
		expect(shouldDelegateCodingHarnessTask("Review the frontend, backend, security, and tests.", 2)).toBe(true);
	});

	test("orders every peer by capability with stable agent ordering as a tie breaker", () => {
		const coordinator = runnableAgent("agent6", { strengthBand: 5 });
		const agent7 = runnableAgent("agent7", { role: "planner", specialties: ["review"] });
		const agent8 = runnableAgent("agent8", { strengthBand: 4 });
		expect(
			selectCodingHarnessPeers([coordinator, agent7, agent8], coordinator.agentId).map((agent) => agent.agentId),
		).toEqual(["agent8", "agent7"]);
		expect(
			selectCodingHarnessPeers(
				[coordinator, runnableAgent("agent8"), runnableAgent("agent7")],
				coordinator.agentId,
			).map((agent) => agent.agentId),
		).toEqual(["agent7", "agent8"]);
	});

	test("shows only the supplied runnable roster in coordinator prompts", () => {
		const coordinator = runnableAgent("agent6");
		const peer = runnableAgent("agent7", { harness: "codex" });
		const roster = [coordinator, peer];
		const prompt = coordinatorBridgePrompt(
			"Implement the task",
			coordinator,
			[peer],
			sharedCodingHarnessContext(roster, ""),
		);
		expect(prompt).toContain("agent6: available; harness opencode");
		expect(prompt).toContain("agent7: available; harness codex");
		expect(prompt).not.toContain("agent8");
	});

	test("builds one shared roster and user-memory snapshot", () => {
		const coordinator = runnableAgent("agent6", { effort: "high", specialties: ["backend"] });
		const peer = runnableAgent("agent7", { harness: "codex", role: "planner" });
		const context = sharedCodingHarnessContext([coordinator, peer], "Use the repository conventions.");
		expect(context).toContain("task-start snapshot");
		expect(context).toContain("Default collaboration instructions:");
		expect(context).toContain("Use only the active agents listed in this snapshot.");
		expect(context).toContain(
			"agent6: available; harness opencode; model provider/agent6; role builder; effort high",
		);
		expect(context).toContain("agent7: available; harness codex");
		expect(context).toContain("User-authored shared memory:\nUse the repository conventions.");
		expect(coordinatorBridgePrompt("Implement", coordinator, [peer], context)).toContain(context);
	});

	test("renders a useful default prompt before external agents are runnable", () => {
		const context = sharedCodingHarnessContext([], "");
		expect(context).toContain("Default collaboration instructions:");
		expect(context).toContain("No runnable external agents are currently available.");
		expect(context).toContain("User-authored shared memory: none");
	});

	test("builds strict Prompt Together plan, build, and review prompts", () => {
		const planner = runnableAgent("agent6");
		const builder = runnableAgent("agent7");
		const reviewer = runnableAgent("agent8", { role: "planner" });
		const context = sharedCodingHarnessContext([planner, builder, reviewer], "Follow repository rules.");
		expect(planningBridgePrompt("Implement it", planner, context)).toContain(
			"temporarily assigned as the read-only Planner",
		);
		expect(implementationBridgePrompt("Implement it", builder, "Plan result", context)).toContain(
			"Planner result:\nPlan result",
		);
		expect(reviewBridgePrompt("Implement it", reviewer, "Plan", "Build", context, 2)).toContain(
			"KLERM_VERDICT: APPROVED",
		);
		expect(promptTogetherVerdict("KLERM_VERDICT: APPROVED\nAll checks pass.")).toBe("approved");
		expect(promptTogetherVerdict("Notes first\nKLERM_VERDICT: APPROVED")).toBe("repair");
		expect(promptTogetherVerdict("KLERM_VERDICT: REPAIR\nMissing tests.")).toBe("repair");
	});

	test("appends deterministic JSONL events and hashes responses", async () => {
		const directory = await mkdtemp(join(tmpdir(), "klerm-bridge-"));
		tempDirs.push(directory);
		const event = {
			version: 1 as const,
			timestamp: "2026-09-14T00:00:00.000Z",
			event: "TASK_CREATED" as const,
			taskId: "task-1",
			correlationId: "task-1",
			sequence: 1,
			sender: "user",
			recipient: "agent6",
			status: "assigned" as const,
			reason: "first runnable coordinator",
			artifact: { kind: "report" as const, reference: "summary", digest: "sha256:abc" },
		};
		await appendCodingHarnessBridgeEvent(directory, event);
		expect(getCodingHarnessBridgeLogPath(directory)).toBe(join(directory, ".klerm", "bridge-events.jsonl"));
		expect(await readCodingHarnessBridgeLog(directory)).toBe(`${JSON.stringify(event)}\n`);
		expect(bridgeResponseHash("answer")).toMatch(/^[a-f0-9]{64}$/);
	});
});
