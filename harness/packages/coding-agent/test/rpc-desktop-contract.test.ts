import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import type { BrowserRunCoordinatorOptions, BrowserRunPublicState } from "../src/klerm/browser-run-coordinator.ts";
import type {
	CodingHarnessAdapter,
	CodingHarnessAdapterListener,
	CodingHarnessSessionRef,
} from "../src/klerm/coding-harness-adapter.ts";
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
		const storedSessionFile = join(harness.tempDir, "stored-session.jsonl");
		const storedSessionBody = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "session-1",
				timestamp: "2026-08-30T10:00:00.000Z",
				cwd: "/project",
			}),
			JSON.stringify({
				type: "message",
				id: "entry-1",
				parentId: null,
				timestamp: "2026-08-30T10:00:01.000Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "Keep the project registry deterministic." }],
					timestamp: 1,
				},
			}),
		].join("\n");
		writeFileSync(storedSessionFile, `${storedSessionBody}\n`, "utf8");
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
			localApprovalMode: "risky",
			frontierApprovalMode: "risky",
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
			setBuilderApprovalMode: vi.fn(async (lane: "local" | "frontier", mode: "always" | "risky" | "never") => {
				if (lane === "local") config.localApprovalMode = mode;
				else config.frontierApprovalMode = mode;
			}),
			setMaxDelegationCycles: vi.fn(async (cycles: number) => {
				config.maxDelegationCycles = cycles;
			}),
			filterToolsForActiveRole: vi.fn(<T>(tools: T[]) => tools),
			getSystemPromptContribution: vi.fn(() => undefined),
			routePrompt: vi.fn(async () => undefined),
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
		const runtimeHost = createRuntimeHost(harness);
		const adapterListeners = new Set<CodingHarnessAdapterListener>();
		const fakeCodexAdapter: CodingHarnessAdapter = {
			kind: "codex",
			startSession: async (agent) => ({
				id: `session-${agent.id}`,
				agentId: agent.id,
				harness: "codex",
				model: agent.model ?? "",
				role: agent.role,
				nativeSessionId: `thread-${agent.id}`,
			}),
			prompt: async (adapterSession: CodingHarnessSessionRef) => {
				for (const listener of adapterListeners) {
					listener({ type: "message", agentId: adapterSession.agentId, text: "Independent bot reply." });
					listener({ type: "settled", agentId: adapterSession.agentId, status: "completed" });
				}
			},
			abort: async () => {},
			closeSession: async () => {},
			subscribe: (listener) => {
				adapterListeners.add(listener);
				return () => adapterListeners.delete(listener);
			},
		};
		const browserState: BrowserRunPublicState = {
			runId: "browser-run-1",
			taskId: "browser-task-1",
			correlationId: "browser-correlation-1",
			agentId: "browser-agent",
			model: "faux/test",
			status: "running",
			control: "ai",
			requestedAt: "2026-09-23T10:00:00.000Z",
			updatedAt: "2026-09-23T10:00:01.000Z",
			startUrl: "https://example.com/docs",
			lastActions: [],
		};
		const browserStart = vi.fn(async () => browserState);
		const browserApprove = vi.fn(async () => browserState);
		const browserTakeover = vi.fn(async () => browserState);
		const browserResume = vi.fn(async () => browserState);
		const browserStop = vi.fn(async () => ({ ...browserState, status: "cancelled" as const }));
		const browserCrashed = vi.fn(async () => ({ ...browserState, browserReset: true }));
		const browserClose = vi.fn(async () => undefined);
		const createBrowserRunCoordinator = vi.fn((_options: BrowserRunCoordinatorOptions) => ({
			availability: async () => ({ available: true as const, runtime: "test browser worker" }),
			state: () => browserState,
			start: browserStart,
			approve: browserApprove,
			approveAction: vi.fn(async () => browserState),
			takeover: browserTakeover,
			resume: browserResume,
			stop: browserStop,
			browserCrashed,
			close: browserClose,
		}));

		try {
			void runRpcMode(runtimeHost, {
				codingHarnessAdapters: new Map([["codex", fakeCodexAdapter]]),
				personalBotStorageDir: join(harness.tempDir, "agent"),
				discoverCodingHarnesses: async () => [
					{ kind: "codex", available: true, builtin: false, adapterConnected: true, models: ["codex/test"] },
				],
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
						path: storedSessionFile,
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
				createBrowserRunCoordinator,
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
							"prompt_together",
							"get_local_runtimes",
							"get_projects",
							"get_personal_bots",
							"upsert_personal_bot",
							"generate_personal_bot_memory",
							"delete_personal_bot",
							"get_personal_bot_conversation",
							"prompt_personal_bot",
							"abort_personal_bot",
							"reset_personal_bot_conversation",
							"delete_personal_bot_summary",
							"create_project",
							"ask_project",
							"import_legacy_desktop_projects",
							"get_available_thinking_levels",
							"set_thinking_level",
							"rename_session",
							"set_session_name",
							"get_workspace_status",
							"initialize_git_repository",
							"get_github_status",
							"login_github",
							"get_project_trust",
							"set_project_trust",
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
							"get_desktop_settings",
							"set_desktop_appearance",
							"upsert_klerm_profile",
							"get_provider_status",
							"connect_provider",
							"disconnect_provider",
							"connect_provider_oauth",
							"cancel_provider_oauth",
							"bash",
							"abort_bash",
							"get_browser_availability",
							"get_browser_run",
							"start_browser_run",
							"resolve_browser_origin",
							"stop_browser_run",
							"report_browser_host_crash",
							"request_browser_takeover",
							"resume_browser_run",
						]),
						events: expect.arrayContaining([
							"model_select",
							"thinking_level_changed",
							"auto_retry_end",
							"workspace_files_changed",
							"bash_execution_update",
							"personal_bot_conversation_changed",
							"personal_bot_summary_updated",
							"personal_bot_summaries_changed",
							"browser_event",
						]),
					},
					state: { cwd: expect.any(String) },
					routingState: { mode: "off", lane: "direct" },
				},
			});
			const untrustedBrowserRun = await send({
				id: "browser-untrusted",
				type: "start_browser_run",
				model: "faux/test",
				prompt: "Summarize the public documentation.",
				startUrl: "https://example.com/docs",
			});
			expect(untrustedBrowserRun).toMatchObject({ success: false, code: "WORKSPACE_NOT_TRUSTED" });
			expect(createBrowserRunCoordinator).not.toHaveBeenCalled();

			const runtimes = await send({ id: "runtimes", type: "get_local_runtimes" });
			expect(runtimes).toMatchObject({
				success: true,
				data: { runtimes: [{ providerId: "ollama", models: [{ id: "qwen3" }] }] },
			});

			const invalidImage = await send({
				id: "invalid-image",
				type: "prompt",
				message: "describe",
				images: [{ type: "image", mimeType: "image/png", data: "not-base64" }],
			});
			expect(invalidImage).toMatchObject({ success: false, code: "INVALID_IMAGE_ATTACHMENT" });

			const desktopSettings = await send({ id: "desktop-settings", type: "get_desktop_settings" });
			expect(desktopSettings).toMatchObject({
				success: true,
				data: {
					appearance: "dark",
					profiles: { profiles: expect.arrayContaining([expect.objectContaining({ id: "scout" })]) },
					shortcuts: expect.arrayContaining([expect.objectContaining({ action: "Send prompt" })]),
				},
			});

			const personalBots = await send({ id: "personal-bots", type: "get_personal_bots" });
			expect(personalBots).toMatchObject({
				success: true,
				data: {
					version: 1,
					bots: [
						expect.objectContaining({ id: "bot-scout", profileId: "scout" }),
						expect.objectContaining({ id: "bot-sage", profileId: "sage" }),
						expect.objectContaining({ id: "bot-builder", profileId: "builder" }),
					],
				},
			});
			const botConversation = await send({
				id: "personal-bot-conversation",
				type: "get_personal_bot_conversation",
				botId: "bot-scout",
			});
			expect(botConversation).toMatchObject({
				success: true,
				data: { botId: "bot-scout", status: "idle", messages: [] },
			});
			expect(
				await send({
					id: "personal-bot-prompt-disabled",
					type: "prompt_personal_bot",
					botId: "bot-scout",
					message: "Hello",
				}),
			).toMatchObject({ success: false, code: "PERSONAL_BOT_UNAVAILABLE" });
			expect(
				await send({
					id: "personal-bot-enable",
					type: "upsert_personal_bot",
					bot: {
						id: "bot-scout",
						name: "Scout",
						face: "fox",
						profileId: "scout",
						harness: "codex",
						model: "codex/test",
						role: "planner",
						effort: "medium",
						enabled: true,
						createdSequence: 1,
					},
				}),
			).toMatchObject({ success: true });
			expect(
				await send({
					id: "personal-bot-prompt",
					type: "prompt_personal_bot",
					botId: "bot-scout",
					message: "Hello",
				}),
			).toMatchObject({ success: true, data: { botId: "bot-scout" } });
			expect(
				await send({
					id: "personal-bot-conversation-updated",
					type: "get_personal_bot_conversation",
					botId: "bot-scout",
				}),
			).toMatchObject({
				success: true,
				data: {
					status: "idle",
					nativeSessionId: "thread-bot-scout",
					messages: [
						{ role: "user", text: "Hello" },
						{ role: "assistant", text: "Independent bot reply." },
					],
				},
			});

			const klermModel = harness.getModel();
			const klermModelRef = `${klermModel.provider}/${klermModel.id}`;
			const sharedMessageCount = harness.session.messages.length;
			harness.setResponses([fauxAssistantMessage("Independent Klerm reply.")]);
			expect(
				await send({
					id: "personal-bot-enable-klerm",
					type: "upsert_personal_bot",
					bot: {
						id: "bot-sage",
						name: "Sage",
						face: "owl",
						profileId: "sage",
						harness: "klerm",
						model: klermModelRef,
						role: "planner",
						effort: "medium",
						enabled: true,
						createdSequence: 2,
					},
				}),
			).toMatchObject({ success: true });
			expect(
				await send({
					id: "personal-bot-link-agent",
					type: "set_coding_harness_slots",
					slots: {
						externalHarnessesEnabled: false,
						agents: [
							{
								id: "agent1",
								kind: "klerm",
								enabled: true,
								personalBotId: "bot-sage",
								memoryProfileId: "scout",
								role: "builder",
								effort: "off",
								tools: [],
							},
						],
					},
				}),
			).toMatchObject({ success: false, code: "INVALID_CODING_HARNESS_SLOTS" });
			expect(
				await send({
					id: "personal-bot-prompt-klerm",
					type: "prompt_personal_bot",
					botId: "bot-sage",
					message: "Use the configured Klerm model",
				}),
			).toMatchObject({ success: true, data: { botId: "bot-sage" } });
			await vi.waitFor(async () => {
				const response = await send({
					id: "personal-bot-conversation-klerm",
					type: "get_personal_bot_conversation",
					botId: "bot-sage",
				});
				expect(response).toMatchObject({
					success: true,
					data: {
						status: "idle",
						sessionContextDigest: expect.any(String),
						linkedSuccessfulPromptCount: 0,
						pendingSummarySources: [],
						summaries: [],
						messages: [
							{ role: "user", text: "Use the configured Klerm model" },
							{ role: "assistant", text: "Independent Klerm reply." },
						],
					},
				});
			});
			expect(parseOutputLines().some((line) => line.type === "personal_bot_summary_updated")).toBe(false);
			expect(harness.session.messages).toHaveLength(sharedMessageCount);
			expect(
				await send({
					id: "personal-bot-profile-update",
					type: "upsert_klerm_profile",
					profile: {
						id: "sage",
						name: "Sage",
						face: "owl",
						level: 4,
						behaviour: "Analyze previous coding sessions carefully.",
						workPlan: "Identify decisions, risks, and next steps.",
						planMode: "Remain read-only and discussion-focused.",
						buildMode: "",
						memoryFormat: "md",
						memory: "",
						readme: "",
					},
				}),
			).toMatchObject({
				success: true,
				data: {
					profiles: { profiles: expect.arrayContaining([expect.objectContaining({ id: "sage", level: 4 })]) },
				},
			});
			harness.setResponses([fauxAssistantMessage("Updated profile reply.")]);
			expect(
				await send({
					id: "personal-bot-prompt-updated-profile",
					type: "prompt_personal_bot",
					botId: "bot-sage",
					message: "Continue with the updated profile",
				}),
			).toMatchObject({ success: true });
			await vi.waitFor(async () => {
				const response = await send({
					id: "personal-bot-conversation-updated-profile",
					type: "get_personal_bot_conversation",
					botId: "bot-sage",
				});
				expect(response).toMatchObject({
					success: true,
					data: {
						status: "idle",
						linkedSuccessfulPromptCount: 0,
						pendingSummarySources: [],
						summaries: [],
						messages: [
							{ role: "user", text: "Use the configured Klerm model" },
							{ role: "assistant", text: "Independent Klerm reply." },
							{ role: "user", text: "Continue with the updated profile" },
							{ role: "assistant", text: "Updated profile reply." },
						],
					},
				});
			});
			harness.setResponses([fauxAssistantMessage("- Prefers terse answers.\n- Works on backend tasks.")]);
			expect(
				await send({
					id: "personal-bot-memory-generate",
					type: "generate_personal_bot_memory",
					model: klermModelRef,
					brief: "A terse backend helper.",
				}),
			).toMatchObject({
				success: true,
				data: { model: klermModelRef, text: expect.stringContaining("Prefers terse answers.") },
			});
			expect(
				await send({
					id: "personal-bot-memory-empty",
					type: "generate_personal_bot_memory",
					model: klermModelRef,
					brief: "   ",
				}),
			).toMatchObject({ success: false, code: "INVALID_PERSONAL_BOT_MEMORY_REQUEST" });
			expect(
				await send({
					id: "personal-bot-memory-unknown-model",
					type: "generate_personal_bot_memory",
					model: "missing/nope",
					brief: "A terse backend helper.",
				}),
			).toMatchObject({ success: false, code: "PERSONAL_BOT_UNAVAILABLE" });
			expect(
				await send({
					id: "personal-bot-unlink-agent",
					type: "set_coding_harness_slots",
					slots: {
						externalHarnessesEnabled: true,
						agents: [
							{
								id: "agent1",
								kind: "codex",
								enabled: true,
								model: "codex/test",
								role: "builder",
								effort: "off",
								tools: [],
							},
						],
					},
				}),
			).toMatchObject({ success: true });
			const settledBeforeUnlinked = parseOutputLines().filter((line) => line.type === "agent_settled").length;
			const unlinkedPrompt = await send({
				id: "normal-unlinked-prompt",
				type: "prompt",
				targetAgentId: "agent1",
				message: "Normal unlinked task",
			});
			expect(unlinkedPrompt, JSON.stringify(unlinkedPrompt)).toMatchObject({ success: true });
			await vi.waitFor(() => {
				expect(parseOutputLines().filter((line) => line.type === "agent_settled").length).toBeGreaterThan(
					settledBeforeUnlinked,
				);
			});
			await vi.waitFor(async () => {
				const response = await send({
					id: "normal-unlinked-conversation",
					type: "get_personal_bot_conversation",
					botId: "bot-sage",
				});
				expect(response).toMatchObject({
					success: true,
					data: { linkedSuccessfulPromptCount: 0, pendingSummarySources: [], summaries: [] },
				});
			});
			expect(
				await send({
					id: "personal-bot-model-settings-update",
					type: "upsert_personal_bot",
					bot: {
						id: "bot-sage",
						name: "Sage",
						face: "owl",
						profileId: "sage",
						harness: "klerm",
						model: klermModelRef,
						role: "planner",
						effort: "high",
						enabled: true,
						createdSequence: 2,
					},
				}),
			).toMatchObject({ success: true });
			harness.setResponses([fauxAssistantMessage("Updated reasoning reply.")]);
			expect(
				await send({
					id: "personal-bot-prompt-updated-model-settings",
					type: "prompt_personal_bot",
					botId: "bot-sage",
					message: "Continue with updated reasoning",
				}),
			).toMatchObject({ success: true });
			await vi.waitFor(async () => {
				const response = await send({
					id: "personal-bot-conversation-updated-model-settings",
					type: "get_personal_bot_conversation",
					botId: "bot-sage",
				});
				expect(response).toMatchObject({
					success: true,
					data: {
						status: "idle",
						linkedSuccessfulPromptCount: 0,
						pendingSummarySources: [],
						summaries: [],
						messages: expect.arrayContaining([
							expect.objectContaining({ role: "user", text: "Continue with updated reasoning" }),
							expect.objectContaining({ role: "assistant", text: "Updated reasoning reply." }),
						]),
					},
				});
			});
			expect(
				await send({
					id: "personal-bot-enable-peer",
					type: "upsert_personal_bot",
					bot: {
						id: "bot-builder",
						name: "Builder",
						face: "bear",
						profileId: "builder",
						harness: "klerm",
						model: klermModelRef,
						role: "planner",
						effort: "medium",
						enabled: true,
						createdSequence: 3,
					},
				}),
			).toMatchObject({ success: true });
			harness.setResponses([fauxAssistantMessage("Peer-aware reply.")]);
			expect(
				await send({
					id: "personal-bot-prompt-peer-aware",
					type: "prompt_personal_bot",
					botId: "bot-builder",
					message: "Review what the other bot discussed",
				}),
			).toMatchObject({ success: true });
			await vi.waitFor(async () => {
				const response = await send({
					id: "personal-bot-conversation-peer-aware",
					type: "get_personal_bot_conversation",
					botId: "bot-builder",
				});
				expect(response).toMatchObject({
					success: true,
					data: {
						status: "idle",
						linkedSuccessfulPromptCount: 0,
						summaries: [],
						messages: [
							{ role: "user", text: "Review what the other bot discussed" },
							{ role: "assistant", text: "Peer-aware reply." },
						],
					},
				});
			});
			const addedBot = await send({
				id: "personal-bot-add",
				type: "upsert_personal_bot",
				bot: {
					id: "bot-reviewer",
					name: "Reviewer",
					face: "owl",
					profileId: "sage",
					harness: "klerm",
					role: "planner",
					effort: "high",
					enabled: false,
					createdSequence: 4,
				},
			});
			expect(addedBot).toMatchObject({
				success: true,
				data: { bots: expect.arrayContaining([expect.objectContaining({ id: "bot-reviewer" })]) },
			});
			expect(await send({ id: "browser-trust", type: "set_project_trust", trusted: true })).toMatchObject({
				success: true,
			});
			expect(await send({ id: "browser-availability", type: "get_browser_availability" })).toMatchObject({
				success: true,
				data: { available: true, runtime: "test browser worker" },
			});
			expect(await send({ id: "browser-state", type: "get_browser_run" })).toMatchObject({
				success: true,
				data: { state: browserState },
			});
			await createBrowserRunCoordinator.mock.calls[0]![0].onEvent?.({
				event: {
					version: 1,
					sequence: 1,
					event: "RUN_STARTED",
					runId: "browser-run-1",
					taskId: "browser-task-1",
					correlationId: "browser-correlation-1",
					agentId: "browser-agent",
					status: "running",
					reason: "Browser worker started.",
					timestamp: "2026-09-23T10:00:01.000Z",
				},
				state: browserState,
			});
			expect(parseOutputLines()).toContainEqual(
				expect.objectContaining({
					type: "browser_event",
					event: expect.objectContaining({ event: "RUN_STARTED", sequence: 1 }),
					state: browserState,
				}),
			);
			expect(
				await send({
					id: "browser-start",
					type: "start_browser_run",
					model: "faux/test",
					prompt: " Summarize the public documentation. ",
					startUrl: " https://example.com/docs ",
					maxSteps: 8,
				}),
			).toMatchObject({ success: true, data: browserState });
			expect(browserStart).toHaveBeenCalledWith({
				model: "faux/test",
				prompt: "Summarize the public documentation.",
				startUrl: "https://example.com/docs",
				maxSteps: 8,
			});
			expect(
				await send({
					id: "browser-approve",
					type: "resolve_browser_origin",
					runId: "browser-run-1",
					approvalId: "approval-1",
					decision: "approved",
					scope: "allow_once",
				}),
			).toMatchObject({ success: true, data: browserState });
			expect(browserApprove).toHaveBeenCalledWith({
				runId: "browser-run-1",
				approvalId: "approval-1",
				decision: "approved",
				scope: "allow_once",
			});
			expect(await send({ id: "browser-stop", type: "stop_browser_run", runId: "browser-run-1" })).toMatchObject({
				success: true,
				data: { status: "cancelled" },
			});
			expect(browserStop).toHaveBeenCalledWith("browser-run-1");
			expect(
				await send({ id: "browser-host-crash", type: "report_browser_host_crash", runId: "browser-run-1" }),
			).toMatchObject({
				success: true,
				data: { state: { browserReset: true } },
			});
			expect(browserCrashed).toHaveBeenCalledWith("browser-run-1");
			expect(
				await send({
					id: "browser-takeover",
					type: "request_browser_takeover",
					runId: "browser-run-1",
					reason: "CAPTCHA handoff",
				}),
			).toMatchObject({ success: true, data: browserState });
			expect(browserTakeover).toHaveBeenCalledWith({ runId: "browser-run-1", reason: "CAPTCHA handoff" });
			expect(
				await send({
					id: "browser-takeover-bad",
					type: "request_browser_takeover",
					runId: "browser-run-1",
					reason: "",
				}),
			).toMatchObject({ success: false, code: "INVALID_BROWSER_TAKEOVER" });
			expect(await send({ id: "browser-resume", type: "resume_browser_run", runId: "browser-run-1" })).toMatchObject(
				{
					success: true,
					data: browserState,
				},
			);
			expect(browserResume).toHaveBeenCalledWith("browser-run-1");
			expect(
				await send({ id: "personal-bot-delete", type: "delete_personal_bot", botId: "bot-reviewer" }),
			).toMatchObject({
				success: true,
				data: { bots: expect.not.arrayContaining([expect.objectContaining({ id: "bot-reviewer" })]) },
			});
			expect(harness.settingsManager.getCodingHarnessSlots().agents[0]).not.toHaveProperty("personalBotId");
			expect(harness.settingsManager.getCodingHarnessSlots().agents[0]).not.toHaveProperty("memoryProfileId");

			const providerStatus = await send({ id: "provider-status", type: "get_provider_status" });
			expect(providerStatus).toMatchObject({
				success: true,
				data: { providers: expect.any(Array) },
			});

			const badConnect = await send({
				id: "provider-connect-bad",
				type: "connect_provider",
				account: { provider: "no-such-provider", apiKey: "x" },
			});
			expect(badConnect).toMatchObject({ success: false });

			const oauthUnsupported = await send({
				id: "provider-oauth-unsupported",
				type: "connect_provider_oauth",
				provider: "openai",
			});
			expect(oauthUnsupported).toMatchObject({ success: false });

			const oauthCancelIdle = await send({ id: "provider-oauth-cancel-idle", type: "cancel_provider_oauth" });
			expect(oauthCancelIdle).toMatchObject({ success: true, data: { cancelled: false } });

			const emptyMcpStatus = await send({ id: "mcp-status-empty", type: "get_mcp_status" });
			expect(emptyMcpStatus).toMatchObject({
				success: true,
				data: { servers: [], toolCount: 0, reloadRequired: false },
			});

			const addedMcp = await send({
				id: "mcp-add",
				type: "add_mcp_server",
				server: {
					name: "filesystem",
					transport: "stdio",
					command: "node",
					args: ["server.js"],
					enabled: false,
					label: "Google Maps",
					color: "green",
				},
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
								label: "Google Maps",
								color: "green",
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
				label: "Google Maps",
				color: "green",
			});

			const addedBaseMcp = await send({
				id: "mcp-add-base",
				type: "add_mcp_server",
				server: { name: "docs", transport: "stdio", command: "node", enabled: false },
			});
			expect(addedBaseMcp).toMatchObject({
				success: true,
				data: {
					status: { servers: expect.arrayContaining([expect.objectContaining({ name: "docs", color: "base" })]) },
				},
			});
			expect(harness.settingsManager.getMcpServersForScope("global").docs).toMatchObject({ color: "base" });

			const configuredMcpEnv = await send({
				id: "mcp-edit-env",
				type: "add_mcp_server",
				server: {
					name: "filesystem",
					transport: "stdio",
					command: "node",
					args: ["server.js"],
					env: { NOTION_TOKEN: "secret-token" },
					enabled: false,
					label: "Notion",
				},
			});
			expect(configuredMcpEnv).toMatchObject({
				success: true,
				data: {
					status: { servers: expect.arrayContaining([expect.objectContaining({ envKeys: ["NOTION_TOKEN"] })]) },
				},
			});
			expect(harness.settingsManager.getMcpServersForScope("global").filesystem?.env).toEqual({
				NOTION_TOKEN: "secret-token",
			});
			expect(JSON.stringify(parseOutputLines())).not.toContain("secret-token");

			const postgresUri = "postgresql://user:secret-pass@example.com:6543/postgres";
			const addedPostgresMcp = await send({
				id: "mcp-add-postgres",
				type: "add_mcp_server",
				server: {
					name: "supabase-postgres",
					transport: "stdio",
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-postgres", postgresUri],
				},
			});
			expect(addedPostgresMcp).toMatchObject({
				success: true,
				data: {
					status: {
						servers: expect.arrayContaining([
							expect.objectContaining({ name: "supabase-postgres", color: "base" }),
						]),
					},
				},
			});
			expect(harness.settingsManager.getMcpServersForScope("global")["supabase-postgres"]).toMatchObject({
				transport: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-postgres", postgresUri],
				color: "base",
			});
			expect(JSON.stringify(parseOutputLines())).not.toContain("secret-pass");
			expect(JSON.stringify(parseOutputLines())).not.toContain(postgresUri);

			const rejectedMcpColor = await send({
				id: "mcp-color",
				type: "add_mcp_server",
				server: { name: "filesystem", transport: "stdio", command: "node", color: "chartreuse" },
			});
			expect(rejectedMcpColor).toMatchObject({ success: false, code: "INVALID_MCP_SERVER" });

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

			const approvalUpdate = await send({
				id: "approval",
				type: "set_klerm_config",
				update: { localApprovalMode: "always", frontierApprovalMode: "never" },
			});
			expect(approvalUpdate).toMatchObject({
				success: true,
				data: { config: { localApprovalMode: "always", frontierApprovalMode: "never" } },
			});
			expect(controller.setBuilderApprovalMode).toHaveBeenCalledWith("local", "always");
			expect(controller.setBuilderApprovalMode).toHaveBeenCalledWith("frontier", "never");

			const cycleUpdate = await send({
				id: "cycles",
				type: "set_klerm_config",
				update: { maxDelegationCycles: 100 },
			});
			expect(cycleUpdate).toMatchObject({ success: true, data: { config: { maxDelegationCycles: 100 } } });
			expect(controller.setMaxDelegationCycles).toHaveBeenCalledWith(100);

			const unlimitedCycles = await send({
				id: "cycles-unlimited",
				type: "set_klerm_config",
				update: { maxDelegationCycles: 0 },
			});
			expect(unlimitedCycles).toMatchObject({ success: true, data: { config: { maxDelegationCycles: 0 } } });

			const invalidCycles = await send({
				id: "cycles-invalid",
				type: "set_klerm_config",
				update: { maxDelegationCycles: 101 },
			});
			expect(invalidCycles).toMatchObject({ success: false, code: "INVALID_CONFIG" });

			const invalidRole = await send({
				id: "invalid-role",
				type: "set_klerm_config",
				update: { localRole: "writer" },
			});
			expect(invalidRole).toMatchObject({ success: false, code: "INVALID_CONFIG" });
			const invalidApproval = await send({
				id: "invalid-approval",
				type: "set_klerm_config",
				update: { localApprovalMode: "sometimes" },
			});
			expect(invalidApproval).toMatchObject({ success: false, code: "INVALID_CONFIG" });

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

			const projects = await send({ id: "projects", type: "get_projects" });
			expect(projects).toMatchObject({
				success: true,
				data: {
					version: 1,
					defaultProjectId: "project-default",
					projects: [{ id: "project-default", name: "My New Project", sessionCount: 1 }],
				},
			});

			const imported = await send({
				id: "import-projects",
				type: "import_legacy_desktop_projects",
				projects: [{ id: "legacy-project", name: "Imported" }],
				sessionProjects: { [storedSessionFile]: "legacy-project" },
			});
			expect(imported).toMatchObject({
				success: true,
				data: { projects: expect.arrayContaining([{ id: "legacy-project", name: "Imported", sessionCount: 1 }]) },
			});
			expect(harness.settingsManager.getProjectRegistry().sessionProjects).toMatchObject({
				"session-1": "legacy-project",
			});

			const asked = await send({
				id: "ask-project",
				type: "ask_project",
				projectId: "legacy-project",
				question: "What matters?",
			});
			expect(asked).toMatchObject({
				success: true,
				data: {
					prompt: expect.stringContaining("[Session: Desktop test | session-1 | user]"),
					extracts: [{ sessionId: "session-1", role: "user", text: "Keep the project registry deterministic." }],
				},
			});
			expect(asked).toMatchObject({
				data: { prompt: expect.stringContaining("User question:\nWhat matters?") },
			});
			const summary = await send({ id: "summary", type: "refresh_project_summary", projectId: "legacy-project" });
			expect(summary).toMatchObject({
				success: true,
				data: { summary: expect.stringContaining("Assigned sessions: 1") },
			});
			expect(readFileSync(storedSessionFile, "utf8")).toBe(`${storedSessionBody}\n`);
			vi.mocked(runtimeHost.newSession).mockResolvedValueOnce({ cancelled: false });
			const newSession = await send({ id: "new-session", type: "new_session" });
			expect(newSession).toMatchObject({ success: true, data: { cancelled: false } });
			expect(harness.settingsManager.getProjectRegistry().sessionProjects[harness.session.sessionId]).toBe(
				"project-default",
			);

			const sessions = await send({ id: "sessions", type: "list_sessions" });
			expect(sessions).toMatchObject({
				success: true,
				data: {
					sessions: [
						{
							id: "session-1",
							sessionToken: storedSessionFile,
							name: "Desktop test",
							projectId: "legacy-project",
						},
					],
				},
			});
			expect(JSON.stringify(sessions)).not.toContain("allMessagesText");

			const switched = await send({
				id: "switch-session",
				type: "switch_session",
				sessionPath: storedSessionFile,
			});
			expect(switched).toMatchObject({ success: true });
			expect(runtimeHost.switchSession).toHaveBeenCalledOnce();
			expect(runtimeHost.switchSession).toHaveBeenCalledWith(storedSessionFile);

			const invalidSwitch = await send({
				id: "invalid-switch-session",
				type: "switch_session",
				sessionPath: "/private/not-listed.jsonl",
			});
			expect(invalidSwitch).toMatchObject({ success: false, code: "SESSION_NOT_FOUND" });

			const renamed = await send({
				id: "rename-session",
				type: "rename_session",
				sessionToken: storedSessionFile,
				name: "  Renamed session  ",
			});
			expect(renamed).toMatchObject({ success: true, data: { sessionId: "session-1" } });
			expect(renameSession).toHaveBeenCalledWith(storedSessionFile, "Renamed session");

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
				sessionToken: storedSessionFile,
				name: "  ",
			});
			expect(emptyRename).toMatchObject({ success: false, code: "INVALID_SESSION_NAME" });

			const deleted = await send({
				id: "delete-session",
				type: "delete_session",
				sessionToken: storedSessionFile,
			});
			expect(deleted).toMatchObject({ success: true, data: { sessionId: "session-1" } });
			expect(deleteSession).toHaveBeenCalledWith(storedSessionFile);
			expect(harness.settingsManager.getProjectRegistry().sessionProjects["session-1"]).toBeUndefined();

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
				sessionToken: storedSessionFile,
			});
			expect(missingFileDelete).toMatchObject({ success: true, data: { sessionId: "session-1" } });
			expect(deleteSession).toHaveBeenCalledTimes(2);

			const deletedProject = await send({
				id: "delete-project",
				type: "delete_project",
				projectId: "legacy-project",
			});
			expect(deletedProject).toMatchObject({ success: true });
			expect(harness.settingsManager.getProjectRegistry().sessionProjects["session-1"]).toBeUndefined();
			expect(existsSync(storedSessionFile)).toBe(true);
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
