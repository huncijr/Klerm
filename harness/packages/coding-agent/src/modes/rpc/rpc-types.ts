/**
 * RPC protocol types for headless operation.
 *
 * Commands are sent as JSON lines on stdin.
 * Responses and events are emitted as JSON lines on stdout.
 */

import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { SessionStats } from "../../core/agent-session.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import type { SessionEntry, SessionTreeNode } from "../../core/session-manager.ts";
import type {
	DesktopAppearance,
	McpServerColor,
	McpServerTransport,
	SettingsScope,
} from "../../core/settings-manager.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import type { BrowserAvailability } from "../../klerm/browser-agent.ts";
import type { BrowserRunPublicState } from "../../klerm/browser-run-coordinator.ts";
import type {
	CodingHarnessDiscoveryResult,
	CodingHarnessKind,
	CodingHarnessSetup,
	CodingHarnessSlots,
} from "../../klerm/coding-harness-setup.ts";
import type {
	KlermActiveStartLane,
	KlermBuilderApprovalMode,
	KlermConfig,
	KlermRoutingMode,
	KlermWorkerRole,
} from "../../klerm/config.ts";
import type { CustomModelEntry } from "../../klerm/custom-models.ts";
import type { KanbanRegistry } from "../../klerm/kanban.ts";
import type { LocalRuntimeDiscoveryResult } from "../../klerm/local-runtime-discovery.ts";
import type { McpErrorKind, McpPromptMention, McpServerState, McpToolCapability } from "../../klerm/mcp/runtime.ts";
import type { PersonalBotConversation } from "../../klerm/personal-bot-conversations.ts";
import type { PersonalBot, PersonalBotRegistry } from "../../klerm/personal-bots.ts";
import type { KlermProfile, KlermProfileState } from "../../klerm/profiles.ts";
import type { KlermProject, ProjectSessionExtract } from "../../klerm/projects.ts";
import type { KlermRoutingState, KlermWorkerLane } from "../../klerm/router/types.ts";

export const KLERM_DESKTOP_RPC_PROTOCOL_VERSION = 1;

export interface RpcDesktopHandshake {
	protocolVersion: number;
	klermVersion: string;
	capabilities: {
		commands: string[];
		events: string[];
	};
	state: RpcSessionState;
	routingState?: KlermRoutingState;
}

export interface RpcDesktopSessionInfo {
	id: string;
	sessionToken: string;
	name?: string;
	cwd: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
	projectId?: string;
}

export interface RpcProject extends KlermProject {
	sessionCount: number;
}

export interface RpcProjects {
	version: number;
	defaultProjectId: string;
	projects: RpcProject[];
}

export interface RpcWorkspaceAttribution {
	source: "local" | "frontier" | "direct" | "manual" | "external";
	provider?: string;
	model?: string;
	lane?: "local" | "frontier" | "direct";
	timestamp?: string;
}

export interface RpcWorkspaceFileStatus {
	path: string;
	oldPath?: string;
	indexStatus: string;
	worktreeStatus: string;
	status: "modified" | "added" | "deleted" | "renamed" | "untracked";
	staged: boolean;
	attribution: RpcWorkspaceAttribution;
}

export interface RpcWorkspaceStatus {
	workspaceRoot: string;
	projectRoot: string;
	gitRoot?: string;
	isGit: boolean;
	trusted?: boolean;
	files: RpcWorkspaceFileStatus[];
	gitInitializationRecommendation?: string;
}

export interface RpcProjectTrustStatus {
	decision: boolean | null;
}

export interface RpcEditorInfo {
	id: "zed" | "vscode" | "vim";
	label: string;
	available: boolean;
}

export interface RpcRunningService {
	id: string;
	kind: "backend" | "listener";
	processName: string;
	pid: number;
	cwd: string;
	port?: number;
	url?: string;
}

export interface RpcMcpToolStatus {
	name: string;
	serverName: string;
	remoteName: string;
	title?: string;
	description?: string;
	capability: McpToolCapability;
}

export interface RpcMcpServerStatus {
	name: string;
	transport: McpServerTransport;
	enabled: boolean;
	state: McpServerState;
	tools: RpcMcpToolStatus[];
	skippedTools: string[];
	error?: string;
	errorKind?: McpErrorKind;
	label?: string;
	color?: McpServerColor;
	command?: string;
	args?: string[];
	url?: string;
	envKeys?: string[];
}

