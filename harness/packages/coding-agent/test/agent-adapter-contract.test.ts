import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	AgentAdapterJournal,
	AgentAdapterRegistry,
	type AgentDescriptor,
	type AgentEvent,
	type AgentPrompt,
	agentAdapterEventSink,
	RuntimeAgentAdapter,
} from "../src/klerm/agent-adapter-contract.ts";
import { FakeAgentAdapter } from "../src/klerm/fake-agent-adapter.ts";
import { PiAgentAdapter } from "../src/klerm/pi-agent-adapter.ts";
import { createHarness, getAssistantTexts, getUserTexts, type Harness } from "./suite/harness.ts";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const capabilities = { resumeSession: false, interrupt: true, tools: [], enforcedRoles: [] };
const descriptor: AgentDescriptor = {
	id: "user-adapter",
	harness: { id: "another-harness", name: "Another harness" },
	capabilities,
};
function prompt(sequence = 1, overrides: Partial<AgentPrompt> = {}): AgentPrompt {
	return {
		version: 1,
		messageId: `message-${sequence}`,
		sender: "user",
		recipient: "worker",
		taskId: "task",
		correlationId: "conversation",
		sequence,
		timestamp: "2026-10-08T00:00:00.000Z",
		reason: "Contract verification.",
		text: "Discuss the project.",
		...overrides,
	};
}

