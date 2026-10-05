import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import type { CodingHarnessAdapterEvent, CodingHarnessProcessSpawner } from "../src/klerm/coding-harness-adapter.ts";
import { HermesAdapter } from "../src/klerm/hermes-adapter.ts";

function fakeHermes(options: { failModel?: boolean; holdPrompt?: boolean } = {}) {
	const messages: Array<Record<string, unknown>> = [];
	let child: ChildProcessWithoutNullStreams;
	let promptId: unknown;
	const spawnProcess: CodingHarnessProcessSpawner = (command, args) => {
		expect(command).toBe("hermes");
		expect(args).toEqual(["acp"]);
		child = new EventEmitter() as ChildProcessWithoutNullStreams;
		const stdin = new PassThrough(),
			stdout = new PassThrough(),
			stderr = new PassThrough();
		Object.assign(child, { stdin, stdout, stderr, killed: false });
		child.kill = () => {
			queueMicrotask(() => child.emit("close", 0, null));
			return true;
		};
		const send = (value: unknown) => stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...(value as object) })}\n`);
		stdin.on("data", (data: Buffer) => {
			for (const line of data.toString().trim().split("\n")) {
				const message = JSON.parse(line) as Record<string, unknown>;
				messages.push(message);
				const method = message.method;
				if (method === "initialize")
					send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
				else if (method === "session/new" || method === "session/load")
					send({
						id: message.id,
						result: { sessionId: "native-hermes", modes: { availableModes: [{ id: "dont_ask" }] } },
					});
				else if (method === "session/set_model" && options.failModel)
					send({ id: message.id, error: { code: -1, message: "Unavailable model" } });
				else if (method === "session/set_model" || method === "session/set_mode")
					send({ id: message.id, result: {} });
				else if (method === "session/prompt") {
					promptId = message.id;
					queueMicrotask(() => {
						send({
							id: "permission-1",
							method: "session/request_permission",
							params: {
								sessionId: "native-hermes",
								options: [
									{ kind: "allow_once", optionId: "yes" },
									{ kind: "reject_once", optionId: "no" },
								],
							},
						});
						send({
							method: "session/update",
							params: {
								sessionId: "native-hermes",
								update: {
									sessionUpdate: "tool_call",
									toolCallId: "tool-1",
									title: "terminal: pwd",
									rawInput: { command: "pwd" },
									status: "in_progress",
								},
							},
						});
						send({
							method: "session/update",
							params: {
								sessionId: "native-hermes",
								update: {
									sessionUpdate: "tool_call_update",
									toolCallId: "tool-1",
									rawOutput: "/repo",
									status: "completed",
								},
							},
						});
						send({
							method: "session/update",
							params: {
								sessionId: "native-hermes",
								update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
							},
						});
						if (!options.holdPrompt) send({ id: message.id, result: { stopReason: "end_turn" } });
					});
				} else if (method === "session/cancel") send({ id: promptId, result: { stopReason: "cancelled" } });
			}
		});
		return child;
	};
	return { spawnProcess, messages };
}

const agent = {
	id: "agent1",
	kind: "hermes" as const,
	enabled: true,
	model: "native-default",
	role: "builder" as const,
	effort: "off" as const,
	tools: [],
};

describe("Hermes ACP adapter", () => {
	test("keeps native sessions, maps tool events and captures Full access permissions", async () => {
		const fake = fakeHermes();
		const adapter = new HermesAdapter(fake.spawnProcess);
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const session = await adapter.startSession({ ...agent, executionProfile: "full-access" }, "/repo");
		await adapter.prompt(session, "first");
		await adapter.prompt(session, "second");
		expect(session.nativeSessionId).toBe("native-hermes");
		expect(fake.messages.filter((message) => message.method === "session/new")).toHaveLength(1);
		expect(fake.messages.find((message) => message.method === "session/set_mode")).toMatchObject({
			params: { modeId: "dont_ask" },
		});
		expect(fake.messages.find((message) => message.id === "permission-1" && message.result)).toMatchObject({
			result: { outcome: { outcome: "selected", optionId: "yes" } },
		});
		expect(events).toContainEqual({
			type: "tool-start",
			agentId: "agent1",
			toolCallId: "tool-1",
			toolName: "bash",
			input: { command: "pwd" },
		});
		expect(events).toContainEqual({
			type: "tool-end",
			agentId: "agent1",
			toolCallId: "tool-1",
			toolName: "bash",
			output: "/repo",
			isError: false,
		});
		expect(events.at(-1)).toEqual({ type: "settled", agentId: "agent1", status: "completed" });
		await adapter.closeSession(session);
	});

	test("denies native permissions without Full access and refuses unenforced Plan mode", async () => {
		const fake = fakeHermes();
		const adapter = new HermesAdapter(fake.spawnProcess);
		await expect(adapter.startSession({ ...agent, role: "planner" }, "/repo")).rejects.toThrow("read-only");
		const session = await adapter.startSession(agent, "/repo", "native-hermes");
		await adapter.prompt(session, "work");
		expect(fake.messages.some((message) => message.method === "session/load")).toBe(true);
		expect(fake.messages.find((message) => message.id === "permission-1" && message.result)).toMatchObject({
			result: { outcome: { optionId: "no" } },
		});
		await adapter.closeSession(session);
	});

	test("cancels the native turn and rejects simultaneous prompts", async () => {
		const fake = fakeHermes({ holdPrompt: true });
		const adapter = new HermesAdapter(fake.spawnProcess);
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const session = await adapter.startSession(agent, "/repo");
		const running = adapter.prompt(session, "work");
		await expect(adapter.prompt(session, "duplicate")).rejects.toThrow("already working");
		await adapter.abort(session);
		await running;
		expect(events.at(-1)).toMatchObject({ type: "settled", status: "aborted" });
		await adapter.closeSession(session);
	});

	test("fails setup when the requested native model is rejected", async () => {
		const fake = fakeHermes({ failModel: true });
		const adapter = new HermesAdapter(fake.spawnProcess);
		await expect(adapter.startSession({ ...agent, model: "provider:model" }, "/repo")).rejects.toThrow(
			"Unavailable model",
		);
	});
});
