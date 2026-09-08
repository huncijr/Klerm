/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 */

import * as crypto from "node:crypto";
import { unlink } from "node:fs/promises";
import { constants as errnoConstants } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { VERSION } from "../../config.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { type SessionInfo, SessionManager } from "../../core/session-manager.ts";
import {
	MCP_SERVER_COLORS,
	type McpServerColor,
	type McpServerSettings,
	type McpServerTransport,
	type SettingsScope,
} from "../../core/settings-manager.ts";
import { isCustomModelApi, loadCustomModels, removeCustomModel, upsertCustomModel } from "../../klerm/custom-models.ts";
import { discoverLocalRuntimes } from "../../klerm/local-runtime-discovery.ts";
import { getMcpRuntimeStatus } from "../../klerm/mcp/extension.ts";
import { redactMcpSecretText } from "../../klerm/mcp/redact.ts";
import { normalizeStdioArgs } from "../../klerm/mcp/stdio-args.ts";
import { normalizeProfile } from "../../klerm/profiles.ts";
import {
	connectProviderAccount,
	customProviderModelIds,
	disconnectProviderAccount,
	getProviderAccountStatus,
} from "../../klerm/provider-accounts.ts";
import { createSessionTitle } from "../../klerm/session-title.ts";
import { canonicalizePath } from "../../utils/paths.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { type Theme, theme } from "../interactive/theme/theme.ts";
import { toJsonEvent } from "../json-event.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type {
	RpcCommand,
	RpcDesktopSessionInfo,
	RpcDesktopSettings,
	RpcEditorInfo,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcMcpStatus,
	RpcMcpToolStatus,
	RpcResponse,
	RpcSessionState,
	RpcSlashCommand,
	RpcWorkspaceAttribution,
} from "./rpc-types.ts";
import { KLERM_DESKTOP_RPC_PROTOCOL_VERSION } from "./rpc-types.ts";
import {
	getAvailableEditors,
	getRunningServices,
	getWorkspaceDiff,
	getWorkspaceStatus,
	openLocalUrl,
	openWorkspaceEditor,
	readWorkspaceTextFile,
	writeWorkspaceTextFile,
} from "./workspace.ts";

// Re-export types for consumers
export type {
	RpcCommand,
	RpcDesktopHandshake,
	RpcDesktopSessionInfo,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcKlermConfigUpdate,
	RpcResponse,
	RpcSessionState,
} from "./rpc-types.ts";

export interface RunRpcModeOptions {
	discoverLocalRuntimes?: typeof discoverLocalRuntimes;
	listSessions?: () => Promise<SessionInfo[]>;
	renameSession?: (sessionPath: string, name: string) => Promise<void> | void;
	deleteSession?: (sessionPath: string) => Promise<void>;
}

const DESKTOP_COMMANDS = [
	"desktop_handshake",
	"get_local_runtimes",
	"get_klerm_config",
	"set_klerm_config",
	"list_sessions",
	"rename_session",
	"delete_session",
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
	"get_desktop_settings",
	"set_desktop_appearance",
	"upsert_klerm_profile",
	"delete_klerm_profile",
	"assign_klerm_profile",
	"add_custom_model",
	"remove_custom_model",
	"get_provider_status",
	"connect_provider",
	"disconnect_provider",
	"connect_provider_oauth",
	"cancel_provider_oauth",
	"bash",
	"abort_bash",
	"get_state",
	"get_messages",
	"get_entries",
	"get_available_models",
	"get_available_thinking_levels",
	"set_thinking_level",
	"prompt",
	"abort",
	"new_session",
	"switch_session",
	"set_session_name",
] as const;

const DESKTOP_EVENTS = [
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
	"routing_changed",
	"agent_start",
	"agent_end",
	"agent_settled",
	"model_select",
	"thinking_level_changed",
	"auto_retry_start",
	"auto_retry_end",
	"workspace_files_changed",
	"bash_execution_update",
] as const;

const WORKSPACE_ATTRIBUTION_CUSTOM_TYPE = "klerm-workspace-attribution";
const MCP_SECRET_HEADER_NAME = /(?:authorization|cookie|token|key|secret|password|credential)/i;
const MCP_SECRET_HEADER_VALUE = /(?:\bbearer\b|\bbasic\b|token|api[_-]?key|password|secret|[A-Za-z0-9_=-]{32,})/i;

function getMcpTransport(settings: McpServerSettings): McpServerTransport {
	return settings.transport ?? "stdio";
}

