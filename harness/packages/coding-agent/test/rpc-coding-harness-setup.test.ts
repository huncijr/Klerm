import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import type { CodingHarnessKind } from "../src/klerm/coding-harness-setup.ts";
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
		]);

		try {
			void runRpcMode(createRuntimeHost(harness), { discoverCodingHarnesses });
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

			const handshake = await send({ id: "handshake", type: "desktop_handshake" });
			expect(handshake).toMatchObject({
				success: true,
				data: {
					capabilities: {
						commands: expect.arrayContaining(["get_coding_harness_setup", "set_coding_harness_slots"]),
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
					effectiveRouting: "none",
					harnesses: expect.any(Array),
				},
			});
			expect(harness.settingsManager.getGlobalSettings().codingHarnessSlots).toMatchObject({
				externalHarnessesEnabled: true,
				agents: [agent("agent1", "codex"), { ...agent("agent2", "claude-code"), model: "sonnet" }],
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
