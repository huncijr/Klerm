<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { open as openDialog } from "@tauri-apps/plugin-dialog";
	import { onMount } from "svelte";
	import { describeToolCall, messageText, resultErrorText, toDisplayText, truncateText } from "./lib/helpers.ts";
	import type {
		AgentMessage,
		ChatMessage,
		DesktopHandshake,
		DesktopSession,
		JsonObject,
		KlermConfig,
		LocalRuntime,
		RoutingState,
		RoutingTransition,
		RuntimeStatus,
		SelectOption,
		SessionEntryRecord,
		SessionState,
		StatusInfo,
		TimelineItem,
		TimelineTone,
	} from "./lib/model.ts";
	import { RpcBridge, toError } from "./lib/rpc.ts";
	import ChatMessageView from "./components/ChatMessage.svelte";
	import Composer from "./components/Composer.svelte";
	import EmptyState from "./components/EmptyState.svelte";
	import Sidebar from "./components/Sidebar.svelte";
	import Splash from "./components/Splash.svelte";
	import Timeline from "./components/Timeline.svelte";
	import Topbar from "./components/Topbar.svelte";

	const bridge = new RpcBridge();

	let splashVisible = $state(true);
	let backendReady = $state(false);
	let backendRestarting = false;
	let taskActive = $state(false);
	let sessionTransitionActive = $state(false);
	let configBusy = $state<Promise<boolean> | undefined>(undefined);
	let currentConfig = $state<KlermConfig | undefined>(undefined);
	let lastState = $state<SessionState | undefined>(undefined);
	let sessions = $state<DesktopSession[]>([]);
	let messages = $state<ChatMessage[]>([]);
	let timeline = $state<TimelineItem[]>([]);
	let localOptions = $state<SelectOption[]>([]);
	let frontierOptions = $state<SelectOption[]>([]);
	let draft = $state("");
	let sidebarOpen = $state(false);
	let sessionTitle = $state("New local session");
	let sessionCwd = $state("");
	let status = $state<StatusInfo>({ state: "starting", label: "Starting backend", detail: "RPC handshake" });
	let runtimeStatus = $state<RuntimeStatus>({
		state: "starting",
		title: "Checking Ollama",
		detail: "Looking for installed local models",
	});
	let errorBanner = $state("");

	let currentLocalRuntimes: LocalRuntime[] = [];
	let timelineDirty = false;
	let lastFallbackReason = "";
	let timelineSeq = 0;
	let messageSeq = 0;
	let streamingMessageId: number | undefined;
	const toolCards = new Map<string, number>();

	const interactionActive = $derived(taskActive || configBusy !== undefined || sessionTransitionActive);
	const sendDisabled = $derived(!backendReady || interactionActive);
	const localSelectDisabled = $derived(
		!backendReady || interactionActive || !localOptions.some((option) => option.value.length > 0),
	);
	const frontierSelectDisabled = $derived(
		!backendReady || interactionActive || !frontierOptions.some((option) => option.value.length > 0),
	);
	const routingSelectDisabled = $derived(!backendReady || interactionActive);
	const hasConversation = $derived(messages.length > 0);
	const heroVisible = $derived(!hasConversation && draft.trim().length === 0);
	const taskStateText = $derived(taskActive ? "Working" : backendReady ? "Ready" : "Backend unavailable");

	const currentModel = $derived.by(() => {
		const routing = currentConfig?.routing ?? "off";
		let reference: string | undefined;
		if (routing === "frontier") reference = currentConfig?.frontierModel;
		else if (routing === "local" || routing === "auto") reference = currentConfig?.localModel;
		else if (lastState?.model) reference = `${lastState.model.provider}/${lastState.model.id}`;
		return {
			reference: reference ?? "Not configured",
			statusClass: backendReady && reference ? "online" : backendReady ? "starting" : "error",
			badge: routing === "off" ? "Direct" : routing === "auto" ? "Auto" : routing === "local" ? "Local" : "Frontier",
		};
	});

	const workspaceRows = $derived(
		hasConversation
			? "grid-rows-[78px_minmax(0,1fr)_auto] narrow-720:grid-rows-[78px_minmax(180px,1fr)_auto] short-650:grid-rows-[62px_minmax(0,1fr)_auto] short-500:grid-rows-[54px_minmax(0,1fr)_auto]"
			: "grid-rows-[78px_minmax(160px,1fr)_auto_minmax(20px,7vh)] short-650:grid-rows-[62px_minmax(0,1fr)_auto_minmax(10px,3vh)] short-500:grid-rows-[54px_minmax(0,1fr)_auto_minmax(8px,2vh)]",
	);

	function setStatus(state: StatusInfo["state"], label: string, detail: string): void {
		status = { state, label, detail };
	}

	function showError(message: string): void {
		errorBanner = message;
	}

	function clearError(): void {
		errorBanner = "";
	}

	function pushTimeline(
		kind: string,
		tone: TimelineTone,
		title: string,
		detail = "",
		cardStatus: TimelineItem["status"] = "settled",
		dedupeId?: string,
	): TimelineItem {
		timelineDirty = true;
		const item: TimelineItem = { id: ++timelineSeq, kind, tone, title, detail, status: cardStatus, open: false, dedupeId };
		timeline.push(item);
		return item;
	}

	function findTimeline(dedupeId: string): TimelineItem | undefined {
		return timeline.find((item) => item.dedupeId === dedupeId);
	}

	function clearTimeline(): void {
		timelineDirty = false;
		lastFallbackReason = "";
		toolCards.clear();
		timeline.length = 0;
	}

	function toggleTimeline(id: number): void {
		const item = timeline.find((candidate) => candidate.id === id);
		if (item) item.open = !item.open;
	}

	function addRoutingTransitionCard(transition: RoutingTransition): void {
		if (!transition || (transition.kind !== "delegate" && transition.kind !== "return")) return;
		const dedupeId = `transition-${transition.id ?? transition.sequence ?? "unknown"}`;
		if (findTimeline(dedupeId)) return;
		const delegate = transition.kind === "delegate";
		const from = transition.fromLane ?? "local";
		const to = transition.toLane ?? (delegate ? "frontier" : "local");
		const arrow = delegate ? "\u2193" : "\u2191";
		const model = delegate ? transition.toTarget : (transition.fromTarget ?? transition.toTarget);
		const title = `${arrow} ${from} \u2192 ${to}${model ? ` \u00b7 ${model}` : ""}`;
		const meta: string[] = [];
		if (transition.trigger) meta.push(`trigger: ${transition.trigger}`);
		if (delegate && typeof transition.cycle === "number") {
			meta.push(`cycle ${transition.cycle}${typeof transition.maxCycles === "number" ? `/${transition.maxCycles}` : ""}`);
		}
		const detail = [transition.reason, ...meta].filter((line) => line).join("\n");
		const failed = transition.trigger === "provider-failure";
		pushTimeline("routing", failed ? "red" : "neutral", title, detail, failed ? "error" : "settled", dedupeId);
	}

	function renderFallbackReason(state: RoutingState | undefined): void {
		const reason = state?.fallbackReason;
		if (!reason || reason === lastFallbackReason) return;
		lastFallbackReason = reason;
		pushTimeline("routing", "red", "Frontier fallback", reason, "error", `fallback-${reason}`);
	}

	function handleRetryStart(event: JsonObject): void {
		const attempt = Number(event.attempt ?? 0);
		const maxAttempts = Number(event.maxAttempts ?? 0);
		const errorMessage = typeof event.errorMessage === "string" ? event.errorMessage : "";
		pushTimeline("retry", "amber", `Provider retry ${attempt}/${maxAttempts}`, errorMessage, "running", `retry-${attempt}`);
	}

	function handleRetryEnd(event: JsonObject): void {
		const attempt = Number(event.attempt ?? 0);
		const item = findTimeline(`retry-${attempt}`);
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
	}

	function handleToolStart(event: JsonObject): void {
		const toolCallId = String(event.toolCallId ?? "");
		const toolName = String(event.toolName ?? "unknown");
		const described = describeToolCall(toolName, event.args);
		const existingId = toolCards.get(toolCallId);
		if (existingId === undefined) {
			const item = pushTimeline(toolName, described.tone, described.label, described.detail, "running", `tool-${toolCallId}`);
			toolCards.set(toolCallId, item.id);
			return;
		}
		const item = timeline.find((candidate) => candidate.id === existingId);
		if (item) {
			item.title = described.label;
			item.status = "running";
			if (described.detail) item.detail = described.detail;
		}
	}

	function handleToolEnd(event: JsonObject): void {
		const existingId = toolCards.get(String(event.toolCallId ?? ""));
		if (existingId === undefined) return;
		const item = timeline.find((candidate) => candidate.id === existingId);
		if (!item) return;
		if (event.isError === true) {
			item.status = "error";
			item.tone = "red";
			item.detail = resultErrorText(event.result) ?? "Tool execution failed";
			return;
		}
		item.status = "settled";
		if (!item.detail) {
			const resultText = truncateText(toDisplayText(event.result));
			if (resultText && resultText !== "{}") item.detail = resultText;
		}
	}

	function appendAssistantMessage(model?: string): void {
		const item: ChatMessage = { id: ++messageSeq, role: "assistant", text: "", model, streaming: true };
		messages.push(item);
		streamingMessageId = item.id;
	}

	function finalizeStreamingMessage(): void {
		if (streamingMessageId === undefined) return;
		const item = messages.find((candidate) => candidate.id === streamingMessageId);
		if (item) item.streaming = false;
		streamingMessageId = undefined;
	}

	function renderMessages(list: AgentMessage[]): void {
		for (const message of list) {
			if (message.role !== "user" && message.role !== "assistant") continue;
			const text = messageText(message);
			if (!text) continue;
			messages.push({
				id: ++messageSeq,
				role: message.role,
				text,
				model: message.role === "assistant" ? message.model : undefined,
				streaming: false,
			});
		}
	}

	function handleRpcEvent(event: JsonObject): void {
		switch (event.type) {
			case "agent_start": {
				taskActive = true;
				return;
			}
			case "agent_settled": {
				finalizeStreamingMessage();
				taskActive = false;
				if (timelineDirty) {
					pushTimeline("task", "neutral", "Task completed");
					timelineDirty = false;
				}
				void refreshSessions();
				void refreshStateAfterSettle();
				return;
			}
			case "message_start": {
				const startedMessage = event.message as AgentMessage | undefined;
				if (startedMessage?.role === "assistant") appendAssistantMessage(startedMessage.model);
				return;
			}
			case "message_update": {
				const update = event.assistantMessageEvent as JsonObject | undefined;
				if (update?.type === "text_delta" && typeof update.delta === "string") {
					if (streamingMessageId === undefined) appendAssistantMessage();
					const item = messages.find((candidate) => candidate.id === streamingMessageId);
					if (item) item.text += update.delta;
				}
				return;
			}
			case "message_end": {
				const completedMessage = event.message as AgentMessage | undefined;
				if (completedMessage?.role !== "assistant") return;
				const finalText = messageText(completedMessage);
				const item = messages.find((candidate) => candidate.id === streamingMessageId);
				if (item) {
					item.text = finalText || item.text;
					item.streaming = false;
					if (completedMessage.model) item.model = completedMessage.model;
				} else {
					messages.push({
						id: ++messageSeq,
						role: "assistant",
						text: finalText,
						model: completedMessage.model,
						streaming: false,
					});
				}
				streamingMessageId = undefined;
				return;
			}
			case "tool_execution_start": {
				handleToolStart(event);
				return;
			}
			case "tool_execution_end": {
				handleToolEnd(event);
				return;
			}
			case "routing_changed": {
				const state = event.state as RoutingState | undefined;
				if (currentConfig && state) {
					currentConfig = {
						...currentConfig,
						routing: state.mode,
						localModel: state.localModel ?? currentConfig.localModel,
						frontierModel: state.frontierModel ?? currentConfig.frontierModel,
					};
				}
				if (state?.lastTransition) addRoutingTransitionCard(state.lastTransition);
				renderFallbackReason(state);
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
			case "backend_error": {
				const text = typeof event.message === "string" ? event.message : "Backend error";
				if (/error|failed|invalid|limit/i.test(text)) pushTimeline("error", "red", text, "", "error");
				return;
			}
			case "backend_exit": {
				if (backendRestarting) return;
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

	async function restoreSessionTimeline(): Promise<void> {
		try {
			const result = await bridge.send<{ entries: SessionEntryRecord[] }>("get_entries");
			for (const entry of result.entries ?? []) {
				if (entry.type !== "custom" || entry.customType !== "klerm-transition") continue;
				const data = entry.data as { transition?: RoutingTransition } | undefined;
				if (data?.transition) addRoutingTransitionCard(data.transition);
			}
		} catch {
			// Timeline history is best-effort; live events remain authoritative.
		}
	}

	async function switchSession(session: DesktopSession): Promise<void> {
		if (taskActive || configBusy || sessionTransitionActive || !backendReady) return;
		sessionTransitionActive = true;
		clearError();
		clearTimeline();
		try {
			await bridge.send("switch_session", { sessionPath: session.sessionToken });
			messages.length = 0;
			streamingMessageId = undefined;
			const [messageResult, state] = await Promise.all([
				bridge.send<{ messages: AgentMessage[] }>("get_messages"),
				bridge.send<SessionState>("get_state"),
			]);
			lastState = state;
			renderMessages(messageResult.messages);
			await restoreSessionTimeline();
			sessionTitle = session.name ?? session.firstMessage;
			sessionCwd = session.cwd;
			void refreshSessions();
			sidebarOpen = false;
		} catch (error) {
			showError(toError(error).message);
		} finally {
			sessionTransitionActive = false;
		}
	}

	async function deleteConversation(session: DesktopSession): Promise<void> {
		if (taskActive || configBusy || sessionTransitionActive || !backendReady) return;
		const isActive = session.id === lastState?.sessionId;
		sessionTransitionActive = true;
		clearError();
		try {
			if (isActive) {
				await bridge.send("new_session");
				clearTimeline();
				messages.length = 0;
				streamingMessageId = undefined;
				sessionTitle = "New local session";
			}
			await bridge.send("delete_session", { sessionToken: session.sessionToken });
			await refreshSessions();
		} catch (error) {
			showError(toError(error).message);
		} finally {
			sessionTransitionActive = false;
		}
	}

	async function refreshLocalModels(): Promise<void> {
		runtimeStatus = { state: "starting", title: "Checking local runtimes", detail: "Looking for installed models" };
		try {
			const result = await bridge.send<{ runtimes: LocalRuntime[] }>("get_local_runtimes");
			const runtimes = [...result.runtimes].sort((left, right) =>
				left.providerId === "ollama" ? -1 : right.providerId === "ollama" ? 1 : 0,
			);
			currentLocalRuntimes = runtimes;
			const modelOptions = runtimes.flatMap((runtime) =>
				runtime.models.map((model) => ({
					value: `${runtime.providerId}/${model.id}`,
					label: `${runtime.name} / ${model.id}${model.details ? ` / ${model.details}` : ""}`,
				})),
			);
			if (modelOptions.length === 0) {
				localOptions = [{ value: "", label: "No local models found" }];
				const availableRuntime = runtimes.find((runtime) => !runtime.error);
				runtimeStatus = {
					state: "error",
					title: "No local model available",
					detail: availableRuntime
						? `${availableRuntime.name} is running without installed models`
						: "Start Ollama and install a model, then refresh",
				};
				return;
			}
			localOptions = modelOptions;
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
			localOptions = [{ value: "", label: "Local discovery failed" }];
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
				options.length > 0 ? options : [{ value: "", label: "No frontier models found" }];
		} catch (error) {
			frontierOptions = [{ value: "", label: "Frontier discovery failed" }];
			runtimeStatus = { ...runtimeStatus, detail: toError(error).message };
		}
	}

	function refreshModels(): void {
		void refreshLocalModels();
		void refreshFrontierModels();
	}

	function applyConfigUpdate(update: {
		localModel?: string;
		frontierModel?: string;
		routing?: KlermConfig["routing"];
	}): void {
		if (configBusy) return;
		const operation = (async () => {
			clearError();
			try {
				const result = await bridge.send<{ config: KlermConfig; routingState?: RoutingState }>("set_klerm_config", {
					update,
				});
				currentConfig = result.config;
				return true;
			} catch (error) {
				showError(toError(error).message);
				return false;
			}
		})();
		configBusy = operation;
		void operation.finally(() => {
			if (configBusy === operation) configBusy = undefined;
		});
	}

	async function connectBackend(): Promise<void> {
		const handshake = await bridge.send<DesktopHandshake>("desktop_handshake");
		if (handshake.protocolVersion !== 1) {
			throw new Error(`Unsupported Klerm RPC protocol ${handshake.protocolVersion}. Expected 1.`);
		}
		backendReady = true;
		setStatus("online", "Backend connected", `Klerm ${handshake.klermVersion} / RPC v${handshake.protocolVersion}`);
		lastState = handshake.state;
		sessionTitle = handshake.state.sessionName ?? "New local session";
		sessionCwd = handshake.state.cwd;
		currentConfig = await bridge.send<KlermConfig>("get_klerm_config");
		const [messageResult] = await Promise.all([
			bridge.send<{ messages: AgentMessage[] }>("get_messages"),
			refreshLocalModels(),
			refreshFrontierModels(),
		]);
		clearTimeline();
		messages.length = 0;
		streamingMessageId = undefined;
		renderMessages(messageResult.messages);
		taskActive = handshake.state.isStreaming;
	}

	async function newSession(): Promise<void> {
		if (taskActive || configBusy || sessionTransitionActive || !backendReady) return;
		let selected: unknown;
		try {
			selected = await openDialog({
				directory: true,
				multiple: false,
				title: "Choose a project folder for the new session",
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
		messages.push({ id: ++messageSeq, role: "user", text, streaming: false });
		draft = "";
		taskActive = true;
		try {
			await bridge.send("prompt", { message: text });
		} catch (error) {
			taskActive = false;
			const failure = toError(error).message;
			pushTimeline("error", "red", failure, "", "error");
			showError(failure);
		}
	}

	async function stopTask(): Promise<void> {
		try {
			await bridge.send("abort");
		} catch (error) {
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
		const onResize = () => {
			if (window.innerWidth > 720) sidebarOpen = false;
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && sidebarOpen) sidebarOpen = false;
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
	class="grid h-full w-full grid-cols-[280px_minmax(0,1fr)] overflow-hidden bg-bg opacity-100 transition-opacity duration-300 narrow-900:grid-cols-[230px_minmax(0,1fr)] narrow-720:grid-cols-1"
	class:opacity-0={splashVisible}
>
	<Sidebar
		{sessions}
		activeSessionId={lastState?.sessionId ?? ""}
		{status}
		open={sidebarOpen}
		onnewsession={newSession}
		onrefresh={() => void refreshSessions()}
		onswitch={(session) => void switchSession(session)}
		ondelete={(session) => void deleteConversation(session)}
	/>
	{#if sidebarOpen}
		<button
			type="button"
			aria-label="Close navigation"
			class="fixed inset-0 z-[19] hidden border-0 bg-black/60 backdrop-blur-[2px] narrow-720:block"
			onclick={() => (sidebarOpen = false)}
		></button>
	{/if}

	<main class={`grid min-h-0 min-w-0 overflow-hidden bg-[radial-gradient(circle_at_50%_30%,rgba(44,57,63,.12),transparent_34%),var(--color-bg)] ${workspaceRows}`}>
		<Topbar
			title={sessionTitle}
			cwd={sessionCwd}
			model={currentModel}
			{sidebarOpen}
			ontogglesidebar={() => (sidebarOpen = !sidebarOpen)}
		/>

		<section class="relative min-h-0 overflow-y-auto">
			<div
				class="mx-auto flex w-[min(820px,calc(100%-48px))] min-w-0 flex-col pt-11 pb-9 narrow-720:w-[calc(100%-30px)]"
			>
				{#if heroVisible}
					<EmptyState {runtimeStatus} onrefresh={refreshModels} />
				{/if}
				{#each messages as message (message.id)}
					<ChatMessageView {message} />
				{/each}
			</div>
			<Timeline items={timeline} ontoggle={toggleTimeline} />
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
			routingValue={currentConfig?.routing ?? "off"}
			localDisabled={localSelectDisabled}
			frontierDisabled={frontierSelectDisabled}
			routingDisabled={routingSelectDisabled}
			{taskStateText}
			{errorBanner}
			onsend={(text) => void sendMessage(text)}
			onstop={() => void stopTask()}
			onlocalchange={(value) => applyConfigUpdate({ localModel: value })}
			onfrontierchange={(value) => applyConfigUpdate({ frontierModel: value })}
			onroutingchange={(value) => applyConfigUpdate({ routing: value as KlermConfig["routing"] })}
		/>
	</main>
</div>