function sanitizeMcpError(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return redactMcpSecretText(value)
		.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1********:********@")
		.replace(/(authorization|token|api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=********")
		.slice(0, 500);
}

function hasSecretHeader(headers: Record<string, string>): boolean {
	return Object.entries(headers).some(
		([name, value]) => MCP_SECRET_HEADER_NAME.test(name) || MCP_SECRET_HEADER_VALUE.test(value),
	);
}

function parseMcpAppearance(
	update: { label?: unknown; color?: unknown },
	existing?: McpServerSettings,
): { label?: string; color?: McpServerColor } | string {
	let label = existing?.label;
	if (update.label !== undefined) {
		if (typeof update.label !== "string") return "MCP label must be a string.";
		const trimmed = update.label.trim();
		if (trimmed.length > 64) return "MCP label must be 64 characters or fewer.";
		label = trimmed || undefined;
	}
	let color = existing?.color ?? "base";
	if (update.color !== undefined) {
		if (typeof update.color !== "string" || !MCP_SERVER_COLORS.includes(update.color as McpServerColor)) {
			return "MCP color must be base, green, blue, amber, red, purple, or teal.";
		}
		color = update.color as McpServerColor;
	}
	return { ...(label ? { label } : {}), ...(color ? { color } : {}) };
}

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(runtimeHost: AgentSessionRuntime, options: RunRpcModeOptions = {}): Promise<never> {
	takeOverStdout();
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;
	const pendingFileMutations = new Map<
		string,
		{
			path: string;
			attribution: {
				source: "local" | "frontier" | "direct";
				provider?: string;
				model?: string;
				lane: "local" | "frontier" | "direct";
				timestamp: string;
			};
		}
	>();
	const fileAttributions = new Map<string, RpcWorkspaceAttribution>();
	let workspaceProjectRoot = session.sessionManager.getCwd();

	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};

	const success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (id: string | undefined, command: string, message: string, code?: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message, code };
	};

	const getSessionState = (): RpcSessionState => ({
		model: session.model,
		cwd: session.sessionManager.getCwd(),
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		isCompacting: session.isCompacting,
		steeringMode: session.steeringMode,
		followUpMode: session.followUpMode,
		sessionFile: session.sessionFile,
		sessionId: session.sessionId,
		sessionName: session.sessionName,
		autoCompactionEnabled: session.autoCompactionEnabled,
		messageCount: session.messages.length,
		pendingMessageCount: session.pendingMessageCount,
	});

	const getMcpStatusPayload = (): RpcMcpStatus => {
		const configuredServers = session.settingsManager.getMcpServers();
		const runtimeStatuses = new Map(
			(getMcpRuntimeStatus(session.settingsManager) ?? []).map((status) => [status.name, status]),
		);
		const configuredNames = Object.keys(configuredServers).sort();
		const servers = configuredNames.map((name) => {
			const settings = configuredServers[name] ?? {};
			const status = runtimeStatuses.get(name);
			const toolDetails: RpcMcpToolStatus[] = (
				status?.toolDetails ??
				status?.tools.map((tool) => ({ name: tool })) ??
				[]
			).map((tool) => ({
				name: tool.name,
				serverName: name,
				remoteName: "remoteName" in tool && typeof tool.remoteName === "string" ? tool.remoteName : tool.name,
				title: "title" in tool && typeof tool.title === "string" ? tool.title : undefined,
				description: "description" in tool && typeof tool.description === "string" ? tool.description : undefined,
				capability:
					"capability" in tool &&
					(tool.capability === "read" || tool.capability === "write" || tool.capability === "unknown")
						? tool.capability
						: "unknown",
			}));
			return {
				name,
				transport: status?.transport ?? getMcpTransport(settings),
				enabled: status?.enabled ?? settings.enabled !== false,
				state: status?.state ?? (settings.enabled === false ? "disabled" : "closed"),
				tools: toolDetails,
				skippedTools: status?.skippedTools ?? [],
				error: sanitizeMcpError(status?.error),
				errorKind: status?.errorKind,
				...(settings.label ? { label: settings.label } : {}),
				...(settings.color ? { color: settings.color } : {}),
				...(typeof settings.command === "string" ? { command: settings.command } : {}),
				...(settings.args ? { args: settings.args.map((argument) => redactMcpSecretText(argument)) } : {}),
				...(typeof settings.url === "string" ? { url: settings.url } : {}),
				...(settings.env ? { envKeys: Object.keys(settings.env).sort() } : {}),
			};
		});
		const runtimeNames = [...runtimeStatuses.keys()].sort();
		const reloadRequired =
			configuredNames.join("\0") !== runtimeNames.join("\0") ||
			servers.some((server) => server.enabled && (server.state === "closed" || server.state === "connecting"));
		return {
			servers,
			toolCount: servers.reduce((count, server) => count + server.tools.length, 0),
			reloadRequired,
		};
	};

	const modelsPath = () => join(session.settingsManager.getAgentDir(), "models.json");

	let oauthAbort: AbortController | undefined;
	const refreshProviderAccounts = async () => {
		const discover = options.discoverLocalRuntimes ?? discoverLocalRuntimes;
		const runtimes = await discover(undefined, AbortSignal.timeout(5000)).catch(() => []);
		return getProviderAccountStatus(session.modelRuntime, runtimes, await customProviderModelIds(modelsPath()));
	};

	const getDesktopSettingsPayload = async (): Promise<RpcDesktopSettings> => ({
		appearance: session.settingsManager.getDesktopAppearance(),
		agentDir: session.settingsManager.getAgentDir(),
		klermVersion: VERSION,
		cwd: session.sessionManager.getCwd(),
		profiles: session.settingsManager.getKlermProfiles(),
		customModels: await loadCustomModels(modelsPath()),
		shortcuts: [
			{ action: "Send prompt", keys: "Enter" },
			{ action: "New line", keys: "Shift+Enter" },
			{ action: "Stop task", keys: "Escape" },
			{ action: "Open Settings", keys: "Ctrl/Cmd+," },
			{ action: "Toggle files", keys: "Ctrl/Cmd+Shift+F" },
			{ action: "New session", keys: "Ctrl/Cmd+N" },
		],
	});

	// Pending extension UI requests waiting for response
	const pendingExtensionRequests = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void }
	>();

	// Shutdown request flag
	let shutdownRequested = false;
	let shuttingDown = false;
	const signalCleanupHandlers: Array<() => void> = [];

	/** Helper for dialog methods with signal/timeout support */
	function createDialogPromise<T>(
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			pendingExtensionRequests.set(id, {
				resolve: (response: RpcExtensionUIResponse) => {
					cleanup();
					resolve(parseResponse(response));
				},
				reject,
			});
			output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	}

	/**
	 * Create an extension UI context that uses the RPC protocol.
	 */
	const createExtensionUIContext = (): ExtensionUIContext => ({
		select: (title, options, opts) =>
			createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		confirm: (title, message, opts) =>
			createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
			),

		input: (title, placeholder, opts) =>
			createDialogPromise(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			} as RpcExtensionUIRequest);
		},

		onTerminalInput(): () => void {
			// Raw terminal input not supported in RPC mode
			return () => {};
		},

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			} as RpcExtensionUIRequest);
		},

		setWorkingMessage(_message?: string): void {
			// Working message not supported in RPC mode - requires TUI loader access
		},

		setWorkingVisible(_visible: boolean): void {
			// Working visibility not supported in RPC mode - requires TUI loader access
		},

		setWorkingIndicator(_options?: WorkingIndicatorOptions): void {
			// Working indicator customization not supported in RPC mode - requires TUI loader access
		},

		setHiddenThinkingLabel(_label?: string): void {
			// Hidden thinking label not supported in RPC mode - requires TUI message rendering access
		},

		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
			// Only support string arrays in RPC mode - factory functions are ignored
			if (content === undefined || Array.isArray(content)) {
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: options?.placement,
				} as RpcExtensionUIRequest);
			}
			// Component factories are not supported in RPC mode - would need TUI access
		},

		setFooter(_factory: unknown): void {
			// Custom footer not supported in RPC mode - requires TUI access
		},

		setHeader(_factory: unknown): void {
			// Custom header not supported in RPC mode - requires TUI access
		},

		setTitle(title: string): void {
			// Fire and forget - host can implement terminal title control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setTitle",
				title,
			} as RpcExtensionUIRequest);
		},

		async custom() {
			// Custom UI not supported in RPC mode
			return undefined as never;
		},

		pasteToEditor(text: string): void {
			// Paste handling not supported in RPC mode - falls back to setEditorText
			this.setEditorText(text);
		},

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
			} as RpcExtensionUIRequest);
		},

		getEditorText(): string {
			// Synchronous method can't wait for RPC response
			// Host should track editor state locally if needed
			return "";
		},

		async editor(title: string, prefill?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingExtensionRequests.set(id, {
					resolve: (response: RpcExtensionUIResponse) => {
						if ("cancelled" in response && response.cancelled) {
							resolve(undefined);
						} else if ("value" in response) {
							resolve(response.value);
						} else {
							resolve(undefined);
						}
					},
					reject,
				});
				output({ type: "extension_ui_request", id, method: "editor", title, prefill } as RpcExtensionUIRequest);
			});
		},

		addAutocompleteProvider(): void {
			// Autocomplete provider composition is not supported in RPC mode
		},

		setEditorComponent(): void {
			// Custom editor components not supported in RPC mode
		},

		getEditorComponent() {
			// Custom editor components not supported in RPC mode
			return undefined;
		},

		get theme() {
			return theme;
		},

		getAllThemes() {
			return [];
		},

		getTheme(_name: string) {
			return undefined;
		},

		setTheme(_theme: string | Theme) {
			// Theme switching not supported in RPC mode
			return { success: false, error: "Theme switching not supported in RPC mode" };
		},

		getToolsExpanded() {
			// Tool expansion not supported in RPC mode - no TUI
			return false;
		},

		setToolsExpanded(_expanded: boolean) {
			// Tool expansion not supported in RPC mode - no TUI
		},
	});

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		workspaceProjectRoot = (await getWorkspaceStatus(session.sessionManager.getCwd())).projectRoot;
		pendingFileMutations.clear();
		fileAttributions.clear();
		for (const entry of session.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== WORKSPACE_ATTRIBUTION_CUSTOM_TYPE) continue;
			const data = entry.data as { path?: unknown; attribution?: unknown } | undefined;
			if (
				typeof data?.path !== "string" ||
				!isAbsolute(data.path) ||
				!data.attribution ||
				typeof data.attribution !== "object"
			) {
				continue;
			}
			const attribution = data.attribution as Partial<RpcWorkspaceAttribution>;
			if (
				attribution.source !== "local" &&
				attribution.source !== "frontier" &&
				attribution.source !== "direct" &&
				attribution.source !== "manual"
			) {
				continue;
			}
			fileAttributions.set(canonicalizePath(resolve(data.path)), {
				source: attribution.source,
				provider: typeof attribution.provider === "string" ? attribution.provider : undefined,
				model: typeof attribution.model === "string" ? attribution.model : undefined,
				lane:
					attribution.lane === "local" || attribution.lane === "frontier" || attribution.lane === "direct"
						? attribution.lane
						: undefined,
				timestamp: typeof attribution.timestamp === "string" ? attribution.timestamp : undefined,
			});
		}
		await session.bindExtensions({
			uiContext: createExtensionUIContext(),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async (options) => runtimeHost.newSession(options),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, options) => {
					return runtimeHost.switchSession(sessionPath, options);
				},
				reload: async () => {
					await session.reload();
				},
			},
			shutdownHandler: () => {
				shutdownRequested = true;
			},
			onError: (err) => {
				output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
			},
		});

		unsubscribe?.();
		unsubscribeBackpressure?.();
		unsubscribe = session.subscribe((event) => {
			output(toJsonEvent(event));
			if (event.type === "tool_execution_start" && (event.toolName === "edit" || event.toolName === "write")) {
				const args = event.args as Record<string, unknown>;
				const path =
					typeof args.path === "string"
						? args.path
						: typeof args.file_path === "string"
							? args.file_path
							: undefined;
				if (path) {
					const lane = session.klermRouting?.routingState.lane ?? "direct";
					const reference = session.klermRouting?.routingState.selectedTarget;
					const separator = reference?.indexOf("/") ?? -1;
					pendingFileMutations.set(event.toolCallId, {
						path: canonicalizePath(resolve(session.sessionManager.getCwd(), path)),
						attribution: {
							source: lane,
							provider: separator > 0 ? reference?.slice(0, separator) : session.model?.provider,
							model: separator > 0 ? reference?.slice(separator + 1) : session.model?.id,
							lane,
							timestamp: new Date().toISOString(),
						},
					});
				}
			}
			if (event.type === "tool_execution_end") {
				const mutation = pendingFileMutations.get(event.toolCallId);
				pendingFileMutations.delete(event.toolCallId);
				if (mutation && !event.isError) {
					fileAttributions.set(mutation.path, mutation.attribution);
					session.sessionManager.appendCustomEntry(WORKSPACE_ATTRIBUTION_CUSTOM_TYPE, mutation);
					const eventPath = relative(workspaceProjectRoot, mutation.path);
					if (eventPath && !eventPath.startsWith("..") && !isAbsolute(eventPath)) {
						output({ type: "workspace_files_changed", path: eventPath, attribution: mutation.attribution });
					}
				}
			}
			if (event.type === "agent_settled") {
				void checkShutdownRequested();
			}
		});
		unsubscribeBackpressure = session.agent.subscribe(async () => {
			await waitForRawStdoutBackpressure();
		});
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	await rebindSession();
	registerSignalHandlers();

	// Handle a single command
	const handleCommand = async (command: RpcCommand): Promise<RpcResponse | undefined> => {
		const id = command.id;

		switch (command.type) {
			// =================================================================
			// Desktop capability and status
			// =================================================================

			case "desktop_handshake": {
				return success(id, "desktop_handshake", {
					protocolVersion: KLERM_DESKTOP_RPC_PROTOCOL_VERSION,
					klermVersion: VERSION,
					capabilities: {
						commands: [...DESKTOP_COMMANDS],
						events: [...DESKTOP_EVENTS],
					},
					state: getSessionState(),
					routingState: session.klermRouting ? { ...session.klermRouting.routingState } : undefined,
				});
			}

			case "get_local_runtimes": {
				const discover = options.discoverLocalRuntimes ?? discoverLocalRuntimes;
				const runtimes = await discover(undefined, AbortSignal.timeout(5000));
				return success(id, "get_local_runtimes", { runtimes });
			}

			case "get_klerm_config": {
				const controller = session.klermRouting;
				if (!controller) {
					return error(id, "get_klerm_config", "Klerm routing is unavailable.", "ROUTING_UNAVAILABLE");
				}
				return success(id, "get_klerm_config", { ...controller.config });
			}

			case "set_klerm_config": {
				const controller = session.klermRouting;
				if (!controller) {
					return error(id, "set_klerm_config", "Klerm routing is unavailable.", "ROUTING_UNAVAILABLE");
				}
				if (session.isStreaming) {
					return error(
						id,
						"set_klerm_config",
						"Routing configuration cannot change during a task.",
						"TASK_ACTIVE",
					);
				}
				const update: unknown = command.update;
				if (!update || typeof update !== "object" || Array.isArray(update)) {
					return error(id, "set_klerm_config", "A configuration update object is required.", "INVALID_CONFIG");
				}
				const keys = Object.keys(update);
				if (
					keys.length === 0 ||
					keys.some(
						(key) =>
							key !== "routing" &&
							key !== "activeStartLane" &&
							key !== "localModel" &&
							key !== "frontierModel" &&
							key !== "localRole" &&
							key !== "frontierRole" &&
							key !== "localApprovalMode" &&
							key !== "frontierApprovalMode" &&
							key !== "maxDelegationCycles",
					)
				) {
					return error(
						id,
						"set_klerm_config",
						"Only routing, activeStartLane, localModel, frontierModel, localRole, frontierRole, localApprovalMode, frontierApprovalMode, and maxDelegationCycles can be updated.",
						"INVALID_CONFIG",
					);
				}
				const typedUpdate = update as {
					routing?: unknown;
					activeStartLane?: unknown;
					localModel?: unknown;
					frontierModel?: unknown;
					localRole?: unknown;
					frontierRole?: unknown;
					localApprovalMode?: unknown;
					frontierApprovalMode?: unknown;
					maxDelegationCycles?: unknown;
				};
				if (
					typedUpdate.routing !== undefined &&
					typedUpdate.routing !== "off" &&
					typedUpdate.routing !== "local" &&
					typedUpdate.routing !== "frontier" &&
					typedUpdate.routing !== "auto"
				) {
					return error(id, "set_klerm_config", "Invalid routing mode.", "INVALID_CONFIG");
				}
				if (
					typedUpdate.activeStartLane !== undefined &&
					typedUpdate.activeStartLane !== "auto" &&
					typedUpdate.activeStartLane !== "local" &&
					typedUpdate.activeStartLane !== "frontier" &&
					typedUpdate.activeStartLane !== "frontier-local"
				) {
					return error(id, "set_klerm_config", "Invalid active start lane.", "INVALID_CONFIG");
				}
				if (
					(typedUpdate.localRole !== undefined &&
						typedUpdate.localRole !== "planner" &&
						typedUpdate.localRole !== "builder") ||
					(typedUpdate.frontierRole !== undefined &&
						typedUpdate.frontierRole !== "planner" &&
						typedUpdate.frontierRole !== "builder")
				) {
					return error(id, "set_klerm_config", "Invalid worker role.", "INVALID_CONFIG");
				}
				if (
					(typedUpdate.localApprovalMode !== undefined &&
						typedUpdate.localApprovalMode !== "always" &&
						typedUpdate.localApprovalMode !== "risky" &&
						typedUpdate.localApprovalMode !== "never") ||
					(typedUpdate.frontierApprovalMode !== undefined &&
						typedUpdate.frontierApprovalMode !== "always" &&
						typedUpdate.frontierApprovalMode !== "risky" &&
						typedUpdate.frontierApprovalMode !== "never")
				) {
					return error(id, "set_klerm_config", "Invalid builder approval mode.", "INVALID_CONFIG");
				}
				const maxDelegationCycles = typedUpdate.maxDelegationCycles;
				if (
					maxDelegationCycles !== undefined &&
					(typeof maxDelegationCycles !== "number" ||
						!Number.isSafeInteger(maxDelegationCycles) ||
						(maxDelegationCycles !== 0 && (maxDelegationCycles < 3 || maxDelegationCycles > 100)))
				) {
					return error(
						id,
						"set_klerm_config",
						"Delegation cycles must be 3 through 100; use 0 for unlimited.",
						"INVALID_CONFIG",
					);
				}
				if (
					"localModel" in typedUpdate &&
					typedUpdate.localModel !== null &&
					(typeof typedUpdate.localModel !== "string" || typedUpdate.localModel.trim().length === 0)
				) {
					return error(id, "set_klerm_config", "Invalid local model reference.", "INVALID_CONFIG");
				}
				if (
					"frontierModel" in typedUpdate &&
					typedUpdate.frontierModel !== null &&
					(typeof typedUpdate.frontierModel !== "string" || typedUpdate.frontierModel.trim().length === 0)
				) {
					return error(id, "set_klerm_config", "Invalid frontier model reference.", "INVALID_CONFIG");
				}
				try {
					if ("localModel" in typedUpdate) {
						await controller.setLocalModel(
							typeof typedUpdate.localModel === "string" ? typedUpdate.localModel.trim() : undefined,
						);
					}
					if ("frontierModel" in typedUpdate) {
						await controller.setFrontierModel(
							typeof typedUpdate.frontierModel === "string" ? typedUpdate.frontierModel.trim() : undefined,
						);
					}
					if (typeof typedUpdate.routing === "string") await controller.setRoutingMode(typedUpdate.routing);
					if (typeof typedUpdate.activeStartLane === "string") {
						await controller.setActiveStartLane(typedUpdate.activeStartLane);
					}
					if (typedUpdate.localRole === "planner" || typedUpdate.localRole === "builder") {
						await controller.setWorkerRole("local", typedUpdate.localRole);
					}
					if (typedUpdate.frontierRole === "planner" || typedUpdate.frontierRole === "builder") {
						await controller.setWorkerRole("frontier", typedUpdate.frontierRole);
					}
					if (
						typedUpdate.localApprovalMode === "always" ||
						typedUpdate.localApprovalMode === "risky" ||
						typedUpdate.localApprovalMode === "never"
					) {
						await controller.setBuilderApprovalMode("local", typedUpdate.localApprovalMode);
					}
					if (
						typedUpdate.frontierApprovalMode === "always" ||
						typedUpdate.frontierApprovalMode === "risky" ||
						typedUpdate.frontierApprovalMode === "never"
					) {
						await controller.setBuilderApprovalMode("frontier", typedUpdate.frontierApprovalMode);
					}
					if (typeof typedUpdate.maxDelegationCycles === "number") {
						await controller.setMaxDelegationCycles(typedUpdate.maxDelegationCycles);
					}
				} catch (configError) {
					return error(
						id,
						"set_klerm_config",
						configError instanceof Error ? configError.message : String(configError),
						"INVALID_CONFIG",
					);
				}
				return success(id, "set_klerm_config", {
					config: { ...controller.config },
					routingState: { ...controller.routingState },
				});
			}

			case "list_sessions": {
				const sessions = await (options.listSessions?.() ?? SessionManager.listAll());
				const desktopSessions: RpcDesktopSessionInfo[] = sessions.map((storedSession) => ({
					id: storedSession.id,
					sessionToken: storedSession.path,
					name: storedSession.name ?? createSessionTitle(storedSession.firstMessage),
					cwd: storedSession.cwd,
					created: storedSession.created.toISOString(),
					modified: storedSession.modified.toISOString(),
					messageCount: storedSession.messageCount,
					firstMessage: storedSession.firstMessage,
				}));
				return success(id, "list_sessions", { sessions: desktopSessions });
			}

			case "rename_session": {
				if (typeof command.sessionToken !== "string" || command.sessionToken.trim().length === 0) {
					return error(id, "rename_session", "A valid session token is required.", "INVALID_SESSION");
				}
				if (typeof command.name !== "string" || command.name.trim().length === 0) {
					return error(id, "rename_session", "A non-empty session name is required.", "INVALID_SESSION_NAME");
				}
				const sessions = await (options.listSessions?.() ?? SessionManager.listAll());
				const requestedPath = resolve(command.sessionToken);
				const storedSession = sessions.find((candidate) => resolve(candidate.path) === requestedPath);
				if (!storedSession) {
					return error(id, "rename_session", "Session not found.", "SESSION_NOT_FOUND");
				}
				if (
					session.sessionFile &&
					canonicalizePath(resolve(session.sessionFile)) === canonicalizePath(resolve(storedSession.path))
				) {
					return error(id, "rename_session", "Use set_session_name for the active session.", "ACTIVE_SESSION");
				}
				try {
					if (options.renameSession) {
						await options.renameSession(storedSession.path, command.name.trim());
					} else {
						const target = SessionManager.open(storedSession.path);
						if (target.getSessionId() !== storedSession.id) {
							return error(id, "rename_session", "Session changed during rename.", "SESSION_NOT_FOUND");
						}
						target.appendSessionInfo(command.name.trim());
					}
				} catch (renameError) {
					const renameErrorCode = (renameError as { code?: string | number } | undefined)?.code;
					if (renameErrorCode === "ENOENT" || renameErrorCode === errnoConstants.errno.ENOENT) {
						return error(id, "rename_session", "Session not found.", "SESSION_NOT_FOUND");
					}
					return error(
						id,
						"rename_session",
						renameError instanceof Error ? renameError.message : String(renameError),
						"RENAME_FAILED",
					);
				}
				return success(id, "rename_session", { sessionId: storedSession.id });
			}

			case "delete_session": {
				if (session.isStreaming) {
					return error(id, "delete_session", "A session cannot be deleted during a task.", "TASK_ACTIVE");
				}
				if (typeof command.sessionToken !== "string" || command.sessionToken.trim().length === 0) {
					return error(id, "delete_session", "A valid session token is required.", "INVALID_SESSION");
				}
				const sessions = await (options.listSessions?.() ?? SessionManager.listAll());
				const requestedPath = resolve(command.sessionToken);
				const storedSession = sessions.find((candidate) => resolve(candidate.path) === requestedPath);
				if (!storedSession) {
					return error(id, "delete_session", "Session not found.", "SESSION_NOT_FOUND");
				}
				if (session.sessionFile && resolve(session.sessionFile) === requestedPath) {
					return error(id, "delete_session", "The active session cannot be deleted.", "ACTIVE_SESSION");
				}
				try {
					await (options.deleteSession?.(storedSession.path) ?? unlink(storedSession.path));
				} catch (deleteError) {
					const deleteErrorCode = (deleteError as { code?: string | number } | undefined)?.code;
					if (deleteErrorCode === "ENOENT" || deleteErrorCode === errnoConstants.errno.ENOENT) {
						return success(id, "delete_session", { sessionId: storedSession.id });
					}
					return error(
						id,
						"delete_session",
						deleteError instanceof Error ? deleteError.message : String(deleteError),
						"DELETE_FAILED",
					);
				}
				return success(id, "delete_session", { sessionId: storedSession.id });
			}

			case "get_workspace_status": {
				const workspace = await getWorkspaceStatus(session.sessionManager.getCwd());
				workspaceProjectRoot = workspace.projectRoot;
				for (const file of workspace.files) {
					file.attribution =
						fileAttributions.get(canonicalizePath(resolve(workspace.projectRoot, file.path))) ?? file.attribution;
				}
				return success(id, "get_workspace_status", workspace);
			}

			case "get_workspace_diff": {
				if (typeof command.path !== "string") {
					return error(id, "get_workspace_diff", "A workspace-relative file path is required.", "INVALID_PATH");
				}
				return success(
					id,
					"get_workspace_diff",
					await getWorkspaceDiff(session.sessionManager.getCwd(), command.path),
				);
			}

			case "read_workspace_file": {
				if (typeof command.path !== "string") {
					return error(id, "read_workspace_file", "A workspace-relative file path is required.", "INVALID_PATH");
				}
				return success(
					id,
					"read_workspace_file",
					await readWorkspaceTextFile(session.sessionManager.getCwd(), command.path),
				);
			}

			case "write_workspace_file": {
				if (typeof command.path !== "string" || typeof command.content !== "string") {
					return error(id, "write_workspace_file", "A file path and text content are required.", "INVALID_FILE");
				}
				await writeWorkspaceTextFile(session.sessionManager.getCwd(), command.path, command.content);
				const workspace = await getWorkspaceStatus(session.sessionManager.getCwd());
				workspaceProjectRoot = workspace.projectRoot;
				const attribution = { source: "manual" as const, timestamp: new Date().toISOString() };
				const absolutePath = canonicalizePath(resolve(workspace.projectRoot, command.path));
				fileAttributions.set(absolutePath, attribution);
				session.sessionManager.appendCustomEntry(WORKSPACE_ATTRIBUTION_CUSTOM_TYPE, {
					path: absolutePath,
					attribution,
				});
				output({ type: "workspace_files_changed", path: command.path, attribution });
				return success(id, "write_workspace_file", { path: command.path });
			}

			case "get_available_editors": {
				return success(id, "get_available_editors", { editors: await getAvailableEditors() });
			}

			case "open_workspace_editor": {
				if (command.editor !== "zed" && command.editor !== "vscode" && command.editor !== "vim") {
					return error(id, "open_workspace_editor", "Unsupported editor.", "INVALID_EDITOR");
				}
				await openWorkspaceEditor(session.sessionManager.getCwd(), command.editor as RpcEditorInfo["id"]);
				return success(id, "open_workspace_editor", { editor: command.editor });
			}

			case "get_running_services": {
				return success(id, "get_running_services", {
					services: await getRunningServices(session.sessionManager.getCwd()),
				});
			}

			case "open_local_url": {
				if (typeof command.url !== "string") {
					return error(id, "open_local_url", "A local service URL is required.", "INVALID_URL");
				}
				openLocalUrl(command.url);
				return success(id, "open_local_url", { url: command.url });
			}

			case "get_mcp_status": {
				return success(id, "get_mcp_status", getMcpStatusPayload());
			}

			case "add_mcp_server": {
				if (session.isStreaming) {
					return error(id, "add_mcp_server", "MCP servers cannot change during a task.", "TASK_ACTIVE");
				}
				const update = command.server;
				if (!update || typeof update !== "object" || Array.isArray(update)) {
					return error(id, "add_mcp_server", "An MCP server update object is required.", "INVALID_MCP_SERVER");
				}
				const scope: SettingsScope = update.scope === "project" ? "project" : "global";
				if (update.scope !== undefined && update.scope !== "global" && update.scope !== "project") {
					return error(id, "add_mcp_server", "MCP scope must be global or project.", "INVALID_MCP_SERVER");
				}
				if (scope === "project" && !session.settingsManager.isProjectTrusted()) {
					return error(
						id,
						"add_mcp_server",
						"Project is not trusted; refusing to write project MCP settings.",
						"PROJECT_NOT_TRUSTED",
					);
				}
				const name = typeof update.name === "string" ? update.name.trim() : "";
				if (!/^[A-Za-z0-9_-]+$/.test(name)) {
					return error(
						id,
						"add_mcp_server",
						"MCP server names may contain only letters, numbers, underscores, and hyphens.",
						"INVALID_MCP_SERVER",
					);
				}
				if (update.transport !== "stdio" && update.transport !== "http" && update.transport !== "sse") {
					return error(id, "add_mcp_server", "MCP transport must be stdio, http, or sse.", "INVALID_MCP_SERVER");
				}
				let server: McpServerSettings;
				const enabled = update.enabled ?? true;
				if (typeof enabled !== "boolean") {
					return error(id, "add_mcp_server", "MCP enabled must be a boolean.", "INVALID_MCP_SERVER");
				}
				const existing = session.settingsManager.getMcpServersForScope(scope)[name];
				const appearance = parseMcpAppearance(update, existing);
				if (typeof appearance === "string") {
					return error(id, "add_mcp_server", appearance, "INVALID_MCP_SERVER");
				}
				if (update.transport === "stdio") {
					const commandValue = typeof update.command === "string" ? update.command.trim() : "";
					if (!commandValue) {
						return error(id, "add_mcp_server", "A stdio MCP command is required.", "INVALID_MCP_SERVER");
					}
					if (update.url !== undefined || update.headers !== undefined) {
						return error(
							id,
							"add_mcp_server",
							"Stdio MCP servers cannot set URL or headers.",
							"INVALID_MCP_SERVER",
						);
					}
					if (
						update.args !== undefined &&
						(!Array.isArray(update.args) || !update.args.every((argument) => typeof argument === "string"))
					) {
						return error(id, "add_mcp_server", "MCP stdio args must be strings.", "INVALID_MCP_SERVER");
					}
					if (
						update.env !== undefined &&
						(update.env === null ||
							typeof update.env !== "object" ||
							Array.isArray(update.env) ||
							Object.entries(update.env).some(
								([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string",
							))
					) {
						return error(
							id,
							"add_mcp_server",
							"MCP environment names and values must be strings.",
							"INVALID_MCP_SERVER",
						);
					}
					server = {
						transport: "stdio",
						command: commandValue,
						args: normalizeStdioArgs(update.args ?? []),
						...(update.env !== undefined
							? {
									env: {
										...(existing?.transport !== "http" && existing?.transport !== "sse" ? existing.env : {}),
										...Object.fromEntries(Object.entries(update.env).filter(([, value]) => value.length > 0)),
									},
								}
							: existing?.transport !== "http" && existing?.transport !== "sse" && existing?.env
								? { env: existing.env }
								: {}),
						enabled,
						...appearance,
					};
				} else {
					if (update.command !== undefined || update.args !== undefined || update.env !== undefined) {
						return error(
							id,
							"add_mcp_server",
							"HTTP and SSE MCP servers cannot set command, args, or environment.",
							"INVALID_MCP_SERVER",
						);
					}
					let endpoint: URL;
					try {
						endpoint = new URL(typeof update.url === "string" ? update.url.trim() : "");
						if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
							throw new Error("unsupported protocol");
					} catch {
						return error(
							id,
							"add_mcp_server",
							"MCP endpoint URL must be a valid http or https URL.",
							"INVALID_MCP_SERVER",
						);
					}
					if (endpoint.username || endpoint.password) {
						return error(
							id,
							"add_mcp_server",
							"MCP endpoint URL cannot contain credentials.",
							"INVALID_MCP_SERVER",
						);
					}
					if (
						update.headers !== undefined &&
						(update.headers === null ||
							typeof update.headers !== "object" ||
							Array.isArray(update.headers) ||
							Object.values(update.headers).some((value) => typeof value !== "string"))
					) {
						return error(id, "add_mcp_server", "MCP headers must be string values.", "INVALID_MCP_SERVER");
					}
					const headers = update.headers ?? {};
					if (hasSecretHeader(headers)) {
						return error(
							id,
							"add_mcp_server",
							"Desktop MCP setup cannot store credential-like headers.",
							"MCP_SECRET_REJECTED",
						);
					}
					server = {
						transport: update.transport,
						url: endpoint.toString(),
						...(Object.keys(headers).length > 0
							? { headers }
							: existing?.transport !== "stdio" && existing?.headers
								? { headers: existing.headers }
								: {}),
						enabled,
						...appearance,
					};
				}
				session.settingsManager.setMcpServer(name, server, scope);
				await session.settingsManager.flush();
				return success(id, "add_mcp_server", {
					name,
					scope,
					reloadRequired: true,
					status: getMcpStatusPayload(),
				});
			}

			case "reload_mcp_servers": {
				if (session.isStreaming) {
					return error(id, "reload_mcp_servers", "MCP servers cannot reload during a task.", "TASK_ACTIVE");
				}
				await session.reload();
				return success(id, "reload_mcp_servers", getMcpStatusPayload());
			}

			case "get_desktop_settings": {
				return success(id, "get_desktop_settings", await getDesktopSettingsPayload());
			}

			case "set_desktop_appearance": {
				if (command.appearance !== "dark" && command.appearance !== "light" && command.appearance !== "system") {
					return error(
						id,
						"set_desktop_appearance",
						"Appearance must be dark, light, or system.",
						"INVALID_SETTINGS",
					);
				}
				session.settingsManager.setDesktopAppearance(command.appearance);
				await session.settingsManager.flush();
				return success(id, "set_desktop_appearance", await getDesktopSettingsPayload());
			}

			case "upsert_klerm_profile": {
				const profile = normalizeProfile(command.profile);
				if (!profile) return error(id, "upsert_klerm_profile", "Invalid Klerm profile.", "INVALID_PROFILE");
				session.settingsManager.upsertKlermProfile(profile);
				await session.settingsManager.flush();
				return success(id, "upsert_klerm_profile", await getDesktopSettingsPayload());
			}

			case "delete_klerm_profile": {
				if (typeof command.profileId !== "string" || command.profileId.trim().length === 0) {
					return error(id, "delete_klerm_profile", "A profile id is required.", "INVALID_PROFILE");
				}
				session.settingsManager.deleteKlermProfile(command.profileId);
				await session.settingsManager.flush();
				return success(id, "delete_klerm_profile", await getDesktopSettingsPayload());
			}

			case "assign_klerm_profile": {
				if (command.lane !== "local" && command.lane !== "frontier") {
					return error(id, "assign_klerm_profile", "Lane must be local or frontier.", "INVALID_PROFILE");
				}
				const profileId = command.profileId === null || command.profileId === "" ? undefined : command.profileId;
				try {
					session.settingsManager.assignKlermProfile(command.lane, profileId);
				} catch (assignError) {
					return error(
						id,
						"assign_klerm_profile",
						assignError instanceof Error ? assignError.message : String(assignError),
						"INVALID_PROFILE",
					);
				}
				await session.settingsManager.flush();
				return success(id, "assign_klerm_profile", await getDesktopSettingsPayload());
			}

			case "add_custom_model": {
				const model = command.model;
				if (!model || typeof model !== "object") {
					return error(id, "add_custom_model", "A custom model object is required.", "INVALID_MODEL");
				}
				if (!isCustomModelApi(model.api)) {
					return error(id, "add_custom_model", "Unsupported custom model API.", "INVALID_MODEL");
				}
				try {
					await upsertCustomModel(modelsPath(), {
						provider: model.provider,
						id: model.id,
						name: model.name,
						api: model.api,
						baseUrl: model.baseUrl,
						apiKey: typeof model.apiKey === "string" ? model.apiKey : undefined,
					});
					await session.modelRuntime.refresh({ allowNetwork: false });
				} catch (modelError) {
					return error(
						id,
						"add_custom_model",
						modelError instanceof Error ? modelError.message : String(modelError),
						"INVALID_MODEL",
					);
				}
				return success(id, "add_custom_model", await getDesktopSettingsPayload());
			}

			case "remove_custom_model": {
				if (typeof command.provider !== "string" || typeof command.modelId !== "string") {
					return error(id, "remove_custom_model", "Provider and id are required.", "INVALID_MODEL");
				}
				await removeCustomModel(modelsPath(), command.provider, command.modelId);
				await session.modelRuntime.refresh({ allowNetwork: false });
				return success(id, "remove_custom_model", await getDesktopSettingsPayload());
			}

			case "get_provider_status": {
				const discover = options.discoverLocalRuntimes ?? discoverLocalRuntimes;
				const runtimes = await discover(undefined, AbortSignal.timeout(5000)).catch(() => []);
				const providers = getProviderAccountStatus(
					session.modelRuntime,
					runtimes,
					await customProviderModelIds(modelsPath()),
				);
				return success(id, "get_provider_status", { providers });
			}

			case "connect_provider": {
				const account = command.account;
				if (!account || typeof account !== "object") {
					return error(id, "connect_provider", "A provider account object is required.", "INVALID_PROVIDER");
				}
				try {
					await connectProviderAccount(session.modelRuntime, modelsPath(), {
						provider: account.provider,
						apiKey: typeof account.apiKey === "string" ? account.apiKey : undefined,
						baseUrl: typeof account.baseUrl === "string" ? account.baseUrl : undefined,
					});
				} catch (providerError) {
					return error(
						id,
						"connect_provider",
						providerError instanceof Error ? providerError.message : String(providerError),
						"INVALID_PROVIDER",
					);
				}
				const discover = options.discoverLocalRuntimes ?? discoverLocalRuntimes;
				const runtimes = await discover(undefined, AbortSignal.timeout(5000)).catch(() => []);
				const providers = getProviderAccountStatus(
					session.modelRuntime,
					runtimes,
					await customProviderModelIds(modelsPath()),
				);
				return success(id, "connect_provider", { providers });
			}

			case "disconnect_provider": {
				if (typeof command.provider !== "string" || !command.provider.trim()) {
					return error(id, "disconnect_provider", "A provider id is required.", "INVALID_PROVIDER");
				}
				try {
					await disconnectProviderAccount(session.modelRuntime, modelsPath(), command.provider);
				} catch (providerError) {
					return error(
						id,
						"disconnect_provider",
						providerError instanceof Error ? providerError.message : String(providerError),
						"INVALID_PROVIDER",
					);
				}
				return success(id, "disconnect_provider", { providers: await refreshProviderAccounts() });
			}

			case "connect_provider_oauth": {
				if (typeof command.provider !== "string" || !command.provider.trim()) {
					return error(id, "connect_provider_oauth", "A provider id is required.", "INVALID_PROVIDER");
				}
				const providerId = command.provider.trim();
				const provider = session.modelRuntime.getProvider(providerId);
				if (!provider) {
					return error(id, "connect_provider_oauth", `Unknown provider: ${providerId}`, "INVALID_PROVIDER");
				}
				if (!provider.auth.oauth?.login) {
					return error(
						id,
						"connect_provider_oauth",
						`${provider.name} does not support OAuth login. Use an API key instead.`,
						"OAUTH_UNSUPPORTED",
					);
				}
				if (oauthAbort) {
					return error(id, "connect_provider_oauth", "An OAuth login is already running.", "OAUTH_BUSY");
				}
				const controller = new AbortController();
				oauthAbort = controller;
				const signal = controller.signal;
				const oauthNotify = (event: AuthEvent): void => {
					if (event.type === "auth_url") {
						output({
							type: "extension_ui_request",
							id: crypto.randomUUID(),
							method: "provider_oauth_notify",
							notify: { kind: "auth_url", url: event.url, instructions: event.instructions },
						} as RpcExtensionUIRequest);
					} else if (event.type === "device_code") {
						output({
							type: "extension_ui_request",
							id: crypto.randomUUID(),
							method: "provider_oauth_notify",
							notify: {
								kind: "device_code",
								userCode: event.userCode,
								verificationUri: event.verificationUri,
								message: `Expires in ${event.expiresInSeconds ?? "?"}s.`,
							},
						} as RpcExtensionUIRequest);
					} else if (event.type === "info") {
						output({
							type: "extension_ui_request",
							id: crypto.randomUUID(),
							method: "provider_oauth_notify",
							notify: { kind: "info", message: event.message },
						} as RpcExtensionUIRequest);
					} else {
						output({
							type: "extension_ui_request",
							id: crypto.randomUUID(),
							method: "provider_oauth_notify",
							notify: { kind: "progress", message: event.message },
						} as RpcExtensionUIRequest);
					}
				};
				const oauthPrompt = (prompt: AuthPrompt): Promise<string> => {
					const requestId = crypto.randomUUID();
					return new Promise<string>((resolve, reject) => {
						if (signal.aborted) {
							reject(signal.reason);
							return;
						}
						const onAbort = (): void => {
							pendingExtensionRequests.delete(requestId);
							reject(signal.reason);
						};
						signal.addEventListener("abort", onAbort, { once: true });
						pendingExtensionRequests.set(requestId, {
							resolve: (response: RpcExtensionUIResponse) => {
								signal.removeEventListener("abort", onAbort);
								if ("cancelled" in response && response.cancelled) reject(new Error("Login cancelled"));
								else if ("value" in response) resolve(response.value);
								else reject(new Error("Login cancelled"));
							},
							reject: (cause: Error) => {
								signal.removeEventListener("abort", onAbort);
								reject(cause);
							},
						});
						output({
							type: "extension_ui_request",
							id: requestId,
							method: "provider_oauth_prompt",
							prompt: {
								promptType: prompt.type,
								message: prompt.message,
								options:
									prompt.type === "select"
										? prompt.options.map((option) => ({
												id: option.id,
												label: option.label,
												description: option.description,
											}))
										: undefined,
							},
						} as RpcExtensionUIRequest);
					});
				};
				try {
					await session.modelRuntime.login(providerId, "oauth", {
						signal,
						prompt: oauthPrompt,
						notify: oauthNotify,
					});
					await session.modelRuntime.refresh({ allowNetwork: false });
				} catch (oauthError) {
					if (signal.aborted) {
						return error(id, "connect_provider_oauth", "OAuth login cancelled.", "OAUTH_CANCELLED");
					}
					return error(
						id,
						"connect_provider_oauth",
						oauthError instanceof Error ? oauthError.message : String(oauthError),
						"OAUTH_FAILED",
					);
				} finally {
					if (oauthAbort === controller) oauthAbort = undefined;
				}
				return success(id, "connect_provider_oauth", { providers: await refreshProviderAccounts() });
			}

			case "cancel_provider_oauth": {
				if (oauthAbort) {
					oauthAbort.abort(new Error("Login cancelled"));
					oauthAbort = undefined;
					return success(id, "cancel_provider_oauth", { cancelled: true });
				}
				return success(id, "cancel_provider_oauth", { cancelled: false });
			}

			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				const mcpMentions: unknown = command.mcpMentions;
				if (
					mcpMentions !== undefined &&
					(!Array.isArray(mcpMentions) ||
						mcpMentions.length > 20 ||
						mcpMentions.some(
							(mention) =>
								typeof mention !== "object" ||
								mention === null ||
								Array.isArray(mention) ||
								typeof (mention as Record<string, unknown>).serverName !== "string" ||
								!/^[A-Za-z0-9_-]+$/.test((mention as Record<string, unknown>).serverName as string) ||
								((mention as Record<string, unknown>).toolName !== undefined &&
									typeof (mention as Record<string, unknown>).toolName !== "string"),
						))
				) {
					return error(id, "prompt", "Invalid MCP mention selection.", "INVALID_MCP_MENTION");
				}
				// Start prompt handling immediately, but emit the authoritative response only after
				// prompt preflight succeeds. Queued and immediately handled prompts also count as success.
				let preflightSucceeded = false;
				void session
					.prompt(command.message, {
						images: command.images,
						mcpMentions: command.mcpMentions,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
						preflightResult: (didSucceed) => {
							if (didSucceed) {
								if (command.displayMessage && command.displayMessage !== command.message) {
									session.sessionManager.appendCustomEntry("klerm-desktop-display-prompt", {
										text: command.displayMessage,
									});
								}
								preflightSucceeded = true;
								output(success(id, "prompt"));
							}
						},
					})
					.catch((e) => {
						if (!preflightSucceeded) {
							output(error(id, "prompt", e.message));
						}
					});
				return undefined;
			}

			case "steer": {
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}

			case "follow_up": {
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}

			case "abort": {
				await session.abort();
				return success(id, "abort");
			}

			case "new_session": {
				const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
				const result = await runtimeHost.newSession(options);
				return success(id, "new_session", result);
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				return success(id, "get_state", getSessionState());
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = session.modelRuntime.getAvailableSnapshot();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return success(id, "cycle_model", null);
				}
				return success(id, "cycle_model", result);
			}

			case "get_available_models": {
				const models = session.modelRuntime.getAvailableSnapshot();
				return success(id, "get_available_models", { models });
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				if (command.lane !== undefined && command.lane !== "local" && command.lane !== "frontier") {
					return error(id, "set_thinking_level", "Invalid Klerm thinking lane.", "INVALID_CONFIG");
				}
				if (command.lane) {
					const setting = await session.setKlermThinkingLevel(command.lane, command.level);
					return success(id, "set_thinking_level", setting);
				}
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return success(id, "cycle_thinking_level", null);
				}
				return success(id, "cycle_thinking_level", { level });
			}

			case "get_available_thinking_levels": {
				if (command.lane !== undefined && command.lane !== "local" && command.lane !== "frontier") {
					return error(id, "get_available_thinking_levels", "Invalid Klerm thinking lane.", "INVALID_CONFIG");
				}
				if (command.lane) {
					return success(id, "get_available_thinking_levels", session.getKlermThinkingSetting(command.lane));
				}
				const levels = session.getAvailableThinkingLevels();
				return success(id, "get_available_thinking_levels", { levels });
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return success(id, "set_follow_up_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return success(id, "set_auto_compaction");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const eventResult = await session.extensionRunner.emitUserBash({
					type: "user_bash",
					command: command.command,
					excludeFromContext: command.excludeFromContext ?? false,
					cwd: session.sessionManager.getCwd(),
				});

				if (eventResult?.result) {
					session.recordBashResult(command.command, eventResult.result, {
						excludeFromContext: command.excludeFromContext,
					});
					return success(id, "bash", eventResult.result);
				}

				const result = await session.executeBash(command.command, undefined, {
					excludeFromContext: command.excludeFromContext,
					id,
					operations: eventResult?.operations,
				});
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return success(id, "abort_bash");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath);
				return success(id, "export_html", { path });
			}

			case "switch_session": {
				if (typeof command.sessionPath !== "string" || command.sessionPath.trim().length === 0) {
					return error(id, "switch_session", "A valid session token is required.", "INVALID_SESSION");
				}
				const sessions = await (options.listSessions?.() ?? SessionManager.listAll());
				const requestedPath = canonicalizePath(resolve(command.sessionPath));
				const storedSession = sessions.find(
					(candidate) => canonicalizePath(resolve(candidate.path)) === requestedPath,
				);
				if (!storedSession) {
					return error(id, "switch_session", "Session not found.", "SESSION_NOT_FOUND");
				}
				const result = await runtimeHost.switchSession(storedSession.path);
				return success(id, "switch_session", result);
			}

			case "fork": {
				const result = await runtimeHost.fork(command.entryId);
				return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "clone": {
				const leafId = session.sessionManager.getLeafId();
				if (!leafId) {
					return error(id, "clone", "Cannot clone session: no current entry selected");
				}
				const result = await runtimeHost.fork(leafId, { position: "at" });
				return success(id, "clone", { cancelled: result.cancelled });
			}

			case "get_fork_messages": {
				const messages = session.getUserMessagesForForking();
				return success(id, "get_fork_messages", { messages });
			}

			case "get_entries": {
				const sessionManager = session.sessionManager;
				let entries = sessionManager.getEntries();
				if (command.since !== undefined) {
					const sinceIndex = entries.findIndex((e) => e.id === command.since);
					if (sinceIndex === -1) {
						return error(id, "get_entries", `Entry not found: ${command.since}`);
					}
					entries = entries.slice(sinceIndex + 1);
				}
				return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
			}

			case "get_tree": {
				const sessionManager = session.sessionManager;
				return success(id, "get_tree", { tree: sessionManager.getTree(), leafId: sessionManager.getLeafId() });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				session.setSessionName(name);
				return success(id, "set_session_name");
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages });
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				const commands: RpcSlashCommand[] = [];

				for (const command of session.extensionRunner.getRegisteredCommands()) {
					commands.push({
						name: command.invocationName,
						description: command.description,
						source: "extension",
						sourceInfo: command.sourceInfo,
					});
				}

				for (const template of session.promptTemplates) {
					commands.push({
						name: template.name,
						description: template.description,
						source: "prompt",
						sourceInfo: template.sourceInfo,
					});
				}

				for (const skill of session.resourceLoader.getSkills().skills) {
					commands.push({
						name: `skill:${skill.name}`,
						description: skill.description,
						source: "skill",
						sourceInfo: skill.sourceInfo,
					});
				}

				return success(id, "get_commands", { commands });
			}

			default: {
				const unknownCommand = command as { type: string };
				return error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	};

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 * Called after handling each command when waiting for the next command.
	 */
	let detachInput = () => {};

	async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
		if (shuttingDown) {
			process.exit(exitCode);
		}
		shuttingDown = true;
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		unsubscribe?.();
		unsubscribeBackpressure?.();
		await runtimeHost.dispose();
		detachInput();
		process.stdin.pause();
		if (signal !== "SIGTERM") {
			await flushRawStdout();
		}
		process.exit(exitCode);
	}

	async function checkShutdownRequested(): Promise<void> {
		if (!shutdownRequested) return;
		await shutdown();
	}

	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			output(
				error(
					undefined,
					"parse",
					`Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
				),
			);
			await waitForRawStdoutBackpressure();
			return;
		}

		// Handle extension UI responses
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"type" in parsed &&
			parsed.type === "extension_ui_response"
		) {
			const response = parsed as RpcExtensionUIResponse;
			const pending = pendingExtensionRequests.get(response.id);
			if (pending) {
				pendingExtensionRequests.delete(response.id);
				pending.resolve(response);
			}
			return;
		}

		const command = parsed as RpcCommand;
		try {
			const response = await handleCommand(command);
			if (response) {
				output(response);
				await waitForRawStdoutBackpressure();
			}
			await checkShutdownRequested();
		} catch (commandError: unknown) {
			const commandErrorMessage = commandError instanceof Error ? commandError.message : String(commandError);
			const safeCommandErrorMessage = command.type.includes("mcp")
				? redactMcpSecretText(commandErrorMessage)
				: commandErrorMessage;
			output(error(command.id, command.type, safeCommandErrorMessage));
			await waitForRawStdoutBackpressure();
		}
	};

	const onInputEnd = () => {
		void shutdown();
	};
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
			void handleInputLine(line);
		});
		return () => {
			detachJsonl();
			process.stdin.off("end", onInputEnd);
		};
	})();

	// Keep process alive forever
	return new Promise(() => {});
}
