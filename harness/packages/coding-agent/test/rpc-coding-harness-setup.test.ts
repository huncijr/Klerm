import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import type { AiDebugTraceEvent } from "../src/klerm/ai-debug-trace.ts";
import type {
	CodingHarnessAdapter,
	CodingHarnessAdapterListener,
	CodingHarnessSessionRef,
} from "../src/klerm/coding-harness-adapter.ts";
import type { CodingHarnessKind } from "../src/klerm/coding-harness-setup.ts";
import { readKlermRouteDecisionLog } from "../src/klerm/router/decision-log.ts";
import { runRpcMode } from "../src/modes/index.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

const agent = (id: string, kind: CodingHarnessKind | null, enabled = kind !== null) => ({
	id,
	kind,
	enabled,
	role: "builder" as const,
	effort: "off" as const,
	tools: [],
});

vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => rpcIo.outputLines.push(line),
}));

vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		rpcIo.lineHandler = onLine;
		return () => {
			rpcIo.lineHandler = undefined;
		};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

type NodeListener = Parameters<typeof process.on>[1];

function createRuntimeHost(harness: Harness): AgentSessionRuntime {
	return {
		session: harness.session,
		newSession: vi.fn(async () => ({ cancelled: true })),
		switchSession: vi.fn(async () => ({ cancelled: true })),
		fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
		dispose: vi.fn(async () => {}),
		setRebindSession: vi.fn(),
	} as unknown as AgentSessionRuntime;
}