export interface RpcMcpStatus {
	servers: RpcMcpServerStatus[];
	toolCount: number;
	reloadRequired: boolean;
}

export interface RpcMcpServerUpdate {
	name: string;
	transport: McpServerTransport;
	scope?: SettingsScope;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	enabled?: boolean;
	label?: string;
	color?: McpServerColor;
}

export interface RpcKlermConfigUpdate {
	routing?: KlermRoutingMode;
	activeStartLane?: KlermActiveStartLane;
	localModel?: string | null;
	frontierModel?: string | null;
	localRole?: KlermWorkerRole;
	frontierRole?: KlermWorkerRole;
	localApprovalMode?: KlermBuilderApprovalMode;
	frontierApprovalMode?: KlermBuilderApprovalMode;
	maxDelegationCycles?: number;
}

export interface RpcDesktopSettings {
	appearance: DesktopAppearance;
	agentDir: string;
	klermVersion: string;
	cwd: string;
	profiles: KlermProfileState;
	customModels: CustomModelEntry[];
	shortcuts: Array<{ action: string; keys: string }>;
}

export interface RpcPersonalBotProfileDraft {
	profile: KlermProfile;
	model: string;
}

export interface RpcPersonalBotMemoryDraft {
	text: string;
	model: string;
}

export interface RpcCustomModelUpdate {
	provider: string;
	id: string;
	name?: string;
	api: string;
	baseUrl: string;
	apiKey?: string;
}

export interface RpcProviderAccount {
	id: string;
	label: string;
	models: string[];
	configured: boolean;
	source?: string;
	local: boolean;
	detected?: string;
	defaultEndpoint?: string;
	supportsOauth: boolean;
}

export interface RpcProviderOauthNotify {
	kind: "auth_url" | "device_code" | "info" | "progress";
	url?: string;
	instructions?: string;
	userCode?: string;
	verificationUri?: string;
	message?: string;
}

export interface RpcProviderOauthPrompt {
	promptType: "text" | "secret" | "select" | "manual_code";
	message: string;
	options?: Array<{ id: string; label: string; description?: string }>;
}

export interface RpcProviderConnect {
	provider: string;
	apiKey?: string;
	baseUrl?: string;
}

export type RpcCodingHarnessSetup = CodingHarnessSetup;
export type RpcCodingHarnessSlots = CodingHarnessSlots;
export type RpcKanbanRegistry = KanbanRegistry;
export type RpcBrowserAvailability = BrowserAvailability;
export type RpcBrowserRunState = BrowserRunPublicState;

// ============================================================================
// RPC Commands (stdin)
// ============================================================================

