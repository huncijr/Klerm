import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import type { KlermConfig } from "../src/klerm/config.ts";
import type { KlermRoutingController } from "../src/klerm/router/runtime.ts";
import type { KlermRoutingState } from "../src/klerm/router/types.ts";
import { KLERM_DESKTOP_RPC_PROTOCOL_VERSION, runRpcMode } from "../src/modes/index.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
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

function parseOutputLines(): Array<Record<string, unknown>> {
	return rpcIo.outputLines
		.flatMap((line) => line.split("\n"))
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function send(command: Record<string, unknown>): Promise<Record<string, unknown>> {
	rpcIo.lineHandler?.(JSON.stringify(command));
	let response: Record<string, unknown> | undefined;
	await vi.waitFor(() => {
		response = parseOutputLines().find(
			(line) => line.type === "response" && line.id === command.id && line.command === command.type,
		);
		expect(response).toBeDefined();
	});
	return response!;
}

describe("Klerm desktop RPC contract", () => {
	afterEach(() => {
		rpcIo.outputLines = [];
		rpcIo.lineHandler = undefined;
	});

	test("exposes versioned readiness, local runtimes, config, and sessions", async () => {
		const stdinListeners = process.stdin.listeners("end") as NodeListener[];
		const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGTERM"] : ["SIGTERM", "SIGHUP"];
		const signalListeners = new Map(signals.map((signal) => [signal, process.listeners(signal) as NodeListener[]]));
		const harness = await createHarness();
		const config: KlermConfig = {
			routing: "off",
			activeStartLane: "auto",
			localModel: undefined,
			frontierModel: undefined,
			allowFrontierFallback: false,
			handbackEnabled: true,
			maxDelegationCycles: 3,
			localMaxTurns: 8,
			localMaxToolErrors: 3,
		};
		const routingState: KlermRoutingState = {
			mode: "off",
			activeStartLane: "auto",
			lane: "direct",
		};
		const controller = {
			get config() {
				return config;
			},
			get routingState() {
				return routingState;
			},
			setLocalModel: vi.fn(async () => {}),
			setFrontierModel: vi.fn(async (reference: string | undefined) => {
				config.frontierModel = reference;
			}),
			setRoutingMode: vi.fn(async (mode: "off" | "local" | "frontier" | "auto") => {
				config.routing = mode;
				routingState.mode = mode;
			}),
		} as unknown as KlermRoutingController;
		Object.defineProperty(harness.session, "_klermRoutingController", { value: controller });

		try {
			void runRpcMode(createRuntimeHost(harness), {
				discoverLocalRuntimes: async () => [
					{
						providerId: "ollama",
						name: "Ollama",
						serverUrl: "http://127.0.0.1:11434",
						models: [{ id: "qwen3" }],
					},
				],
				listSessions: async () => [
					{
						id: "session-1",
						path: "/private/session.jsonl",
						cwd: "/project",
						name: "Desktop test",
						created: new Date("2026-08-30T10:00:00.000Z"),
						modified: new Date("2026-08-30T10:01:00.000Z"),
						messageCount: 2,
						firstMessage: "Hello",
						allMessagesText: "Hello world",
					},
				],
			});
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

			const handshake = await send({ id: "handshake", type: "desktop_handshake" });
			expect(handshake).toMatchObject({
				success: true,
				data: {
					protocolVersion: KLERM_DESKTOP_RPC_PROTOCOL_VERSION,
					capabilities: { commands: expect.arrayContaining(["prompt", "get_local_runtimes"]) },
					state: { cwd: expect.any(String) },
					routingState: { mode: "off", lane: "direct" },
				},
			});

			const runtimes = await send({ id: "runtimes", type: "get_local_runtimes" });
			expect(runtimes).toMatchObject({
				success: true,
				data: { runtimes: [{ providerId: "ollama", models: [{ id: "qwen3" }] }] },
			});

			const updated = await send({
				id: "config",
				type: "set_klerm_config",
				update: { routing: "local" },
			});
			expect(updated).toMatchObject({ success: true, data: { config: { routing: "local" } } });
			expect(controller.setRoutingMode).toHaveBeenCalledWith("local");

			const frontier = await send({
				id: "frontier",
				type: "set_klerm_config",
				update: { frontierModel: "openai-codex/gpt-5.5" },
			});
			expect(frontier).toMatchObject({
				success: true,
				data: { config: { frontierModel: "openai-codex/gpt-5.5" } },
			});
			expect(controller.setFrontierModel).toHaveBeenCalledWith("openai-codex/gpt-5.5");

			const invalid = await send({ id: "invalid", type: "set_klerm_config", update: {} });
			expect(invalid).toMatchObject({ success: false, code: "INVALID_CONFIG" });

			const sessions = await send({ id: "sessions", type: "list_sessions" });
			expect(sessions).toMatchObject({
				success: true,
				data: {
					sessions: [
						{
							id: "session-1",
							sessionToken: "/private/session.jsonl",
							name: "Desktop test",
						},
					],
				},
			});
			expect(JSON.stringify(sessions)).not.toContain("allMessagesText");
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
