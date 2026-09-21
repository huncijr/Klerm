<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { confirm as confirmDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
	import { onMount, untrack } from "svelte";
	import {
		bridgeEventCard,
		preventDesktopContextMenu,
		type WorkspaceEditDraft,
	} from "./lib/agent-workspace.ts";
	import {
		contentImages,
		describeToolCall,
		messageText,
		resultErrorText,
		rpcImageAttachments,
		taskCompletionTitle,
		toolResultDetails,
		toDisplayText,
		truncateText,
	} from "./lib/helpers.ts";
	import {
		addCodingHarnessSlot,
		assignWorkTogetherModels,
		codingHarnessModelOptions,
		removeCodingHarnessSlot,
		resolvedCodingHarnessModel,
		setAllCodingHarnessAgentsEnabled,
		setExternalCodingHarnessesEnabled,
		shouldShowAgentContext,
		updateCodingHarnessSlot,
	} from "./lib/coding-harnesses.ts";
	import type {
		AgentMessage,
		BashResult,
		ChatMessage,
		CodingHarnessBridgeChatEntry,
		CodingHarnessBridgeEvent,
		CodingHarnessKind,
		CodingHarnessSetup,
		CodingHarnessSlotSettings,
		CustomModelEntry,
		DesktopAppearance,
		DesktopHandshake,
		DesktopProject,
		DesktopProjects,
		DesktopSettings,
		DesktopSession,
		EditorInfo,
		FeedItem,
		GitHubStatus,
		ImageAttachment,
		JsonObject,
		KlermConfig,
		KanbanActivityEvent,
		KanbanRegistry,
		KlermProfile,
		LocalRuntime,
		McpServerUpdate,
		McpStatus,
		PersonalBot,
		PersonalBotConversation,
		PersonalBotMemoryDraft,
		PersonalBotRegistry,
		ProviderAccount,
		ProviderConnect,
		ProviderOauthStep,
		ProjectSessionExtract,
		RoutingState,
		RoutingTransition,
		RunningService,
		RuntimeStatus,
		SelectOption,
		SessionEntryRecord,
		SessionState,
		StatusInfo,
		TaskOutcome,
		TimelineItem,
		TimelineTone,
		ThinkingLevel,
		ThinkingSetting,
		WorkspaceStatus,
		WorkspaceView,
	} from "./lib/model.ts";
	import { mcpDisplayName, prepareMcpPrompt, resolveMcpTool } from "./lib/mcp-mentions.ts";
	import { RpcBridge, toError } from "./lib/rpc.ts";
	import Composer from "./components/Composer.svelte";
	import AgentViews from "./components/AgentViews.svelte";
	import BottomPanel from "./components/BottomPanel.svelte";
	import ConfirmDialog from "./components/ConfirmDialog.svelte";
	import EmptyState from "./components/EmptyState.svelte";
	import Feed from "./components/Feed.svelte";
	import PersonalBotsView from "./components/PersonalBotsView.svelte";
	import BrowserWorkspace from "./components/BrowserWorkspace.svelte";
	import ProjectWorkspace from "./components/ProjectWorkspace.svelte";
	import SettingsView from "./components/SettingsView.svelte";
	import Sidebar from "./components/Sidebar.svelte";
	import Splash from "./components/Splash.svelte";
	import Topbar from "./components/Topbar.svelte";
	import WorkspacePanel from "./components/WorkspacePanel.svelte";
	import WorkspacePlannedView from "./components/WorkspacePlannedView.svelte";

	const bridge = new RpcBridge();

	let splashVisible = $state(true);
	let backendReady = $state(false);
	let backendRestarting = false;
	let taskActive = $state(false);
	let taskStopping = false;
	let taskHadErrors = false;
	let taskSawAssistant = false;
	let lastAssistantStopReason: string | undefined;
	let taskHadExecution = false;
	let taskErrorDetails: string[] = [];
	let buildModeOffer = $state<{ id: number; agent: "agent1" | "agent2" } | undefined>(undefined);
	let sessionTransitionActive = $state(false);
	let configBusy = $state<Promise<boolean> | undefined>(undefined);
	let currentConfig = $state<KlermConfig | undefined>(undefined);
	let settingsOpen = $state(false);
	let workspaceView = $state<WorkspaceView>();
	let settingsFullscreen = $state(false);
	let desktopSettings = $state<DesktopSettings | undefined>(undefined);
	let systemPrefersDark = $state(true);
	let currentRoutingState = $state<RoutingState | undefined>(undefined);
	let lastState = $state<SessionState | undefined>(undefined);
	let sessions = $state<DesktopSession[]>([]);
	let projects = $state<DesktopProject[]>([]);
	let kanbanRegistry = $state<KanbanRegistry>({ version: 1, boards: [] });
	let kanbanActivity = $state<KanbanActivityEvent[]>([]);
	let personalBots = $state<PersonalBotRegistry>({ version: 1, defaultsInitialized: true, bots: [] });
	let personalBotConversations = $state<Record<string, PersonalBotConversation | undefined>>({});
	let defaultProjectId = $state("");
	let selectedProjectId = $state<string | undefined>(undefined);
	let projectBusy = $state(false);
	let personalBotBusy = $state(false);
	let notification = $state("");
	let notificationTimer: number | undefined;
	const notifiedPersonalBotMessages = new Set<string>();
	let feed = $state<FeedItem[]>([]);
	let localOptions = $state<SelectOption[]>([]);
	let frontierOptions = $state<SelectOption[]>([]);
	let draft = $state("");
	let attachments = $state<ImageAttachment[]>([]);
	let sidebarOpen = $state(false);
	let sessionsExpanded = $state(true);
	let sessionWidth = $state(280);
	let filesWidth = $state(280);
	let pendingDelete = $state<DesktopSession | undefined>(undefined);
	let pendingApproval = $state<{ id: string; title: string; message: string } | undefined>(undefined);
	let workspacePanelOpen = $state(true);
	let bottomPanelOpen = $state(false);
	let bottomPanelRevealed = $state(false);
	let sessionTitle = $state("New Agent 1 session");
	let sessionCwd = $state("");
	let status = $state<StatusInfo>({ state: "starting", label: "Starting backend", detail: "RPC handshake" });
	let runtimeStatus = $state<RuntimeStatus>({
		state: "starting",
		title: "Checking Ollama",
		detail: "Looking for installed Agent 1 models",
	});
	let errorBanner = $state("");
	let composerFocusRequest = $state(0);
	let localThinking = $state<ThinkingSetting>({ level: "off", levels: ["off"] });
	let frontierThinking = $state<ThinkingSetting>({ level: "off", levels: ["off"] });
	let thinkingBusy = $state<"local" | "frontier" | undefined>(undefined);
	let workspace = $state<WorkspaceStatus | undefined>(undefined);
	let github = $state<GitHubStatus | undefined>(undefined);
	let gitBusy = $state(false);
	let editors = $state<EditorInfo[]>([]);
	let runningServices = $state<RunningService[]>([]);
	let runningServicesBusy = false;
	let selectedFilePath = $state<string | undefined>(undefined);
	let selectedFileDiff = $state("");
	let selectedFileContent = $state<string | undefined>(undefined);
	let fileLoading = $state(false);
	let fileSaving = $state(false);
	let projectFiles = $state<string[] | undefined>(undefined);
	let projectFilesTruncated = $state(false);
	let projectFilesLoading = $state(false);
	let terminalOutput = $state("");
	let terminalBusy = $state(false);
	let terminalCurrentCommand = $state("");
	let terminalStreamed = false;
	let mcpStatus = $state<McpStatus | undefined>(undefined);
	let mcpBusy = $state(false);
	let providerAccounts = $state<ProviderAccount[]>([]);
	let providerBusy = $state(false);
	let oauthStep = $state<ProviderOauthStep | undefined>(undefined);
	let backendCommands = $state<string[]>([]);
	let codingHarnessSetup = $state<CodingHarnessSetup | undefined>(undefined);
	let codingHarnessSetupLoading = $state(false);
	let codingHarnessSetupError = $state("");
	let visibleAgentIds = $state<string[]>([]);
	let workspaceEditDrafts = $state<Record<string, WorkspaceEditDraft>>({});
	// Agent view visibility is per session: each session restores exactly the
	// views that were opened in it, and a first visit opens none.
	const agentViewsBySession = new Map<string, string[]>();
	const agentClearBySession = new Map<string, Record<string, number>>();
	let agentClearThrough = $state<Record<string, number>>({});
	function rememberAgentViews(): void {
		const sessionId = lastState?.sessionId;
		if (sessionId) {
			agentViewsBySession.set(sessionId, [...visibleAgentIds]);
			agentClearBySession.set(sessionId, { ...agentClearThrough });
		}
	}
	function restoreAgentViews(sessionId: string | undefined): void {
		visibleAgentIds = sessionId ? [...(agentViewsBySession.get(sessionId) ?? [])] : [];
		agentClearThrough = sessionId ? { ...(agentClearBySession.get(sessionId) ?? {}) } : {};
	}
	let agentViewsHeight = $state(260);
	let agentContextContainer: HTMLElement | undefined = $state();
	let mcpNeedsReload = false;

	let currentLocalRuntimes = $state<LocalRuntime[]>([]);
	let modelCatalog = $state<SelectOption[]>([]);
	let lastFallbackReason = "";
	let feedSeq = 0;
	let taskSeq = 0;
	let buildModeOfferSeq = 0;
	let activeTaskKey = 0;
	let timelineSeq = 0;
	let messageSeq = 0;
	let streamingMessageId: number | undefined;
	const toolCards = new Map<string, number>();

	const interactionActive = $derived(
		taskActive ||
			terminalBusy ||
			configBusy !== undefined ||
			sessionTransitionActive ||
			thinkingBusy !== undefined ||
			mcpBusy,
	);
	const sendDisabled = $derived(!backendReady || interactionActive || Boolean(codingHarnessSetup?.blockingReason));
	const externalHarnessesEnabled = $derived(codingHarnessSetup?.slots.externalHarnessesEnabled === true);
	const codingHarnessOptions = $derived<SelectOption[]>(
		codingHarnessSetup?.harnesses
			.filter((harness) => harness.available)
			.map((harness) => ({
				value: harness.kind,
				label:
					harness.kind === "claude-code"
						? "Claude Code"
						: harness.kind === "opencode"
							? "OpenCode"
							: harness.kind.charAt(0).toUpperCase() + harness.kind.slice(1),
			})) ?? [{ value: "klerm", label: "Klerm" }],
	);
	const configuredHarnessAgents = $derived(codingHarnessSetup?.slots.agents ?? []);
	const projectPromptAgents = $derived.by(() => {
		const internal = configuredHarnessAgents.flatMap((agent) => {
			if (!agent.enabled || agent.kind !== "klerm" || (agent.id !== "agent1" && agent.id !== "agent2")) return [];
			const model =
				agent.model ?? (agent.id === "agent1" ? currentConfig?.localModel : currentConfig?.frontierModel);
			return model ? [{ agentId: agent.id, harness: agent.kind, model, effort: agent.effort }] : [];
		});
		const external =
			codingHarnessSetup?.runnableAgents
				.filter((agent) => agent.harness !== "klerm")
				.map(({ agentId, harness, model, effort }) => ({ agentId, harness, model, effort })) ?? [];
		return [...internal, ...external].sort((left, right) =>
			left.agentId.localeCompare(right.agentId, undefined, { numeric: true }),
		);
	});
	const selectedProject = $derived(projects.find((project) => project.id === selectedProjectId));
	const activeWorkspaceView = $derived<WorkspaceView | undefined>(
		settingsOpen || selectedProject ? undefined : (workspaceView ?? "agents-routing"),
	);
	const selectedProjectSessions = $derived(
		selectedProjectId ? sessions.filter((session) => session.projectId === selectedProjectId) : [],
	);
	const firstHarnessAgent = $derived(configuredHarnessAgents[0]);
	const secondHarnessAgent = $derived(configuredHarnessAgents[1]);
	const workTogetherVisible = $derived((codingHarnessSetup?.runnableAgents.length ?? 0) >= 2);
	const klermModelCatalog = $derived(
		[...localOptions, ...frontierOptions]
			.map((option) => option.value)
			.filter((model, index, models) => model && models.indexOf(model) === index),
	);
	const workTogetherAvailable = $derived(codingHarnessSetup?.workTogetherAvailable === true);
	const workTogetherEnabled = $derived(
		workTogetherAvailable && codingHarnessSetup?.slots.workTogetherEnabled === true,
	);
	const agentContextVisible = $derived(
		codingHarnessSetup ? shouldShowAgentContext(codingHarnessSetup.slots, visibleAgentIds) : false,
	);
	const activeHarnessAgentId = $derived.by(() => {
		if (!currentRoutingState) return undefined;
		if (currentRoutingState.selectedAgentId) return currentRoutingState.selectedAgentId;
		const activeAgents = configuredHarnessAgents.filter((agent) => agent.enabled && agent.kind === "klerm" && agent.model);
		return (
			activeAgents.find((agent) => agent.model === currentRoutingState?.selectedTarget)?.id ??
			(currentRoutingState.lane === "local" ? activeAgents[0]?.id : undefined)
		);
	});

	$effect(() => {
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		systemPrefersDark = query.matches;
		const update = (event: MediaQueryListEvent) => {
			systemPrefersDark = event.matches;
		};
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	});

	$effect(() => {
		const appearance = desktopSettings?.appearance;
		if (appearance) localStorage.setItem("klerm-appearance", appearance);
		// The persisted appearance is read from localStorage so the theme is
		// correct from the first paint, before the backend handshake arrives.
		const effective =
			appearance ?? ((localStorage.getItem("klerm-appearance") as DesktopAppearance | null) ?? "dark");
		document.documentElement.dataset.theme =
			effective === "system" ? (systemPrefersDark ? "dark" : "light") : effective;
	});

	function loadStoredProjects(): Array<{ id: string; name: string }> {
		try {
			const raw = localStorage.getItem("klerm-projects");
			if (!raw) return [];
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.flatMap((item): Array<{ id: string; name: string }> => {
				if (!item || typeof item !== "object") return [];
				const project = item as Record<string, unknown>;
				return typeof project.id === "string" && typeof project.name === "string"
					? [{ id: project.id, name: project.name }]
					: [];
			});
		} catch {
			return [];
		}
	}

	function loadStoredSessionProjects(): Record<string, string> {
		try {
			const raw = localStorage.getItem("klerm-session-projects");
			if (!raw) return {};
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null) return {};
			const entries = Object.entries(parsed as Record<string, unknown>);
			const valid: Record<string, string> = {};
			for (const [key, value] of entries) {
				if (typeof value === "string") valid[key] = value;
			}
			return valid;
		} catch {
			return {};
		}
	}

	function applyProjects(result: DesktopProjects): void {
		projects = result.projects;
		defaultProjectId = result.defaultProjectId;
		if (selectedProjectId && !result.projects.some((project) => project.id === selectedProjectId)) {
			selectedProjectId = undefined;
		}
	}

	async function refreshProjects(): Promise<void> {
		if (!backendReady || !supportsCommand("get_projects")) return;
		try {
			applyProjects(await bridge.send<DesktopProjects>("get_projects"));
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function refreshKanban(): Promise<void> {
		if (!backendReady || !supportsCommand("get_kanban_registry")) return;
		try { kanbanRegistry = await bridge.send<KanbanRegistry>("get_kanban_registry"); }
		catch (error) { showError(toError(error).message); }
	}

	async function saveKanban(registry: KanbanRegistry): Promise<void> {
		try {
			kanbanRegistry = await bridge.send<KanbanRegistry>("set_kanban_registry", { registry });
		} catch (error) {
			showError(toError(error).message);
			throw error;
		}
	}

	async function runKanbanTask(boardId: string, taskId: string): Promise<void> {
		if (!supportsCommand("run_kanban_task")) {
			const error = new Error("The backend does not support Kanban runs. Restart Klerm to upgrade the sidecar.");
			showError(error.message);
			throw error;
		}
		try {
			await bridge.send<KanbanRegistry>("run_kanban_task", { boardId, taskId }, 60_000);
			await refreshKanban();
		} catch (error) {
			showError(toError(error).message);
			throw error;
		}
	}

	async function stopKanbanTask(boardId: string, taskId: string): Promise<void> {
		if (!supportsCommand("stop_kanban_task")) {
			const error = new Error("The backend does not support Kanban runs. Restart Klerm to upgrade the sidecar.");
			showError(error.message);
			throw error;
		}
		try {
			await bridge.send<KanbanRegistry>("stop_kanban_task", { boardId, taskId }, 60_000);
			await refreshKanban();
		} catch (error) {
			showError(toError(error).message);
			throw error;
		}
	}

	async function pickKanbanFolder(initial?: string): Promise<string | undefined> {
		let selected: unknown;
		try {
			selected = await openDialog({
				directory: true,
				multiple: false,
				title: "Choose a task folder",
				...(initial ? { defaultPath: initial } : {}),
			});
		} catch (error) {
			showError(toError(error).message);
			return undefined;
		}
		return typeof selected === "string" && selected.length > 0 ? selected : undefined;
	}

	async function initializeProjects(): Promise<void> {
		if (!supportsCommand("get_projects")) return;
		const hasLegacyProjects = localStorage.getItem("klerm-projects") !== null;
		const hasLegacyAssignments = localStorage.getItem("klerm-session-projects") !== null;
		try {
			if ((hasLegacyProjects || hasLegacyAssignments) && supportsCommand("import_legacy_desktop_projects")) {
				applyProjects(
					await bridge.send<DesktopProjects>("import_legacy_desktop_projects", {
						projects: loadStoredProjects(),
						sessionProjects: loadStoredSessionProjects(),
					}),
				);
				localStorage.removeItem("klerm-projects");
				localStorage.removeItem("klerm-session-projects");
				return;
			}
			applyProjects(await bridge.send<DesktopProjects>("get_projects"));
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function createProject(name: string): Promise<void> {
		const trimmed = name.trim();
		if (!trimmed || !supportsCommand("create_project")) return;
		try {
			applyProjects(await bridge.send<DesktopProjects>("create_project", { name: trimmed }));
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function renameProject(project: DesktopProject, name: string): Promise<void> {
		const trimmed = name.trim();
		if (!trimmed || !supportsCommand("rename_project")) return;
		try {
			applyProjects(await bridge.send<DesktopProjects>("rename_project", { projectId: project.id, name: trimmed }));
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function deleteProject(project: DesktopProject): Promise<void> {
		if (!supportsCommand("delete_project")) return;
		try {
			applyProjects(await bridge.send<DesktopProjects>("delete_project", { projectId: project.id }));
			await refreshSessions();
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function moveSessionToProject(session: DesktopSession, projectId: string | undefined): Promise<void> {
		if (!supportsCommand("move_session_to_project")) return;
		try {
			applyProjects(
				await bridge.send<DesktopProjects>("move_session_to_project", { sessionId: session.id, projectId }),
			);
			await refreshSessions();
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function refreshProjectSummary(project: DesktopProject): Promise<void> {
		if (!supportsCommand("refresh_project_summary") || projectBusy) return;
		projectBusy = true;
		try {
			const result = await bridge.send<{
				projects: DesktopProjects;
				summary: string;
				extracts: ProjectSessionExtract[];
			}>("refresh_project_summary", { projectId: project.id });
			applyProjects(result.projects);
		} catch (error) {
			showError(toError(error).message);
		} finally {
			projectBusy = false;
		}
	}

	async function askProject(
		project: DesktopProject,
		question: string,
		targetAgentId: string,
		effort: ThinkingLevel,
	): Promise<boolean> {
		if (!supportsCommand("ask_project") || interactionActive || projectBusy) return false;
		const destination =
			sessions.find((session) => session.projectId === project.id && session.sessionToken === lastState?.sessionFile) ??
			sessions.find((session) => session.projectId === project.id);
		if (!destination) {
			showError("Add a session to this project before asking a project-wide question.");
			return false;
		}
		projectBusy = true;
		try {
			if (!(await setCodingHarnessAgentEffort(targetAgentId, effort))) return false;
			const result = await bridge.send<{ prompt: string; extracts: ProjectSessionExtract[] }>("ask_project", {
				projectId: project.id,
				question,
			});
			if (result.extracts.length === 0) {
				showError("This project has no readable session messages yet.");
				return false;
			}
			if (destination.sessionToken !== lastState?.sessionFile && !(await switchSession(destination))) return false;
			return sendMessage(result.prompt, [], "prompt", question, targetAgentId);
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			projectBusy = false;
		}
	}

	$effect(() => {
		const enabledIds = configuredHarnessAgents.filter((agent) => agent.enabled).map((agent) => agent.id);
		// Read the current visible ids without tracking: this effect must only
		// re-run when the agent roster changes, never when it writes the list.
		const current = untrack(() => visibleAgentIds);
		const next = current.filter((id) => enabledIds.includes(id)).slice(0, 4);
		if (next.length !== current.length || next.some((id, index) => id !== current[index])) {
			visibleAgentIds = next;
		}
	});
	const composerLocalOptions = $derived(
		externalHarnessesEnabled && firstHarnessAgent
			? codingHarnessModelOptions(firstHarnessAgent, codingHarnessSetup, localOptions, frontierOptions)
			: localOptions,
	);
	const composerFrontierOptions = $derived(
		externalHarnessesEnabled && secondHarnessAgent
			? codingHarnessModelOptions(secondHarnessAgent, codingHarnessSetup, localOptions, frontierOptions)
			: frontierOptions,
	);
	const composerLocalValue = $derived(
		externalHarnessesEnabled
			? (firstHarnessAgent
				? resolvedCodingHarnessModel(firstHarnessAgent, currentConfig?.localModel, currentConfig?.frontierModel) ?? ""
				: "")
			: (currentConfig?.localModel ?? ""),
	);
	const composerFrontierValue = $derived(
		externalHarnessesEnabled
			? (secondHarnessAgent
				? resolvedCodingHarnessModel(secondHarnessAgent, currentConfig?.localModel, currentConfig?.frontierModel) ?? ""
				: "")
			: (currentConfig?.frontierModel ?? ""),
	);
	const composerLocalDisabled = $derived(
		!backendReady || interactionActive || !composerLocalOptions.some((option) => option.value.length > 0),
	);
	const composerFrontierDisabled = $derived(
		!backendReady || interactionActive || !composerFrontierOptions.some((option) => option.value.length > 0),
	);
	const routingSelectDisabled = $derived(!backendReady || interactionActive);
	const localThinkingDisabled = $derived(!backendReady || interactionActive || localThinking.levels.length < 2);
	const frontierThinkingDisabled = $derived(!backendReady || interactionActive || frontierThinking.levels.length < 2);
	const chatMessages = $derived.by(() =>
		feed.flatMap((item) => (item.type === "message" ? [item.message] : [])),
	);
	const hasConversation = $derived(chatMessages.length > 0);
	const promptHistory = $derived(chatMessages.filter((message) => message.role === "user").map((message) => message.text));
	const routingControlValue = $derived(
		currentConfig?.activeStartLane === "frontier-local"
			? "frontier-local"
			: currentConfig?.activeStartLane === "local" || currentConfig?.activeStartLane === "frontier"
				? currentConfig.activeStartLane
				: (currentConfig?.routing ?? "off"),
	);
	const activeAgent = $derived.by(() => {
		if (currentRoutingState?.lane === "frontier") return "agent2";
		if (currentRoutingState?.lane === "local") return "agent1";
		return routingControlValue === "frontier" || routingControlValue === "frontier-local" ? "agent2" : "agent1";
	});
	const heroVisible = $derived(!hasConversation);
	const taskStateText = $derived(taskActive ? "Working" : backendReady ? "Ready" : "Backend unavailable");
	const activityLogs = $derived(
		feed
			.filter((item) => item.type === "activity" && ["command", "error"].includes(item.activity.kind))
			.slice(-12)
			.flatMap((item) => (item.type === "activity" ? [`${item.activity.title}${item.activity.detail ? `\n${item.activity.detail}` : ""}`] : [])),
	);
	const workspaceListeners = $derived(runningServices.filter((service) => service.kind === "listener"));
	const hasWorkspaceProcess = $derived(
		terminalBusy || workspaceListeners.length > 0 || activityLogs.length > 0,
	);
	const bottomPanelVisible = $derived(hasConversation && bottomPanelRevealed);
	const mcpServers = $derived(mcpStatus?.servers ?? []);
	const MIN_MAIN_COL = 280;
	const SESSION_RAIL = 48;
	const sessionColPx = $derived(sessionsExpanded ? sessionWidth : SESSION_RAIL);
	const filesColPx = $derived(!settingsOpen && !selectedProject && !workspaceView && workspacePanelOpen ? filesWidth : 0);
	const shellColumns = $derived(
		(settingsOpen && settingsFullscreen) || workspaceView === "browser"
			? "grid-cols-[minmax(0,1fr)]"
			: "grid-cols-[var(--session-col)_minmax(0,1fr)_var(--files-col)] narrow-900:grid-cols-[var(--session-col)_minmax(0,1fr)] narrow-720:grid-cols-1",
	);

	const currentModel = $derived.by(() => {
		const routing = currentConfig?.routing ?? "off";
		let reference = currentRoutingState?.selectedTarget;
		if (!reference) {
			if (routing === "frontier") reference = currentConfig?.frontierModel;
			else if (routing === "local" || routing === "auto") reference = currentConfig?.localModel;
			else if (lastState?.model) reference = `${lastState.model.provider}/${lastState.model.id}`;
		}
		const enabledAgentCount = configuredHarnessAgents.filter((agent) => agent.enabled && agent.kind).length;
		const enabledHarnessKinds = [
			...new Set(configuredHarnessAgents.filter((agent) => agent.enabled && agent.kind).map((agent) => agent.kind)),
		];
		if (enabledAgentCount > 1) {
			reference = `AGENT MODE — ${enabledAgentCount} agents, one swarm`;
		}
		const activeLane = currentRoutingState?.lane;
		return {
			reference: reference ?? "Not configured",
			statusClass: backendReady && reference ? "online" : backendReady ? "starting" : "error",
			badge:
				enabledAgentCount > 1
					? `Orchestrated · ${enabledHarnessKinds.join(" + ")}`
					: activeLane && activeLane !== "direct"
					? activeLane === "local"
						? "Agent 1"
						: "Agent 2"
					: routing === "off"
						? "Direct"
						: routing === "auto"
							? "Auto"
							: routing === "local"
								? "Agent 1"
								: "Agent 2",
		};
	});

	const workspaceRows = $derived(
		settingsOpen || selectedProject || workspaceView
			? "grid-rows-[minmax(0,1fr)]"
			: bottomPanelVisible
				? "grid-rows-[auto_minmax(0,1fr)_auto_auto] narrow-720:grid-rows-[auto_minmax(180px,1fr)_auto_auto]"
				: "grid-rows-[auto_minmax(0,1fr)_auto]",
	);
	const personalBotHarnessSetup = $derived.by(() => {
		if (!codingHarnessSetup) return undefined;
		const klermModels = [...new Set([...localOptions, ...frontierOptions].map((option) => option.value))];
		return {
			...codingHarnessSetup,
			harnesses: codingHarnessSetup.harnesses.map((harness) =>
				harness.kind === "klerm" ? { ...harness, models: klermModels } : harness,
			),
		};
	});
	const personalBotGenerationModel = $derived.by(() => {
		const first = firstHarnessAgent;
		if (first?.kind === "klerm" && first.model) return first.model;
		return klermModelCatalog[0] ?? "";
	});

	$effect(() => {
		if (!hasConversation) {
			bottomPanelRevealed = false;
			bottomPanelOpen = false;
			return;
		}
		if (hasWorkspaceProcess && !bottomPanelRevealed) {
			bottomPanelRevealed = true;
		}
	});

	$effect(() => {
		if (!taskActive) return;
		const timer = window.setInterval(() => void refreshRunningServices(), 2_000);
		return () => window.clearInterval(timer);
	});

	function setStatus(state: StatusInfo["state"], label: string, detail: string): void {
		status = { state, label, detail };
	}

	function showError(message: string): void {
		errorBanner = message;
	}

	function clearError(): void {
		errorBanner = "";
	}

	let notificationTarget = $state<{ botId: string } | undefined>(undefined);
	let personalBotsFocus = $state<string | undefined>(undefined);

	function showNotification(message: string, target?: { botId: string }, timeoutMs = 4_000): void {
		notification = message;
		notificationTarget = target;
		if (notificationTimer !== undefined) window.clearTimeout(notificationTimer);
		notificationTimer = window.setTimeout(() => {
			notification = "";
			notificationTarget = undefined;
			notificationTimer = undefined;
		}, timeoutMs);
	}

	function openPersonalBot(botId: string): void {
		notification = "";
		notificationTarget = undefined;
		if (notificationTimer !== undefined) {
			window.clearTimeout(notificationTimer);
			notificationTimer = undefined;
		}
		selectedProjectId = undefined;
		settingsOpen = false;
		settingsFullscreen = false;
		workspaceView = "personal-bots";
		personalBotsFocus = botId;
		void loadPersonalBotConversation(botId);
	}

	function recordTaskError(message: string): void {
		taskHadErrors = true;
		const detail = message.trim();
		if (detail && !taskErrorDetails.includes(detail)) taskErrorDetails.push(detail);
	}

	function dismissBuildModeOffer(id: number): void {
		if (buildModeOffer?.id === id) buildModeOffer = undefined;
	}

	function switchBuildMode(id: number): void {
		const offer = buildModeOffer;
		if (!offer || offer.id !== id) return;
		buildModeOffer = undefined;
		void applyConfigUpdate(offer.agent === "agent1" ? { localRole: "builder" } : { frontierRole: "builder" });
	}

	function appendTerminal(text: string): void {
		terminalOutput = `${terminalOutput}${text}`.slice(-120_000);
	}

	function resetTerminal(cwd: string): void {
		terminalOutput = cwd ? `Klerm workspace shell\n${cwd}\n` : "";
		terminalBusy = false;
		terminalCurrentCommand = "";
		terminalStreamed = false;
		bottomPanelRevealed = false;
		bottomPanelOpen = false;
	}

	function maxFilesWidth(expanded: boolean): number {
		const left = expanded ? sessionWidth : SESSION_RAIL;
		return Math.max(280, window.innerWidth - left - MIN_MAIN_COL);
	}

	function applyFilesWidth(requested: number): void {
		const roomWithSession = maxFilesWidth(true);
		if (requested > roomWithSession) {
			sessionsExpanded = false;
			filesWidth = Math.min(requested, maxFilesWidth(false));
			return;
		}
		sessionsExpanded = true;
		filesWidth = Math.max(280, requested);
	}

	function startSessionResize(event: PointerEvent): void {
		if (window.innerWidth <= 720) return;
		event.preventDefault();
		const origin = event.clientX;
		const startWidth = sessionsExpanded ? sessionWidth : SESSION_RAIL;
		const onMove = (move: PointerEvent) => {
			const files = workspacePanelOpen ? filesWidth : 0;
			const maxWidth = Math.min(420, window.innerWidth - files - MIN_MAIN_COL);
			const next = Math.max(SESSION_RAIL, Math.min(maxWidth, startWidth + move.clientX - origin));
			if (next < 88) {
				sessionsExpanded = false;
				return;
			}
			sessionsExpanded = true;
			sessionWidth = next;
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	function startFilesResize(event: PointerEvent): void {
		if (window.innerWidth <= 900) return;
		event.preventDefault();
		const origin = event.clientX;
		const startWidth = filesWidth;
		const onMove = (move: PointerEvent) => {
			applyFilesWidth(startWidth - (move.clientX - origin));
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	function applyAgentViewsHeight(requested: number): void {
		const available = agentContextContainer?.clientHeight ?? 520;
		const maximum = Math.max(140, available - 140);
		const minimum = Math.min(180, maximum);
		agentViewsHeight = Math.max(minimum, Math.min(maximum, requested));
	}

	function startAgentViewsResize(event: PointerEvent): void {
		if (window.innerWidth <= 720 || !agentContextContainer) return;
		event.preventDefault();
		const top = agentContextContainer.getBoundingClientRect().top;
		const onMove = (move: PointerEvent) => applyAgentViewsHeight(move.clientY - top);
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	function pushTimeline(
		kind: string,
		tone: TimelineTone,
		title: string,
		detail = "",
		cardStatus: TimelineItem["status"] = "settled",
		dedupeId?: string,
	): TimelineItem {
		const item: TimelineItem = { id: ++timelineSeq, kind, tone, title, detail, status: cardStatus, open: false, dedupeId };
		feed.push({ id: ++feedSeq, type: "activity", activity: item });
		return item;
	}

	function findTimeline(dedupeId: string): TimelineItem | undefined {
		const entry = feed.find((item) => item.type === "activity" && item.activity.dedupeId === dedupeId);
		return entry?.type === "activity" ? entry.activity : undefined;
	}

	function renderCodingHarnessBridgeEvent(event: CodingHarnessBridgeEvent): void {
		if (event.event === "NO_DELEGATION") return;
		if (!event.parentTaskId && (event.status === "assigned" || event.status === "running")) return;
		const card = bridgeEventCard(event);
		const existingEntry = feed.find(
			(item) => item.type === "activity" && item.activity.dedupeId === card.dedupeId,
		);
		const existing = existingEntry?.type === "activity" ? existingEntry.activity : undefined;
		if (existing) {
			existing.title = card.title;
			existing.detail = card.detail;
			existing.tone = card.tone;
			existing.status = card.status;
			existing.agentId = card.agentId;
			existing.bridgeStatus = card.bridgeStatus;
			if (card.agentId && existingEntry && existingEntry.id <= (agentClearThrough[card.agentId] ?? 0)) {
				existingEntry.id = ++feedSeq;
				existing.id = ++timelineSeq;
			}
			return;
		}
		const item = pushTimeline("bridge", card.tone, card.title, card.detail, card.status, card.dedupeId);
		item.agentId = card.agentId;
		item.bridgeStatus = card.bridgeStatus;
	}

	function clearFeed(): void {
		buildModeOffer = undefined;
		lastFallbackReason = "";
		toolCards.clear();
		feed.length = 0;
		feedSeq = 0;
		timelineSeq = 0;
		messageSeq = 0;
		streamingMessageId = undefined;
	}

	function toggleTimeline(id: number): void {
		const entry = feed.find((candidate) => candidate.type === "activity" && candidate.activity.id === id);
		const item = entry?.type === "activity" ? entry.activity : undefined;
		if (item) item.open = !item.open;
	}

	function pushMessage(message: ChatMessage): ChatMessage {
		feed.push({ id: ++feedSeq, type: "message", message });
		return message;
	}

	function findMessage(id: number | undefined): ChatMessage | undefined {
		if (id === undefined) return undefined;
		const entry = feed.find((candidate) => candidate.type === "message" && candidate.message.id === id);
		return entry?.type === "message" ? entry.message : undefined;
	}

	function removeMessage(id: number): void {
		const index = feed.findIndex((candidate) => candidate.type === "message" && candidate.message.id === id);
		if (index >= 0) feed.splice(index, 1);
	}

	function addRoutingTransitionCard(transition: RoutingTransition): void {
		if (!transition || !["initial", "delegate", "return"].includes(transition.kind ?? "")) return;
		const dedupeId = `transition-${transition.id ?? transition.sequence ?? "unknown"}`;
		if (findTimeline(dedupeId)) return;
		const initial = transition.kind === "initial";
		const delegate = transition.kind === "delegate";
		const from = transition.fromLane ?? (initial ? "direct" : "local");
		const to = transition.toLane ?? (delegate ? "frontier" : "local");
		const arrow = initial ? "\u2192" : delegate ? "\u2193" : "\u2191";
		const model = initial || delegate ? transition.toTarget : (transition.fromTarget ?? transition.toTarget);
		const laneLabel = (lane: string) =>
			lane === "local" ? "Agent 1" : lane === "frontier" ? "Agent 2" : lane === "direct" ? "Direct" : lane;
		const title = `${arrow} ${laneLabel(from)} \u2192 ${laneLabel(to)}${model ? ` \u00b7 ${model}` : ""}`;
		const meta: string[] = [];
		if (transition.trigger) meta.push(`trigger: ${transition.trigger}`);
		if (delegate && typeof transition.cycle === "number") {
			meta.push(
				`cycle ${transition.cycle}${typeof transition.maxCycles === "number" ? `/${transition.maxCycles === 0 ? "unlimited" : transition.maxCycles}` : ""}`,
			);
		}
		const detail = [transition.reason, ...meta].filter((line) => line).join("\n");
		const failed = transition.trigger === "provider-failure";
		if (failed) recordTaskError(transition.reason ?? title);
		const item = pushTimeline("routing", failed ? "red" : "amber", title, detail, failed ? "error" : "settled", dedupeId);
		item.agentId = configuredHarnessAgents.find((agent) => agent.model === model)?.id;
	}

	function renderFallbackReason(state: RoutingState | undefined): void {
		const reason = state?.fallbackReason;
		if (!reason || reason === lastFallbackReason) return;
		lastFallbackReason = reason;
		pushTimeline("routing", "red", "Agent 2 fallback", reason, "error", `fallback-${activeTaskKey}-${reason}`);
	}

	function handleRetryStart(event: JsonObject): void {
		const attempt = Number(event.attempt ?? 0);
		const maxAttempts = Number(event.maxAttempts ?? 0);
		const errorMessage = typeof event.errorMessage === "string" ? event.errorMessage : "";
		pushTimeline(
			"retry",
			"amber",
			`Provider retry ${attempt}/${maxAttempts}`,
			errorMessage,
			"running",
			`retry-${activeTaskKey}-${attempt}`,
		);
	}

	function handleRetryEnd(event: JsonObject): void {
		const attempt = Number(event.attempt ?? 0);
		const item = findTimeline(`retry-${activeTaskKey}-${attempt}`);
		if (event.success === true) {
			if (item) {
				item.status = "settled";
				item.title = `Provider retry ${attempt} succeeded`;
			}
			return;
		}
		const finalError =
			typeof event.finalError === "string" && event.finalError.length > 0
				? event.finalError
				: "Provider request failed after retries";
		if (item) {
			item.status = "error";
			item.tone = "red";
			item.title = `Provider retry ${attempt} failed`;
			item.detail = finalError;
		} else {
			pushTimeline("error", "red", "Provider request failed", finalError, "error");
		}
		recordTaskError(finalError);
	}

	function handleToolStart(event: JsonObject): void {
		taskHadExecution = true;
		const toolCallId = String(event.toolCallId ?? "");
		const toolName = String(event.toolName ?? "unknown");
		const described = describeToolCall(toolName, event.args);
		const mcpMatch = resolveMcpTool(mcpServers, toolName);
		const mcpServer = mcpMatch?.server;
		const mcpTool = mcpMatch?.tool;
		if (mcpServer) {
			described.kind = "MCP server called";
			described.label = `${mcpServer.name} MCP called`;
			described.detail = `${mcpDisplayName(mcpServer)} / ${mcpTool?.remoteName ?? toolName}`;
		}
		const existingId = toolCards.get(toolCallId);
		if (existingId === undefined) {
			const item = pushTimeline(
				described.kind,
				described.tone,
				described.label,
				described.detail,
				"running",
				`tool-${toolCallId}`,
			);
			if (typeof event.agentId === "string") item.agentId = event.agentId;
			item.detailType = described.detailType;
			if (mcpServer) {
				item.mcp = {
					serverName: mcpServer.name,
					displayName: mcpDisplayName(mcpServer),
					toolName: mcpTool?.remoteName,
					color: mcpServer.color ?? "base",
				};
			}
			toolCards.set(toolCallId, item.id);
			return;
		}
		const entry = feed.find((candidate) => candidate.type === "activity" && candidate.activity.id === existingId);
		const item = entry?.type === "activity" ? entry.activity : undefined;
		if (item) {
			item.title = described.label;
			item.status = "running";
			if (described.detail) item.detail = described.detail;
		}
	}

	function handleToolEnd(event: JsonObject): void {
		const existingId = toolCards.get(String(event.toolCallId ?? ""));
		if (existingId === undefined) return;
		const entry = feed.find((candidate) => candidate.type === "activity" && candidate.activity.id === existingId);
		const item = entry?.type === "activity" ? entry.activity : undefined;
		if (!item) return;
		const result = event.result as { content?: AgentMessage["content"] } | undefined;
		const images = contentImages(result?.content);
		if (images.length > 0) item.images = images;
		if (event.isError === true) {
			const errorText = resultErrorText(event.result) ?? "Tool execution failed";
			recordTaskError(errorText);
			item.status = "error";
			item.tone = "red";
			item.detail = event.toolName === "bash" ? [item.detail, errorText].filter(Boolean).join("\n\n") : errorText;
			item.detailType = event.toolName === "bash" ? "code" : "text";
			return;
		}
		item.status = "settled";
		if (event.toolName === "edit") {
			const diff = toolResultDetails(event.result)?.diff;
			if (typeof diff === "string" && diff.length > 0) {
				item.detail = diff;
				item.detailType = "diff";
			}
		}
		if (event.toolName === "bash") {
			const resultText = resultErrorText(event.result);
			if (resultText) item.detail = [item.detail, resultText].filter(Boolean).join("\n\n");
			item.detailType = "code";
		}
		if (!item.detail) {
			const resultText = truncateText(toDisplayText(event.result));
			if (resultText && resultText !== "{}") item.detail = resultText;
		}
	}

	function modelLabel(message: AgentMessage | undefined): string | undefined {
		const model = message?.responseModel ?? message?.model;
		if (!model) return undefined;
		return message?.provider ? `${message.provider}/${model}` : model;
	}

	function agentIdForModel(model: string | undefined): string | undefined {
		if (!model) return undefined;
		return configuredHarnessAgents.find((agent) => agent.model === model)?.id;
	}

	function appendAssistantMessage(
		message?: AgentMessage,
		agentId?: string,
		sender?: string,
		recipient?: string,
	): void {
		const item: ChatMessage = {
			id: ++messageSeq,
			role: "assistant",
			text: "",
			model: modelLabel(message),
			streaming: true,
			...(agentId ? { agentId } : {}),
			...(sender ? { sender } : {}),
			...(recipient ? { recipient } : {}),
		};
		pushMessage(item);
		streamingMessageId = item.id;
	}

	function finalizeStreamingMessage(): void {
		if (streamingMessageId === undefined) return;
		const item = findMessage(streamingMessageId);
		if (item) item.streaming = false;
		streamingMessageId = undefined;
	}

	function renderSessionEntries(entries: SessionEntryRecord[], leafId: string | null): void {
		const entryById = new Map(entries.map((entry) => [entry.id, entry]));
		const activeBranch: SessionEntryRecord[] = [];
		let cursor = leafId ? entryById.get(leafId) : undefined;
		while (cursor) {
			activeBranch.push(cursor);
			cursor = cursor.parentId ? entryById.get(cursor.parentId) : undefined;
		}
		activeBranch.reverse();
		const structuredHandoffTaskIds = new Set(
			activeBranch.flatMap((entry) => {
				if (entry.type !== "custom" || entry.customType !== "klerm-bridge-chat") return [];
				const chat = entry.data as CodingHarnessBridgeChatEntry;
				return chat.kind === "handoff" && chat.taskId ? [chat.taskId] : [];
			}),
		);
		let displayPrompt: string | undefined;
		let replayAgentId: string | undefined;
		let participant: CodingHarnessBridgeChatEntry | undefined;
		const latestAssistantByAgent = new Map<string, ChatMessage>();
		for (const entry of activeBranch) {
			if (entry.type === "custom" && entry.customType === "klerm-desktop-display-prompt") {
				const data = entry.data as { text?: unknown } | undefined;
				displayPrompt = typeof data?.text === "string" ? data.text : undefined;
				continue;
			}
			if (entry.type === "custom" && entry.customType === "klerm-transition") {
				const data = entry.data as { transition?: RoutingTransition } | undefined;
				if (data?.transition) {
					addRoutingTransitionCard(data.transition);
					replayAgentId = agentIdForModel(data.transition.toTarget);
				}
				continue;
			}
			if (entry.type === "custom" && entry.customType === "klerm-bridge-event") {
				const bridgeEvent = entry.data as CodingHarnessBridgeEvent;
				if (bridgeEvent.event === "TASK_CREATED" && bridgeEvent.sender === "user") {
					const latestUser = [...feed]
						.reverse()
						.find((item) => item.type === "message" && item.message.role === "user");
					if (latestUser?.type === "message" && !latestUser.message.recipient) {
						latestUser.message.sender = "user";
						latestUser.message.recipient = bridgeEvent.recipient;
						latestUser.message.agentId = bridgeEvent.recipient;
					}
				}
				if (
					!structuredHandoffTaskIds.has(bridgeEvent.taskId) &&
					bridgeEvent.event === "TASK_ASSIGNED" &&
					bridgeEvent.parentTaskId &&
					bridgeEvent.sender.startsWith("agent") &&
					bridgeEvent.recipient.startsWith("agent")
				) {
					pushMessage({
						id: ++messageSeq,
						role: "user",
						text: latestAssistantByAgent.get(bridgeEvent.sender)?.text ?? bridgeEvent.reason,
						agentId: bridgeEvent.sender,
						sender: bridgeEvent.sender,
						recipient: bridgeEvent.recipient,
						kind: "handoff",
						streaming: false,
					});
				}
				if (
					bridgeEvent.event === "TASK_RETURNED" &&
					bridgeEvent.sender.startsWith("agent") &&
					bridgeEvent.recipient.startsWith("agent")
				) {
					const returnedMessage = latestAssistantByAgent.get(bridgeEvent.sender);
					if (returnedMessage && !returnedMessage.recipient) {
						returnedMessage.sender = bridgeEvent.sender;
						returnedMessage.recipient = bridgeEvent.recipient;
						returnedMessage.agentId = bridgeEvent.sender;
					}
				}
				renderCodingHarnessBridgeEvent(bridgeEvent);
				replayAgentId = bridgeEvent.agentId ?? replayAgentId;
				continue;
			}
			if (entry.type === "custom" && entry.customType === "klerm-bridge-chat") {
				const chat = entry.data as CodingHarnessBridgeChatEntry;
				if (chat.kind === "handoff" && chat.body?.trim()) {
					pushMessage({
						id: ++messageSeq,
						role: "user",
						text: chat.body,
						agentId: chat.sender.startsWith("agent") ? chat.sender : undefined,
						sender: chat.sender,
						recipient: chat.recipient,
						kind: "handoff",
						streaming: false,
					});
				} else if (chat.kind === "participant") {
					participant = chat;
				}
				continue;
			}
			if (entry.type !== "message" || !entry.message) continue;
			const message = entry.message;
			if (message.role === "user" || message.role === "assistant") {
				if (message.role === "assistant") replayAgentId = agentIdForModel(modelLabel(message)) ?? replayAgentId;
				const rawText = messageText(message);
				const text = message.role === "user" && displayPrompt ? displayPrompt : rawText;
				const images = contentImages(message.content);
				if (message.role === "user") displayPrompt = undefined;
				if (text || images.length > 0) {
					const metadata =
						participant?.role === message.role && (!participant.body || participant.body === rawText)
							? participant
							: undefined;
					const rendered = pushMessage({
						id: ++messageSeq,
						role: message.role,
						text,
						images,
						model: message.role === "assistant" ? modelLabel(message) : undefined,
						agentId:
							message.role === "assistant"
								? (metadata?.sender.startsWith("agent") ? metadata.sender : replayAgentId)
								: metadata?.recipient.startsWith("agent")
									? metadata.recipient
									: undefined,
						sender: metadata?.sender,
						recipient: metadata?.recipient,
						streaming: false,
					});
					if (message.role === "assistant" && rendered.agentId) {
						latestAssistantByAgent.set(rendered.agentId, rendered);
					}
				}
				participant = undefined;
				if (message.role === "assistant" && Array.isArray(message.content)) {
					for (const part of message.content) {
						if (part.type === "toolCall" && part.id && part.name) {
								handleToolStart({
								type: "tool_execution_start",
								toolCallId: part.id,
								toolName: part.name,
									args: part.arguments ?? {},
									agentId: replayAgentId,
							});
						}
					}
				}
				continue;
			}
			if (message.role === "toolResult" && message.toolCallId) {
				handleToolEnd({
					type: "tool_execution_end",
					toolCallId: message.toolCallId,
					toolName: message.toolName ?? "unknown",
					result: { content: message.content ?? [], details: message.details },
					isError: message.isError === true,
				});
			}
		}
	}

	function handleRpcEvent(event: JsonObject): void {
		switch (event.type) {
			case "personal_bot_conversation_changed":
			case "personal_bot_summary_updated":
			case "personal_bot_summaries_changed": {
				const conversation = event.conversation as PersonalBotConversation | undefined;
				if (conversation && typeof conversation.botId === "string") {
					const previous = personalBotConversations[conversation.botId];
					const botName = personalBots.bots.find((bot) => bot.id === conversation.botId)?.name ?? "Personal Bot";
					const summaryCreated =
						previous !== undefined && conversation.summaries.length > (previous?.summaries.length ?? 0);
					const latestAssistant = [...conversation.messages].reverse().find((message) => message.role === "assistant");
					if (summaryCreated && workspaceView !== "personal-bots") {
						showNotification(`${botName} added a coding summary`, { botId: conversation.botId }, 8_000);
					} else if (
						latestAssistant &&
						!notifiedPersonalBotMessages.has(latestAssistant.id) &&
						conversation.status === "idle" &&
						workspaceView !== "personal-bots"
					) {
						notifiedPersonalBotMessages.add(latestAssistant.id);
						showNotification(`${botName} completed a reply`, { botId: conversation.botId });
					}
					personalBotConversations = { ...personalBotConversations, [conversation.botId]: conversation };
				}
				return;
			}
			case "personal_bot_error": {
				if (typeof event.message === "string") showError(event.message);
				return;
			}
			case "personal_bot_tool":
				return;
			case "kanban_event": {
				if (
					typeof event.boardId === "string" &&
					typeof event.taskId === "string" &&
					typeof event.text === "string"
				) {
					kanbanActivity = [
						...kanbanActivity.slice(-299),
						{
							kind: typeof event.kind === "string" ? event.kind : "info",
							boardId: event.boardId,
							taskId: event.taskId,
							timestamp: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
							text: event.text,
						},
					];
				}
				return;
			}
			case "kanban_registry_changed": {
				const registry = event.registry as KanbanRegistry | undefined;
				if (registry && Array.isArray(registry.boards)) kanbanRegistry = registry;
				return;
			}
			case "extension_ui_request": {
				if (
					event.method === "confirm" &&
					typeof event.id === "string" &&
					typeof event.title === "string" &&
					typeof event.message === "string"
				) {
					if (pendingApproval) {
						void bridge.respond({ type: "extension_ui_response", id: pendingApproval.id, confirmed: false });
					}
					pendingApproval = { id: event.id, title: event.title, message: event.message };
					bottomPanelRevealed = true;
					bottomPanelOpen = true;
				} else if (event.method === "provider_oauth_notify" && typeof event.id === "string") {
					const notify = event.notify as Record<string, unknown> | undefined;
					if (notify && oauthStep) {
						oauthStep = {
							...oauthStep,
							...(typeof notify.url === "string" ? { url: notify.url } : {}),
							...(typeof notify.instructions === "string" ? { instructions: notify.instructions } : {}),
							...(typeof notify.userCode === "string" ? { userCode: notify.userCode } : {}),
							...(typeof notify.verificationUri === "string" ? { verificationUri: notify.verificationUri } : {}),
							...(typeof notify.message === "string" ? { message: notify.message } : {}),
						};
					}
				} else if (event.method === "provider_oauth_prompt" && typeof event.id === "string") {
					const prompt = event.prompt as Record<string, unknown> | undefined;
					if (prompt && typeof prompt.message === "string" && oauthStep) {
						const options = Array.isArray(prompt.options)
							? (prompt.options as Array<Record<string, unknown>>)
									.filter((option) => typeof option.id === "string" && typeof option.label === "string")
									.map((option) => ({
										id: option.id as string,
										label: option.label as string,
										description: typeof option.description === "string" ? option.description : undefined,
									}))
							: undefined;
						oauthStep = {
							...oauthStep,
							prompt: {
								id: event.id,
								promptType: typeof prompt.promptType === "string" ? prompt.promptType : "text",
								message: prompt.message,
								options,
							},
						};
					}
				}
				return;
			}
			case "agent_start": {
				if (!taskActive) {
					activeTaskKey = ++taskSeq;
					taskStopping = false;
					taskHadErrors = false;
					taskHadExecution = false;
					taskErrorDetails = [];
					taskSawAssistant = false;
					lastAssistantStopReason = undefined;
				}
				taskActive = true;
				return;
			}
			case "agent_settled": {
				if (activeWorkspaceView !== "agents-routing") {
					const agentId =
						typeof event.agentId === "string" ? event.agentId : activeHarnessAgentId ?? activeAgent;
					showNotification(`Agent ${agentId.replace(/^agent/, "")} settled`);
				}
				pendingApproval = undefined;
				finalizeStreamingMessage();
				for (const entry of feed) {
					if (
						entry.type === "activity" &&
						entry.activity.kind === "thinking" &&
						entry.activity.status === "running"
					) {
						entry.activity.status = "settled";
					}
				}
				const outcome = event.outcome as TaskOutcome | undefined;
				const outcomeFailed =
					outcome !== undefined &&
					outcome.status !== "completed" &&
					outcome.status !== "implemented-and-verified";
				const failed =
					!taskStopping && (outcomeFailed || !taskSawAssistant || lastAssistantStopReason === "error");
				const settledAgent = activeAgent;
				const settledRole = settledAgent === "agent1" ? currentConfig?.localRole : currentConfig?.frontierRole;
				const outcomeTitle =
					outcome?.status === "implemented-and-verified"
						? "Implemented and verified"
						: outcome?.status === "blocked-before-implementation"
							? "Blocked before implementation"
							: outcome?.status === "plan-returned-instead-of-implementation"
								? "Plan returned instead of implementation"
								: outcome?.status === "verification-missing"
									? "Implementation not verified"
									: outcome?.status === "failed"
										? "Task failed"
										: undefined;
				taskActive = false;
				if (
					!externalHarnessesEnabled &&
					!failed &&
					!taskStopping &&
					!taskHadErrors &&
					taskSawAssistant &&
					settledRole === "planner"
				) {
					buildModeOffer = { id: ++buildModeOfferSeq, agent: settledAgent };
				}
				if (outcomeFailed || taskHadExecution || taskStopping) {
					const completionDetail = [
						outcome?.reason,
						taskErrorDetails.length > 0 ? taskErrorDetails.join("\n\n") : undefined,
						outcome?.status === "implemented-and-verified"
							? `${outcome.changedFileCount} changed file${outcome.changedFileCount === 1 ? "" : "s"}; ${outcome.verificationCount} verification${outcome.verificationCount === 1 ? "" : "s"}.`
							: undefined,
					]
						.filter((detail): detail is string => Boolean(detail))
						.join("\n\n");
					pushTimeline(
						"task",
						failed ? "red" : taskHadErrors ? "amber" : "neutral",
						taskCompletionTitle(taskStopping, taskHadErrors, outcomeTitle, failed),
						completionDetail,
						failed ? "error" : "settled",
					);
				}
				taskStopping = false;
				taskHadErrors = false;
				taskHadExecution = false;
				taskErrorDetails = [];
				taskSawAssistant = false;
				lastAssistantStopReason = undefined;
				activeTaskKey = 0;
				void refreshSessions();
				void refreshStateAfterSettle();
				void refreshWorkspace();
				void refreshRunningServices();
				if (mcpNeedsReload && supportsCommand("reload_mcp_servers")) {
					mcpNeedsReload = false;
					void reloadMcpServers();
				} else {
					void refreshMcpStatus();
				}
				return;
			}
			case "message_start": {
				const startedMessage = event.message as AgentMessage | undefined;
				if (startedMessage?.role === "assistant") {
					appendAssistantMessage(
						startedMessage,
						typeof event.agentId === "string" ? event.agentId : undefined,
						typeof event.sender === "string" ? event.sender : undefined,
						typeof event.recipient === "string" ? event.recipient : undefined,
					);
				}
				return;
			}
			case "message_update": {
				const update = event.assistantMessageEvent as JsonObject | undefined;
				if (update?.type === "thinking_start") {
					pushTimeline(
						"thinking",
						"neutral",
						"Thinking",
						"The selected model is reasoning. Klerm does not retain or display raw private reasoning.",
						"running",
						`thinking-${activeTaskKey}-${typeof event.agentId === "string" ? event.agentId : "default"}`,
					);
				}
				if (update?.type === "thinking_end") {
					const item = findTimeline(
						`thinking-${activeTaskKey}-${typeof event.agentId === "string" ? event.agentId : "default"}`,
					);
					if (item) item.status = "settled";
				}
				if (update?.type === "text_delta" && typeof update.delta === "string") {
					if (streamingMessageId === undefined) {
						appendAssistantMessage(
							undefined,
							typeof event.agentId === "string" ? event.agentId : undefined,
							typeof event.sender === "string" ? event.sender : undefined,
							typeof event.recipient === "string" ? event.recipient : undefined,
						);
					}
					const item = findMessage(streamingMessageId);
					if (item) item.text += update.delta;
				}
				return;
			}
			case "message_end": {
				const completedMessage = event.message as AgentMessage | undefined;
				if (completedMessage?.role !== "assistant") return;
				const thinkingItem = findTimeline(
					`thinking-${activeTaskKey}-${typeof event.agentId === "string" ? event.agentId : "default"}`,
				);
				if (thinkingItem) thinkingItem.status = "settled";
				taskSawAssistant = true;
				lastAssistantStopReason = completedMessage.stopReason;
				const finalText = messageText(completedMessage);
				const images = contentImages(completedMessage.content);
				const item = findMessage(streamingMessageId);
				if (item) {
					item.text = finalText || item.text;
					item.images = images;
					item.streaming = false;
					if (completedMessage.model) item.model = modelLabel(completedMessage);
					if (typeof event.agentId === "string") item.agentId = event.agentId;
					if (typeof event.sender === "string") item.sender = event.sender;
					if (typeof event.recipient === "string") item.recipient = event.recipient;
					if (!item.text && images.length === 0) removeMessage(item.id);
				} else if (finalText || images.length > 0) {
					pushMessage({
						id: ++messageSeq,
						role: "assistant",
						text: finalText,
						images,
						model: modelLabel(completedMessage),
						agentId: typeof event.agentId === "string" ? event.agentId : undefined,
						sender: typeof event.sender === "string" ? event.sender : undefined,
						recipient: typeof event.recipient === "string" ? event.recipient : undefined,
						streaming: false,
					});
				}
				streamingMessageId = undefined;
				if (completedMessage.stopReason === "error") {
					recordTaskError(completedMessage.errorMessage ?? "The model ended with an error.");
					pushTimeline(
						"error",
						"red",
						"Model request failed",
						completedMessage.errorMessage ?? "The model ended with an error.",
						"error",
					);
				}
				return;
			}
			case "tool_execution_start": {
				handleToolStart(event);
				return;
			}
			case "tool_execution_end": {
				pendingApproval = undefined;
				handleToolEnd(event);
				if (event.toolName === "configure_mcp_server" && event.isError !== true) {
					mcpNeedsReload = true;
					void refreshMcpStatus();
				}
				return;
			}
			case "routing_changed": {
				const state = event.state as RoutingState | undefined;
				currentRoutingState = state;
				if (state?.selectedAgentId && state.selectedHarness && state.selectedTarget) {
					pushTimeline(
						"routing",
						"amber",
						`→ Agent ${state.selectedAgentId.slice(5)} / ${state.selectedHarness === "opencode" ? "OpenCode" : state.selectedHarness === "codex" ? "Codex" : state.selectedHarness} / ${state.selectedTarget}`,
						state.reason ?? "Selected from the runnable coding-agent roster.",
						"settled",
						`harness-route-${state.routingSequence ?? activeTaskKey}`,
					);
				}
				if (currentConfig && state && (!state.selectedHarness || state.selectedHarness === "klerm")) {
					currentConfig = {
						...currentConfig,
						routing: state.mode,
						activeStartLane: state.activeStartLane ?? currentConfig.activeStartLane,
						localModel: state.localModel ?? currentConfig.localModel,
						frontierModel: state.frontierModel ?? currentConfig.frontierModel,
					};
				}
				if (state?.lastTransition) addRoutingTransitionCard(state.lastTransition);
				renderFallbackReason(state);
				void refreshThinkingLevels();
				return;
			}
			case "bridge_event": {
				renderCodingHarnessBridgeEvent(event.event as CodingHarnessBridgeEvent);
				return;
			}
			case "bridge_chat_message": {
				const chat = event.message as CodingHarnessBridgeChatEntry | undefined;
				if (chat?.kind === "handoff" && chat.body?.trim()) {
					pushMessage({
						id: ++messageSeq,
						role: "user",
						text: chat.body,
						agentId: chat.sender.startsWith("agent") ? chat.sender : undefined,
						sender: chat.sender,
						recipient: chat.recipient,
						kind: "handoff",
						streaming: false,
					});
				}
				return;
			}
			case "thinking_level_changed": {
				const level = event.level as ThinkingLevel | undefined;
				if (level) {
					if (lastState) lastState = { ...lastState, thinkingLevel: level };
					if (currentRoutingState?.lane === "local") localThinking = { ...localThinking, level };
					if (currentRoutingState?.lane === "frontier") frontierThinking = { ...frontierThinking, level };
				}
				return;
			}
			case "model_select": {
				const model = event.model as { provider?: string; id?: string } | undefined;
				if (model?.provider && model.id && lastState) {
					lastState = { ...lastState, model: { provider: model.provider, id: model.id } };
				}
				return;
			}
			case "auto_retry_start": {
				handleRetryStart(event);
				return;
			}
			case "auto_retry_end": {
				handleRetryEnd(event);
				return;
			}
			case "workspace_files_changed": {
				void refreshWorkspace();
				return;
			}
			case "bash_execution_update": {
				if (terminalBusy && typeof event.delta === "string") {
					terminalStreamed = true;
					appendTerminal(event.delta);
				}
				return;
			}
			case "backend_error": {
				const text = typeof event.message === "string" ? event.message : "Backend error";
				if (taskActive) recordTaskError(text);
				pushTimeline("error", "red", text, "", "error");
				return;
			}
			case "backend_exit": {
				if (backendRestarting) return;
				pendingApproval = undefined;
				backendReady = false;
				setStatus("error", "Backend stopped", "Restart Klerm to reconnect");
				taskActive = false;
				showError("The Klerm backend stopped unexpectedly.");
			}
		}
	}

	async function refreshStateAfterSettle(): Promise<void> {
		try {
			const state = await bridge.send<SessionState>("get_state");
			lastState = state;
			if (!sessionTransitionActive) {
				sessionTitle = state.sessionName ?? sessionTitle;
				sessionCwd = state.cwd;
			}
		} catch {
			// Backend may be restarting; state will refresh on reconnect.
		}
	}

	async function refreshSessions(): Promise<void> {
		try {
			const result = await bridge.send<{ sessions: DesktopSession[] }>("list_sessions");
			sessions = result.sessions;
		} catch (error) {
			sessions = [];
			showError(toError(error).message);
		}
	}

	async function refreshWorkspace(): Promise<void> {
		if (!backendReady) return;
		try {
			const next = await bridge.send<WorkspaceStatus>("get_workspace_status");
			workspace = next;
			github = await bridge.send<GitHubStatus>("get_github_status");
			if (selectedFilePath && !next.files.some((file) => file.path === selectedFilePath)) {
				selectedFilePath = undefined;
				selectedFileDiff = "";
				selectedFileContent = undefined;
			}
			if (!selectedFilePath && next.files[0] && workspacePanelOpen) void selectWorkspaceFile(next.files[0].path);
		} catch (error) {
			workspace = undefined;
			showError(toError(error).message);
		}
	}

	async function initializeGit(): Promise<void> {
		if (gitBusy || taskActive || !backendReady) return;
		if (!(await confirmDialog("Initialize a Git repository in the selected workspace? This only runs git init.")))
			return;
		gitBusy = true;
		try {
			workspace = await bridge.send<WorkspaceStatus>("initialize_git_repository");
			showNotification("Git repository initialized");
		} catch (error) {
			showError(toError(error).message);
		} finally {
			gitBusy = false;
		}
	}

	async function loginGitHub(): Promise<void> {
		if (gitBusy || !backendReady) return;
		gitBusy = true;
		try {
			github = await bridge.send<GitHubStatus>("login_github", {}, 300_000);
			showNotification("GitHub connected");
		} catch (error) {
			showError(toError(error).message);
		} finally {
			gitBusy = false;
		}
	}

	function openProjectFiles(): void {
		if (!backendReady || projectFilesLoading) return;
		projectFilesLoading = true;
		void bridge
			.send<{ projectRoot: string; files: string[]; truncated: boolean }>("list_workspace_files")
			.then((result) => {
				projectFiles = result.files;
				projectFilesTruncated = result.truncated;
			})
			.catch((error) => {
				projectFiles = [];
				showError(toError(error).message);
			})
			.finally(() => {
				projectFilesLoading = false;
			});
	}

	async function selectWorkspaceFile(path: string): Promise<void> {
		selectedFilePath = path;
		selectedFileDiff = "";
		selectedFileContent = undefined;
		fileLoading = true;
		try {
			const [diffResult, contentResult] = await Promise.allSettled([
				bridge.send<{ path: string; diff: string }>("get_workspace_diff", { path }),
				bridge.send<{ path: string; content: string; size: number }>("read_workspace_file", { path }),
			]);
			if (selectedFilePath !== path) return;
			if (diffResult.status === "fulfilled") selectedFileDiff = diffResult.value.diff;
			else showError(toError(diffResult.reason).message);
			if (contentResult.status === "fulfilled") selectedFileContent = contentResult.value.content;
		} finally {
			if (selectedFilePath === path) fileLoading = false;
		}
	}

	async function saveWorkspaceFile(path: string, content: string): Promise<boolean> {
		if (fileSaving || taskActive) return false;
		fileSaving = true;
		clearError();
		try {
			await bridge.send("write_workspace_file", { path, content });
			selectedFileContent = content;
			await refreshWorkspace();
			await selectWorkspaceFile(path);
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			fileSaving = false;
		}
	}

	async function refreshEditors(): Promise<void> {
		try {
			const result = await bridge.send<{ editors: EditorInfo[] }>("get_available_editors");
			editors = result.editors;
		} catch (error) {
			editors = [];
			showError(toError(error).message);
		}
	}

	async function openWorkspaceEditor(editor: EditorInfo["id"]): Promise<void> {
		try {
			await bridge.send("open_workspace_editor", { editor });
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function refreshRunningServices(): Promise<void> {
		if (!backendReady || runningServicesBusy) return;
		runningServicesBusy = true;
		try {
			const result = await bridge.send<{ services: RunningService[] }>("get_running_services");
			runningServices = result.services;
		} catch (error) {
			runningServices = [];
			showError(toError(error).message);
		} finally {
			runningServicesBusy = false;
		}
	}

	function supportsCommand(name: string): boolean {
		return backendCommands.includes(name);
	}

	async function refreshMcpStatus(): Promise<void> {
		if (!backendReady || mcpBusy || !supportsCommand("get_mcp_status")) return;
		mcpBusy = true;
		try {
			mcpStatus = await bridge.send<McpStatus>("get_mcp_status");
		} catch (error) {
			mcpStatus = undefined;
			showError(toError(error).message);
		} finally {
			mcpBusy = false;
		}
	}

	async function reloadMcpServers(): Promise<void> {
		if (!backendReady || interactionActive || mcpBusy || !supportsCommand("reload_mcp_servers")) return;
		mcpBusy = true;
		clearError();
		try {
			mcpStatus = await bridge.send<McpStatus>("reload_mcp_servers", {}, 45_000);
		} catch (error) {
			showError(toError(error).message);
		} finally {
			mcpBusy = false;
		}
	}

	async function refreshDesktopSettings(): Promise<void> {
		if (!backendReady || !supportsCommand("get_desktop_settings")) return;
		try {
			desktopSettings = await bridge.send<DesktopSettings>("get_desktop_settings");
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function refreshPersonalBots(): Promise<void> {
		if (!backendReady || !supportsCommand("get_personal_bots")) return;
		try {
			personalBots = await bridge.send<PersonalBotRegistry>("get_personal_bots");
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function savePersonalBot(bot: PersonalBot): Promise<boolean> {
		if (personalBotBusy || !supportsCommand("upsert_personal_bot")) return false;
		personalBotBusy = true;
		try {
			personalBots = await bridge.send<PersonalBotRegistry>("upsert_personal_bot", { bot });
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			personalBotBusy = false;
		}
	}

	async function savePersonalBotProfile(profile: KlermProfile): Promise<boolean> {
		if (personalBotBusy || !supportsCommand("upsert_klerm_profile")) return false;
		personalBotBusy = true;
		try {
			desktopSettings = await bridge.send<DesktopSettings>("upsert_klerm_profile", { profile });
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			personalBotBusy = false;
		}
	}

	async function generatePersonalBotMemory(model: string, brief: string): Promise<string | undefined> {
		if (personalBotBusy || !supportsCommand("generate_personal_bot_memory")) return undefined;
		personalBotBusy = true;
		try {
			const result = await bridge.send<PersonalBotMemoryDraft>("generate_personal_bot_memory", { model, brief });
			return result.text;
		} catch (error) {
			showError(toError(error).message);
			return undefined;
		} finally {
			personalBotBusy = false;
		}
	}

	async function deletePersonalBot(bot: PersonalBot): Promise<void> {
		if (
			personalBotBusy ||
			!supportsCommand("delete_personal_bot") ||
			!(await confirmDialog(`Delete ${bot.name}?`))
		)
			return;
		personalBotBusy = true;
		try {
			personalBots = await bridge.send<PersonalBotRegistry>("delete_personal_bot", { botId: bot.id });
			const { [bot.id]: _deleted, ...remaining } = personalBotConversations;
			personalBotConversations = remaining;
		} catch (error) {
			showError(toError(error).message);
		} finally {
			personalBotBusy = false;
		}
	}

	async function deletePersonalBotSummary(botId: string, summaryId: string): Promise<void> {
		if (
			personalBotBusy ||
			!supportsCommand("delete_personal_bot_summary") ||
			!(await confirmDialog("Delete this summary? This cannot be undone."))
		)
			return;
		personalBotBusy = true;
		try {
			const conversation = await bridge.send<PersonalBotConversation>("delete_personal_bot_summary", {
				botId,
				summaryId,
			});
			personalBotConversations = { ...personalBotConversations, [botId]: conversation };
		} catch (error) {
			showError(toError(error).message);
		} finally {
			personalBotBusy = false;
		}
	}

	async function loadPersonalBotConversation(botId: string): Promise<void> {
		if (!supportsCommand("get_personal_bot_conversation")) return;
		try {
			const conversation = await bridge.send<PersonalBotConversation>("get_personal_bot_conversation", { botId });
			personalBotConversations = { ...personalBotConversations, [botId]: conversation };
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function promptPersonalBot(botId: string, message: string): Promise<boolean> {
		if (!supportsCommand("prompt_personal_bot")) return false;
		try {
			const conversation = await bridge.send<PersonalBotConversation>("prompt_personal_bot", { botId, message });
			personalBotConversations = { ...personalBotConversations, [botId]: conversation };
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		}
	}

	async function abortPersonalBot(botId: string): Promise<void> {
		if (!supportsCommand("abort_personal_bot")) return;
		try {
			await bridge.send("abort_personal_bot", { botId });
		} catch (error) {
			showError(toError(error).message);
		}
	}

	let codingHarnessSetupQueue: Promise<void> = Promise.resolve();

	async function enqueueCodingHarnessSetup<T>(work: () => Promise<T>): Promise<T> {
		const run = codingHarnessSetupQueue.then(work, work);
		codingHarnessSetupQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	async function refreshCodingHarnessSetup(): Promise<void> {
		if (!backendReady || !supportsCommand("get_coding_harness_setup")) return;
		let missingModelKinds: CodingHarnessKind[] = [];
		await enqueueCodingHarnessSetup(async () => {
			codingHarnessSetupLoading = true;
			codingHarnessSetupError = "";
			try {
				codingHarnessSetup = await bridge.send<CodingHarnessSetup>("get_coding_harness_setup");
				missingModelKinds = [
					...new Set(
						codingHarnessSetup.slots.agents
							.map((agent) => agent.kind)
							.filter(
								(kind): kind is "pi" | "codex" | "opencode" =>
									(kind === "pi" || kind === "codex" || kind === "opencode") &&
									codingHarnessSetup?.harnesses.find((harness) => harness.kind === kind)?.models.length === 0,
							),
					),
				];
			} catch (error) {
				codingHarnessSetupError = toError(error).message;
			} finally {
				codingHarnessSetupLoading = false;
			}
		});
		for (const kind of missingModelKinds) await refreshCodingHarnessModels(kind);
	}

	async function refreshCodingHarnessModels(kind: CodingHarnessKind): Promise<void> {
		if (!backendReady || !supportsCommand("refresh_coding_harness_models")) return;
		await enqueueCodingHarnessSetup(async () => {
			try {
				const harness = await bridge.send<CodingHarnessSetup["harnesses"][number]>(
					"refresh_coding_harness_models",
					{ kind },
				);
				if (!codingHarnessSetup) return;
				codingHarnessSetup = {
					...codingHarnessSetup,
					harnesses: codingHarnessSetup.harnesses.map((candidate) =>
						candidate.kind === kind ? harness : candidate,
					),
				};
			} catch (error) {
				codingHarnessSetupError = toError(error).message;
			}
		});
	}

	async function saveCodingHarnessSlots(slots: CodingHarnessSetup["slots"]): Promise<boolean> {
		if (!backendReady || !supportsCommand("set_coding_harness_slots")) return false;
		return enqueueCodingHarnessSetup(async () => {
			codingHarnessSetupLoading = true;
			codingHarnessSetupError = "";
			try {
				codingHarnessSetup = await bridge.send<CodingHarnessSetup>("set_coding_harness_slots", { slots });
				return true;
			} catch (error) {
				codingHarnessSetupError = toError(error).message;
				return false;
			} finally {
				codingHarnessSetupLoading = false;
			}
		});
	}

	async function updateCodingHarnessAgent(
		id: string,
		update: Partial<CodingHarnessSlotSettings>,
	): Promise<boolean> {
		if (!codingHarnessSetup) return false;
		return saveCodingHarnessSlots(updateCodingHarnessSlot(codingHarnessSetup.slots, id, update));
	}

	async function setCodingHarnessAgentModel(id: string, model: string): Promise<void> {
		const agent = codingHarnessSetup?.slots.agents.find((candidate) => candidate.id === id);
		if (!agent || !(await updateCodingHarnessAgent(id, { model: model || undefined }))) return;
		if (agent.kind === "klerm" && id === "agent1") await applyConfigUpdate({ localModel: model });
		if (agent.kind === "klerm" && id === "agent2") await applyConfigUpdate({ frontierModel: model });
	}

	async function setCodingHarnessAgentKind(id: string, kind: CodingHarnessKind): Promise<void> {
		await refreshCodingHarnessModels(kind);
		await updateCodingHarnessAgent(id, { kind, model: undefined });
	}

	async function setCodingHarnessAgentPersonality(id: string, botId: string): Promise<void> {
		const bot = personalBots.bots.find((candidate) => candidate.id === botId);
		await updateCodingHarnessAgent(
			id,
			bot
				? { personalBotId: bot.id, memoryProfileId: bot.profileId }
				: { personalBotId: undefined, memoryProfileId: undefined },
		);
	}

	async function setCodingHarnessAgentEffort(id: string, effort: ThinkingLevel): Promise<boolean> {
		const agent = codingHarnessSetup?.slots.agents.find((candidate) => candidate.id === id);
		if (!agent || !(await updateCodingHarnessAgent(id, { effort }))) return false;
		if (agent.kind === "klerm" && id === "agent1") await applyThinkingLevel("local", effort);
		if (agent.kind === "klerm" && id === "agent2") await applyThinkingLevel("frontier", effort);
		return true;
	}

	async function setCodingHarnessAgentRole(id: string, role: "planner" | "builder"): Promise<void> {
		const agent = codingHarnessSetup?.slots.agents.find((candidate) => candidate.id === id);
		if (!agent || !(await updateCodingHarnessAgent(id, { role }))) return;
		if (agent.kind === "klerm" && id === "agent1") await applyConfigUpdate({ localRole: role });
		if (agent.kind === "klerm" && id === "agent2") await applyConfigUpdate({ frontierRole: role });
	}

	async function setAllCodingHarnessAgents(enabled: boolean): Promise<void> {
		if (!codingHarnessSetup) return;
		if (await saveCodingHarnessSlots(setAllCodingHarnessAgentsEnabled(codingHarnessSetup.slots, enabled))) {
			if (!enabled) visibleAgentIds = [];
			rememberAgentViews();
		}
	}

	async function turnOffExternalCodingHarnesses(): Promise<void> {
		if (!codingHarnessSetup) return;
		if (await saveCodingHarnessSlots(setExternalCodingHarnessesEnabled(codingHarnessSetup.slots, false))) {
			visibleAgentIds = [];
			rememberAgentViews();
		}
	}

	function closeAgentView(id: string): void {
		visibleAgentIds = visibleAgentIds.filter((candidate) => candidate !== id);
		rememberAgentViews();
	}

	function toggleAgentView(id: string): void {
		visibleAgentIds = visibleAgentIds.includes(id)
			? visibleAgentIds.filter((candidate) => candidate !== id)
			: [...visibleAgentIds, id].slice(-4);
		rememberAgentViews();
	}

	function clearAgentOutput(id: string): void {
		agentClearThrough = { ...agentClearThrough, [id]: feedSeq };
		rememberAgentViews();
	}

	async function addCodingHarnessAgent(): Promise<void> {
		if (!codingHarnessSetup || codingHarnessSetup.slots.agents.length >= 4) return;
		await saveCodingHarnessSlots(addCodingHarnessSlot(codingHarnessSetup.slots));
	}

	async function removeCodingHarnessAgent(id: string): Promise<void> {
		if (!codingHarnessSetup) return;
		await saveCodingHarnessSlots(removeCodingHarnessSlot(codingHarnessSetup.slots, id));
	}

	async function setWorkTogetherMode(enabled: boolean): Promise<void> {
		if (!codingHarnessSetup) return;
		const next = assignWorkTogetherModels(
			codingHarnessSetup.slots,
			currentConfig?.localModel,
			currentConfig?.frontierModel,
			klermModelCatalog,
		);
		if (enabled && !workTogetherAvailable) {
			return;
		}
		await saveCodingHarnessSlots({
			...next,
			workTogetherEnabled: enabled || undefined,
		});
	}

	async function setDesktopAppearance(appearance: DesktopAppearance): Promise<boolean> {
		if (!supportsCommand("set_desktop_appearance")) return false;
		try {
			desktopSettings = await bridge.send<DesktopSettings>("set_desktop_appearance", { appearance });
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		}
	}

	async function assignProfile(lane: "local" | "frontier", profileId: string): Promise<boolean> {
		if (!supportsCommand("assign_klerm_profile")) return false;
		try {
			desktopSettings = await bridge.send<DesktopSettings>("assign_klerm_profile", {
				lane,
				profileId: profileId || null,
			});
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		}
	}

	async function setSharedMemory(memory: string, presetId?: string): Promise<boolean> {
		if (!supportsCommand("set_klerm_shared_memory")) return false;
		try {
			desktopSettings = await bridge.send<DesktopSettings>("set_klerm_shared_memory", { memory, presetId });
			await refreshCodingHarnessSetup();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		}
	}

	async function saveDefaultSharedMemory(memory: string): Promise<boolean> {
		if (!supportsCommand("set_klerm_shared_memory")) return false;
		try {
			desktopSettings = await bridge.send<DesktopSettings>("set_klerm_shared_memory", {
				memory,
				activate: false,
			});
			await refreshCodingHarnessSetup();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		}
	}

	async function saveSharedMemoryPreset(name: string, memory: string): Promise<boolean> {
		if (!supportsCommand("save_klerm_shared_memory_preset")) return false;
		try {
			desktopSettings = await bridge.send<DesktopSettings>("save_klerm_shared_memory_preset", { name, memory });
			await refreshCodingHarnessSetup();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		}
	}

	async function deleteSharedMemoryPreset(presetId: string): Promise<boolean> {
		if (!supportsCommand("delete_klerm_shared_memory_preset")) return false;
		try {
			desktopSettings = await bridge.send<DesktopSettings>("delete_klerm_shared_memory_preset", { presetId });
			await refreshCodingHarnessSetup();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		}
	}

	async function addCustomModel(model: CustomModelEntry): Promise<boolean> {
		if (!supportsCommand("add_custom_model")) return false;
		try {
			desktopSettings = await bridge.send<DesktopSettings>("add_custom_model", { model });
			await refreshModels();
			await refreshProviderStatus();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		}
	}

	async function refreshProviderStatus(): Promise<void> {
		if (!backendReady || !supportsCommand("get_provider_status")) return;
		try {
			const result = await bridge.send<{ providers: ProviderAccount[] }>("get_provider_status");
			providerAccounts = result.providers;
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function connectProvider(account: ProviderConnect): Promise<boolean> {
		if (!supportsCommand("connect_provider") || providerBusy) return false;
		providerBusy = true;
		clearError();
		try {
			const result = await bridge.send<{ providers: ProviderAccount[] }>("connect_provider", { account });
			providerAccounts = result.providers;
			await refreshModels();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			providerBusy = false;
		}
	}

	async function startProviderOauth(provider: string): Promise<boolean> {
		if (!supportsCommand("connect_provider_oauth") || providerBusy) return false;
		providerBusy = true;
		clearError();
		oauthStep = { provider };
		try {
			const result = await bridge.send<{ providers: ProviderAccount[] }>(
				"connect_provider_oauth",
				{ provider },
				600_000,
			);
			providerAccounts = result.providers;
			await refreshModels();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			providerBusy = false;
			oauthStep = undefined;
		}
	}

	async function cancelProviderOauth(): Promise<void> {
		const step = oauthStep;
		oauthStep = undefined;
		if (step?.prompt) {
			void bridge.respond({ type: "extension_ui_response", id: step.prompt.id, cancelled: true });
		}
		if (supportsCommand("cancel_provider_oauth")) {
			try {
				await bridge.send("cancel_provider_oauth");
			} catch (error) {
				showError(toError(error).message);
			}
		}
		providerBusy = false;
	}

	function submitOauthPrompt(value: string): void {
		const step = oauthStep;
		const prompt = step?.prompt;
		if (!prompt) return;
		oauthStep = step ? { ...step, prompt: undefined } : undefined;
		void bridge.respond({ type: "extension_ui_response", id: prompt.id, value });
	}

	async function disconnectProvider(provider: string): Promise<boolean> {
		if (!supportsCommand("disconnect_provider") || providerBusy) return false;
		providerBusy = true;
		clearError();
		try {
			const result = await bridge.send<{ providers: ProviderAccount[] }>("disconnect_provider", { provider });
			providerAccounts = result.providers;
			await refreshModels();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			providerBusy = false;
		}
	}

	async function addMcpServer(server: McpServerUpdate): Promise<boolean> {
		if (!backendReady || interactionActive || mcpBusy || !supportsCommand("add_mcp_server")) return false;
		mcpBusy = true;
		clearError();
		try {
			const added = await bridge.send<{ status: McpStatus }>("add_mcp_server", { server });
			mcpStatus = added.status;
			mcpStatus = await bridge.send<McpStatus>("reload_mcp_servers", {}, 45_000);
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			mcpBusy = false;
		}
	}

	async function openLocalUrl(url: string): Promise<void> {
		try {
			await bridge.send("open_local_url", { url });
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function runTerminalCommand(command: string): Promise<void> {
		const value = command.trim();
		if (!value || terminalBusy || taskActive || !backendReady) return;
		terminalBusy = true;
		terminalCurrentCommand = value;
		terminalStreamed = false;
		clearError();
		appendTerminal(`${terminalOutput && !terminalOutput.endsWith("\n") ? "\n" : ""}$ ${value}\n`);
		try {
			const result = await bridge.send<BashResult>("bash", { command: value, excludeFromContext: true }, 0);
			if (!terminalStreamed && result.output) appendTerminal(result.output);
			if (result.output && !result.output.endsWith("\n") && !terminalOutput.endsWith("\n")) appendTerminal("\n");
			appendTerminal(
				result.cancelled
					? "[stopped]\n"
					: `[exit ${result.exitCode ?? "unknown"}${result.truncated ? ", output truncated" : ""}]\n`,
			);
		} catch (error) {
			const message = toError(error).message;
			appendTerminal(`[error] ${message}\n`);
			showError(message);
		} finally {
			terminalBusy = false;
			terminalCurrentCommand = "";
			void refreshRunningServices();
		}
	}

	async function stopTerminalCommand(): Promise<void> {
		if (!terminalBusy) return;
		try {
			await bridge.send("abort_bash");
		} catch (error) {
			showError(toError(error).message);
		}
	}

	async function switchSession(session: DesktopSession): Promise<boolean> {
		if (taskActive || terminalBusy || configBusy || sessionTransitionActive || !backendReady) return false;
		sessionTransitionActive = true;
		clearError();
		try {
			rememberAgentViews();
			const transition = await bridge.send<{ cancelled: boolean }>("switch_session", {
				sessionPath: session.sessionToken,
			});
			if (transition.cancelled) return false;
			const [entries, state] = await Promise.all([
				bridge.send<{ entries: SessionEntryRecord[]; leafId: string | null }>("get_entries"),
				bridge.send<SessionState>("get_state"),
			]);
			restoreAgentViews(state.sessionId);
			lastState = state;
			clearFeed();
			attachments = [];
			renderSessionEntries(entries.entries ?? [], entries.leafId);
			await refreshThinkingLevels();
			sessionTitle = state.sessionName ?? session.name ?? session.firstMessage;
			sessionCwd = state.cwd;
			resetTerminal(state.cwd);
			await refreshWorkspace();
			void refreshSessions();
			sidebarOpen = false;
			selectedProjectId = undefined;
			workspaceView = undefined;
			settingsOpen = false;
			settingsFullscreen = false;
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			sessionTransitionActive = false;
		}
	}

	async function deleteConversation(session: DesktopSession): Promise<void> {
		if (taskActive || terminalBusy || configBusy || sessionTransitionActive || !backendReady) return;
		const isActive = session.sessionToken === lastState?.sessionFile;
		sessionTransitionActive = true;
		clearError();
		try {
			if (isActive) {
				const transition = await bridge.send<{ cancelled: boolean }>("new_session");
				if (transition.cancelled) return;
				clearFeed();
				attachments = [];
				sessionTitle = "New Agent 1 session";
				lastState = await bridge.send<SessionState>("get_state");
				restoreAgentViews(lastState.sessionId);
				sessionCwd = lastState.cwd;
				resetTerminal(lastState.cwd);
				currentRoutingState = currentRoutingState
					? { ...currentRoutingState, lane: "direct", selectedTarget: undefined, lastTransition: undefined }
					: undefined;
			}
			await bridge.send("delete_session", { sessionToken: session.sessionToken });
			await Promise.all([refreshSessions(), refreshProjects()]);
		} catch (error) {
			showError(toError(error).message);
		} finally {
			sessionTransitionActive = false;
		}
	}

	async function renameActiveSession(name: string): Promise<boolean> {
		if (taskActive || terminalBusy || configBusy || sessionTransitionActive || !backendReady) return false;
		sessionTransitionActive = true;
		clearError();
		try {
			await bridge.send("set_session_name", { name });
			sessionTitle = name;
			if (lastState) lastState = { ...lastState, sessionName: name };
			await refreshSessions();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			sessionTransitionActive = false;
		}
	}

	async function renameSession(session: DesktopSession, name: string): Promise<boolean> {
		if (session.sessionToken === lastState?.sessionFile) return renameActiveSession(name);
		if (taskActive || terminalBusy || configBusy || sessionTransitionActive || !backendReady) return false;
		sessionTransitionActive = true;
		clearError();
		try {
			await bridge.send("rename_session", { sessionToken: session.sessionToken, name });
			await refreshSessions();
			return true;
		} catch (error) {
			showError(toError(error).message);
			return false;
		} finally {
			sessionTransitionActive = false;
		}
	}

	function mergeModelCatalog(options: SelectOption[]): SelectOption[] {
		const seen = new Set<string>();
		const merged: SelectOption[] = [];
		for (const option of options) {
			if (!option.value || seen.has(option.value)) continue;
			seen.add(option.value);
			merged.push(option);
		}
		return merged;
	}

	function assignAgentOptions(): void {
		const catalog = mergeModelCatalog(modelCatalog);
		if (catalog.length === 0) {
			localOptions = [{ value: "", label: "No models found" }];
			frontierOptions = [{ value: "", label: "No models found" }];
			return;
		}
		const agent1 = currentConfig?.localModel;
		const agent2 = currentConfig?.frontierModel;
		localOptions = catalog.filter((option) => option.value !== agent2);
		frontierOptions = catalog.filter((option) => option.value !== agent1);
		if (agent1 && !localOptions.some((option) => option.value === agent1)) {
			localOptions = [{ value: agent1, label: agent1 }, ...localOptions];
		}
		if (agent2 && !frontierOptions.some((option) => option.value === agent2)) {
			frontierOptions = [{ value: agent2, label: agent2 }, ...frontierOptions];
		}
	}

	async function refreshLocalModels(): Promise<void> {
		runtimeStatus = { state: "starting", title: "Checking local runtimes", detail: "Looking for installed models" };
		try {
			const result = await bridge.send<{ runtimes: LocalRuntime[] }>("get_local_runtimes");
			const runtimes = [...result.runtimes].sort((left, right) => {
				const leftPriority = left.providerId === "ollama" ? 0 : 1;
				const rightPriority = right.providerId === "ollama" ? 0 : 1;
				return leftPriority - rightPriority || left.name.localeCompare(right.name);
			});
			currentLocalRuntimes = runtimes;
			const modelOptions = runtimes.flatMap((runtime) =>
				runtime.models.map((model) => ({
					value: `${runtime.providerId}/${model.id}`,
					label: `${runtime.name} / ${model.id}${model.details ? ` / ${model.details}` : ""}`,
				})),
			);
			const availableRuntime = runtimes.find((runtime) => !runtime.error);
			if (modelOptions.length === 0) {
				runtimeStatus = {
					state: availableRuntime ? "error" : "starting",
					title: availableRuntime ? "No local models installed" : "No local runtime running",
					detail: availableRuntime
						? `${availableRuntime.name} is running without installed models`
						: "Start Ollama or pick a cloud model for Agent 1 or Agent 2",
				};
				return;
			}
			runtimeStatus = {
				state: "online",
				title: `${modelOptions.length} local model${modelOptions.length === 1 ? "" : "s"} ready`,
				detail: runtimes
					.filter((runtime) => !runtime.error)
					.map((runtime) => runtime.name)
					.join(" / "),
			};
		} catch (error) {
			currentLocalRuntimes = [];
			runtimeStatus = { state: "error", title: "Runtime discovery failed", detail: toError(error).message };
		}
	}

	async function refreshFrontierModels(): Promise<void> {
		try {
			const result = await bridge.send<{ models: Array<{ provider: string; id: string }> }>("get_available_models");
			const localOptionsFromRuntimes = currentLocalRuntimes.flatMap((runtime) =>
				runtime.models.map((model) => ({
					value: `${runtime.providerId}/${model.id}`,
					label: `${runtime.name} / ${model.id}${model.details ? ` / ${model.details}` : ""}`,
				})),
			);
			const available = result.models.map((model) => ({
				value: `${model.provider}/${model.id}`,
				label: `${model.provider} / ${model.id}`,
			}));
			modelCatalog = mergeModelCatalog([...localOptionsFromRuntimes, ...available]);
			assignAgentOptions();
			if (modelCatalog.length > 0 && runtimeStatus.state !== "online") {
				runtimeStatus = {
					state: "online",
					title: `${modelCatalog.length} model${modelCatalog.length === 1 ? "" : "s"} ready`,
					detail: "Agent 1 and Agent 2 can use any available model except the same one",
				};
			}
		} catch (error) {
			modelCatalog = [];
			assignAgentOptions();
			runtimeStatus = { ...runtimeStatus, detail: toError(error).message };
		}
	}

	async function refreshModels(): Promise<void> {
		await refreshLocalModels();
		await refreshFrontierModels();
	}

	async function refreshThinkingLevels(): Promise<void> {
		await Promise.all([refreshThinkingSetting("local"), refreshThinkingSetting("frontier")]);
	}

	async function refreshThinkingSetting(lane: "local" | "frontier"): Promise<void> {
		try {
			const result = await bridge.send<ThinkingSetting>("get_available_thinking_levels", { lane });
			if (lane === "local") localThinking = result;
			else frontierThinking = result;
		} catch (error) {
			if (lane === "local") localThinking = { level: "off", levels: ["off"] };
			else frontierThinking = { level: "off", levels: ["off"] };
			showError(toError(error).message);
		}
	}

	async function applyThinkingLevel(lane: "local" | "frontier", level: ThinkingLevel): Promise<void> {
		if (thinkingBusy !== undefined || interactionActive) return;
		thinkingBusy = lane;
		clearError();
		try {
			const result = await bridge.send<ThinkingSetting>("set_thinking_level", { lane, level });
			if (lane === "local") localThinking = result;
			else frontierThinking = result;
		} catch (error) {
			showError(toError(error).message);
		} finally {
			thinkingBusy = undefined;
		}
	}

	function applyConfigUpdate(update: {
		localModel?: string;
		frontierModel?: string;
		routing?: KlermConfig["routing"];
		activeStartLane?: KlermConfig["activeStartLane"];
		localRole?: KlermConfig["localRole"];
		frontierRole?: KlermConfig["frontierRole"];
		localApprovalMode?: KlermConfig["localApprovalMode"];
		frontierApprovalMode?: KlermConfig["frontierApprovalMode"];
		maxDelegationCycles?: KlermConfig["maxDelegationCycles"];
	}): Promise<boolean> {
		if (configBusy) return Promise.resolve(false);
		const operation = (async () => {
			clearError();
			try {
				const result = await bridge.send<{ config: KlermConfig; routingState?: RoutingState }>("set_klerm_config", {
					update,
				});
				currentConfig = result.config;
				currentRoutingState = result.routingState;
				assignAgentOptions();
				if (update.localModel !== undefined) await refreshThinkingSetting("local");
				if (update.frontierModel !== undefined) await refreshThinkingSetting("frontier");
				return true;
			} catch (error) {
				const message = toError(error).message;
				pushTimeline("error", "red", "Configuration update failed", message, "error");
				showError(message);
				return false;
			}
		})();
		configBusy = operation;
		void operation.finally(() => {
			if (configBusy === operation) configBusy = undefined;
		});
		return operation;
	}

	function applyRoutingSelection(value: string): void {
		if (value === "frontier-local") {
			void applyConfigUpdate({ routing: "frontier", activeStartLane: "frontier-local" });
			return;
		}
		if (value === "off" || value === "local" || value === "frontier" || value === "auto") {
			void applyConfigUpdate({ routing: value, activeStartLane: "auto" });
		}
	}

	async function connectBackend(): Promise<void> {
		const handshake = await bridge.send<DesktopHandshake>("desktop_handshake");
		if (handshake.protocolVersion !== 1) {
			throw new Error(`Unsupported Klerm RPC protocol ${handshake.protocolVersion}. Expected 1.`);
		}
		backendReady = true;
		backendCommands = handshake.capabilities?.commands ?? [];
		setStatus("online", "Backend connected", `Klerm ${handshake.klermVersion} / RPC v${handshake.protocolVersion}`);
		if (!supportsCommand("get_mcp_status")) {
			showError("Rebuild the desktop backend. This sidecar does not support MCP commands.");
		}
		lastState = handshake.state;
		restoreAgentViews(handshake.state.sessionId);
		currentRoutingState = handshake.routingState;
		sessionTitle = handshake.state.sessionName ?? "New Agent 1 session";
		sessionCwd = handshake.state.cwd;
		resetTerminal(handshake.state.cwd);
		currentConfig = await bridge.send<KlermConfig>("get_klerm_config");
		await initializeProjects();
		const entriesPromise = bridge.send<{ entries: SessionEntryRecord[]; leafId: string | null }>("get_entries");
		// Optional catalogs and integrations must not keep the app splash visible.
		// Some providers can legitimately take several seconds or wait on a local service.
		void Promise.all([
			refreshLocalModels(),
			refreshFrontierModels(),
			refreshThinkingLevels(),
			refreshMcpStatus(),
			refreshDesktopSettings(),
			refreshProviderStatus(),
			refreshCodingHarnessSetup(),
			refreshPersonalBots(),
		]).catch((error) => showError(toError(error).message));
		const entries = await entriesPromise;
		clearFeed();
		renderSessionEntries(entries.entries ?? [], entries.leafId);
		taskActive = handshake.state.isStreaming;
		await Promise.all([refreshWorkspace(), refreshEditors(), refreshRunningServices()]);
	}

	async function newSession(): Promise<void> {
		if (taskActive || terminalBusy || configBusy || sessionTransitionActive || !backendReady) return;
		sessionTransitionActive = true;
		clearError();
		try {
			const transition = await bridge.send<{ cancelled: boolean }>("new_session");
			if (transition.cancelled) return;
			clearFeed();
			attachments = [];
			lastState = await bridge.send<SessionState>("get_state");
			restoreAgentViews(lastState.sessionId);
			sessionTitle = "New Agent 1 session";
			sessionCwd = lastState.cwd;
			resetTerminal(lastState.cwd);
			currentRoutingState = currentRoutingState
				? { ...currentRoutingState, lane: "direct", selectedTarget: undefined, lastTransition: undefined }
				: undefined;
			await refreshWorkspace();
			await Promise.all([refreshSessions(), refreshProjects()]);
			sidebarOpen = false;
			selectedProjectId = undefined;
			workspaceView = undefined;
			settingsOpen = false;
			settingsFullscreen = false;
		} catch (error) {
			showError(toError(error).message);
		} finally {
			sessionTransitionActive = false;
		}
	}

	async function changeRoot(): Promise<void> {
		if (taskActive || terminalBusy || configBusy || sessionTransitionActive || !backendReady) return;
		let selected: unknown;
		try {
			selected = await openDialog({
				directory: true,
				multiple: false,
				title: "Choose a project root",
			});
		} catch (error) {
			showError(toError(error).message);
			return;
		}
		if (typeof selected !== "string" || selected.length === 0) return;
		sessionTransitionActive = true;
		backendRestarting = true;
		clearError();
		try {
			await invoke("stop_backend");
			await invoke("start_backend", { cwd: selected });
			await prepareBackendTrust();
			await connectBackend();
			await refreshSessions();
			sidebarOpen = false;
		} catch (error) {
			backendReady = false;
			setStatus("error", "Backend unavailable", "Restart Klerm to reconnect");
			showError(toError(error).message);
			taskActive = false;
		} finally {
			sessionTransitionActive = false;
			backendRestarting = false;
		}
	}

	async function prepareBackendTrust(): Promise<void> {
		const handshake = await bridge.send<DesktopHandshake>("desktop_handshake");
		if (handshake.protocolVersion !== 1) {
			throw new Error(`Unsupported Klerm RPC protocol ${handshake.protocolVersion}. Expected 1.`);
		}
		const workspaceStatus = await bridge.send<WorkspaceStatus>("get_workspace_status");
		const trust = await bridge.send<{ decision: boolean | null }>("get_project_trust");
		const trusted =
			trust.decision ??
			(await confirmDialog(
				`Trust ${handshake.state.cwd}?\n\nTrusted folders may load project-local settings, extensions, and skills. Other folders remain unavailable without separate approval.`,
			));
		if (trust.decision === null) await bridge.send("set_project_trust", { trusted });
		if (workspaceStatus.trusted === trusted) return;
		await invoke("stop_backend");
		await invoke("start_backend", { cwd: handshake.state.cwd, trusted });
	}

	async function sendMessage(
		text: string,
		images: ImageAttachment[] = [],
		mode: "prompt" | "prompt_together" = "prompt",
		displayText = text,
		targetAgentId?: string,
	): Promise<boolean> {
		if (
			(!text && images.length === 0) ||
			taskActive ||
			codingHarnessSetupLoading ||
			configBusy ||
			sessionTransitionActive ||
			!backendReady
		)
			return false;
		buildModeOffer = undefined;
		bottomPanelOpen = false;
		bottomPanelRevealed = true;
		clearError();
		taskActive = true;
		taskStopping = false;
		taskHadErrors = false;
		taskHadExecution = false;
		taskErrorDetails = [];
		taskSawAssistant = false;
		lastAssistantStopReason = undefined;
		activeTaskKey = ++taskSeq;
		const userMessage = pushMessage({
			id: ++messageSeq,
			role: "user",
			text: displayText,
			images: [...images],
			streaming: false,
			sender: "user",
			...(targetAgentId ? { recipient: targetAgentId } : {}),
			...(targetAgentId ? { agentId: targetAgentId } : {}),
		});
		try {
			const preparedPrompt = prepareMcpPrompt(text, mcpServers);
			const rpcImages = rpcImageAttachments(images);
			await bridge.send(mode, {
				message: preparedPrompt.message,
				displayMessage: displayText,
				...(mode === "prompt" ? { mcpMentions: preparedPrompt.mentions } : {}),
				...(mode === "prompt" && rpcImages ? { images: rpcImages } : {}),
				...(mode === "prompt" && targetAgentId ? { targetAgentId } : {}),
			});
			if (draft.trim() === text) draft = "";
			attachments = [];
			return true;
		} catch (error) {
			taskActive = false;
			activeTaskKey = 0;
			removeMessage(userMessage.id);
			const failure = toError(error).message;
			pushTimeline("error", "red", failure, "", "error");
			showError(failure);
			return false;
		}
	}

	function sendAgentMessage(agentId: string, text: string, images: ImageAttachment[]): void {
		void sendMessage(text, images, "prompt", text, agentId);
	}

	function rerunPrompt(text: string): void {
		if (taskActive) {
			draft = text;
			composerFocusRequest += 1;
			showError("The corrected prompt is ready. Stop the active task before sending it.");
			return;
		}
		void sendMessage(text);
	}

	async function stopTask(): Promise<void> {
		try {
			taskStopping = true;
			await bridge.send("abort");
		} catch (error) {
			taskStopping = false;
			showError(toError(error).message);
		}
	}

	async function boot(): Promise<void> {
		const startedAt = performance.now();
		bridge.onEvent(handleRpcEvent);
		try {
			await bridge.start();
			backendRestarting = true;
			await prepareBackendTrust();
			await connectBackend();
			backendRestarting = false;
			await refreshSessions();
		} catch (error) {
			backendRestarting = false;
			backendReady = false;
			setStatus("error", "Backend unavailable", "Check the development console");
			runtimeStatus = { state: "error", title: "Klerm could not start", detail: toError(error).message };
			showError(toError(error).message);
			taskActive = false;
		} finally {
			const remainingSplashTime = Math.max(0, 950 - (performance.now() - startedAt));
			window.setTimeout(() => {
				splashVisible = false;
			}, remainingSplashTime);
		}
	}

	onMount(() => {
		if (window.innerWidth <= 900) workspacePanelOpen = false;
		const onResize = () => {
			if (window.innerWidth > 720) sidebarOpen = false;
			else sessionsExpanded = true;
			if (workspacePanelOpen) applyFilesWidth(filesWidth);
			if (agentContextVisible) applyAgentViewsHeight(agentViewsHeight);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (pendingDelete) pendingDelete = undefined;
			else if (settingsOpen) {
				settingsOpen = false;
				settingsFullscreen = false;
			}
			else if (selectedProjectId) selectedProjectId = undefined;
			else if (workspaceView) workspaceView = undefined;
			else if (sidebarOpen) sidebarOpen = false;
			else if (window.innerWidth <= 900 && workspacePanelOpen) workspacePanelOpen = false;
		};
		window.addEventListener("resize", onResize);
		document.addEventListener("keydown", onKeyDown);
		void boot();
		return () => {
			if (notificationTimer !== undefined) window.clearTimeout(notificationTimer);
			window.removeEventListener("resize", onResize);
			document.removeEventListener("keydown", onKeyDown);
		};
	});
</script>

<Splash visible={splashVisible} />

{#if notification}
	{#if notificationTarget}
		{@const target = notificationTarget}
		<button type="button" class="fixed top-4 right-4 z-[90] max-w-[min(360px,calc(100vw-32px))] rounded-lg border border-[#3a4a43] bg-[#101915] px-3 py-2.5 text-left text-[11px] text-[#dce8e3] shadow-[0_16px_44px_rgba(0,0,0,.45)] hover:border-[#5a7a68]" aria-label={notification} onclick={() => openPersonalBot(target.botId)}>{notification}</button>
	{:else}
		<div class="pointer-events-none fixed top-4 right-4 z-[90] max-w-[min(360px,calc(100vw-32px))] rounded-lg border border-[#3a4a43] bg-[#101915] px-3 py-2.5 text-[11px] text-[#dce8e3] shadow-[0_16px_44px_rgba(0,0,0,.45)]" role="status" aria-live="polite">{notification}</div>
	{/if}
{/if}

<svelte:window oncontextmenu={preventDesktopContextMenu} />

<div
	class={`relative grid h-full w-full overflow-hidden bg-bg opacity-100 transition-opacity duration-300 ${shellColumns}`}
	class:opacity-0={splashVisible}
	style={`--session-col: ${sessionColPx}px; --files-col: ${filesColPx}px;`}
>
	{#if !(settingsOpen && settingsFullscreen) && workspaceView !== "browser"}
	<Sidebar
		{sessions}
		{projects}
		{defaultProjectId}
		activeProjectId={selectedProjectId}
		activeSessionToken={lastState?.sessionFile ?? ""}
		{mcpStatus}
		{mcpBusy}
		open={sidebarOpen}
		collapsed={!sessionsExpanded}
		onnewsession={newSession}
		onrefresh={() => void refreshSessions()}
		onswitch={(session) => void switchSession(session)}
		onrename={renameSession}
		ondelete={(session) => (pendingDelete = session)}
		oncreateproject={(name) => void createProject(name)}
		onopenproject={(project) => {
			selectedProjectId = project.id;
			workspaceView = undefined;
			settingsOpen = false;
			settingsFullscreen = false;
			sidebarOpen = false;
		}}
		onrenameproject={(project, name) => void renameProject(project, name)}
		ondeleteproject={(project) => void deleteProject(project)}
		onmovesession={(session, projectId) => void moveSessionToProject(session, projectId)}
		onexpand={() => (sessionsExpanded = true)}
		onrefreshmcp={() => void refreshMcpStatus()}
		onreloadmcp={() => void reloadMcpServers()}
		onaddmcpserver={addMcpServer}
		settingsOpen={settingsOpen}
		workspaceView={activeWorkspaceView}
		onworkspaceview={(view) => {
			workspaceView = view === "agents-routing" ? undefined : view;
			if (view === "kanban") void refreshKanban();
			selectedProjectId = undefined;
			settingsOpen = false;
			settingsFullscreen = false;
			sidebarOpen = false;
		}}
		ontogglesettings={() => {
			buildModeOffer = undefined;
			workspaceView = undefined;
			selectedProjectId = undefined;
			settingsOpen = !settingsOpen;
			if (!settingsOpen) settingsFullscreen = false;
		}}
	/>
	{/if}
	{#if !(settingsOpen && settingsFullscreen) && workspaceView !== "browser"}
	<button
		type="button"
		aria-label="Resize sessions"
		class="absolute top-0 bottom-0 z-[16] hidden w-1.5 cursor-col-resize border-0 bg-transparent hover:bg-[rgba(143,163,176,.18)] min-[721px]:block"
		style={`left: calc(${sessionColPx}px - 3px);`}
		onpointerdown={startSessionResize}
	></button>
	{/if}
	{#if workspacePanelOpen && !selectedProject && !workspaceView}
		<button
			type="button"
			aria-label="Resize file changes"
			class="absolute top-0 bottom-0 z-[16] hidden w-1.5 cursor-col-resize border-0 bg-transparent hover:bg-[rgba(143,163,176,.18)] min-[901px]:block"
			style={`right: calc(${filesColPx}px - 3px);`}
			onpointerdown={startFilesResize}
		></button>
	{/if}
	{#if sidebarOpen}
		<button
			type="button"
			aria-label="Close navigation"
			class="fixed inset-0 z-[19] hidden border-0 bg-black/60 backdrop-blur-[2px] narrow-720:block"
			onclick={() => (sidebarOpen = false)}
		></button>
	{/if}
	{#if workspacePanelOpen && !settingsOpen && !selectedProject && !workspaceView}
		<button
			type="button"
			aria-label="Close file changes"
			class="fixed inset-0 z-[17] hidden border-0 bg-black/50 backdrop-blur-[1px] narrow-900:block"
			onclick={() => (workspacePanelOpen = false)}
		></button>
	{/if}

	<main class={`grid min-h-0 min-w-0 overflow-hidden bg-[radial-gradient(circle_at_50%_30%,rgba(44,57,63,.12),transparent_34%),var(--color-bg)] ${workspaceRows}`}>
		{#if settingsOpen}
			{#if desktopSettings}
			<SettingsView
				settings={desktopSettings}
				klermConfig={currentConfig}
				{mcpStatus}
				{mcpBusy}
				codingHarnessSetup={codingHarnessSetup}
				codingHarnessLoading={codingHarnessSetupLoading}
				codingHarnessError={codingHarnessSetupError}
				personalBots={personalBots.bots}
				providers={providerAccounts}
				{providerBusy}
				fullscreen={settingsFullscreen}
				ontogglefullscreen={() => (settingsFullscreen = !settingsFullscreen)}
				onclose={() => {
					settingsOpen = false;
					settingsFullscreen = false;
				}}
				onappearance={setDesktopAppearance}
				onmaxdelegationcycles={(value) => applyConfigUpdate({ maxDelegationCycles: value })}
				onrefreshharnesses={() => void refreshCodingHarnessSetup()}
				onrefreshharnessmodels={refreshCodingHarnessModels}
				onsaveharnesses={saveCodingHarnessSlots}
				onaddmodel={addCustomModel}
				onconnectprovider={connectProvider}
				ondisconnectprovider={disconnectProvider}
				oauthStep={oauthStep}
				onstartoauth={startProviderOauth}
				oncanceloauth={() => void cancelProviderOauth()}
				onoauthsubmit={submitOauthPrompt}
				onsharedmemorychange={setSharedMemory}
				onsavedefaultsharedmemory={saveDefaultSharedMemory}
				onsavesharedmemory={saveSharedMemoryPreset}
				ondeletesharedmemory={deleteSharedMemoryPreset}
				onrefreshmcp={() => void refreshMcpStatus()}
				onreloadmcp={() => void reloadMcpServers()}
				onaddmcpserver={addMcpServer}
			/>
			{:else}
				<p class="px-7 py-6 font-mono text-[11px] text-[#8b969e]">Loading settings...</p>
			{/if}
		{:else if workspaceView === "personal-bots"}
			<PersonalBotsView
				bots={personalBots.bots}
				profiles={desktopSettings?.profiles.profiles ?? []}
				harnessSetup={personalBotHarnessSetup}
				conversations={personalBotConversations}
				busy={personalBotBusy}
				generationModel={personalBotGenerationModel}
				focusBotId={personalBotsFocus}
				onclose={() => (workspaceView = undefined)}
				onselect={(botId) => void loadPersonalBotConversation(botId)}
				onsave={savePersonalBot}
				onprofilesave={savePersonalBotProfile}
				ongeneratememory={generatePersonalBotMemory}
				ondelete={deletePersonalBot}
				onsummarydelete={deletePersonalBotSummary}
				onprompt={promptPersonalBot}
				onabort={abortPersonalBot}
			/>
		{:else if workspaceView === "kanban"}
			<WorkspacePlannedView
				registry={kanbanRegistry}
				workspaceRoot={workspace?.projectRoot ?? sessionCwd}
				models={modelCatalog}
				activity={kanbanActivity}
				onclose={() => (workspaceView = undefined)}
				onsave={saveKanban}
				onpickfolder={pickKanbanFolder}
				onrun={runKanbanTask}
				onstop={stopKanbanTask}
			/>
		{:else if workspaceView === "browser"}
			<BrowserWorkspace setup={codingHarnessSetup} onclose={() => (workspaceView = undefined)} />
		{:else if selectedProject}
			<ProjectWorkspace
				project={selectedProject}
				sessions={selectedProjectSessions}
				{projects}
				agents={projectPromptAgents}
				activeSessionToken={lastState?.sessionFile ?? ""}
				busy={projectBusy || interactionActive}
				{sidebarOpen}
				ontogglesidebar={() => (sidebarOpen = !sidebarOpen)}
				onclose={() => (selectedProjectId = undefined)}
				onrefresh={() => refreshProjectSummary(selectedProject)}
				onask={(question, agentId, effort) => askProject(selectedProject, question, agentId, effort)}
				onswitch={(session) => void switchSession(session)}
				onrename={renameSession}
				ondelete={(session) => (pendingDelete = session)}
				onmove={(session, projectId) => void moveSessionToProject(session, projectId)}
			/>
		{:else}
			<Topbar
				title={sessionTitle}
				cwd={sessionCwd}
				projectRoot={workspace?.projectRoot ?? sessionCwd}
				isGit={workspace?.isGit ?? false}
			model={currentModel}
			{sidebarOpen}
			ontogglesidebar={() => (sidebarOpen = !sidebarOpen)}
			onrename={renameActiveSession}
			onchangeroot={() => void changeRoot()}
			{workspacePanelOpen}
			ontogglefiles={() => (workspacePanelOpen = !workspacePanelOpen)}
		/>

		<section bind:this={agentContextContainer} class={`relative min-h-0 ${agentContextVisible ? "overflow-hidden" : "overflow-y-auto"}`}>
			{#if agentContextVisible}
				<div
					class="grid h-full min-h-0 grid-rows-[minmax(140px,var(--agent-views-height))_8px_minmax(120px,1fr)] narrow-720:grid-rows-[minmax(180px,1fr)_minmax(140px,1fr)]"
					style={`--agent-views-height: ${agentViewsHeight}px;`}
				>
					<div class="min-h-0 overflow-hidden p-3 pb-2 narrow-720:p-2">
						<AgentViews
							agents={configuredHarnessAgents}
							visibleIds={visibleAgentIds}
							items={feed}
							clearThrough={agentClearThrough}
							activeAgentId={activeHarnessAgentId}
							{taskActive}
							sendDisabled={sendDisabled}
							personalBots={personalBots.bots}
							mcpServers={mcpServers}
							connectedHarnessKinds={codingHarnessSetup?.harnesses.filter((harness) => harness.adapterConnected).map((harness) => harness.kind) ?? []}
							onclose={closeAgentView}
							oneffortchange={(id, effort) => void setCodingHarnessAgentEffort(id, effort)}
							onrolechange={(id, role) => void setCodingHarnessAgentRole(id, role)}
							onclear={clearAgentOutput}
							onrerun={rerunPrompt}
							ontoggle={toggleTimeline}
							onsend={sendAgentMessage}
						/>
					</div>
					<button
						type="button"
						aria-label="Resize agent views and shared conversation"
						class="group relative cursor-row-resize border-0 bg-transparent narrow-720:hidden"
						onpointerdown={startAgentViewsResize}
						onkeydown={(event) => {
							if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
							event.preventDefault();
							applyAgentViewsHeight(agentViewsHeight + (event.key === "ArrowDown" ? 24 : -24));
						}}
					>
						<span class="absolute top-1/2 right-3 left-3 h-px -translate-y-1/2 bg-[#273139] transition-colors group-hover:bg-[#65747d] group-focus-visible:bg-[#8d9aa2]"></span>
						<span class="absolute top-1/2 left-1/2 h-1.5 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#3b474f] bg-[#11181d] transition-colors group-hover:border-[#65747d]"></span>
					</button>
					<div class="min-h-0 overflow-y-auto border-t border-[#273139] bg-[rgba(5,9,12,.38)]">
						<div class="sticky top-0 z-[1] border-b border-[#222b32] bg-[#090e12]/95 px-4 py-1.5 backdrop-blur">
							<span class="font-mono text-[8px] tracking-[.1em] text-[#75828a] uppercase">Shared conversation</span>
						</div>
						<div class="mx-auto flex w-[min(820px,calc(100%-48px))] min-w-0 flex-col py-4 narrow-720:w-[calc(100%-30px)] narrow-720:py-3">
							<Feed items={feed} {taskActive} {mcpServers} onrerun={rerunPrompt} ontoggle={toggleTimeline} />
						</div>
					</div>
				</div>
			{:else}
			<div class="mx-auto flex w-[min(820px,calc(100%-48px))] min-w-0 flex-col pt-11 pb-9 narrow-720:w-[calc(100%-30px)]">
				{#if heroVisible}
					<EmptyState
						{runtimeStatus}
						onrefresh={() => void refreshModels()}
						onprompt={(prompt) => {
							draft = prompt;
							composerFocusRequest += 1;
						}}
					/>
				{/if}
				<Feed items={feed} {taskActive} {mcpServers} onrerun={rerunPrompt} ontoggle={toggleTimeline} />
			</div>
			{/if}
		</section>

		<Composer
			bind:draft
			bind:attachments
			sendDisabled={sendDisabled}
			{taskActive}
			showMeta={hasConversation}
			emptyLayout={!hasConversation}
			localOptions={composerLocalOptions}
			frontierOptions={composerFrontierOptions}
			klermLocalOptions={localOptions}
			klermFrontierOptions={frontierOptions}
			localValue={composerLocalValue}
			frontierValue={composerFrontierValue}
			routingValue={routingControlValue}
			codingHarnessOptions={codingHarnessOptions}
			localDisabled={composerLocalDisabled}
			frontierDisabled={composerFrontierDisabled}
			routingDisabled={routingSelectDisabled}
			{taskStateText}
			{errorBanner}
			externalHarnessSetup={codingHarnessSetup}
			{visibleAgentIds}
			externalHarnessBusy={codingHarnessSetupLoading}
			{workTogetherEnabled}
			{workTogetherAvailable}
			{workTogetherVisible}
			history={promptHistory}
			focusRequest={composerFocusRequest}
			historyKey={lastState?.sessionId ?? ""}
			localThinkingLevels={localThinking.levels}
			localThinkingValue={localThinking.level}
			{localThinkingDisabled}
			frontierThinkingLevels={frontierThinking.levels}
			frontierThinkingValue={frontierThinking.level}
			{frontierThinkingDisabled}
			mcpServers={mcpServers}
			localProfileId={desktopSettings?.profiles.localProfileId ?? ""}
			frontierProfileId={desktopSettings?.profiles.frontierProfileId ?? ""}
			personalBots={personalBots.bots}
			localRole={currentConfig?.localRole ?? "builder"}
			frontierRole={currentConfig?.frontierRole ?? "builder"}
			approvalMode={currentConfig?.localApprovalMode ?? "risky"}
			{activeAgent}
			roleDisabled={!backendReady || interactionActive}
			{buildModeOffer}
			onsend={(text, images) => void sendMessage(text, images)}
			onprompttogether={(text) => void sendMessage(text, [], "prompt_together")}
			onattachmenterror={showError}
			onstop={() => void stopTask()}
			onlocalchange={(value) => {
				if (externalHarnessesEnabled && firstHarnessAgent) void setCodingHarnessAgentModel(firstHarnessAgent.id, value);
				else void applyConfigUpdate({ localModel: value });
			}}
			onfrontierchange={(value) => {
				if (externalHarnessesEnabled && secondHarnessAgent) void setCodingHarnessAgentModel(secondHarnessAgent.id, value);
				else void applyConfigUpdate({ frontierModel: value });
			}}
			onroutingchange={applyRoutingSelection}
			onlocalthinkingchange={(level) => void applyThinkingLevel("local", level)}
			onfrontierthinkingchange={(level) => void applyThinkingLevel("frontier", level)}
			onlocalrolechange={(role) => {
				buildModeOffer = undefined;
				void applyConfigUpdate({ localRole: role });
			}}
			onfrontierrolechange={(role) => {
				buildModeOffer = undefined;
				void applyConfigUpdate({ frontierRole: role });
			}}
			onbuildofferdismiss={dismissBuildModeOffer}
			onbuildofferswitch={switchBuildMode}
			onapprovalchange={(mode) => void applyConfigUpdate({ localApprovalMode: mode, frontierApprovalMode: mode })}
			onlocalprofilechange={(id) => void assignProfile("local", id)}
			onfrontierprofilechange={(id) => void assignProfile("frontier", id)}
			onexternalharnesschange={(id, enabled) => void updateCodingHarnessAgent(id, { enabled })}
			onexternalharnesskindchange={(id, kind) => void setCodingHarnessAgentKind(id, kind)}
			onexternalmodelchange={(id, model) => void setCodingHarnessAgentModel(id, model)}
			onexternalpersonalitychange={(id, botId) => void setCodingHarnessAgentPersonality(id, botId)}
			onexternaleffortchange={(id, effort) => void setCodingHarnessAgentEffort(id, effort)}
			onaddexternalagent={() => void addCodingHarnessAgent()}
			onremoveexternalagent={(id) => void removeCodingHarnessAgent(id)}
			ondisableallexternalagents={() => void setAllCodingHarnessAgents(false)}
			onenableallexternalagents={() => void setAllCodingHarnessAgents(true)}
			onturnoffexternalagents={() => void turnOffExternalCodingHarnesses()}
			onviewexternalagent={toggleAgentView}
			onworktogetherchange={(enabled) => void setWorkTogetherMode(enabled)}
		/>

		{#if bottomPanelVisible}
		<BottomPanel
			open={bottomPanelOpen}
			services={runningServices}
			logs={activityLogs}
			{status}
			{terminalOutput}
			{terminalBusy}
			{terminalCurrentCommand}
			{pendingApproval}
			ontoggle={() => (bottomPanelOpen = !bottomPanelOpen)}
			onrefresh={() => void refreshRunningServices()}
			onopenurl={(url) => void openLocalUrl(url)}
			onruncommand={(command) => void runTerminalCommand(command)}
			onstopcommand={() => void stopTerminalCommand()}
			onclearterminal={() => (terminalOutput = "")}
			onreject={() => {
				const request = pendingApproval;
				pendingApproval = undefined;
				if (request) void bridge.respond({ type: "extension_ui_response", id: request.id, confirmed: false });
			}}
			onapprove={() => {
				const request = pendingApproval;
				pendingApproval = undefined;
				if (request) void bridge.respond({ type: "extension_ui_response", id: request.id, confirmed: true });
			}}
		/>
		{/if}
		{/if}
	</main>
	{#if workspacePanelOpen && !settingsOpen && !selectedProject && !workspaceView}
		<WorkspacePanel
			bind:editDrafts={workspaceEditDrafts}
			{workspace}
			{editors}
			selectedPath={selectedFilePath}
			diff={selectedFileDiff}
			content={selectedFileContent}
			loading={fileLoading}
			saving={fileSaving}
			{projectFiles}
			{projectFilesTruncated}
			{projectFilesLoading}
			onclose={() => (workspacePanelOpen = false)}
			onrefresh={() => void refreshWorkspace()}
			onselect={(path) => void selectWorkspaceFile(path)}
			onsave={saveWorkspaceFile}
			onopeneditor={(editor) => void openWorkspaceEditor(editor)}
			onviewprojectfiles={openProjectFiles}
			{github}
			{gitBusy}
			oninitializegit={() => void initializeGit()}
			onlogingithub={() => void loginGitHub()}
		/>
	{/if}
</div>
{#if pendingDelete}
	<ConfirmDialog
		title="Delete session?"
		detail={`This removes "${pendingDelete.name ?? pendingDelete.firstMessage}" from the session list.`}
		confirmLabel="Delete"
		oncancel={() => (pendingDelete = undefined)}
		onconfirm={() => {
			const session = pendingDelete;
			pendingDelete = undefined;
			if (session) void deleteConversation(session);
		}}
	/>
{/if}
