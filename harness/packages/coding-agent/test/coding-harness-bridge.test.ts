import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	appendCodingHarnessBridgeEvent,
	bridgeResponseHash,
	coordinatorBridgePrompt,
	getCodingHarnessBridgeLogPath,
	readCodingHarnessBridgeLog,
	selectCodingHarnessPeer,
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

	test("selects the highest ranked peer with stable agent ordering as a tie breaker", () => {
		const coordinator = runnableAgent("agent6", { strengthBand: 5 });
		const agent7 = runnableAgent("agent7", { role: "planner", specialties: ["review"] });
		const agent8 = runnableAgent("agent8", { strengthBand: 4 });
		expect(selectCodingHarnessPeer([coordinator, agent7, agent8], coordinator.agentId)?.agentId).toBe("agent8");
		expect(
			selectCodingHarnessPeer([coordinator, runnableAgent("agent8"), runnableAgent("agent7")], coordinator.agentId)
				?.agentId,
		).toBe("agent7");
	});

	test("shows only the supplied runnable roster in coordinator prompts", () => {
		const coordinator = runnableAgent("agent6");
		const peer = runnableAgent("agent7", { harness: "codex" });
		const prompt = coordinatorBridgePrompt("Implement the task", coordinator, [coordinator, peer], peer);
		expect(prompt).toContain("agent6: harness opencode");
		expect(prompt).toContain("agent7: harness codex");
		expect(prompt).not.toContain("agent8");
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
