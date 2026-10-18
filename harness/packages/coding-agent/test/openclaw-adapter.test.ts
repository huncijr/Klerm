import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { AgentAdapterJournal } from "../src/klerm/agent-adapter-contract.ts";
import type { CodingHarnessAdapterEvent, CodingHarnessProcessSpawner } from "../src/klerm/coding-harness-adapter.ts";
import {
	type CodingHarnessAgentSettings,
	createCodingHarnessSetup,
	discoverCodingHarnessModels,
} from "../src/klerm/coding-harness-setup.ts";
import { OpenClawAdapter } from "../src/klerm/openclaw-adapter.ts";
import { createRegisteredCodingHarnessAdapters } from "../src/klerm/registered-coding-harness-adapter.ts";

/** Fake protocol/Gateway contract, not an installed OpenClaw or a model request. */
function gateway(
	options: {
		hold?: boolean;
		ignoreCancel?: boolean;
		disconnectOnCancel?: boolean;
		disconnectOnPrompt?: boolean;
		denyPermission?: boolean;
		noResume?: boolean;
		wrongMapping?: boolean;
		missingResume?: boolean;
		stopReason?: string;
	} = {},
) {
	const requests: Array<Record<string, unknown>> = [];
	const rows = new Map<string, string[]>();
	const spawns: Array<{ command: string; args: readonly string[] }> = [];
	let nextId = 0;
	const spawn: CodingHarnessProcessSpawner = (command, args) => {
		spawns.push({ command, args });
		const child = new EventEmitter() as ChildProcessWithoutNullStreams;
		const stdin = new PassThrough(),
			stdout = new PassThrough(),
			stderr = new PassThrough();
		Object.assign(child, { stdin, stdout, stderr, killed: false });
		child.kill = vi.fn(() => {
			queueMicrotask(() => child.emit("close", 0, null));
			return true;
		});
		let protocolId = "";
		let key = "";
		let pendingPrompt: unknown;
		const send = (message: Record<string, unknown>) =>
			stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
		const update = (value: Record<string, unknown>, sessionId = protocolId) =>
			send({ method: "session/update", params: { sessionId, update: value } });
		stdin.on("data", (chunk: Buffer) => {
			for (const line of chunk.toString("utf8").trim().split("\n")) {
				const message = JSON.parse(line) as Record<string, unknown>;
				requests.push(message);
				const params = (message.params ?? {}) as Record<string, unknown>;
				if (message.method === "initialize")
					send({
						id: message.id,
						result: {
							protocolVersion: 1,
							agentInfo: { name: "openclaw", version: "fixture" },
							agentCapabilities: {
								sessionCapabilities: { close: {}, ...(!options.noResume ? { resume: {} } : {}) },
							},
						},
					});
				if (message.method === "session/new" || message.method === "session/resume") {
					key = (params._meta as { sessionKey: string }).sessionKey;
					if (message.method === "session/resume" && (options.missingResume || !rows.has(key))) {
						send({ id: message.id, error: { code: -1, message: "Gateway session not found" } });
						continue;
					}
					protocolId = message.method === "session/new" ? `protocol-${++nextId}` : String(params.sessionId);
					if (!rows.has(key)) rows.set(key, []);
					// Upstream metadata can precede or follow the session response.
					update({
						sessionUpdate: "session_info_update",
						_meta: { sessionKey: options.wrongMapping ? "unrelated-session" : key },
					});
					send({
						id: message.id,
						result:
							message.method === "session/new"
								? { sessionId: protocolId, modes: { availableModes: [{ id: "dont_ask" }, { id: "plan" }] } }
								: {},
					});
				}
				if (message.method === "session/prompt") {
					pendingPrompt = message.id;
					rows.get(key)!.push(String((params.prompt as Array<{ text: string }>)[0]!.text));
					queueMicrotask(() => {
						if (options.disconnectOnPrompt) {
							child.emit("close", 1, null);
							return;
						}
						update(
							{
								sessionUpdate: "agent_message_chunk",
								content: { type: "text", text: "foreign text must be ignored" },
							},
							"foreign-session",
						);
						if (options.denyPermission)
							send({
								id: "approval",
								method: "session/request_permission",
								params: {
									sessionId: protocolId,
									options: [
										{ kind: "allow_once", optionId: "allow" },
										{ kind: "reject_once", optionId: "deny" },
									],
								},
							});
						update({
							sessionUpdate: "tool_call",
							toolCallId: "read-1",
							title: "read: marker.txt",
							status: "in_progress",
							rawInput: { path: "private tool input" },
						});
						update({
							sessionUpdate: "tool_call_update",
							toolCallId: "read-1",
							status: "completed",
							rawOutput: "private tool output",
						});
						update({ sessionUpdate: "tool_call_update", toolCallId: "read-1", status: "completed" });
						update({
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: `native reply ${rows.get(key)!.length}` },
						});
						if (!options.hold) send({ id: message.id, result: { stopReason: options.stopReason ?? "end_turn" } });
					});
				}
				if (message.method === "session/cancel") {
					if (options.disconnectOnCancel) child.emit("close", 1, null);
					else if (!options.ignoreCancel) send({ id: pendingPrompt, result: { stopReason: "cancelled" } });
				}
				if (message.method === "session/close") send({ id: message.id, result: {} });
			}
		});
		return child;
	};
	return { spawn, requests, rows, spawns };
}