for (const kind of ["fake", "pi-klerm"] as const) {
	describe(`${kind} common adapter contract`, () => {
		async function setup() {
			const records: AgentEvent[] = [];
			const journal = new AgentAdapterJournal(async (event) => {
				records.push(event);
			});
			let harness: Harness | undefined;
			if (kind === "pi-klerm") {
				harness = await createHarness();
				cleanups.push(harness.cleanup);
				harness.setResponses([fauxAssistantMessage("first reply"), fauxAssistantMessage("second reply")]);
			}
			const native = harness;
			const adapter = native
				? new PiAgentAdapter(async () => native.session, journal, capabilities)
				: new FakeAgentAdapter(descriptor, [{ text: "first reply" }, { text: "second reply" }], journal);
			cleanups.push(() => adapter.dispose());
			const model = native
				? `${native.getModel().provider}/${native.getModel().id}`
				: "Vendor/Case Sensitive Custom Model";
			const session = await adapter.start({ agentId: "worker", cwd: native?.tempDir ?? "/workspace", model });
			return { adapter, session, journal, records, harness: native, model };
		}

		test("correlates replies and preserves native identity, model and conversation over follow-up turns", async () => {
			const { adapter, session, journal, records, harness, model } = await setup();
			expect(adapter.status(session)).toBe("idle");
			const first = await adapter.prompt(session, prompt());
			const second = await adapter.prompt(session, prompt(2, { replyTo: first.messageId, text: "Follow up." }));
			expect(first).toMatchObject({
				sender: "worker",
				recipient: "user",
				replyTo: "message-1",
				text: "first reply",
				status: "completed",
				taskId: "task",
				correlationId: "conversation",
			});
			expect(second).toMatchObject({
				text: "second reply",
				session: { nativeSessionId: session.nativeSessionId, model },
			});
			expect(first.sequence).toBeLessThan(second.sequence);
			expect(first.timestamp).toBe(records[2]?.timestamp);
			expect(journal.replay()).toEqual(records);
			expect(records.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
			if (harness) {
				expect(getUserTexts(harness)).toEqual(["Discuss the project.", "Follow up."]);
				expect(getAssistantTexts(harness)).toEqual(["first reply", "second reply"]);
			}
		});

		test("rejects forged sessions, incorrect recipients, duplicate IDs and stale sequence numbers", async () => {
			const { adapter, session, records } = await setup();
			await expect(adapter.prompt({ ...session, harnessId: "forged" }, prompt())).rejects.toThrow("mismatched");
			await expect(adapter.prompt(session, prompt(1, { recipient: "other-worker" }))).rejects.toThrow("envelope");
			await adapter.prompt(session, prompt());
			await expect(adapter.prompt(session, prompt())).rejects.toThrow("envelope");
			await expect(adapter.prompt(session, prompt(2, { messageId: "message-1" }))).rejects.toThrow("envelope");
			expect(records.filter((event) => event.type === "PROMPT_REJECTED")).toHaveLength(3);
			expect(records.filter((event) => event.type === "REPLY_RETURNED")).toHaveLength(1);
		});

		test("stops once, refuses further prompts and rejects unsupported role/resume requests", async () => {
			const { adapter, session, records } = await setup();
			await adapter.stop(session);
			await adapter.stop(session);
			expect(adapter.status(session)).toBe("stopped");
			await expect(adapter.prompt(session, prompt())).rejects.toThrow("not idle");
			await expect(
				adapter.start({ agentId: "worker", cwd: "/workspace", nativeSessionId: "not-restorable" }),
			).rejects.toThrow("resume unsupported");
			await expect(adapter.start({ agentId: "worker", cwd: "/workspace", role: "planner" })).rejects.toThrow(
				"Role enforcement unsupported",
			);
			expect(records.filter((event) => event.type === "SESSION_STOPPED")).toHaveLength(1);
		});
	});
}

test("registry accepts independent harness identities and native defaults without assuming models", async () => {
	const registry = new AgentAdapterRegistry();
	const journal = new AgentAdapterJournal(async () => {});
	for (const id of ["vendor-a", "vendor-b", "alternative-cli", "custom-worker"]) {
		const adapter = new FakeAgentAdapter(
			{ ...descriptor, id: `${id}-adapter`, harness: { id, name: id } },
			[{ text: "reply" }],
			journal,
		);
		cleanups.push(() => adapter.dispose());
		registry.register(adapter);
		const session = await registry.get(`${id}-adapter`).start({ agentId: "worker", cwd: "/workspace" });
		expect(session.model).toBeUndefined();
		expect(session.harnessId).toBe(id);
		await expect(adapter.prompt(session, prompt())).resolves.toMatchObject({ text: "reply" });
	}
	expect((await registry.discover()).map((entry) => entry.harness.id)).toEqual([
		"alternative-cli",
		"custom-worker",
		"vendor-a",
		"vendor-b",
	]);
	expect(() => registry.register(registry.get("vendor-a-adapter"))).toThrow("already registered");
	expect(() => registry.get("unregistered")).toThrow("No registered adapter");
});

test("fake cancellation waits for settlement and keeps the native session usable", async () => {
	const journal = new AgentAdapterJournal(async () => {});
	const adapter = new FakeAgentAdapter(
		descriptor,
		[{ text: "", waitForInterrupt: true }, { text: "continued" }],
		journal,
	);
	cleanups.push(() => adapter.dispose());
	const session = await adapter.start({ agentId: "worker", cwd: "/workspace" });
	const active = adapter.prompt(session, prompt());
	await expect(adapter.prompt(session, prompt(2))).rejects.toThrow("not idle");
	await adapter.interrupt(session);
	await expect(active).resolves.toMatchObject({ status: "aborted" });
	expect(adapter.status(session)).toBe("idle");
	await expect(adapter.prompt(session, prompt(2))).resolves.toMatchObject({
		text: "continued",
		session: { nativeSessionId: session.nativeSessionId },
	});
});

test("Pi adapter runs native tools, cancels their native loop and preserves tools and transcript", async () => {
	let toolStarted: () => void = () => {};
	const started = new Promise<void>((resolve) => {
		toolStarted = resolve;
	});
	const tool: AgentTool = {
		name: "native_wait",
		label: "Native wait",
		description: "Wait for native cancellation.",
		parameters: Type.Object({}),
		execute: async (_id, _params, signal) => {
			toolStarted();
			if (!signal?.aborted)
				await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
			return { content: [{ type: "text", text: "cancelled" }], details: {} };
		},
	};
	const harness = await createHarness({ tools: [tool], initialActiveToolNames: ["native_wait"] });
	cleanups.push(harness.cleanup);
	harness.setResponses([fauxAssistantMessage(fauxToolCall("native_wait", {}), { stopReason: "toolUse" })]);
	const journal = new AgentAdapterJournal(async () => {});
	const adapter = new PiAgentAdapter(async () => harness.session, journal, {
		...capabilities,
		tools: ["native_wait"],
	});
	cleanups.push(() => adapter.dispose());
	const session = await adapter.start({ agentId: "worker", cwd: harness.tempDir });
	const active = adapter.prompt(session, prompt());
	await started;
	await adapter.interrupt(session);
	await expect(active).resolves.toMatchObject({ status: "aborted" });
	harness.setResponses([fauxAssistantMessage("continued natively")]);
	await expect(adapter.prompt(session, prompt(2))).resolves.toMatchObject({ text: "continued natively" });
	expect(harness.eventsOfType("tool_execution_start")[0]?.toolName).toBe("native_wait");
	expect(getUserTexts(harness)).toHaveLength(2);
});

test("audit failures prevent execution; observers cannot alter persisted events", async () => {
	const execute = vi.fn(async () => ({ text: "never" }));
	const journal = new AgentAdapterJournal(async (event) => {
		if (event.type === "PROMPT_ACCEPTED") throw new Error("disk full");
	});
	const adapter = new RuntimeAgentAdapter(
		descriptor,
		async () => ({ nativeSessionId: "native", prompt: execute, interrupt: async () => {}, dispose: async () => {} }),
		journal,
	);
	const session = await adapter.start({ agentId: "worker", cwd: "/workspace" });
	await expect(adapter.prompt(session, prompt())).rejects.toThrow("disk full");
	expect(execute).not.toHaveBeenCalled();
	const successful = new AgentAdapterJournal(async () => {});
	successful.subscribe((event) => {
		event.reason = "mutated";
		throw new Error("observer failure");
	});
	await successful.record({
		type: "SESSION_STARTED",
		session,
		sender: "klerm",
		recipient: "worker",
		reason: "original",
	});
	expect(successful.replay()[0]?.reason).toBe("original");
});

test("runtime session and model mismatches are rejected and cleaned up, not silently substituted", async () => {
	const dispose = vi.fn(async () => {});
	const journal = new AgentAdapterJournal(async () => {});
	const adapter = new RuntimeAgentAdapter(
		{ ...descriptor, capabilities: { ...capabilities, resumeSession: true } },
		async () => ({
			nativeSessionId: "replacement",
			model: "other-model",
			prompt: async () => ({ text: "" }),
			interrupt: async () => {},
			dispose,
		}),
		journal,
	);
	await expect(adapter.start({ agentId: "worker", cwd: "/workspace", nativeSessionId: "original" })).rejects.toThrow(
		"preserve",
	);
	await expect(adapter.start({ agentId: "worker", cwd: "/workspace", model: "requested-model" })).rejects.toThrow(
		"model",
	);
	expect(dispose).toHaveBeenCalledTimes(2);
	expect(journal.replay()).toEqual([]);
});

test("persists one ordered shared journal without prompt, reply or native credential payloads", async () => {
	const dir = await mkdtemp(join(tmpdir(), "klerm-adapter-contract-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const journal = new AgentAdapterJournal(agentAdapterEventSink(dir));
	const adapter = new FakeAgentAdapter(descriptor, [{ text: "private reply" }], journal);
	cleanups.push(() => adapter.dispose());
	const session = await adapter.start({ agentId: "worker", cwd: dir });
	await adapter.prompt(session, prompt(1, { text: "private prompt" }));
	await adapter.stop(session);
	const log = await readFile(join(dir, ".klerm", "agent-adapter-events.jsonl"), "utf8");
	expect(log).not.toContain("private prompt");
	expect(log).not.toContain("private reply");
	expect(
		log
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line)),
	).toEqual(journal.replay());
	expect(journal.replay().map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
});
