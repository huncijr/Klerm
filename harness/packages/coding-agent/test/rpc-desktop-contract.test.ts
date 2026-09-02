import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
		(harness.sessionManager as unknown as { cwd: string }).cwd = harness.tempDir;
		execFileSync("git", ["init"], { cwd: harness.tempDir, stdio: "ignore" });
		const persistedFile = join(harness.tempDir, "persisted-attribution.txt");
		writeFileSync(persistedFile, "before\n", "utf8");
		harness.sessionManager.appendCustomEntry("klerm-workspace-attribution", {
			path: persistedFile,
			attribution: { source: "local", provider: "ollama", model: "qwen", lane: "local" },
		});
		const config: KlermConfig = {
			routing: "off",
			activeStartLane: "auto",
			localModel: undefined,
			frontierModel: undefined,
			localRole: "builder",
			frontierRole: "builder",
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
			setActiveStartLane: vi.fn(async (lane: "auto" | "local" | "frontier" | "frontier-local") => {
				config.activeStartLane = lane;
				routingState.activeStartLane = lane;
			}),
			setWorkerRole: vi.fn(async (lane: "local" | "frontier", role: "planner" | "builder") => {
				if (lane === "local") config.localRole = role;
				else config.frontierRole = role;
			}),
			filterToolsForActiveRole: vi.fn(<T>(tools: T[]) => tools),
			getSystemPromptContribution: vi.fn(() => undefined),
		} as unknown as KlermRoutingController;
		Object.defineProperty(harness.session, "_klermRoutingController", { value: controller });
		const renameSession = vi.fn(async () => {});
		const deleteSession = vi.fn(async () => {});
		const getKlermThinkingSetting = vi
			.spyOn(harness.session, "getKlermThinkingSetting")
			.mockImplementation((lane) => ({
				level: lane === "local" ? "low" : "high",
				levels: ["off", "low", "high"],
			}));
		const setKlermThinkingLevel = vi
			.spyOn(harness.session, "setKlermThinkingLevel")
			.mockImplementation(async (lane, level) => ({
				level,
				levels: lane === "local" ? ["off", "low"] : ["low", "high"],
			}));

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
				renameSession,
				deleteSession,
			});
			await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());

			const handshake = await send({ id: "handshake", type: "desktop_handshake" });
			expect(handshake).toMatchObject({
				success: true,
				data: {
					protocolVersion: KLERM_DESKTOP_RPC_PROTOCOL_VERSION,
					capabilities: {
						commands: expect.arrayContaining([
							"prompt",
							"get_local_runtimes",
							"get_available_thinking_levels",
							"set_thinking_level",
							"rename_session",
							"set_session_name",
							"get_workspace_status",
							"get_workspace_diff",
							"read_workspace_file",
							"write_workspace_file",
							"get_available_editors",
							"open_workspace_editor",
							"get_running_services",
							"open_local_url",
							"get_mcp_status",
							"add_mcp_server",
							"reload_mcp_servers",
							"bash",
							"abort_bash",
						]),
						events: expect.arrayContaining([
							"model_select",
							"thinking_level_changed",
							"auto_retry_end",
							"workspace_files_changed",
							"bash_execution_update",
						]),
					},
					state: { cwd: expect.any(String) },
					routingState: { mode: "off", lane: "direct" },
				},
			});

			const runtimes = await send({ id: "runtimes", type: "get_local_runtimes" });
			expect(runtimes).toMatchObject({
				success: true,
				data: { runtimes: [{ providerId: "ollama", models: [{ id: "qwen3" }] }] },
			});

			const emptyMcpStatus = await send({ id: "mcp-status-empty", type: "get_mcp_status" });
			expect(emptyMcpStatus).toMatchObject({
				success: true,
				data: { servers: [], toolCount: 0, reloadRequired: false },
			});

			const addedMcp = await send({
				id: "mcp-add",
				type: "add_mcp_server",
				server: { name: "filesystem", transport: "stdio", command: "node", args: ["server.js"], enabled: false },
			});
			expect(addedMcp).toMatchObject({
				success: true,
				data: {
					name: "filesystem",
					scope: "global",
					reloadRequired: true,
					status: {
						servers: [
							{
								name: "filesystem",
								transport: "stdio",
								enabled: false,
								state: "disabled",
								tools: [],
							},
						],
					},
				},
			});
			expect(harness.settingsManager.getMcpServersForScope("global").filesystem).toMatchObject({
				transport: "stdio",
				command: "node",
				args: ["server.js"],
				enabled: false,
			});

			const rejectedMcpSecret = await send({
				id: "mcp-secret",
				type: "add_mcp_server",
				server: {
					name: "remote",
					transport: "http",
					url: "https://example.com/mcp",
					headers: { Authorization: "Bearer secret-token" },
				},
			});
			expect(rejectedMcpSecret).toMatchObject({ success: false, code: "MCP_SECRET_REJECTED" });
			expect(harness.settingsManager.getMcpServersForScope("global").remote).toBeUndefined();

			const reloadedMcp = await send({ id: "mcp-reload", type: "reload_mcp_servers" });
			if (!reloadedMcp.success) throw new Error(JSON.stringify(reloadedMcp));
			expect(reloadedMcp).toMatchObject({ success: true, data: { toolCount: 0 } });

			const workspace = await send({ id: "workspace", type: "get_workspace_status" });
			expect(workspace).toMatchObject({
				success: true,
				data: {
					workspaceRoot: expect.any(String),
					projectRoot: expect.any(String),
					isGit: expect.any(Boolean),
					files: expect.arrayContaining([
						expect.objectContaining({
							path: "persisted-attribution.txt",
							attribution: expect.objectContaining({ source: "local", model: "qwen" }),
						}),
					]),
				},
			});

			const saved = await send({
				id: "write-workspace-file",
				type: "write_workspace_file",
				path: "persisted-attribution.txt",
				content: "after\n",
			});
			expect(saved).toMatchObject({ success: true, data: { path: "persisted-attribution.txt" } });
			expect(parseOutputLines()).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						type: "workspace_files_changed",
						path: "persisted-attribution.txt",
						attribution: expect.objectContaining({ source: "manual" }),
					}),
				]),
			);
			expect(
				harness.sessionManager
					.getEntries()
					.filter((entry) => entry.type === "custom" && entry.customType === "klerm-workspace-attribution"),
			).toHaveLength(2);

			const terminal = await send({
				id: "terminal-command",
				type: "bash",
				command: "printf terminal-ok",
				excludeFromContext: true,
			});
			expect(terminal).toMatchObject({ success: true, data: { output: "terminal-ok", exitCode: 0 } });
			expect(parseOutputLines()).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: "bash_execution_update", id: "terminal-command", delta: "terminal-ok" }),
				]),
			);

			const localThinking = await send({
				id: "local-thinking",
				type: "get_available_thinking_levels",
				lane: "local",
			});
			expect(localThinking).toMatchObject({
				success: true,
				data: { level: "low", levels: ["off", "low", "high"] },
			});
			expect(getKlermThinkingSetting).toHaveBeenCalledWith("local");

			const frontierThinking = await send({
				id: "frontier-thinking",
				type: "set_thinking_level",
				lane: "frontier",
				level: "high",
			});
			expect(frontierThinking).toMatchObject({
				success: true,
				data: { level: "high", levels: ["low", "high"] },
			});
			expect(setKlermThinkingLevel).toHaveBeenCalledWith("frontier", "high");

			const invalidThinkingLane = await send({
				id: "invalid-thinking-lane",
				type: "set_thinking_level",
				lane: "direct",
				level: "low",
			});
			expect(invalidThinkingLane).toMatchObject({ success: false, code: "INVALID_CONFIG" });

			const updated = await send({
				id: "config",
				type: "set_klerm_config",
				update: { routing: "local" },
			});
			expect(updated).toMatchObject({ success: true, data: { config: { routing: "local" } } });
			expect(controller.setRoutingMode).toHaveBeenCalledWith("local");

			const roleUpdate = await send({
				id: "roles",
				type: "set_klerm_config",
				update: { localRole: "planner", frontierRole: "builder" },
			});
			expect(roleUpdate).toMatchObject({
				success: true,
				data: { config: { localRole: "planner", frontierRole: "builder" } },
			});
			expect(controller.setWorkerRole).toHaveBeenCalledWith("local", "planner");

			const invalidRole = await send({
				id: "invalid-role",
				type: "set_klerm_config",
				update: { localRole: "writer" },
			});
			expect(invalidRole).toMatchObject({ success: false, code: "INVALID_CONFIG" });

			const frontierRouting = await send({
				id: "frontier-routing",
				type: "set_klerm_config",
				update: { routing: "frontier", activeStartLane: "auto" },
			});
			expect(frontierRouting).toMatchObject({
				success: true,
				data: { config: { routing: "frontier", activeStartLane: "auto" } },
			});
			expect(controller.setActiveStartLane).toHaveBeenCalledWith("auto");

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
			const invalidStartLane = await send({
				id: "invalid-start-lane",
				type: "set_klerm_config",
				update: { activeStartLane: "direct" },
			});
			expect(invalidStartLane).toMatchObject({ success: false, code: "INVALID_CONFIG" });

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

			const renamed = await send({
				id: "rename-session",
				type: "rename_session",
				sessionToken: "/private/session.jsonl",
				name: "  Renamed session  ",
			});
			expect(renamed).toMatchObject({ success: true, data: { sessionId: "session-1" } });
			expect(renameSession).toHaveBeenCalledWith("/private/session.jsonl", "Renamed session");

			const invalidRename = await send({
				id: "invalid-rename",
				type: "rename_session",
				sessionToken: "/private/not-listed.jsonl",
				name: "Renamed session",
			});
			expect(invalidRename).toMatchObject({ success: false, code: "SESSION_NOT_FOUND" });

			const emptyRename = await send({
				id: "empty-rename",
				type: "rename_session",
				sessionToken: "/private/session.jsonl",
				name: "  ",
			});
			expect(emptyRename).toMatchObject({ success: false, code: "INVALID_SESSION_NAME" });

			const deleted = await send({
				id: "delete-session",
				type: "delete_session",
				sessionToken: "/private/session.jsonl",
			});
			expect(deleted).toMatchObject({ success: true, data: { sessionId: "session-1" } });
			expect(deleteSession).toHaveBeenCalledWith("/private/session.jsonl");

			const invalidDelete = await send({
				id: "invalid-delete",
				type: "delete_session",
				sessionToken: "/private/not-listed.jsonl",
			});
			expect(invalidDelete).toMatchObject({ success: false, code: "SESSION_NOT_FOUND" });

			const missingDeleteToken = await send({ id: "missing-delete-token", type: "delete_session" });
			expect(missingDeleteToken).toMatchObject({ success: false, code: "INVALID_SESSION" });

			deleteSession.mockImplementationOnce(async () => {
				const notFound = new Error("no such file or directory") as Error & { code?: string };
				notFound.code = "ENOENT";
				throw notFound;
			});
			const missingFileDelete = await send({
				id: "missing-file-delete",
				type: "delete_session",
				sessionToken: "/private/session.jsonl",
			});
			expect(missingFileDelete).toMatchObject({ success: true, data: { sessionId: "session-1" } });
			expect(deleteSession).toHaveBeenCalledTimes(2);
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
