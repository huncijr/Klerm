import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
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
		const adapterSession: CodingHarnessSessionRef = {
			id: "adapter-session",
			agentId: "agent5",
			harness: "opencode",
			model: "openai/gpt-5.6-terra",
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
			await vi.waitFor(() => expect(opencodeAdapter.prompt).toHaveBeenCalledWith(adapterSession, "use OpenCode"));
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
});