export type RpcCommand =
	// Desktop capability and status
	| { id?: string; type: "desktop_handshake" }
	| { id?: string; type: "get_local_runtimes" }
	| { id?: string; type: "get_coding_harness_setup" }
	| { id?: string; type: "refresh_coding_harness_models"; kind: CodingHarnessKind }
	| { id?: string; type: "set_coding_harness_slots"; slots: RpcCodingHarnessSlots }
	| { id?: string; type: "get_klerm_config" }
	| { id?: string; type: "set_klerm_config"; update: RpcKlermConfigUpdate }
	| { id?: string; type: "list_sessions" }
	| { id?: string; type: "get_projects" }
	| { id?: string; type: "get_kanban_registry" }
	| { id?: string; type: "set_kanban_registry"; registry: RpcKanbanRegistry }
	| { id?: string; type: "run_kanban_task"; boardId: string; taskId: string }
	| { id?: string; type: "stop_kanban_task"; boardId: string; taskId: string }
	| { id?: string; type: "get_browser_availability" }
	| { id?: string; type: "get_browser_run" }
	| {
			id?: string;
			type: "start_browser_run";
			agentId: string;
			model: string;
			prompt: string;
			startUrl: string;
			maxSteps?: number;
	  }
	| {
			id?: string;
			type: "resolve_browser_origin";
			runId: string;
			approvalId: string;
			decision: "approved" | "denied";
			scope?: "allow_once" | "current_run";
	  }
	| { id?: string; type: "stop_browser_run"; runId: string }
	| { id?: string; type: "get_personal_bots" }
	| { id?: string; type: "upsert_personal_bot"; bot: PersonalBot }
	| { id?: string; type: "generate_personal_bot_profile"; botId: string; brief: string; style?: string }
	| { id?: string; type: "generate_personal_bot_memory"; model: string; brief: string }
	| { id?: string; type: "delete_personal_bot"; botId: string }
	| { id?: string; type: "get_personal_bot_conversation"; botId: string }
	| { id?: string; type: "prompt_personal_bot"; botId: string; message: string }
	| { id?: string; type: "abort_personal_bot"; botId: string }
	| { id?: string; type: "reset_personal_bot_conversation"; botId: string }
	| { id?: string; type: "delete_personal_bot_summary"; botId: string; summaryId: string }
	| { id?: string; type: "create_project"; name: string }
	| { id?: string; type: "rename_project"; projectId: string; name: string }
	| { id?: string; type: "delete_project"; projectId: string }
	| { id?: string; type: "move_session_to_project"; sessionId: string; projectId?: string }
	| { id?: string; type: "refresh_project_summary"; projectId: string }
	| { id?: string; type: "ask_project"; projectId: string; question: string }
	| {
			id?: string;
			type: "import_legacy_desktop_projects";
			projects: Array<{ id: string; name: string }>;
			sessionProjects: Record<string, string>;
	  }
	| { id?: string; type: "rename_session"; sessionToken: string; name: string }
	| { id?: string; type: "delete_session"; sessionToken: string }
	| { id?: string; type: "get_workspace_status" }
	| { id?: string; type: "initialize_git_repository" }
	| { id?: string; type: "get_github_status" }
	| { id?: string; type: "login_github" }
	| { id?: string; type: "get_project_trust" }
	| { id?: string; type: "set_project_trust"; trusted: boolean }
	| { id?: string; type: "list_workspace_files" }
	| { id?: string; type: "get_workspace_diff"; path: string }
	| { id?: string; type: "read_workspace_file"; path: string }
	| { id?: string; type: "write_workspace_file"; path: string; content: string }
	| { id?: string; type: "get_available_editors" }
	| { id?: string; type: "open_workspace_editor"; editor: RpcEditorInfo["id"] }
	| { id?: string; type: "get_running_services" }
	| { id?: string; type: "open_local_url"; url: string }
	| { id?: string; type: "get_mcp_status" }
	| { id?: string; type: "add_mcp_server"; server: RpcMcpServerUpdate }
	| { id?: string; type: "reload_mcp_servers" }
	| { id?: string; type: "get_desktop_settings" }
	| { id?: string; type: "set_desktop_appearance"; appearance: DesktopAppearance }
	| { id?: string; type: "upsert_klerm_profile"; profile: KlermProfile }
	| { id?: string; type: "delete_klerm_profile"; profileId: string }
	| { id?: string; type: "assign_klerm_profile"; lane: KlermWorkerLane; profileId?: string | null }
	| { id?: string; type: "set_klerm_shared_memory"; memory: string; presetId?: string; activate?: boolean }
	| { id?: string; type: "save_klerm_shared_memory_preset"; name: string; memory: string }
	| { id?: string; type: "delete_klerm_shared_memory_preset"; presetId: string }
	| { id?: string; type: "add_custom_model"; model: RpcCustomModelUpdate }
	| { id?: string; type: "remove_custom_model"; provider: string; modelId: string }
	| { id?: string; type: "get_provider_status" }
	| { id?: string; type: "connect_provider"; account: RpcProviderConnect }
	| { id?: string; type: "disconnect_provider"; provider: string }
	| { id?: string; type: "connect_provider_oauth"; provider: string }
	| { id?: string; type: "cancel_provider_oauth" }

	// Prompting
	| {
			id?: string;
			type: "prompt";
			message: string;
			displayMessage?: string;
			targetAgentId?: string;
			mcpMentions?: McpPromptMention[];
			images?: ImageContent[];
			streamingBehavior?: "steer" | "followUp";
	  }
	| { id?: string; type: "prompt_together"; message: string; displayMessage?: string }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "new_session"; parentSession?: string }

	// State
	| { id?: string; type: "get_state" }

	// Model
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }

	// Thinking
	| { id?: string; type: "set_thinking_level"; level: ThinkingLevel; lane?: KlermWorkerLane }
	| { id?: string; type: "cycle_thinking_level" }
	| { id?: string; type: "get_available_thinking_levels"; lane?: KlermWorkerLane }

	// Queue modes
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }

	// Compaction
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }

	// Retry
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }

	// Bash
	| { id?: string; type: "bash"; command: string; excludeFromContext?: boolean }
	| { id?: string; type: "abort_bash" }

	// Session
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "fork"; entryId: string }
	| { id?: string; type: "clone" }
	| { id?: string; type: "get_fork_messages" }
	| { id?: string; type: "get_entries"; since?: string }
	| { id?: string; type: "get_tree" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string }

	// Messages
	| { id?: string; type: "get_messages" }

	// Commands (available for invocation via prompt)
	| { id?: string; type: "get_commands" };