function responses(): Array<Record<string, unknown>> {
	return rpcIo.outputLines
		.flatMap((line) => line.split("\n"))
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function send(command: Record<string, unknown>): Promise<Record<string, unknown>> {
	rpcIo.lineHandler?.(JSON.stringify(command));
	let response: Record<string, unknown> | undefined;
	await vi.waitFor(() => {
		response = responses().find(
			(candidate) =>
				candidate.type === "response" && candidate.id === command.id && candidate.command === command.type,
		);
		expect(response).toBeDefined();
	});
	return response!;
}

describe("coding harness setup RPC", () => {
	afterEach(() => {
		rpcIo.outputLines = [];
		rpcIo.lineHandler = undefined;
	});

	test("advertises, discovers, validates, and persists harness slots", async () => {
		const stdinListeners = process.stdin.listeners("end") as NodeListener[];
		const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
		const signalListeners = new Map(signals.map((signal) => [signal, process.listeners(signal) as NodeListener[]]));
		const harness = await createHarness();
		const discoverCodingHarnesses = vi.fn(async () => [
			{ kind: "klerm" as const, available: true, builtin: true, models: [] },
			{ kind: "claude-code" as const, available: true, builtin: false, models: [], version: "2.0" },
			{ kind: "codex" as const, available: false, builtin: false, models: [] },
			{ kind: "opencode" as const, available: true, builtin: false, models: ["openai/gpt-5.6-terra"] },
		]);
		const discoverCodingHarnessModels = vi.fn(async (kind: CodingHarnessKind) =>
			kind === "claude-code" ? ["claude-sonnet"] : [],
		);

		let adapterListener: CodingHarnessAdapterListener | undefined;
		const bridgeEvents: Array<Record<string, unknown>> = [];
		const adapterSession: CodingHarnessSessionRef = {
			id: "adapter-session",
			agentId: "agent5",
			harness: "opencode",
			model: "openai/gpt-5.6-terra",
			role: "builder",
		};
		const opencodeAdapter: CodingHarnessAdapter = {
			kind: "opencode",
			startSession: vi.fn(async () => adapterSession),
			prompt: vi.fn(async () => {
				adapterListener?.({ type: "message", agentId: "agent5", text: "OpenCode reply" });
				adapterListener?.({ type: "settled", agentId: "agent5", status: "completed" });
			}),
			abort: vi.fn(async () => {}),
			closeSession: vi.fn(async () => {}),
			subscribe: (listener: CodingHarnessAdapterListener) => {
				adapterListener = listener;
				return () => {
					adapterListener = undefined;
				};
			},
		};

		try {
			void runRpcMode(createRuntimeHost(harness), {
				discoverCodingHarnesses,
				discoverCodingHarnessModels,
				codingHarnessAdapters: new Map([["opencode", opencodeAdapter]]),
				appendCodingHarnessBridgeEvent: vi.fn(async (_cwd, event) => {
					bridgeEvents.push(event as unknown as Record<string, unknown>);
				}),
			});
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

			const handshake = await send({ id: "handshake", type: "desktop_handshake" });
			expect(handshake).toMatchObject({
				success: true,
				data: {
					capabilities: {
						commands: expect.arrayContaining([
							"get_coding_harness_setup",
							"refresh_coding_harness_models",
							"set_coding_harness_slots",
						]),
					},
				},
			});

			const initial = await send({ id: "get", type: "get_coding_harness_setup" });
			expect(initial).toMatchObject({
				success: true,
				data: {
					slots: {
						externalHarnessesEnabled: false,
						agents: [agent("agent1", "klerm")],
					},
					effectiveRouting: "disabled",
					harnesses: expect.arrayContaining([
						expect.objectContaining({ kind: "claude-code", available: true, version: "2.0" }),
					]),
				},
			});

			const models = await send({
				id: "models",
				type: "refresh_coding_harness_models",
				kind: "claude-code",
			});
			expect(models).toMatchObject({
				success: true,
				data: { kind: "claude-code", models: ["claude-sonnet"] },
			});
			expect(discoverCodingHarnessModels).toHaveBeenCalledWith("claude-code");

			discoverCodingHarnessModels.mockRejectedValueOnce(new Error("temporary discovery failure"));
			const failedRefresh = await send({
				id: "failed-models",
				type: "refresh_coding_harness_models",
				kind: "claude-code",
			});
			expect(failedRefresh).toMatchObject({
				success: true,
				data: {
					kind: "claude-code",
					models: ["claude-sonnet"],
					error: "temporary discovery failure",
				},
			});

			const invalid = await send({
				id: "invalid",
				type: "set_coding_harness_slots",
				slots: { agent1: "Claude Code", agent2: null, injected: true },
			});
			expect(invalid).toMatchObject({ success: false, code: "INVALID_CODING_HARNESS_SLOTS" });
			expect(harness.settingsManager.getCodingHarnessSlots()).toMatchObject({
				externalHarnessesEnabled: false,
				agents: [agent("agent1", "klerm")],
			});

			const updated = await send({
				id: "set",
				type: "set_coding_harness_slots",
				slots: {
					externalHarnessesEnabled: true,
					agents: [agent("agent1", "codex"), { ...agent("agent2", "claude-code"), model: "sonnet" }],
				},
			});
			expect(updated).toMatchObject({
				success: true,
				data: {
					slots: {
						externalHarnessesEnabled: true,
						agents: [agent("agent1", "codex"), { ...agent("agent2", "claude-code"), model: "sonnet" }],
					},
					effectiveRouting: "disabled",
					blockingReason: "Agent 1 (Codex) is not available.",
					harnesses: expect.any(Array),
				},
			});
			expect(harness.settingsManager.getGlobalSettings().codingHarnessSlots).toMatchObject({
				externalHarnessesEnabled: true,
				agents: [agent("agent1", "codex"), { ...agent("agent2", "claude-code"), model: "sonnet" }],
			});

			const blockedPrompt = await send({ id: "blocked-prompt", type: "prompt", message: "do not fall back" });
			expect(blockedPrompt).toMatchObject({
				success: false,
				code: "CODING_HARNESS_UNAVAILABLE",
				error: "Agent 1 (Codex) is not available.",
			});
			expect(opencodeAdapter.prompt).not.toHaveBeenCalled();

			await send({
				id: "set-opencode",
				type: "set_coding_harness_slots",
				slots: {
					externalHarnessesEnabled: true,
					agents: [{ ...agent("agent5", "opencode"), model: "openai/gpt-5.6-terra" }],
				},
			});
			const nativePrompt = await send({ id: "native-prompt", type: "prompt", message: "use OpenCode" });
			expect(nativePrompt).toMatchObject({ success: true });
			await vi.waitFor(() =>
				expect(opencodeAdapter.prompt).toHaveBeenCalledWith(
					adapterSession,
					expect.stringContaining("use OpenCode"),
				),
			);
			expect(responses()).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "routing_changed",
						state: expect.objectContaining({
							selectedAgentId: "agent5",
							selectedHarness: "opencode",
							selectedTarget: "openai/gpt-5.6-terra",
						}),
					}),
					expect.objectContaining({ type: "message_end", agentId: "agent5" }),
					expect.objectContaining({ type: "agent_settled", agentId: "agent5" }),
				]),
			);
			await vi.waitFor(() => expect(bridgeEvents).toHaveLength(5));
			expect(bridgeEvents.map((event) => event.event)).toEqual([
				"TASK_CREATED",
				"TASK_ASSIGNED",
				"TASK_STARTED",
				"NO_DELEGATION",
				"TASK_COMPLETED",
			]);
			const decisions = (await readKlermRouteDecisionLog(harness.session.sessionManager.getCwd()))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			expect(decisions.at(-1)).toMatchObject({
				event: "CODING_HARNESS_ROUTE",
				sender: "user",
				recipient: "agent5",
				sequence: 1,
				selectedHarness: "opencode",
				selectedTarget: "openai/gpt-5.6-terra",
			});
			expect(discoverCodingHarnesses).toHaveBeenCalledTimes(1);
		} finally {
			harness.cleanup();
			for (const listener of process.stdin.listeners("end") as NodeListener[]) {
				if (!stdinListeners.includes(listener)) process.stdin.off("end", listener);
			}
			for (const [signal, previousListeners] of signalListeners) {
				for (const listener of process.listeners(signal) as NodeListener[]) {
					if (!previousListeners.includes(listener)) process.off(signal, listener);
				}
			}
		}
	});

	test("runs a deterministic coordinator, peer, coordinator bridge flow", async () => {
		const stdinListeners = process.stdin.listeners("end") as NodeListener[];
		const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
		const signalListeners = new Map(signals.map((signal) => [signal, process.listeners(signal) as NodeListener[]]));
		const harness = await createHarness();
		const listeners = new Map<CodingHarnessKind, CodingHarnessAdapterListener>();
		const promptCalls: Array<{ session: CodingHarnessSessionRef; text: string }> = [];
		const bridgeRecords: Array<Record<string, unknown>> = [];
		const debugRecords: AiDebugTraceEvent[] = [];
		const adapter = (kind: "opencode" | "codex"): CodingHarnessAdapter => ({
			kind,
			startSession: vi.fn(async (configured) => ({
				id: `${kind}-${configured.id}`,
				agentId: configured.id,
				harness: kind,
				model: configured.model ?? "default",
				role: configured.role,
				nativeSessionId: `${kind}-native-${configured.id}`,
			})),
			prompt: vi.fn(async (session, text) => {
				promptCalls.push({ session, text });
			}),
			abort: vi.fn(async (session) => {
				listeners.get(kind)?.({ type: "settled", agentId: session.agentId, status: "aborted" });
			}),
			closeSession: vi.fn(async () => {}),
			subscribe: (listener) => {
				listeners.set(kind, listener);
				return () => listeners.delete(kind);
			},
		});

		try {
			void runRpcMode(createRuntimeHost(harness), {
				discoverCodingHarnesses: vi.fn(async () => [
					{ kind: "klerm" as const, available: true, builtin: true, models: [] },
					{ kind: "opencode" as const, available: true, builtin: false, models: [] },
					{ kind: "codex" as const, available: true, builtin: false, models: [] },
				]),
				codingHarnessAdapters: new Map([
					["opencode", adapter("opencode")],
					["codex", adapter("codex")],
				]),
				appendCodingHarnessBridgeEvent: vi.fn(async (_cwd, event) => {
					bridgeRecords.push(event as unknown as Record<string, unknown>);
				}),
				aiDebugTrace: {
					append: (event) => debugRecords.push(event),
					flush: vi.fn(async () => {}),
				},
			});
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());
			await send({
				id: "set-team",
				type: "set_coding_harness_slots",
				slots: {
					externalHarnessesEnabled: true,
					workTogetherEnabled: true,
					agents: [
						{ ...agent("agent6", "opencode"), model: "openai/gpt-5.6-terra" },
						{ ...agent("agent7", "codex"), model: "gpt-5-codex" },
						{ ...agent("agent8", "codex", false), model: "disabled-model" },
					],
				},
			});
			await send({
				id: "team-prompt",
				type: "prompt",
				message: "Review the frontend, backend, security, and tests for this architecture.",
			});
			await vi.waitFor(() => expect(promptCalls).toHaveLength(1));
			await expect(send({ id: "busy-team-prompt", type: "prompt", message: "overlap" })).resolves.toMatchObject({
				success: false,
				code: "AGENT_BUSY",
			});
			expect(promptCalls).toHaveLength(1);
			expect(promptCalls[0]).toMatchObject({ session: { agentId: "agent6" } });
			expect(promptCalls[0]?.text).toContain("agent6: harness opencode");
			expect(promptCalls[0]?.text).toContain("agent7: harness codex");
			expect(promptCalls[0]?.text).not.toContain("agent8");

			listeners.get("opencode")?.({ type: "message", agentId: "agent6", text: "Coordinator pass" });
			listeners.get("opencode")?.({ type: "settled", agentId: "agent6", status: "completed" });
			await vi.waitFor(() => expect(promptCalls).toHaveLength(2));
			expect(promptCalls[1]).toMatchObject({ session: { agentId: "agent7" } });
			expect(promptCalls[1]?.text).toContain("Coordinator result:\nCoordinator pass");

			listeners.get("codex")?.({ type: "message", agentId: "agent7", text: "Peer pass" });
			listeners.get("codex")?.({ type: "settled", agentId: "agent7", status: "completed" });
			await vi.waitFor(() => expect(promptCalls).toHaveLength(3));
			expect(promptCalls[2]?.session).toBe(promptCalls[0]?.session);
			expect(promptCalls[2]?.text).toContain("Peer result:\nPeer pass");

			listeners.get("opencode")?.({ type: "message", agentId: "agent6", text: "Final answer" });
			listeners.get("opencode")?.({ type: "settled", agentId: "agent6", status: "completed" });
			await vi.waitFor(() =>
				expect(responses()).toEqual(
					expect.arrayContaining([expect.objectContaining({ type: "agent_settled", agentId: "agent6" })]),
				),
			);

			await vi.waitFor(() => expect(bridgeRecords).toHaveLength(11));
			expect(bridgeRecords.map((record) => record.event)).toEqual([
				"TASK_CREATED",
				"TASK_ASSIGNED",
				"TASK_STARTED",
				"TASK_WAITING",
				"TASK_CREATED",
				"TASK_ASSIGNED",
				"TASK_STARTED",
				"TASK_RETURNED",
				"TASK_COMPLETED",
				"TASK_RETURNED",
				"TASK_COMPLETED",
			]);
			expect(bridgeRecords.map((record) => record.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
			expect([...new Set(bridgeRecords.map((record) => record.correlationId))]).toHaveLength(1);
			const debugTypes = debugRecords.map((record) => record.type);
			expect(debugTypes).toEqual(
				expect.arrayContaining([
					"TRACE_STARTED",
					"USER_PROMPT",
					"ROSTER_SNAPSHOT",
					"NATIVE_SESSION_READY",
					"PROMPT_SENT",
					"ADAPTER_EVENT",
					"MODEL_RESPONSE",
					"BRIDGE_EVENT",
				]),
			);
			const rosterRecord = debugRecords.find((record) => record.type === "ROSTER_SNAPSHOT");
			expect(rosterRecord?.data).toMatchObject({
				externalRoster: [{ agentId: "agent6" }, { agentId: "agent7" }],
				coordinator: { agentId: "agent6" },
				peer: { agentId: "agent7" },
			});
			const sentPrompts = debugRecords.filter((record) => record.type === "PROMPT_SENT");
			expect(sentPrompts).toHaveLength(3);
			expect(sentPrompts[1]?.data).toMatchObject({ prompt: expect.stringContaining("Coordinator pass") });
			expect(sentPrompts[2]?.data).toMatchObject({ prompt: expect.stringContaining("Peer pass") });

			await send({
				id: "cancelled-team-prompt",
				type: "prompt",
				message: "Review the frontend, backend, security, and tests for this architecture again.",
			});
			await vi.waitFor(() => expect(promptCalls).toHaveLength(4));
			await send({ id: "abort-team-prompt", type: "abort" });
			await vi.waitFor(() => expect(bridgeRecords).toHaveLength(15));
			expect(bridgeRecords.slice(-4).map((record) => record.event)).toEqual([
				"TASK_CREATED",
				"TASK_ASSIGNED",
				"TASK_STARTED",
				"TASK_CANCELLED",
			]);

			await send({ id: "empty-team-prompt", type: "prompt", message: "quick answer" });
			await vi.waitFor(() => expect(promptCalls).toHaveLength(5));
			listeners.get("opencode")?.({ type: "settled", agentId: "agent6", status: "completed" });
			await vi.waitFor(() => expect(bridgeRecords).toHaveLength(19));
			expect(bridgeRecords.at(-1)).toMatchObject({
				event: "TASK_FAILED",
				status: "failed",
				reason: "agent6 returned no result",
			});
		} finally {
			harness.cleanup();
			for (const listener of process.stdin.listeners("end") as NodeListener[]) {
				if (!stdinListeners.includes(listener)) process.stdin.off("end", listener);
			}
			for (const [signal, previousListeners] of signalListeners) {
				for (const listener of process.listeners(signal) as NodeListener[]) {
					if (!previousListeners.includes(listener)) process.off(signal, listener);
				}
			}
		}
	});
});
