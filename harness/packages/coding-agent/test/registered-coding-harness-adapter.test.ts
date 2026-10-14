import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { AgentAdapterJournal, AgentAdapterRegistry, type AgentEvent } from "../src/klerm/agent-adapter-contract.ts";
import {
	CodexAdapter,
	type CodingHarnessAdapterEvent,
	type CodingHarnessProcessSpawner,
	OpenCodeAdapter,
} from "../src/klerm/coding-harness-adapter.ts";
import type { CodingHarnessAgentSettings } from "../src/klerm/coding-harness-setup.ts";
import { createRegisteredCodingHarnessAdapters } from "../src/klerm/registered-coding-harness-adapter.ts";

// Protocol fixtures use real adapter parsing/lifecycle, never a paid provider.
function worker(runs: readonly string[][]) {
	let index = 0;
	const calls: string[] = [];
	const spawn: CodingHarnessProcessSpawner = () => {
		const child = new EventEmitter() as ChildProcessWithoutNullStreams;
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		Object.assign(child, { stdin, stdout, stderr: new PassThrough(), killed: false });
		child.kill = vi.fn(() => {
			queueMicrotask(() => child.emit("close", null, "SIGTERM"));
			return true;
		});
		let input = "";
		stdin.on("data", (data: Buffer) => {
			input += data.toString("utf8");
		});
		stdin.on("finish", () => {
			calls.push(input);
			queueMicrotask(() => {
				for (const frame of runs[index++] ?? []) stdout.write(`${frame}\n`);
				stdout.end();
				child.emit("close", 0, null);
			});
		});
		return child;
	};
	return { spawn, calls };
}

const settings: CodingHarnessAgentSettings = {
	id: "agent1",
	kind: "codex",
	enabled: true,
	model: "Vendor/Custom Model",
	role: "builder",
	effort: "off",
	tools: [],
};
const text = (body: string) =>
	JSON.stringify({ type: "item.completed", item: { id: body, type: "agent_message", text: body } });