const agent: CodingHarnessAgentSettings = {
	id: "agent1",
	kind: "openclaw",
	model: "native-default",
	enabled: true,
	role: "builder",
	effort: "off",
	tools: [],
};

describe("OpenClaw Gateway ACP adapter", () => {
	test("keeps isolated Gateway identity distinct from ACP identity and resumes without resetting history", async () => {
		const fixture = gateway();
		const adapter = new OpenClawAdapter(fixture.spawn);
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const first = await adapter.startSession(agent, "/workspace");
		expect(first.nativeSessionId).toMatch(/^acp-bridge:klerm-/);
		await adapter.prompt(first, "first");
		await adapter.prompt(first, "follow-up");
		expect(events.filter((event) => event.type === "message")).toEqual([
			{ type: "message", agentId: "agent1", text: "native reply 1" },
			{ type: "message", agentId: "agent1", text: "native reply 2" },
		]);
		expect(events.filter((event) => event.type === "tool-end")).toHaveLength(2);
		expect(fixture.spawns[0]).toEqual({ command: "openclaw", args: ["acp"] });
		expect(fixture.requests.find((request) => request.method === "session/prompt")).toMatchObject({
			params: { sessionId: "protocol-1" },
		});
		await adapter.closeSession(first);
		const resumed = await adapter.startSession(agent, "/workspace", first.nativeSessionId);
		await adapter.prompt(resumed, "after reconnect");
		expect(fixture.rows.get(first.nativeSessionId!)).toEqual(["first", "follow-up", "after reconnect"]);
		expect(fixture.requests.find((request) => request.method === "session/resume")).toMatchObject({
			params: {
				sessionId: first.nativeSessionId,
				_meta: { sessionKey: first.nativeSessionId, resetSession: false, requireExisting: true },
			},
		});
		expect(
			fixture.requests.some((request) =>
				["session/set_model", "session/set_mode", "sessions.reset", "session/load"].includes(
					String(request.method),
				),
			),
		).toBe(false);
		await adapter.closeSession(resumed);
	});

	test("separate workers never inherit the default Gateway/human session", async () => {
		const fixture = gateway();
		const adapter = new OpenClawAdapter(fixture.spawn);
		const first = await adapter.startSession(agent, "/workspace");
		const second = await adapter.startSession({ ...agent, id: "agent2" }, "/workspace");
		expect(first.nativeSessionId).not.toBe(second.nativeSessionId);
		await expect(adapter.startSession(agent, "/workspace", "agent:main:main")).rejects.toThrow("isolated");
		await adapter.closeSession(first);
		await adapter.closeSession(second);
	});

	test("refuses unsupported overrides and does not interpret thought modes as permissions", async () => {
		const fixture = gateway();
		const adapter = new OpenClawAdapter(fixture.spawn);
		for (const update of [
			{ role: "planner" as const },
			{ model: "arbitrary-model" },
			{ effort: "high" as const },
			{ tools: ["write"] },
			{ executionProfile: "full-access" as const },
		])
			await expect(adapter.startSession({ ...agent, ...update }, "/workspace")).rejects.toThrow();
		expect(fixture.spawns).toEqual([]);
	});

	test("denies native permission requests without falsely completing the turn", async () => {
		const fixture = gateway({ denyPermission: true });
		const adapter = new OpenClawAdapter(fixture.spawn);
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const ref = await adapter.startSession(agent, "/workspace");
		await adapter.prompt(ref, "needs approval");
		expect(fixture.requests.find((request) => request.id === "approval" && request.result)).toMatchObject({
			result: { outcome: { outcome: "selected", optionId: "deny" } },
		});
		expect(events.at(-1)).toMatchObject({ type: "settled", status: "failed" });
		await adapter.closeSession(ref);
	});

	test("cancels an active turn and rejects concurrent prompts", async () => {
		const fixture = gateway({ hold: true });
		const adapter = new OpenClawAdapter(fixture.spawn);
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const ref = await adapter.startSession(agent, "/workspace");
		const active = adapter.prompt(ref, "long turn");
		await expect(adapter.prompt(ref, "overlap")).rejects.toThrow("already working");
		await adapter.abort(ref);
		await active;
		expect(events.at(-1)).toMatchObject({ type: "settled", status: "aborted" });
		await adapter.closeSession(ref);
	});

	test("refuses a mismatched Gateway mapping and missing/unsupported resume without new-session fallback", async () => {
		const wrong = gateway({ wrongMapping: true });
		await expect(new OpenClawAdapter(wrong.spawn).startSession(agent, "/workspace")).rejects.toThrow("mapping");
		const owned = "acp-bridge:klerm-00000000-0000-0000-0000-000000000000";
		for (const options of [{ noResume: true }, { missingResume: true }]) {
			const fixture = gateway(options);
			await expect(new OpenClawAdapter(fixture.spawn).startSession(agent, "/workspace", owned)).rejects.toThrow();
			expect(fixture.requests.some((request) => request.method === "session/new")).toBe(false);
		}
	});

	test.each([false, true])("connection loss is uncertain, including during Stop (%s)", async (duringStop) => {
		const fixture = gateway({ hold: true, disconnectOnCancel: duringStop, disconnectOnPrompt: !duringStop });
		const journal = new AgentAdapterJournal(async () => {});
		const adapter = createRegisteredCodingHarnessAdapters(
			new Map([["openclaw", new OpenClawAdapter(fixture.spawn)]]),
			journal,
		).get("openclaw")!;
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		const ref = await adapter.startSession(agent, "/workspace");
		try {
			const active = adapter.prompt(ref, "native work with unknown side effects");
			if (duringStop) {
				await vi.waitFor(() =>
					expect(fixture.requests.some((request) => request.method === "session/prompt")).toBe(true),
				);
				await expect(adapter.abort(ref)).rejects.toThrow("may still be active");
			}
			await active;
			expect(events.at(-1)).toMatchObject({ type: "settled", status: "failed", uncertain: true });
			expect(journal.replay().at(-1)).toMatchObject({ type: "REPLY_RETURNED", status: "failed", uncertain: true });
			expect(events.find((event) => event.type === "error")).toMatchObject({
				message: expect.stringContaining("may still be active"),
			});
		} finally {
			await adapter.closeSession(ref);
		}
	});

	test("unacknowledged cancellation fails explicitly through the shared registry instead of claiming a stopped Gateway", async () => {
		const fixture = gateway({ hold: true, ignoreCancel: true });
		const journal = new AgentAdapterJournal(async () => {});
		const adapter = createRegisteredCodingHarnessAdapters(
			new Map([["openclaw", new OpenClawAdapter(fixture.spawn)]]),
			journal,
		).get("openclaw")!;
		const ref = await adapter.startSession(agent, "/workspace");
		const events: CodingHarnessAdapterEvent[] = [];
		adapter.subscribe((event) => events.push(event));
		vi.useFakeTimers();
		try {
			const active = adapter.prompt(ref, "long native work");
			await vi.waitFor(() =>
				expect(fixture.requests.some((request) => request.method === "session/prompt")).toBe(true),
			);
			const stopped = adapter.abort(ref).catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(5000);
			expect(await stopped).toBeInstanceOf(Error);
			await active;
			expect(events.at(-1)).toMatchObject({ type: "settled", status: "failed", uncertain: true });
			expect(journal.replay().at(-1)).toMatchObject({ type: "REPLY_RETURNED", status: "failed", uncertain: true });
			expect(events.find((event) => event.type === "error")).toMatchObject({
				message: expect.stringContaining("may still be active"),
			});
		} finally {
			vi.useRealTimers();
			await adapter.closeSession(ref);
		}
	});

	test("registers live turns without inventing a resolved model or copying tool payloads into the audit", async () => {
		const fixture = gateway();
		const journal = new AgentAdapterJournal(async () => {});
		const adapter = createRegisteredCodingHarnessAdapters(
			new Map([["openclaw", new OpenClawAdapter(fixture.spawn)]]),
			journal,
		).get("openclaw")!;
		const ref = await adapter.startSession(agent, "/workspace");
		await adapter.prompt(ref, "private prompt", {
			taskId: "task",
			correlationId: "correlation",
			sender: "user",
			reason: "Directed native turn.",
		});
		expect(journal.replay().filter((event) => event.type === "PROMPT_ACCEPTED")).toMatchObject([
			{ taskId: "task", correlationId: "correlation" },
		]);
		expect(journal.replay().every((event) => event.session.model === undefined)).toBe(true);
		for (const text of ["private prompt", "private tool input", "private tool output", "native reply 1"])
			expect(JSON.stringify(journal.replay())).not.toContain(text);
		await adapter.closeSession(ref);
	});

	test("setup uses adapter capabilities and requires a Gateway handshake before admitting a native-only worker", async () => {
		const fixture = gateway();
		const capabilities = new OpenClawAdapter(fixture.spawn).capabilities;
		const slots = { externalHarnessesEnabled: true, agents: [agent] };
		const discovered = { kind: "openclaw" as const, available: true, builtin: false, models: ["native-default"] };
		const adapters = new Map([["openclaw" as const, capabilities]]);
		const installedOnly = createCodingHarnessSetup(slots, [discovered], adapters);
		expect(installedOnly.runnableAgents).toEqual([]);
		expect(installedOnly.excludedAgents[0]?.reason).toContain("ACP/Gateway");
		const connected = { ...discovered, acp: { command: "openclaw", protocolVersion: 1 } };
		expect(createCodingHarnessSetup(slots, [connected], adapters).runnableAgents).toHaveLength(1);
		for (const update of [
			{ role: "planner" as const },
			{ model: "another-model" },
			{ effort: "high" as const },
			{ tools: ["write"] },
			{ executionProfile: "full-access" as const },
		])
			expect(
				createCodingHarnessSetup({ ...slots, agents: [{ ...agent, ...update }] }, [connected], adapters)
					.runnableAgents,
			).toEqual([]);
		expect(await discoverCodingHarnessModels("openclaw")).toEqual(["native-default"]);
	});
});
