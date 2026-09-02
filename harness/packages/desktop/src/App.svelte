<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import { onMount } from "svelte";
	import {
		describeToolCall,
		messageText,
		resultErrorText,
		toolResultDetails,
		toDisplayText,
		truncateText,
	} from "./lib/helpers.ts";
	import type {
		AgentMessage,
		BashResult,
		ChatMessage,
		DesktopHandshake,
		DesktopSession,
		EditorInfo,
		FeedItem,
		JsonObject,
		KlermConfig,
		LocalRuntime,
		McpServerUpdate,
		McpStatus,
		McpToolOption,
		RoutingState,
		RoutingTransition,
		RunningService,
		RuntimeStatus,
		SelectOption,
		SessionEntryRecord,
		SessionState,
		StatusInfo,
		TimelineItem,
		TimelineTone,
		ThinkingLevel,
		ThinkingSetting,
		WorkspaceStatus,
	} from "./lib/model.ts";
	import { RpcBridge, toError } from "./lib/rpc.ts";
	import Composer from "./components/Composer.svelte";
	import BottomPanel from "./components/BottomPanel.svelte";
	import ConfirmDialog from "./components/ConfirmDialog.svelte";
	import EmptyState from "./components/EmptyState.svelte";
	import Feed from "./components/Feed.svelte";
	import Sidebar from "./components/Sidebar.svelte";
	import Splash from "./components/Splash.svelte";
	import Topbar from "./components/Topbar.svelte";
	import WorkspacePanel from "./components/WorkspacePanel.svelte";

	const bridge = new RpcBridge();

	let splashVisible = $state(true);
	let backendReady = $state(false);
	let backendRestarting = false;
	let taskActive = $state(false);
	let taskStopping = false;
	let taskHadErrors = false;
	let taskSawAssistant = false;
	let lastAssistantStopReason: string | undefined;
	let sessionTransitionActive = $state(false);
	let configBusy = $state<Promise<boolean> | undefined>(undefined);
	let currentConfig = $state<KlermConfig | undefined>(undefined);
	let currentRoutingState = $state<RoutingState | undefined>(undefined);
	let lastState = $state<SessionState | undefined>(undefined);
	let sessions = $state<DesktopSession[]>([]);
	let feed = $state<FeedItem[]>([]);
	let localOptions = $state<SelectOption[]>([]);
	let frontierOptions = $state<SelectOption[]>([]);
	let draft = $state("");
	let sidebarOpen = $state(false);
	let sessionsExpanded = $state(true);
	let sessionWidth = $state(280);
	let filesWidth = $state(430);
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
	let editors = $state<EditorInfo[]>([]);
	let runningServices = $state<RunningService[]>([]);
	let selectedFilePath = $state<string | undefined>(undefined);
	let selectedFileDiff = $state("");
	let selectedFileContent = $state<string | undefined>(undefined);
	let fileLoading = $state(false);
	let fileSaving = $state(false);
	let terminalOutput = $state("");
	let terminalBusy = $state(false);
	let terminalCurrentCommand = $state("");
	let terminalStreamed = false;
	let mcpStatus = $state<McpStatus | undefined>(undefined);
	let mcpBusy = $state(false);

	let currentLocalRuntimes: LocalRuntime[] = [];
	let lastFallbackReason = "";
	let feedSeq = 0;
	let taskSeq = 0;
	let activeTaskKey = 0;
	let timelineSeq = 0;
	let messageSeq = 0;
	let streamingMessageId: number | undefined;
	const toolCards = new Map<string, number>();

	const interactionActive = $derived(
		taskActive || terminalBusy || configBusy !== undefined || sessionTransitionActive || thinkingBusy !== undefined || mcpBusy,
	);
	const sendDisabled = $derived(!backendReady || interactionActive);
	const localSelectDisabled = $derived(
		!backendReady || interactionActive || !localOptions.some((option) => option.value.length > 0),
	);
	const frontierSelectDisabled = $derived(
		!backendReady || interactionActive || !frontierOptions.some((option) => option.value.length > 0),
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
	const mcpToolOptions = $derived.by(() => {
		const options: McpToolOption[] = [];
		for (const server of mcpStatus?.servers ?? []) {
			if (server.state !== "connected") continue;
			for (const tool of server.tools) {
				options.push({ ...tool, label: `${server.name} / ${tool.remoteName}` });
			}
		}
		return options.sort((left, right) => left.label.localeCompare(right.label));
	});
	const MIN_MAIN_COL = 280;
	const SESSION_RAIL = 48;
	const sessionColPx = $derived(sessionsExpanded ? sessionWidth : SESSION_RAIL);
	const filesColPx = $derived(workspacePanelOpen ? filesWidth : 0);
	const shellColumns = "grid-cols-[var(--session-col)_minmax(0,1fr)_var(--files-col)] narrow-900:grid-cols-[var(--session-col)_minmax(0,1fr)] narrow-720:grid-cols-1";

	const currentModel = $derived.by(() => {
		const routing = currentConfig?.routing ?? "off";
		let reference = currentRoutingState?.selectedTarget;
		if (!reference) {
			if (routing === "frontier") reference = currentConfig?.frontierModel;
			else if (routing === "local" || routing === "auto") reference = currentConfig?.localModel;
			else if (lastState?.model) reference = `${lastState.model.provider}/${lastState.model.id}`;
		}
		const activeLane = currentRoutingState?.lane;
		return {
			reference: reference ?? "Not configured",
			statusClass: backendReady && reference ? "online" : backendReady ? "starting" : "error",
			badge:
				activeLane && activeLane !== "direct"
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
		bottomPanelVisible
			? "grid-rows-[auto_minmax(0,1fr)_auto_auto] narrow-720:grid-rows-[auto_minmax(180px,1fr)_auto_auto]"
			: "grid-rows-[auto_minmax(0,1fr)_auto]",
	);

	$effect(() => {
		if (!hasConversation) {
			bottomPanelRevealed = false;
			bottomPanelOpen = false;
			return;
		}
		if (hasWorkspaceProcess && !bottomPanelRevealed) {
			bottomPanelRevealed = true;
			bottomPanelOpen = true;
		}
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

	function clearFeed(): void {
		lastFallbackReason = "";
		toolCards.clear();
		feed.length = 0;
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
			meta.push(`cycle ${transition.cycle}${typeof transition.maxCycles === "number" ? `/${transition.maxCycles}` : ""}`);
		}
		const detail = [transition.reason, ...meta].filter((line) => line).join("\n");
		const failed = transition.trigger === "provider-failure";
		if (failed) taskHadErrors = true;
		pushTimeline("routing", failed ? "red" : "amber", title, detail, failed ? "error" : "settled", dedupeId);
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
		taskHadErrors = true;
	}

	function handleToolStart(event: JsonObject): void {
		const toolCallId = String(event.toolCallId ?? "");
		const toolName = String(event.toolName ?? "unknown");
		const described = describeToolCall(toolName, event.args);
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
			item.detailType = described.detailType;
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
		if (event.isError === true) {
			taskHadErrors = true;
			item.status = "error";
			item.tone = "red";
			const errorText = resultErrorText(event.result) ?? "Tool execution failed";
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

	function appendAssistantMessage(message?: AgentMessage): void {
		const item: ChatMessage = {
			id: ++messageSeq,
			role: "assistant",
			text: "",
			model: modelLabel(message),
			streaming: true,
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
		for (const entry of activeBranch) {
			if (entry.type === "custom" && entry.customType === "klerm-transition") {
				const data = entry.data as { transition?: RoutingTransition } | undefined;
				if (data?.transition) addRoutingTransitionCard(data.transition);
				continue;
			}
			if (entry.type !== "message" || !entry.message) continue;
			const message = entry.message;
			if (message.role === "user" || message.role === "assistant") {
				const text = messageText(message);
				if (text) {
					pushMessage({
						id: ++messageSeq,
						role: message.role,
						text,
						model: message.role === "assistant" ? modelLabel(message) : undefined,
						streaming: false,
					});
				}
				if (message.role === "assistant" && Array.isArray(message.content)) {
					for (const part of message.content) {
						if (part.type === "toolCall" && part.id && part.name) {
							handleToolStart({
								type: "tool_execution_start",
								toolCallId: part.id,
								toolName: part.name,
								args: part.arguments ?? {},
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
				}
				return;
			}
			case "agent_start": {
				if (!taskActive) {
					activeTaskKey = ++taskSeq;
					taskStopping = false;
					taskHadErrors = false;
					taskSawAssistant = false;
					lastAssistantStopReason = undefined;
				}
				taskActive = true;
				return;
			}
			case "agent_settled": {
				pendingApproval = undefined;
				finalizeStreamingMessage();
				const failed = !taskStopping && (!taskSawAssistant || lastAssistantStopReason === "error");
				taskActive = false;
				pushTimeline(
					"task",
					failed ? "red" : taskHadErrors ? "amber" : "neutral",
					failed
						? "Task failed"
						: taskStopping
							? "Task stopped"
							: taskHadErrors
								? "Task completed with errors"
								: "Task completed",
					"",
					failed ? "error" : "settled",
				);
				taskStopping = false;
				taskHadErrors = false;
				taskSawAssistant = false;
				lastAssistantStopReason = undefined;
				activeTaskKey = 0;
				void refreshSessions();
				void refreshStateAfterSettle();
				void refreshWorkspace();
				void refreshRunningServices();
				void refreshMcpStatus();
				return;
			}
			case "message_start": {
				const startedMessage = event.message as AgentMessage | undefined;
				if (startedMessage?.role === "assistant") appendAssistantMessage(startedMessage);
				return;
			}
			case "message_update": {
				const update = event.assistantMessageEvent as JsonObject | undefined;
				if (update?.type === "text_delta" && typeof update.delta === "string") {
					if (streamingMessageId === undefined) appendAssistantMessage();
					const item = findMessage(streamingMessageId);
					if (item) item.text += update.delta;
				}
				return;
			}
			case "message_end": {
				const completedMessage = event.message as AgentMessage | undefined;
				if (completedMessage?.role !== "assistant") return;
				taskSawAssistant = true;
				lastAssistantStopReason = completedMessage.stopReason;
				const finalText = messageText(completedMessage);
				const item = findMessage(streamingMessageId);
				if (item) {
					item.text = finalText || item.text;
					item.streaming = false;
					if (completedMessage.model) item.model = modelLabel(completedMessage);
					if (!item.text) removeMessage(item.id);
				} else if (finalText) {
					pushMessage({
						id: ++messageSeq,
						role: "assistant",
						text: finalText,
						model: modelLabel(completedMessage),
						streaming: false,
					});
				}
				streamingMessageId = undefined;
				if (completedMessage.stopReason === "error") {
					taskHadErrors = true;
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
				return;
			}
			case "routing_changed": {
				const state = event.state as RoutingState | undefined;
				currentRoutingState = state;
				if (currentConfig && state) {
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
				if (taskActive) taskHadErrors = true;
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
		if (!backendReady) return;
		try {
			const result = await bridge.send<{ services: RunningService[] }>("get_running_services");
			runningServices = result.services;
		} catch (error) {
			runningServices = [];
			showError(toError(error).message);
		}
	}

	async function refreshMcpStatus(): Promise<void> {
		if (!backendReady || mcpBusy) return;
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

	async function addMcpServer(server: McpServerUpdate): Promise<boolean> {
		if (!backendReady || interactionActive || mcpBusy) return false;
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

	async function switchSession(session: DesktopSession): Promise<void> {
		if (taskActive || terminalBusy || configBusy || sessionTransitionActive || !backendReady) return;
		sessionTransitionActive = true;
		clearError();
		try {
			const transition = await bridge.send<{ cancelled: boolean }>("switch_session", {
				sessionPath: session.sessionToken,
			});
			if (transition.cancelled) return;
			const [entries, state] = await Promise.all([
				bridge.send<{ entries: SessionEntryRecord[]; leafId: string | null }>("get_entries"),
				bridge.send<SessionState>("get_state"),
			]);
			lastState = state;
			clearFeed();
			renderSessionEntries(entries.entries ?? [], entries.leafId);
			await refreshThinkingLevels();
			sessionTitle = session.name ?? session.firstMessage;
			sessionCwd = session.cwd;
			resetTerminal(session.cwd);
			await refreshWorkspace();
			void refreshSessions();
			sidebarOpen = false;
		} catch (error) {
			showError(toError(error).message);
		} finally {
			sessionTransitionActive = false;
		}
	}

	async function deleteConversation(session: DesktopSession): Promise<void> {
		if (taskActive || terminalBusy || configBusy || sessionTransitionActive || !backendReady) return;
		const isActive = session.id === lastState?.sessionId;
		sessionTransitionActive = true;
		clearError();
		try {
			if (isActive) {
				const transition = await bridge.send<{ cancelled: boolean }>("new_session");
				if (transition.cancelled) return;
				clearFeed();
				sessionTitle = "New Agent 1 session";
				lastState = await bridge.send<SessionState>("get_state");
				sessionCwd = lastState.cwd;
				resetTerminal(lastState.cwd);
				currentRoutingState = currentRoutingState
					? { ...currentRoutingState, lane: "direct", selectedTarget: undefined, lastTransition: undefined }
					: undefined;
			}
			await bridge.send("delete_session", { sessionToken: session.sessionToken });
			await refreshSessions();
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
		if (session.id === lastState?.sessionId) return renameActiveSession(name);
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

	async function refreshLocalModels(): Promise<void> {
		runtimeStatus = { state: "starting", title: "Checking Agent 1 runtimes", detail: "Looking for installed models" };
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
			if (modelOptions.length === 0) {
				localOptions = [{ value: "", label: "No Agent 1 models found" }];
				const availableRuntime = runtimes.find((runtime) => !runtime.error);
				runtimeStatus = {
					state: "error",
					title: "No Agent 1 model available",
					detail: availableRuntime
						? `${availableRuntime.name} is running without installed models`
						: "Start Ollama and install a model, then refresh",
				};
				return;
			}
			localOptions = modelOptions;
			runtimeStatus = {
				state: "online",
				title: `${modelOptions.length} Agent 1 model${modelOptions.length === 1 ? "" : "s"} ready`,
				detail: runtimes
					.filter((runtime) => !runtime.error)
					.map((runtime) => runtime.name)
					.join(" / "),
			};
		} catch (error) {
			currentLocalRuntimes = [];
			localOptions = [{ value: "", label: "Agent 1 discovery failed" }];
			runtimeStatus = { state: "error", title: "Runtime discovery failed", detail: toError(error).message };
		}
	}

	async function refreshFrontierModels(): Promise<void> {
		try {
			const result = await bridge.send<{ models: Array<{ provider: string; id: string }> }>("get_available_models");
			const localProviders = new Set(currentLocalRuntimes.map((runtime) => runtime.providerId));
			const options = result.models
				.filter((model) => !localProviders.has(model.provider))
				.map((model) => ({ value: `${model.provider}/${model.id}`, label: `${model.provider} / ${model.id}` }));
			frontierOptions =
				options.length > 0 ? options : [{ value: "", label: "No Agent 2 models found" }];
		} catch (error) {
			frontierOptions = [{ value: "", label: "Agent 2 discovery failed" }];
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
	}): void {
		if (configBusy) return;
		const operation = (async () => {
			clearError();
			try {
				const result = await bridge.send<{ config: KlermConfig; routingState?: RoutingState }>("set_klerm_config", {
					update,
				});
				currentConfig = result.config;
				currentRoutingState = result.routingState;
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
	}

	function applyRoutingSelection(value: string): void {
		if (value === "frontier-local") {
			applyConfigUpdate({ routing: "frontier", activeStartLane: "frontier-local" });
			return;
		}
		if (value === "off" || value === "local" || value === "frontier" || value === "auto") {
			applyConfigUpdate({ routing: value, activeStartLane: "auto" });
		}
	}

	async function connectBackend(): Promise<void> {
		const handshake = await bridge.send<DesktopHandshake>("desktop_handshake");
		if (handshake.protocolVersion !== 1) {
			throw new Error(`Unsupported Klerm RPC protocol ${handshake.protocolVersion}. Expected 1.`);
		}
		backendReady = true;
		setStatus("online", "Backend connected", `Klerm ${handshake.klermVersion} / RPC v${handshake.protocolVersion}`);
		lastState = handshake.state;
		currentRoutingState = handshake.routingState;
		sessionTitle = handshake.state.sessionName ?? "New Agent 1 session";
		sessionCwd = handshake.state.cwd;
		resetTerminal(handshake.state.cwd);
		currentConfig = await bridge.send<KlermConfig>("get_klerm_config");
		const entriesPromise = bridge.send<{ entries: SessionEntryRecord[]; leafId: string | null }>("get_entries");
		await refreshLocalModels();
		await Promise.all([refreshFrontierModels(), refreshThinkingLevels()]);
		const entries = await entriesPromise;
		clearFeed();
		renderSessionEntries(entries.entries ?? [], entries.leafId);
		taskActive = handshake.state.isStreaming;
		await Promise.all([refreshWorkspace(), refreshEditors(), refreshRunningServices(), refreshMcpStatus()]);
	}

	async function newSession(): Promise<void> {
		if (taskActive || terminalBusy || configBusy || sessionTransitionActive || !backendReady) return;
		sessionTransitionActive = true;
		clearError();
		try {
			const transition = await bridge.send<{ cancelled: boolean }>("new_session");
			if (transition.cancelled) return;
			clearFeed();
			lastState = await bridge.send<SessionState>("get_state");
			sessionTitle = "New Agent 1 session";
			sessionCwd = lastState.cwd;
			resetTerminal(lastState.cwd);
			currentRoutingState = currentRoutingState
				? { ...currentRoutingState, lane: "direct", selectedTarget: undefined, lastTransition: undefined }
				: undefined;
			await refreshWorkspace();
			await refreshSessions();
			sidebarOpen = false;
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

	async function sendMessage(text: string): Promise<void> {
		if (!text || taskActive || configBusy || sessionTransitionActive || !backendReady) return;
		clearError();
		taskActive = true;
		taskStopping = false;
		taskHadErrors = false;
		taskSawAssistant = false;
		lastAssistantStopReason = undefined;
		activeTaskKey = ++taskSeq;
		const userMessage = pushMessage({ id: ++messageSeq, role: "user", text, streaming: false });
		try {
			await bridge.send("prompt", { message: text });
			if (draft.trim() === text) draft = "";
		} catch (error) {
			taskActive = false;
			activeTaskKey = 0;
			removeMessage(userMessage.id);
			const failure = toError(error).message;
			pushTimeline("error", "red", failure, "", "error");
			showError(failure);
		}
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
			await connectBackend();
			await refreshSessions();
		} catch (error) {
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
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (pendingDelete) pendingDelete = undefined;
			else if (sidebarOpen) sidebarOpen = false;
			else if (window.innerWidth <= 900 && workspacePanelOpen) workspacePanelOpen = false;
		};
		window.addEventListener("resize", onResize);
		document.addEventListener("keydown", onKeyDown);
		void boot();
		return () => {
			window.removeEventListener("resize", onResize);
			document.removeEventListener("keydown", onKeyDown);
		};
	});
</script>

<Splash visible={splashVisible} />

<div
	class={`relative grid h-full w-full overflow-hidden bg-bg opacity-100 transition-opacity duration-300 ${shellColumns}`}
	class:opacity-0={splashVisible}
	style={`--session-col: ${sessionColPx}px; --files-col: ${filesColPx}px;`}
>
	<Sidebar
		{sessions}
		activeSessionId={lastState?.sessionId ?? ""}
		{status}
		{mcpStatus}
		{mcpBusy}
		open={sidebarOpen}
		collapsed={!sessionsExpanded}
		onnewsession={newSession}
		onrefresh={() => void refreshSessions()}
		onswitch={(session) => void switchSession(session)}
		onrename={renameSession}
		ondelete={(session) => (pendingDelete = session)}
		onexpand={() => (sessionsExpanded = true)}
		oncollapse={() => (sessionsExpanded = false)}
		onrefreshmcp={() => void refreshMcpStatus()}
		onaddmcpserver={addMcpServer}
	/>
	<button
		type="button"
		aria-label="Resize sessions"
		class="absolute top-0 bottom-0 z-[16] hidden w-1.5 cursor-col-resize border-0 bg-transparent hover:bg-[rgba(143,163,176,.18)] min-[721px]:block"
		style={`left: calc(${sessionColPx}px - 3px);`}
		onpointerdown={startSessionResize}
	></button>
	{#if workspacePanelOpen}
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
	{#if workspacePanelOpen}
		<button
			type="button"
			aria-label="Close file changes"
			class="fixed inset-0 z-[17] hidden border-0 bg-black/50 backdrop-blur-[1px] narrow-900:block"
			onclick={() => (workspacePanelOpen = false)}
		></button>
	{/if}

	<main class={`grid min-h-0 min-w-0 overflow-hidden bg-[radial-gradient(circle_at_50%_30%,rgba(44,57,63,.12),transparent_34%),var(--color-bg)] ${workspaceRows}`}>
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

		<section class="relative min-h-0 overflow-y-auto">
			<div
				class="mx-auto flex w-[min(820px,calc(100%-48px))] min-w-0 flex-col pt-11 pb-9 narrow-720:w-[calc(100%-30px)]"
			>
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
				<Feed items={feed} {taskActive} onrerun={rerunPrompt} ontoggle={toggleTimeline} />
			</div>
		</section>

		<Composer
			bind:draft
			sendDisabled={sendDisabled}
			{taskActive}
			showMeta={hasConversation}
			emptyLayout={!hasConversation}
			localOptions={localOptions}
			frontierOptions={frontierOptions}
			localValue={currentConfig?.localModel ?? ""}
			frontierValue={currentConfig?.frontierModel ?? ""}
			routingValue={routingControlValue}
			localDisabled={localSelectDisabled}
			frontierDisabled={frontierSelectDisabled}
			routingDisabled={routingSelectDisabled}
			{taskStateText}
			{errorBanner}
			history={promptHistory}
			focusRequest={composerFocusRequest}
			historyKey={lastState?.sessionId ?? ""}
			localThinkingLevels={localThinking.levels}
			localThinkingValue={localThinking.level}
			{localThinkingDisabled}
			frontierThinkingLevels={frontierThinking.levels}
			frontierThinkingValue={frontierThinking.level}
			{frontierThinkingDisabled}
			mcpTools={mcpToolOptions}
			localRole={currentConfig?.localRole ?? "builder"}
			frontierRole={currentConfig?.frontierRole ?? "builder"}
			{activeAgent}
			roleDisabled={!backendReady || interactionActive}
			onsend={(text) => void sendMessage(text)}
			onstop={() => void stopTask()}
			onlocalchange={(value) => applyConfigUpdate({ localModel: value })}
			onfrontierchange={(value) => applyConfigUpdate({ frontierModel: value })}
			onroutingchange={applyRoutingSelection}
			onlocalthinkingchange={(level) => void applyThinkingLevel("local", level)}
			onfrontierthinkingchange={(level) => void applyThinkingLevel("frontier", level)}
			onlocalrolechange={(role) => applyConfigUpdate({ localRole: role })}
			onfrontierrolechange={(role) => applyConfigUpdate({ frontierRole: role })}
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
			ontoggle={() => (bottomPanelOpen = !bottomPanelOpen)}
			onrefresh={() => void refreshRunningServices()}
			onopenurl={(url) => void openLocalUrl(url)}
			onruncommand={(command) => void runTerminalCommand(command)}
			onstopcommand={() => void stopTerminalCommand()}
			onclearterminal={() => (terminalOutput = "")}
		/>
		{/if}
	</main>
	{#if workspacePanelOpen}
		<WorkspacePanel
			{workspace}
			{editors}
			selectedPath={selectedFilePath}
			diff={selectedFileDiff}
			content={selectedFileContent}
			loading={fileLoading}
			saving={fileSaving}
			onclose={() => (workspacePanelOpen = false)}
			onrefresh={() => void refreshWorkspace()}
			onselect={(path) => void selectWorkspaceFile(path)}
			onsave={saveWorkspaceFile}
			onopeneditor={(editor) => void openWorkspaceEditor(editor)}
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
{#if pendingApproval}
	<ConfirmDialog
		title={pendingApproval.title}
		detail={pendingApproval.message}
		confirmLabel="Approve"
		tone="approval"
		oncancel={() => {
			const request = pendingApproval;
			pendingApproval = undefined;
			if (request) void bridge.respond({ type: "extension_ui_response", id: request.id, confirmed: false });
		}}
		onconfirm={() => {
			const request = pendingApproval;
			pendingApproval = undefined;
			if (request) void bridge.respond({ type: "extension_ui_response", id: request.id, confirmed: true });
		}}
	/>
{/if}