// ============================================================================
// RPC Slash Command (for get_commands response)
// ============================================================================

/** A command available for invocation via prompt */
export interface RpcSlashCommand {
	/** Command name (without leading slash) */
	name: string;
	/** Human-readable description */
	description?: string;
	/** What kind of command this is */
	source: "extension" | "prompt" | "skill";
	/** Source metadata for the owning resource */
	sourceInfo: SourceInfo;
}

// ============================================================================
// RPC State
// ============================================================================

export interface RpcSessionState {
	model?: Model<any>;
	cwd: string;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
}

// ============================================================================
// RPC Responses (stdout)
// ============================================================================

// Success responses with data
export type RpcResponse =
	// Desktop capability and status
	| { id?: string; type: "response"; command: "desktop_handshake"; success: true; data: RpcDesktopHandshake }
	| {
			id?: string;
			type: "response";
			command: "get_local_runtimes";
			success: true;
			data: { runtimes: LocalRuntimeDiscoveryResult[] };
	  }
	| { id?: string; type: "response"; command: "get_coding_harness_setup"; success: true; data: RpcCodingHarnessSetup }
	| {
			id?: string;
			type: "response";
			command: "refresh_coding_harness_models";
			success: true;
			data: CodingHarnessDiscoveryResult;
	  }
	| { id?: string; type: "response"; command: "set_coding_harness_slots"; success: true; data: RpcCodingHarnessSetup }
	| { id?: string; type: "response"; command: "get_klerm_config"; success: true; data: KlermConfig }
	| {
			id?: string;
			type: "response";
			command: "set_klerm_config";
			success: true;
			data: { config: KlermConfig; routingState?: KlermRoutingState };
	  }
	| {
			id?: string;
			type: "response";
			command: "list_sessions";
			success: true;
			data: { sessions: RpcDesktopSessionInfo[] };
	  }
	| { id?: string; type: "response"; command: "get_projects"; success: true; data: RpcProjects }
	| {
			id?: string;
			type: "response";
			command: "get_kanban_registry" | "set_kanban_registry" | "run_kanban_task" | "stop_kanban_task";
			success: true;
			data: RpcKanbanRegistry;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_browser_availability";
			success: true;
			data: RpcBrowserAvailability;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_browser_run";
			success: true;
			data: { state?: RpcBrowserRunState };
	  }
	| {
			id?: string;
			type: "response";
			command: "start_browser_run" | "resolve_browser_origin" | "stop_browser_run";
			success: true;
			data: RpcBrowserRunState;
	  }
	| { id?: string; type: "response"; command: "get_personal_bots"; success: true; data: PersonalBotRegistry }
	| { id?: string; type: "response"; command: "upsert_personal_bot"; success: true; data: PersonalBotRegistry }
	| {
			id?: string;
			type: "response";
			command: "generate_personal_bot_profile";
			success: true;
			data: RpcPersonalBotProfileDraft;
	  }
	| {
			id?: string;
			type: "response";
			command: "generate_personal_bot_memory";
			success: true;
			data: RpcPersonalBotMemoryDraft;
	  }
	| { id?: string; type: "response"; command: "delete_personal_bot"; success: true; data: PersonalBotRegistry }
	| {
			id?: string;
			type: "response";
			command: "get_personal_bot_conversation";
			success: true;
			data: PersonalBotConversation;
	  }
	| {
			id?: string;
			type: "response";
			command: "prompt_personal_bot";
			success: true;
			data: PersonalBotConversation;
	  }
	| { id?: string; type: "response"; command: "abort_personal_bot"; success: true; data: { aborted: boolean } }
	| {
			id?: string;
			type: "response";
			command: "reset_personal_bot_conversation";
			success: true;
			data: PersonalBotConversation;
	  }
	| {
			id?: string;
			type: "response";
			command: "delete_personal_bot_summary";
			success: true;
			data: PersonalBotConversation;
	  }
	| { id?: string; type: "response"; command: "create_project"; success: true; data: RpcProjects }
	| { id?: string; type: "response"; command: "rename_project"; success: true; data: RpcProjects }
	| { id?: string; type: "response"; command: "delete_project"; success: true; data: RpcProjects }
	| { id?: string; type: "response"; command: "move_session_to_project"; success: true; data: RpcProjects }
	| {
			id?: string;
			type: "response";
			command: "refresh_project_summary";
			success: true;
			data: { projects: RpcProjects; summary: string; extracts: ProjectSessionExtract[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "ask_project";
			success: true;
			data: { prompt: string; extracts: ProjectSessionExtract[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "import_legacy_desktop_projects";
			success: true;
			data: RpcProjects;
	  }
	| {
			id?: string;
			type: "response";
			command: "rename_session";
			success: true;
			data: { sessionId: string };
	  }
	| { id?: string; type: "response"; command: "get_workspace_status"; success: true; data: RpcWorkspaceStatus }
	| { id?: string; type: "response"; command: "initialize_git_repository"; success: true; data: RpcWorkspaceStatus }
	| {
			id?: string;
			type: "response";
			command: "get_github_status" | "login_github";
			success: true;
			data: { available: boolean; authenticated: boolean };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_project_trust" | "set_project_trust";
			success: true;
			data: RpcProjectTrustStatus;
	  }
	| {
			id?: string;
			type: "response";
			command: "list_workspace_files";
			success: true;
			data: { projectRoot: string; files: string[]; truncated: boolean };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_workspace_diff";
			success: true;
			data: { path: string; diff: string };
	  }
	| {
			id?: string;
			type: "response";
			command: "read_workspace_file";
			success: true;
			data: { path: string; content: string; size: number };
	  }
	| {
			id?: string;
			type: "response";
			command: "write_workspace_file";
			success: true;
			data: { path: string };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_editors";
			success: true;
			data: { editors: RpcEditorInfo[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "open_workspace_editor";
			success: true;
			data: { editor: RpcEditorInfo["id"] };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_running_services";
			success: true;
			data: { services: RpcRunningService[] };
	  }
	| { id?: string; type: "response"; command: "open_local_url"; success: true; data: { url: string } }
	| { id?: string; type: "response"; command: "get_mcp_status"; success: true; data: RpcMcpStatus }
	| {
			id?: string;
			type: "response";
			command: "add_mcp_server";
			success: true;
			data: { name: string; scope: SettingsScope; reloadRequired: boolean; status: RpcMcpStatus };
	  }
	| { id?: string; type: "response"; command: "reload_mcp_servers"; success: true; data: RpcMcpStatus }
	| { id?: string; type: "response"; command: "get_desktop_settings"; success: true; data: RpcDesktopSettings }
	| { id?: string; type: "response"; command: "set_desktop_appearance"; success: true; data: RpcDesktopSettings }
	| { id?: string; type: "response"; command: "upsert_klerm_profile"; success: true; data: RpcDesktopSettings }
	| { id?: string; type: "response"; command: "delete_klerm_profile"; success: true; data: RpcDesktopSettings }
	| { id?: string; type: "response"; command: "assign_klerm_profile"; success: true; data: RpcDesktopSettings }
	| { id?: string; type: "response"; command: "set_klerm_shared_memory"; success: true; data: RpcDesktopSettings }
	| {
			id?: string;
			type: "response";
			command: "save_klerm_shared_memory_preset";
			success: true;
			data: RpcDesktopSettings;
	  }
	| {
			id?: string;
			type: "response";
			command: "delete_klerm_shared_memory_preset";
			success: true;
			data: RpcDesktopSettings;
	  }
	| { id?: string; type: "response"; command: "add_custom_model"; success: true; data: RpcDesktopSettings }
	| { id?: string; type: "response"; command: "remove_custom_model"; success: true; data: RpcDesktopSettings }
	| {
			id?: string;
			type: "response";
			command: "get_provider_status";
			success: true;
			data: { providers: RpcProviderAccount[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "connect_provider";
			success: true;
			data: { providers: RpcProviderAccount[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "disconnect_provider";
			success: true;
			data: { providers: RpcProviderAccount[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "connect_provider_oauth";
			success: true;
			data: { providers: RpcProviderAccount[] };
	  }
	| { id?: string; type: "response"; command: "cancel_provider_oauth"; success: true; data: { cancelled: boolean } }
	| {
			id?: string;
			type: "response";
			command: "delete_session";
			success: true;
			data: { sessionId: string };
	  }

	// Prompting (async - events follow)
	| { id?: string; type: "response"; command: "prompt"; success: true }
	| { id?: string; type: "response"; command: "prompt_together"; success: true }
	| { id?: string; type: "response"; command: "steer"; success: true }
	| { id?: string; type: "response"; command: "follow_up"; success: true }
	| { id?: string; type: "response"; command: "abort"; success: true }
	| { id?: string; type: "response"; command: "new_session"; success: true; data: { cancelled: boolean } }

	// State
	| { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }

	// Model
	| {
			id?: string;
			type: "response";
			command: "set_model";
			success: true;
			data: Model<any>;
	  }
	| {
			id?: string;
			type: "response";
			command: "cycle_model";
			success: true;
			data: { model: Model<any>; thinkingLevel: ThinkingLevel; isScoped: boolean } | null;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_models";
			success: true;
			data: { models: Model<any>[] };
	  }

	// Thinking
	| {
			id?: string;
			type: "response";
			command: "set_thinking_level";
			success: true;
			data?: { level: ThinkingLevel; levels: ThinkingLevel[] };
	  }
	| {
			id?: string;
			type: "response";
			command: "cycle_thinking_level";
			success: true;
			data: { level: ThinkingLevel } | null;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_thinking_levels";
			success: true;
			data: { levels: ThinkingLevel[]; level?: ThinkingLevel };
	  }

	// Queue modes
	| { id?: string; type: "response"; command: "set_steering_mode"; success: true }
	| { id?: string; type: "response"; command: "set_follow_up_mode"; success: true }

	// Compaction
	| { id?: string; type: "response"; command: "compact"; success: true; data: CompactionResult }
	| { id?: string; type: "response"; command: "set_auto_compaction"; success: true }

	// Retry
	| { id?: string; type: "response"; command: "set_auto_retry"; success: true }
	| { id?: string; type: "response"; command: "abort_retry"; success: true }

	// Bash
	| { id?: string; type: "response"; command: "bash"; success: true; data: BashResult }
	| { id?: string; type: "response"; command: "abort_bash"; success: true }

	// Session
	| { id?: string; type: "response"; command: "get_session_stats"; success: true; data: SessionStats }
	| { id?: string; type: "response"; command: "export_html"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "switch_session"; success: true; data: { cancelled: boolean } }
	| { id?: string; type: "response"; command: "fork"; success: true; data: { text: string; cancelled: boolean } }
	| { id?: string; type: "response"; command: "clone"; success: true; data: { cancelled: boolean } }
	| {
			id?: string;
			type: "response";
			command: "get_fork_messages";
			success: true;
			data: { messages: Array<{ entryId: string; text: string }> };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_entries";
			success: true;
			data: { entries: SessionEntry[]; leafId: string | null };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_tree";
			success: true;
			data: { tree: SessionTreeNode[]; leafId: string | null };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_last_assistant_text";
			success: true;
			data: { text: string | null };
	  }
	| { id?: string; type: "response"; command: "set_session_name"; success: true }

	// Messages
	| { id?: string; type: "response"; command: "get_messages"; success: true; data: { messages: AgentMessage[] } }

	// Commands
	| {
			id?: string;
			type: "response";
			command: "get_commands";
			success: true;
			data: { commands: RpcSlashCommand[] };
	  }

	// Error response (any command can fail)
	| { id?: string; type: "response"; command: string; success: false; error: string; code?: string };

// ============================================================================
// Extension UI Events (stdout)
// ============================================================================

/** Emitted when an extension needs user input */
export type RpcExtensionUIRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| {
			type: "extension_ui_request";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
	  }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setStatus";
			statusKey: string;
			statusText: string | undefined;
	  }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines: string[] | undefined;
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string }
	| { type: "extension_ui_request"; id: string; method: "provider_oauth_notify"; notify: RpcProviderOauthNotify }
	| { type: "extension_ui_request"; id: string; method: "provider_oauth_prompt"; prompt: RpcProviderOauthPrompt };

// ============================================================================
// Extension UI Commands (stdin)
// ============================================================================

/** Response to an extension UI request */
export type RpcExtensionUIResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

// ============================================================================
// Helper type for extracting command types
// ============================================================================

export type RpcCommandType = RpcCommand["type"];
