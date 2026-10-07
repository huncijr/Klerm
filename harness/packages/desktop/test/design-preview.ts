/** Development-only real-UI fixture. No backend, credentials, filesystem writes or model calls. */
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { mount } from "svelte";
import { effectiveDesktopBindings, parseDesktopKeybindings } from "../../coding-agent/src/klerm/desktop-keybindings.ts";
import App from "../src/App.svelte";
import type {
	DesktopSettings,
	KanbanRegistry,
	KlermProfile,
	PersonalBot,
	PersonalBotChatMessage,
	PersonalBotRegistry,
} from "../src/lib/model.ts";
import "../src/app.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "light" ? "light" : "dark";
localStorage.setItem("klerm-appearance", appearance);
document.documentElement.dataset.theme = appearance;
const root = "/workspace/atlas";
const time = "2026-10-06T12:00:00.000Z";
const settings: DesktopSettings = {
	appearance,
	agentDir: "~/.klerm/agent",
	klermVersion: "design-fixture",
	cwd: root,
	profiles: {
		sharedMemory: "Keep changes small. Verify implementation before reporting completion.",
		defaultSharedMemory: "Keep changes small. Verify implementation before reporting completion.",
		sharedMemoryPresets: [
			{ id: "review", name: "Code review", memory: "Inspect correctness, regressions and test evidence." },
		],
		profiles: [
			{
				id: "scout",
				name: "Scout",
				face: "fox",
				level: 1,
				behaviour: "A careful workspace reviewer.",
				workPlan: "Inspect, explain, verify.",
				planMode: "Read-only review",
				buildMode: "Implement and verify",
				memoryFormat: "md",
				memory: "",
				readme: "",
			},
		],
	},
	customModels: [],
	shortcuts: effectiveDesktopBindings(),
	cliKeybindings: [
		{ id: "app.session.new", description: "Start a new session", keys: ["ctrl+alt+n"], defaultKeys: ["ctrl+alt+n"] },
	],
};
const bots: PersonalBotRegistry = {
	version: 1,
	defaultsInitialized: true,
	bots: [
		{
			id: "scout",
			name: "Scout",
			face: "fox",
			profileId: "scout",
			harness: "klerm",
			model: "demo/worker",
			role: "planner",
			effort: "medium",
			enabled: true,
			browserEnabled: true,
			kanbanEnabled: true,
			createdSequence: 1,
		},
	],
};
const fixtureRequests: string[] = [];
Object.defineProperty(window, "__klermDesign", {
	value: {
		requests: fixtureRequests,
		get agents() {
			return bots.bots;
		},
	},
});
const personalMessages: PersonalBotChatMessage[] = [
	{ id: "personal-user", role: "user", text: "Help me plan a review of the session registry.", timestamp: time },
	{
		id: "personal-assistant",
		role: "assistant",
		text: "## A focused review\nStart with how sessions are saved and reopened. Check the revision rules before changing the registry.\n\n- Inspect the existing session tests.\n- Compare interrupted and completed runs.\n- Record the failure before proposing a fix.\n\nI can help turn the findings into a Kanban card when you are ready.",
		timestamp: time,
	},
];
const boards: KanbanRegistry = {
	version: 1,
	boards: [
		{
			id: "board",
			name: "Atlas release",
			workspaceRoot: root,
			createdAt: time,
			updatedAt: time,
			createdSequence: 1,
			tasks: [
				{
					id: "task",
					title: "Review the authentication flow",
					prompt: "Inspect the session lifecycle and document recovery behavior.",
					workspaceRoot: root,
					kind: "review",
					personalBotId: "scout",
					reasoning: "medium",
					status: "planned",
					runStatus: "idle",
					createdAt: time,
					updatedAt: time,
					createdSequence: 1,
				},
				{
					id: "done",
					title: "Verify the session registry",
					prompt: "Check persistence and restart behavior.",
					workspaceRoot: root,
					kind: "build",
					personalBotId: "scout",
					reasoning: "medium",
					status: "review",
					runStatus: "succeeded",
					runCount: 1,
					lastResult: "Implemented revision-safe persistence. Focused checks passed.",
					createdAt: time,
					updatedAt: time,
					createdSequence: 2,
				},
				{
					id: "failed",
					title: "Resolve a failing integration check",
					prompt: "Reproduce and fix the regression.",
					workspaceRoot: root,
					kind: "fix",
					personalBotId: "scout",
					reasoning: "medium",
					status: "waiting",
					runStatus: "failed",
					runError: "One verification command still fails.",
					createdAt: time,
					updatedAt: time,
					createdSequence: 3,
				},
			],
		},
	],
};
const sessions = ["Authentication review", "Session registry", "Release checklist"].map((name, index) => ({
	id: `session-${index}`,
	sessionToken: `fixture-${index}`,
	name,
	firstMessage: name,
	modified: time,
	created: time,
	cwd: root,
	messageCount: 6,
	projectId: "project",
}));
const projects = {
	version: 1,
	defaultProjectId: "project",
	projects: [
		{
			id: "project",
			name: "Atlas",
			createdSequence: 1,
			sessionCount: sessions.length,
			summary: "Session persistence and release readiness.",
		},
	],
};
const state = {
	sessionId: "session-0",
	sessionName: "Authentication review",
	cwd: root,
	isStreaming: false,
	messageCount: 0,
	thinkingLevel: "medium",
	model: { provider: "demo", id: "worker" },
};
const config = {
	routing: "off",
	activeStartLane: "auto",
	localModel: "demo/worker",
	localRole: "builder",
	frontierRole: "planner",
	localApprovalMode: "risky",
	frontierApprovalMode: "risky",
	allowFrontierFallback: false,
	handbackEnabled: true,
	maxDelegationCycles: 0,
	localMaxTurns: 8,
	localMaxToolErrors: 3,
};
const harnesses = {
	slots: {
		externalHarnessesEnabled: false,
		agents: [
			{
				id: "agent1",
				kind: "klerm",
				enabled: true,
				model: "demo/worker",
				role: "builder",
				effort: "medium",
				tools: [],
			},
		],
	},
	harnesses: [
		{
			kind: "klerm",
			builtin: true,
			available: true,
			adapterConnected: true,
			models: ["demo/worker", "demo/reviewer"],
		},
	],
	effectiveRouting: "none",
	externalPromptingAvailable: false,
	workTogetherAvailable: false,
	runnableAgents: [],
	excludedAgents: [],
	sharedContextPreview: settings.profiles.sharedMemory,
};
const workflow = {
	version: 1,
	id: "workflow",
	revision: 1,
	name: "Release review",
	workspaceRoot: root,
	createdAt: time,
	updatedAt: time,
	viewport: { x: 0, y: 0, zoom: 1 },
	nodes: [
		{
			id: "start",
			kind: "start",
			title: "Start review",
			position: { x: 50, y: 70 },
			createdSequence: 1,
			brief: "",
			note: "",
		},
		{
			id: "review",
			kind: "task",
			title: "Inspect the workspace",
			position: { x: 330, y: 70 },
			createdSequence: 2,
			brief: "Review session persistence.",
			note: "",
		},
		{
			id: "end",
			kind: "end",
			title: "Review complete",
			position: { x: 610, y: 70 },
			createdSequence: 3,
			brief: "",
			note: "",
		},
	],
	edges: [
		{ id: "edge1", kind: "depends-on", source: "start", target: "review", createdSequence: 1, label: "Inspect" },
		{ id: "edge2", kind: "depends-on", source: "review", target: "end", createdSequence: 2, label: "Report" },
	],
};
const commands = [
	"get_mcp_status",
	"get_desktop_settings",
	"set_desktop_appearance",
	"set_desktop_keybindings",
	"get_provider_status",
	"get_coding_harness_setup",
	"get_personal_bots",
	"get_personal_bot_conversation",
	"upsert_personal_bot",
	"upsert_klerm_profile",
	"get_projects",
	"get_kanban_registry",
	"get_browser_sessions",
	"get_browser_availability",
	"get_browser_run",
	"get_available_editors",
	"get_running_services",
	"get_workspace_status",
	"get_github_status",
	"get_available_models",
	"get_available_thinking_levels",
];
function response(command: Record<string, unknown>): unknown {
	switch (command.type) {
		case "desktop_handshake":
			return {
				protocolVersion: 1,
				klermVersion: "design-fixture",
				capabilities: { commands, events: [] },
				state,
				routingState: { mode: "off", lane: "direct" },
			};
		case "get_state":
			return state;
		case "get_project_trust":
			return { decision: true };
		case "get_klerm_config":
			return config;
		case "get_projects":
			return projects;
		case "list_sessions":
			return { sessions };
		case "get_entries":
			return {
				entries: params.has("conversation")
					? [
							{
								id: "user",
								type: "message",
								parentId: null,
								timestamp: time,
								message: {
									role: "user",
									content: [{ type: "text", text: "Review the session registry and explain the next steps." }],
									timestamp: Date.parse(time),
								},
							},
							{
								id: "assistant",
								type: "message",
								parentId: "user",
								timestamp: time,
								message: {
									role: "assistant",
									model: "worker",
									provider: "demo",
									content: [
										{
											type: "text",
											text: "## Session registry\nThe registry keeps stable session IDs and explicit project membership.\n\n- Validate revisions before writing.\n- Recover pending audit events after restart.\n\n```ts\nawait saveRegistry(next, expectedRevision);\n```",
										},
									],
									stopReason: "stop",
									timestamp: Date.parse(time),
								},
							},
						]
					: [],
				leafId: params.has("conversation") ? "assistant" : null,
			};
		case "get_local_runtimes":
			return { runtimes: [] };
		case "get_available_models":
			return {
				models: [
					{ provider: "demo", id: "worker", name: "Workspace worker" },
					{ provider: "demo", id: "reviewer", name: "Workspace reviewer" },
				],
			};
		case "get_available_thinking_levels":
			return { level: "medium", levels: ["off", "low", "medium", "high"] };
		case "get_workspace_status":
			return {
				workspaceRoot: root,
				projectRoot: root,
				gitRoot: root,
				isGit: true,
				trusted: true,
				files: [
					{
						path: "src/session.ts",
						status: "modified",
						staged: false,
						indexStatus: " ",
						worktreeStatus: "M",
						attribution: { source: "manual" },
					},
				],
			};
		case "get_workspace_diff":
			return { path: command.path, diff: "-const revision = 0;\n+const revision = registry.revision;\n" };
		case "read_workspace_file":
			return { path: command.path, content: "export const revision = registry.revision;\n", size: 47 };
		case "get_github_status":
			return { available: false, authenticated: false };
		case "get_available_editors":
			return { editors: [] };
		case "get_running_services":
			return { services: [] };
		case "get_mcp_status":
			return {
				servers: [
					{
						name: "docs",
						label: "Documentation",
						color: "blue",
						state: "connected",
						enabled: true,
						transport: "stdio",
						tools: [{ name: "docs_search", remoteName: "search" }],
					},
				],
				toolCount: 1,
				reloadRequired: false,
			};
		case "get_desktop_settings":
			return settings;
		case "set_desktop_appearance":
			settings.appearance =
				command.appearance === "light" ? "light" : command.appearance === "system" ? "system" : "dark";
			return settings;
		case "set_desktop_keybindings":
			settings.shortcuts = effectiveDesktopBindings(parseDesktopKeybindings(command.overrides));
			return settings;
		case "get_provider_status":
			return {
				providers: [
					{
						id: "anthropic",
						label: "Anthropic",
						configured: false,
						local: false,
						supportsOauth: false,
						models: [],
					},
					{ id: "openai", label: "OpenAI", configured: false, local: false, supportsOauth: true, models: [] },
					{
						id: "ollama",
						label: "Ollama",
						configured: true,
						local: true,
						supportsOauth: false,
						models: ["workspace-worker"],
					},
				],
			};
		case "get_coding_harness_setup":
			return harnesses;
		case "get_personal_bots":
			return bots;
		case "upsert_personal_bot": {
			const bot = command.bot as PersonalBot;
			if (
				!bot.name?.trim() ||
				!bot.id ||
				!settings.profiles.profiles.some((profile) => profile.id === bot.profileId)
			)
				throw new Error("Invalid fixture agent.");
			bots.bots = [...bots.bots.filter((previous) => previous.id !== bot.id), { ...bot }];
			return bots;
		}
		case "upsert_klerm_profile": {
			const profile = command.profile as KlermProfile;
			if (!profile.id || !profile.name?.trim()) throw new Error("Invalid fixture profile.");
			settings.profiles.profiles = [
				...settings.profiles.profiles.filter((previous) => previous.id !== profile.id),
				{ ...profile },
			];
			return settings;
		}
		case "get_personal_bot_conversation": {
			const bot = bots.bots.find((entry) => entry.id === command.botId);
			return {
				version: 1,
				id: `fixture-${bot?.id}`,
				botId: bot?.id,
				cwd: root,
				harness: "klerm",
				model: bot?.model,
				role: "planner",
				nativeSessionId: bot?.id === "scout" ? "fixture-scout-session" : undefined,
				status: "idle",
				messages: bot?.id === "scout" && !params.has("empty-personal") ? personalMessages : [],
				eventSequence: 0,
				linkedSuccessfulPromptCount: 0,
				pendingSummarySources: [],
				summaries: [],
				updatedAt: time,
			};
		}
		case "get_kanban_registry":
			return boards;
		case "get_browser_sessions":
			return { sessions: [{ id: "browser", name: "Documentation research" }] };
		case "get_browser_availability":
			return {
				available: false,
				runtime: "Design fixture",
				reason: "Browser execution is disabled in this visual fixture.",
			};
		case "get_browser_run":
			return {};
		case "list_workflows":
			return {
				workflows: [
					{ id: "workflow", name: workflow.name, revision: 1, nodeCount: 3, edgeCount: 2, updatedAt: time },
				],
				workspaceRoot: root,
			};
		case "get_workflow":
			return workflow;
		case "get_graph_catalog":
			return { items: [], executionSupported: false };
		case "probe_browser_model":
			return { status: "failed", code: "fixture", reason: "No model calls in this fixture.", levels: ["off"] };
		default:
			throw new Error(`Design fixture does not execute ${String(command.type)}.`);
	}
}
mockIPC(
	async (name, payload) => {
		if (name === "start_backend" || name === "stop_backend") return;
		if (name === "start_browser_host") throw new Error("Embedded Chromium is disabled in the design fixture.");
		if (name === "browser_host_command") return;
		if (name !== "rpc_send") return;
		const command = (payload as { command: Record<string, unknown> }).command;
		fixtureRequests.push(String(command.type));
		try {
			await emit("klerm://rpc", {
				type: "response",
				id: command.id,
				command: command.type,
				success: true,
				data: response(command),
			});
		} catch (error) {
			await emit("klerm://rpc", {
				type: "response",
				id: command.id,
				command: command.type,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
	{ shouldMockEvents: true },
);
mount(App, { target: document.getElementById("app")! });