describe("registered native dispatch", () => {
	test("binds lazy native identity, streams tools and persists outer task correlation through the shared registry", async () => {
		const process = worker([
			[
				JSON.stringify({ type: "thread.started", thread_id: "native-thread" }),
				JSON.stringify({
					type: "item.started",
					item: { id: "tool", type: "command_execution", command: "private input" },
				}),
				JSON.stringify({
					type: "item.completed",
					item: {
						id: "tool",
						type: "command_execution",
						status: "completed",
						aggregated_output: "private output",
					},
				}),
				text("first response"),
			],
			[text("second response")],
		]);
		const records: AgentEvent[] = [];
		const journal = new AgentAdapterJournal(async (event) => {
			records.push(event);
		});
		const registry = new AgentAdapterRegistry();
		const adapter = createRegisteredCodingHarnessAdapters(
			new Map([["codex", new CodexAdapter(process.spawn)]]),
			journal,
			registry,
		).get("codex")!;
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const ref = await adapter.startSession(settings, "/workspace");
		expect(ref.nativeSessionId).toBeUndefined();
		await adapter.prompt(ref, "private prompt", {
			taskId: "outer-task",
			correlationId: "outer-correlation",
			sender: "user",
			reason: "Directed user prompt.",
		});
		expect(ref.nativeSessionId).toBe("native-thread");
		await adapter.prompt(ref, "follow-up");
		expect(process.calls).toEqual(["private prompt", "follow-up"]);
		expect(events.map((event) => event.type)).toEqual([
			"tool-start",
			"tool-end",
			"message",
			"settled",
			"message",
			"settled",
		]);
		expect(records.filter((event) => event.taskId === "outer-task").map((event) => event.type)).toEqual([
			"PROMPT_ACCEPTED",
			"TOOL_STARTED",
			"TOOL_FINISHED",
			"SESSION_BOUND",
			"REPLY_RETURNED",
		]);
		expect(records.find((event) => event.type === "PROMPT_ACCEPTED")).toMatchObject({
			correlationId: "outer-correlation",
			sender: "user",
			recipient: "agent1",
		});
		expect(registry.get("codex").status(records.at(-1)!.session)).toBe("idle");
		for (const content of ["private prompt", "private input", "private output", "first response"])
			expect(JSON.stringify(records)).not.toContain(content);
		await adapter.closeSession(ref);
	});

	test("settled observers may submit a follow-up only after both native and common ownership drained", async () => {
		const process = worker([
			[JSON.stringify({ type: "thread.started", thread_id: "native" }), text("first")],
			[text("second")],
		]);
		const adapter = createRegisteredCodingHarnessAdapters(
			new Map([["codex", new CodexAdapter(process.spawn)]]),
			new AgentAdapterJournal(async () => {}),
		).get("codex")!;
		const ref = await adapter.startSession(settings, "/workspace");
		let second: Promise<void> | undefined;
		let completed = 0;
		adapter.subscribe((event) => {
			if (event.type === "settled" && event.status === "completed" && ++completed === 1)
				second = adapter.prompt(ref, "follow-up");
		});
		await adapter.prompt(ref, "start");
		await second;
		expect(completed).toBe(2);
		await adapter.closeSession(ref);
	});

	test("audit failure rejects a turn before native execution and still closes native resources", async () => {
		const process = worker([[text("must not run")]]);
		const native = new CodexAdapter(process.spawn);
		const close = vi.spyOn(native, "closeSession");
		const journal = new AgentAdapterJournal(async (event) => {
			if (event.type === "PROMPT_ACCEPTED") throw new Error("disk full");
		});
		const adapter = createRegisteredCodingHarnessAdapters(new Map([["codex", native]]), journal).get("codex")!;
		const ref = await adapter.startSession(settings, "/workspace");
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		await adapter.prompt(ref, "do not execute");
		expect(process.calls).toEqual([]);
		expect(events).toContainEqual({ type: "error", agentId: "agent1", message: "disk full" });
		expect(events.at(-1)).toMatchObject({ type: "settled", status: "failed" });
		await expect(adapter.closeSession(ref)).rejects.toThrow("disk full");
		expect(close).toHaveBeenCalledOnce();
	});

	test("does not claim completion when a structured CLI omits its native session identity", async () => {
		const process = worker([[text("text without identity")]]);
		const adapter = createRegisteredCodingHarnessAdapters(
			new Map([["codex", new CodexAdapter(process.spawn)]]),
			new AgentAdapterJournal(async () => {}),
		).get("codex")!;
		const ref = await adapter.startSession(settings, "/workspace");
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		await adapter.prompt(ref, "start");
		expect(events.at(-1)).toMatchObject({ type: "settled", status: "failed" });
		expect(events.find((event) => event.type === "error")).toMatchObject({
			message: "Native protocol returned no session identity.",
		});
		await adapter.closeSession(ref);
	});

	test("preserves native failure details, guards disabled agents and rejects unsupported execution profiles", async () => {
		const process = worker([
			[
				JSON.stringify({ type: "thread.started", thread_id: "native" }),
				JSON.stringify({ type: "turn.failed", error: { message: "native setup missing" } }),
			],
		]);
		const adapter = createRegisteredCodingHarnessAdapters(
			new Map([["codex", new CodexAdapter(process.spawn)]]),
			new AgentAdapterJournal(async () => {}),
		).get("codex")!;
		await expect(adapter.startSession({ ...settings, enabled: false }, "/workspace")).rejects.toThrow("disabled");
		await expect(
			adapter.startSession({ ...settings, executionProfile: "full-access" }, "/workspace"),
		).rejects.toThrow("execution profile");
		const ref = await adapter.startSession(settings, "/workspace");
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		await adapter.prompt(ref, "start");
		expect(events).toContainEqual({ type: "error", agentId: "agent1", message: "native setup missing" });
		expect(events.at(-1)).toMatchObject({ type: "settled", status: "failed" });
		await adapter.closeSession(ref);
	});

	test("aborts an active native turn, waits for audited settlement and keeps the session usable", async () => {
		let child: ChildProcessWithoutNullStreams | undefined;
		const spawn: CodingHarnessProcessSpawner = () => {
			child = new EventEmitter() as ChildProcessWithoutNullStreams;
			Object.assign(child, {
				stdin: new PassThrough(),
				stdout: new PassThrough(),
				stderr: new PassThrough(),
				killed: false,
			});
			child.kill = vi.fn(() => {
				queueMicrotask(() => child?.emit("close", null, "SIGTERM"));
				return true;
			});
			return child;
		};
		const journal = new AgentAdapterJournal(async () => {});
		const adapter = createRegisteredCodingHarnessAdapters(
			new Map([["opencode", new OpenCodeAdapter(spawn)]]),
			journal,
		).get("opencode")!;
		const ref = await adapter.startSession({ ...settings, kind: "opencode" }, "/workspace");
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const active = adapter.prompt(ref, "long turn");
		await vi.waitFor(() => expect(child).toBeDefined());
		await adapter.abort(ref);
		await active;
		expect(events.at(-1)).toMatchObject({ type: "settled", status: "aborted" });
		expect(journal.replay().at(-1)).toMatchObject({ type: "REPLY_RETURNED", status: "aborted" });
		await adapter.closeSession(ref);
	});
});
