import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import {
	CodexAdapter,
	type CodingHarnessAdapterEvent,
	type CodingHarnessProcessSpawner,
	OpenCodeAdapter,
} from "../src/klerm/coding-harness-adapter.ts";
import type { CodingHarnessAgentSettings } from "../src/klerm/coding-harness-setup.ts";

function agent(kind: "opencode" | "codex", role: "planner" | "builder" = "builder"): CodingHarnessAgentSettings {
	return {
		id: kind === "opencode" ? "agent5" : "agent7",
		kind,
		enabled: true,
		model: kind === "opencode" ? "openai/gpt-5.6-terra" : "gpt-5.6-codex",
		role,
		effort: "high",
		tools: [],
	};
}

function processSpawner(runs: string[][]) {
	const calls: Array<{ command: string; args: readonly string[]; input: string }> = [];
	const spawnProcess: CodingHarnessProcessSpawner = (command, args) => {
		const child = new EventEmitter() as ChildProcessWithoutNullStreams;
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		Object.assign(child, { stdin, stdout, stderr, killed: false });
		child.kill = vi.fn(() => true);
		const call = { command, args, input: "" };
		calls.push(call);
		stdin.on("data", (chunk: Buffer) => {
			call.input += chunk.toString("utf8");
		});
		stdin.on("finish", () => {
			queueMicrotask(() => {
				for (const line of runs.shift() ?? []) stdout.write(`${line}\n`);
				stdout.end();
				child.emit("close", 0, null);
			});
		});
		return child;
	};
	return { spawnProcess, calls };
}

describe("coding harness adapters", () => {
	test("waits for an aborted child to settle before closing its session", async () => {
		let child: ChildProcessWithoutNullStreams | undefined;
		const spawnProcess: CodingHarnessProcessSpawner = () => {
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
		const adapter = new OpenCodeAdapter(spawnProcess);
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const session = await adapter.startSession(agent("opencode"), "/repo");
		const prompt = adapter.prompt(session, "long task");
		await adapter.closeSession(session);
		await prompt;
		expect(child?.kill).toHaveBeenCalledWith("SIGTERM");
		expect(events.at(-1)).toEqual({ type: "settled", agentId: "agent5", status: "aborted" });
	});

	test("OpenCode preserves its native session and attributes message and tool events", async () => {
		const fake = processSpawner([
			[
				JSON.stringify({ type: "step_start", sessionID: "ses_native" }),
				JSON.stringify({
					type: "tool_use",
					sessionID: "ses_native",
					part: {
						callID: "call_1",
						tool: "bash",
						state: { status: "completed", input: { command: "pwd" }, output: "/repo" },
					},
				}),
				JSON.stringify({ type: "text", sessionID: "ses_native", part: { text: "done" } }),
			],
			[JSON.stringify({ type: "text", sessionID: "ses_native", part: { text: "continued" } })],
		]);
		const adapter = new OpenCodeAdapter(fake.spawnProcess);
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const session = await adapter.startSession(agent("opencode"), "/repo");
		await adapter.prompt(session, "first");
		await adapter.prompt(session, "second");

		expect(session.nativeSessionId).toBe("ses_native");
		expect(fake.calls[0]).toMatchObject({ command: "opencode", input: "first" });
		expect(fake.calls[0]?.args).not.toContain("--session");
		expect(fake.calls[1]?.args).toContain("ses_native");
		expect(events).toEqual([
			{ type: "tool-start", agentId: "agent5", toolCallId: "call_1", toolName: "bash", input: { command: "pwd" } },
			{
				type: "tool-end",
				agentId: "agent5",
				toolCallId: "call_1",
				toolName: "bash",
				output: "/repo",
				isError: false,
			},
			{ type: "message", agentId: "agent5", text: "done" },
			{ type: "settled", agentId: "agent5", status: "completed" },
			{ type: "message", agentId: "agent5", text: "continued" },
			{ type: "settled", agentId: "agent5", status: "completed" },
		]);
	});

	test("Codex maps its structured lifecycle and gives planners a read-only sandbox", async () => {
		const fake = processSpawner([
			[
				JSON.stringify({ type: "thread.started", thread_id: "thread_native" }),
				JSON.stringify({
					type: "item.started",
					item: { id: "item_1", type: "command_execution", command: "git status", status: "in_progress" },
				}),
				JSON.stringify({
					type: "item.completed",
					item: { id: "item_1", type: "command_execution", aggregated_output: "clean", status: "completed" },
				}),
				JSON.stringify({ type: "item.completed", item: { id: "item_2", type: "agent_message", text: "reviewed" } }),
				JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
			],
		]);
		const adapter = new CodexAdapter(fake.spawnProcess);
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const session = await adapter.startSession(agent("codex", "planner"), "/repo");
		await adapter.prompt(session, "review");

		expect(fake.calls[0]?.args).toEqual(expect.arrayContaining(["--sandbox", "read-only", "--cd", "/repo"]));
		expect(events).toEqual([
			{
				type: "tool-start",
				agentId: "agent7",
				toolCallId: "item_1",
				toolName: "bash",
				input: { command: "git status" },
			},
			{
				type: "tool-end",
				agentId: "agent7",
				toolCallId: "item_1",
				toolName: "bash",
				output: "clean",
				isError: false,
			},
			{ type: "message", agentId: "agent7", text: "reviewed" },
			{ type: "settled", agentId: "agent7", status: "completed" },
		]);
	});
});
