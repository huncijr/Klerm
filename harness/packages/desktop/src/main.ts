import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./style.css";

type JsonObject = Record<string, unknown>;

interface RpcResponse<T = unknown> extends JsonObject {
	id?: string;
	type: "response";
	command: string;
	success: boolean;
	data?: T;
	error?: string;
	code?: string;
}

interface SessionState {
	sessionId: string;
	sessionName?: string;
	cwd: string;
	isStreaming: boolean;
	messageCount: number;
	model?: { provider: string; id: string };
}

interface RoutingState {
	mode: "off" | "local" | "frontier" | "auto";
	lane: "direct" | "local" | "frontier";
	localModel?: string;
	frontierModel?: string;
	selectedTarget?: string;
}

interface DesktopHandshake {
	protocolVersion: number;
	klermVersion: string;
	state: SessionState;
	routingState?: RoutingState;
}

interface LocalRuntime {
	providerId: string;
	name: string;
	serverUrl: string;
	models: Array<{ id: string; details?: string }>;
	error?: string;
}

interface AvailableModel {
	provider: string;
	id: string;
}

interface KlermConfig {
	routing: "off" | "local" | "frontier" | "auto";
	localModel?: string;
	frontierModel?: string;
}

interface DesktopSession {
	id: string;
	sessionToken: string;
	name?: string;
	cwd: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
}

interface AgentMessage {
	role: string;
	content?: string | Array<{ type: string; text?: string }>;
	provider?: string;
	model?: string;
	usage?: { totalTokens?: number; cost?: { total?: number } };
}

type RpcEventHandler = (message: JsonObject) => void;

class RpcCommandError extends Error {
	readonly code: string | undefined;

	constructor(message: string, code?: string) {
		super(message);
		this.name = "RpcCommandError";
		this.code = code;
	}
}

class RpcBridge {
	private requestId = 0;
	private readonly pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }
	>();
	private readonly handlers = new Set<RpcEventHandler>();
	private unlisten: UnlistenFn[] = [];

	async start(): Promise<void> {
		this.unlisten.push(
			await listen<JsonObject>("klerm://rpc", (event) => this.handleMessage(event.payload)),
			await listen<{ message: string }>("klerm://backend-error", (event) => {
				this.emit({ type: "backend_error", message: event.payload.message });
			}),
			await listen<{ code: number | null }>("klerm://backend-exit", (event) => {
				this.rejectPending(new Error("The Klerm backend stopped."));
				this.emit({ type: "backend_exit", code: event.payload.code });
			}),
		);
		await invoke("start_backend", { cwd: null });
	}

	onEvent(handler: RpcEventHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	async send<T>(type: string, fields: JsonObject = {}): Promise<T> {
		const id = `desktop_${++this.requestId}`;
		const response = new Promise<T>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Backend timed out while handling ${type}.`));
			}, 30_000);
			this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
		});

		try {
			await invoke("rpc_send", { command: { id, type, ...fields } });
		} catch (error) {
			const pending = this.pending.get(id);
			if (pending) {
				window.clearTimeout(pending.timer);
				this.pending.delete(id);
				pending.reject(toError(error));
			}
		}
		return response;
	}

	private handleMessage(message: JsonObject): void {
		if (message.type === "response" && typeof message.id === "string") {
			const pending = this.pending.get(message.id);
			if (pending) {
				window.clearTimeout(pending.timer);
				this.pending.delete(message.id);
				const response = message as RpcResponse;
				if (response.success) pending.resolve(response.data);
				else
					pending.reject(
						new RpcCommandError(response.error ?? `Backend command ${response.command} failed.`, response.code),
					);
				return;
			}
		}
		this.emit(message);
	}

	private emit(message: JsonObject): void {
		for (const handler of this.handlers) handler(message);
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			window.clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

function element<T extends HTMLElement>(id: string): T {
	const result = document.getElementById(id);
	if (!result) throw new Error(`Missing UI element: ${id}`);
	return result as T;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function messageText(message: AgentMessage): string {
	if (typeof message.content === "string") return message.content;
	return (message.content ?? [])
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

const bridge = new RpcBridge();
const app = element<HTMLDivElement>("app");
const splash = element<HTMLDivElement>("splash");
const sidebar = element<HTMLElement>("sidebar");
const sidebarStatus = element<HTMLSpanElement>("sidebar-status");
const sidebarStatusLabel = element<HTMLElement>("sidebar-status-label");
const versionLabel = element<HTMLElement>("version-label");
const workspace = element<HTMLElement>("workspace");
const taskState = element<HTMLElement>("task-state");
const sessionTitle = element<HTMLElement>("session-title");
const sessionCwd = element<HTMLElement>("session-cwd");
const currentModelLabel = element<HTMLElement>("current-model");
const conversation = element<HTMLDivElement>("conversation");
const emptyState = element<HTMLDivElement>("empty-state");
const runtimeCard = element<HTMLDivElement>("runtime-card");
const runtimeIndicator = element<HTMLSpanElement>("runtime-indicator");
const runtimeTitle = element<HTMLElement>("runtime-title");
const runtimeDetail = element<HTMLElement>("runtime-detail");
const activity = element<HTMLDivElement>("activity");
const errorBanner = element<HTMLDivElement>("error-banner");
const localModelSelect = element<HTMLSelectElement>("local-model-select");
const frontierModelSelect = element<HTMLSelectElement>("frontier-model-select");
const routingSelect = element<HTMLSelectElement>("routing-select");
const prompt = element<HTMLTextAreaElement>("prompt");
const sendButton = element<HTMLButtonElement>("send-button");
const stopButton = element<HTMLButtonElement>("stop-button");
const composerWrap = element<HTMLElement>("composer-wrap");
const composer = element<HTMLFormElement>("composer");
const sessionList = element<HTMLDivElement>("session-list");

let backendReady = false;
let backendRestarting = false;
let taskActive = false;
let sessionTransitionActive = false;
let configBusy: Promise<boolean> | undefined;
let currentConfig: KlermConfig | undefined;
let lastState: SessionState | undefined;
let currentLocalRuntimes: LocalRuntime[] = [];
let currentAssistantBody: HTMLDivElement | undefined;
let currentAssistantText = "";

function setStatus(state: "starting" | "online" | "error", label: string, detail?: string): void {
	sidebarStatus.className = `status-dot is-${state}`;
	sidebarStatusLabel.textContent = label;
	if (detail) versionLabel.textContent = detail;
}

function showError(message: string): void {
	errorBanner.textContent = message;
	errorBanner.hidden = false;
}

function clearError(): void {
	errorBanner.hidden = true;
	errorBanner.textContent = "";
}

function setTaskActive(active: boolean): void {
	taskActive = active;
	stopButton.hidden = !active;
	const interactionActive = active || configBusy !== undefined || sessionTransitionActive;
	sendButton.disabled = !backendReady || interactionActive;
	localModelSelect.disabled = !backendReady || interactionActive || localModelSelect.options.length === 0;
	frontierModelSelect.disabled = !backendReady || interactionActive || frontierModelSelect.options.length === 0;
	routingSelect.disabled = !backendReady || interactionActive;
	taskState.textContent = active ? "Klerm is working" : backendReady ? "Ready" : "Backend unavailable";
}

function renderCurrentModel(): void {
	const routing = currentConfig?.routing ?? "off";
	let reference: string | undefined;
	if (routing === "frontier") reference = currentConfig?.frontierModel;
	else if (routing === "local" || routing === "auto") reference = currentConfig?.localModel;
	else if (lastState?.model) reference = `${lastState.model.provider}/${lastState.model.id}`;
	currentModelLabel.textContent = reference ?? "Not configured";
	currentModelLabel.title = reference ?? "";
}

function optionExists(select: HTMLSelectElement, value: string): boolean {
	return Array.from(select.options).some((option) => option.value === value);
}

function syncConfigControls(): void {
	if (currentConfig?.localModel && optionExists(localModelSelect, currentConfig.localModel)) {
		localModelSelect.value = currentConfig.localModel;
	}
	if (currentConfig?.frontierModel && optionExists(frontierModelSelect, currentConfig.frontierModel)) {
		frontierModelSelect.value = currentConfig.frontierModel;
	}
	routingSelect.value = currentConfig?.routing ?? "off";
	renderCurrentModel();
}

function hasConversationMessages(): boolean {
	return Array.from(conversation.children).some((child) => child !== emptyState);
}

function placeComposer(): void {
	if (hasConversationMessages()) workspace.append(composerWrap);
	else emptyState.insertBefore(composerWrap, runtimeCard);
}

function addMessage(role: "user" | "assistant", text: string, model?: string): HTMLDivElement {
	emptyState.hidden = true;
	const article = document.createElement("article");
	article.className = `message ${role}`;
	const header = document.createElement("div");
	header.className = "message-header";
	const dot = document.createElement("i");
	const label = document.createElement("span");
	label.textContent = role === "user" ? "You" : model ? `Klerm / ${model}` : "Klerm";
	header.append(dot, label);
	const body = document.createElement("div");
	body.className = "message-body";
	body.textContent = text;
	article.append(header, body);
	conversation.append(article);
	article.scrollIntoView({ behavior: "smooth", block: "end" });
	placeComposer();
	return body;
}

function renderMessages(messages: AgentMessage[]): void {
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = messageText(message);
		if (!text) continue;
		addMessage(message.role, text, message.role === "assistant" ? message.model : undefined);
	}
}

function renderSessions(sessions: DesktopSession[]): void {
	sessionList.replaceChildren();
	if (sessions.length === 0) {
		const empty = document.createElement("p");
		empty.className = "muted";
		empty.textContent = "No saved sessions yet.";
		sessionList.append(empty);
		return;
	}
	for (const session of sessions.slice(0, 30)) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "session-item";
		const title = document.createElement("strong");
		title.textContent = session.name ?? session.firstMessage;
		const detail = document.createElement("small");
		detail.textContent = `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(session.modified))} / ${session.messageCount} messages`;
		button.append(title, detail);
		button.addEventListener("click", () => void switchSession(session));
		sessionList.append(button);
	}
}

async function refreshSessions(): Promise<void> {
	try {
		const result = await bridge.send<{ sessions: DesktopSession[] }>("list_sessions");
		renderSessions(result.sessions);
	} catch (error) {
		sessionList.textContent = "Sessions unavailable.";
		showError(toError(error).message);
	}
}

async function refreshLocalModels(): Promise<void> {
	localModelSelect.disabled = true;
	runtimeIndicator.className = "status-dot is-starting";
	runtimeTitle.textContent = "Checking local runtimes";
	runtimeDetail.textContent = "Looking for installed models";
	try {
		const result = await bridge.send<{ runtimes: LocalRuntime[] }>("get_local_runtimes");
		const runtimes = [...result.runtimes].sort((left, right) =>
			left.providerId === "ollama" ? -1 : right.providerId === "ollama" ? 1 : 0,
		);
		currentLocalRuntimes = runtimes;
		const modelOptions = runtimes.flatMap((runtime) =>
			runtime.models.map((model) => ({
				reference: `${runtime.providerId}/${model.id}`,
				label: `${runtime.name} / ${model.id}${model.details ? ` / ${model.details}` : ""}`,
			})),
		);
		localModelSelect.replaceChildren();
		if (modelOptions.length === 0) {
			const option = document.createElement("option");
			option.value = "";
			option.textContent = "No local models found";
			localModelSelect.append(option);
			runtimeIndicator.className = "status-dot is-error";
			runtimeTitle.textContent = "No local model available";
			const availableRuntime = runtimes.find((runtime) => !runtime.error);
			runtimeDetail.textContent = availableRuntime
				? `${availableRuntime.name} is running without installed models`
				: "Start Ollama and install a model, then refresh";
			return;
		}
		for (const model of modelOptions) {
			const option = document.createElement("option");
			option.value = model.reference;
			option.textContent = model.label;
			localModelSelect.append(option);
		}
		runtimeIndicator.className = "status-dot is-online";
		runtimeTitle.textContent = `${modelOptions.length} local model${modelOptions.length === 1 ? "" : "s"} ready`;
		runtimeDetail.textContent = runtimes
			.filter((runtime) => !runtime.error)
			.map((runtime) => runtime.name)
			.join(" / ");
	} catch (error) {
		currentLocalRuntimes = [];
		localModelSelect.replaceChildren(new Option("Local discovery failed", ""));
		runtimeIndicator.className = "status-dot is-error";
		runtimeTitle.textContent = "Runtime discovery failed";
		runtimeDetail.textContent = toError(error).message;
	} finally {
		syncConfigControls();
		setTaskActive(taskActive);
	}
}

async function refreshFrontierModels(): Promise<void> {
	frontierModelSelect.disabled = true;
	try {
		const result = await bridge.send<{ models: AvailableModel[] }>("get_available_models");
		const localProviders = new Set(currentLocalRuntimes.map((runtime) => runtime.providerId));
		const options = result.models
			.filter((model) => !localProviders.has(model.provider))
			.map((model) => ({ reference: `${model.provider}/${model.id}`, label: `${model.provider} / ${model.id}` }));
		frontierModelSelect.replaceChildren();
		if (options.length === 0) {
			frontierModelSelect.append(new Option("No frontier models found", ""));
		} else {
			for (const option of options) {
				const element = document.createElement("option");
				element.value = option.reference;
				element.textContent = option.label;
				frontierModelSelect.append(element);
			}
		}
	} catch (error) {
		frontierModelSelect.replaceChildren(new Option("Frontier discovery failed", ""));
		runtimeDetail.textContent = toError(error).message;
	} finally {
		syncConfigControls();
		setTaskActive(taskActive);
	}
}

function applyConfigUpdate(update: {
	localModel?: string;
	frontierModel?: string;
	routing?: KlermConfig["routing"];
}): Promise<boolean> {
	if (configBusy) return configBusy;
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
		} finally {
			syncConfigControls();
		}
	})().finally(() => {
		if (configBusy === operation) configBusy = undefined;
		setTaskActive(taskActive);
	});
	configBusy = operation;
	setTaskActive(taskActive);
	return operation;
}

async function switchSession(session: DesktopSession): Promise<void> {
	if (taskActive || configBusy || sessionTransitionActive || !backendReady) return;
	sessionTransitionActive = true;
	setTaskActive(taskActive);
	clearError();
	try {
		await bridge.send("switch_session", { sessionPath: session.sessionToken });
		conversation.replaceChildren(emptyState);
		const [messages, state] = await Promise.all([
			bridge.send<{ messages: AgentMessage[] }>("get_messages"),
			bridge.send<SessionState>("get_state"),
		]);
		lastState = state;
		renderMessages(messages.messages);
		emptyState.hidden = hasConversationMessages();
		placeComposer();
		sessionTitle.textContent = session.name ?? session.firstMessage;
		sessionCwd.textContent = session.cwd;
		renderCurrentModel();
		sidebar.classList.remove("is-open");
	} catch (error) {
		showError(toError(error).message);
	} finally {
		sessionTransitionActive = false;
		setTaskActive(taskActive);
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
	sessionTitle.textContent = handshake.state.sessionName ?? "New local session";
	sessionCwd.textContent = handshake.state.cwd;
	currentConfig = await bridge.send<KlermConfig>("get_klerm_config");
	const [messages] = await Promise.all([
		bridge.send<{ messages: AgentMessage[] }>("get_messages"),
		refreshLocalModels(),
		refreshFrontierModels(),
	]);
	conversation.replaceChildren(emptyState);
	renderMessages(messages.messages);
	emptyState.hidden = hasConversationMessages();
	placeComposer();
	syncConfigControls();
	setTaskActive(handshake.state.isStreaming);
}

async function newSession(): Promise<void> {
	if (taskActive || configBusy || sessionTransitionActive || !backendReady) return;
	let selected: unknown;
	try {
		selected = await open({ directory: true, multiple: false, title: "Choose a project folder for the new session" });
	} catch (error) {
		showError(toError(error).message);
		return;
	}
	if (typeof selected !== "string" || selected.length === 0) return;
	sessionTransitionActive = true;
	backendRestarting = true;
	setTaskActive(taskActive);
	clearError();
	try {
		await invoke("stop_backend");
		await invoke("start_backend", { cwd: selected });
		await connectBackend();
		await refreshSessions();
		sidebar.classList.remove("is-open");
	} catch (error) {
		backendReady = false;
		setStatus("error", "Backend unavailable", "Restart Klerm to reconnect");
		showError(toError(error).message);
		setTaskActive(false);
	} finally {
		sessionTransitionActive = false;
		backendRestarting = false;
		setTaskActive(taskActive);
	}
}

function handleRpcEvent(message: JsonObject): void {
	if (message.type === "agent_start") {
		setTaskActive(true);
		return;
	}
	if (message.type === "agent_settled") {
		currentAssistantBody?.classList.remove("is-streaming");
		currentAssistantBody = undefined;
		currentAssistantText = "";
		activity.hidden = true;
		setTaskActive(false);
		void refreshSessions();
		void (async () => {
			try {
				const state = await bridge.send<SessionState>("get_state");
				lastState = state;
				if (!sessionTransitionActive) {
					sessionTitle.textContent = state.sessionName ?? sessionTitle.textContent;
					sessionCwd.textContent = state.cwd;
				}
				renderCurrentModel();
				placeComposer();
			} catch {
				// Backend may be restarting; state will refresh on reconnect.
			}
		})();
		return;
	}
	if (message.type === "message_start") {
		const startedMessage = message.message as AgentMessage | undefined;
		if (startedMessage?.role === "assistant") {
			currentAssistantText = "";
			currentAssistantBody = addMessage("assistant", "", startedMessage.model);
			currentAssistantBody.classList.add("is-streaming");
		}
		return;
	}
	if (message.type === "message_update") {
		const event = message.assistantMessageEvent as JsonObject | undefined;
		if (event?.type === "text_delta" && typeof event.delta === "string") {
			if (!currentAssistantBody) currentAssistantBody = addMessage("assistant", "");
			currentAssistantText += event.delta;
			currentAssistantBody.textContent = currentAssistantText;
			currentAssistantBody.classList.add("is-streaming");
		}
		return;
	}
	if (message.type === "message_end") {
		const completedMessage = message.message as AgentMessage | undefined;
		if (completedMessage?.role === "assistant") {
			if (!currentAssistantBody) currentAssistantBody = addMessage("assistant", "", completedMessage.model);
			currentAssistantBody.textContent = messageText(completedMessage) || currentAssistantText;
			currentAssistantBody.classList.remove("is-streaming");
		}
		return;
	}
	if (message.type === "tool_execution_start") {
		activity.hidden = false;
		activity.textContent = `Tool running: ${String(message.toolName ?? "unknown")}`;
		return;
	}
	if (message.type === "tool_execution_end") {
		activity.textContent = `Tool completed: ${String(message.toolName ?? "unknown")}`;
		return;
	}
	if (message.type === "routing_changed") {
		const state = message.state as RoutingState | undefined;
		if (currentConfig && state) {
			currentConfig = {
				...currentConfig,
				routing: state.mode,
				localModel: state.localModel ?? currentConfig.localModel,
				frontierModel: state.frontierModel ?? currentConfig.frontierModel,
			};
		}
		syncConfigControls();
		return;
	}
	if (message.type === "backend_error") {
		const text = typeof message.message === "string" ? message.message : "Backend error";
		if (/error|failed|invalid/i.test(text)) showError(text);
		return;
	}
	if (message.type === "backend_exit") {
		if (backendRestarting) return;
		backendReady = false;
		setStatus("error", "Backend stopped", "Restart Klerm to reconnect");
		setTaskActive(false);
		showError("The Klerm backend stopped unexpectedly.");
	}
}

function setupInteractions(): void {
	localModelSelect.addEventListener("change", () => {
		if (localModelSelect.value) void applyConfigUpdate({ localModel: localModelSelect.value });
	});
	frontierModelSelect.addEventListener("change", () => {
		if (frontierModelSelect.value) void applyConfigUpdate({ frontierModel: frontierModelSelect.value });
	});
	routingSelect.addEventListener("change", () => {
		void applyConfigUpdate({ routing: routingSelect.value as KlermConfig["routing"] });
	});
	element<HTMLButtonElement>("refresh-models").addEventListener("click", () => {
		void refreshLocalModels();
		void refreshFrontierModels();
	});
	element<HTMLButtonElement>("refresh-sessions").addEventListener("click", () => void refreshSessions());
	element<HTMLButtonElement>("new-session").addEventListener("click", () => void newSession());
	element<HTMLButtonElement>("sidebar-toggle").addEventListener("click", () => sidebar.classList.toggle("is-open"));
	stopButton.addEventListener("click", async () => {
		try {
			await bridge.send("abort");
		} catch (error) {
			showError(toError(error).message);
		}
	});

	prompt.addEventListener("input", () => {
		prompt.style.height = "auto";
		prompt.style.height = `${Math.min(prompt.scrollHeight, 150)}px`;
	});
	prompt.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			composer.requestSubmit();
		}
	});
	composer.addEventListener("submit", async (event) => {
		event.preventDefault();
		const text = prompt.value.trim();
		if (!text || taskActive || configBusy || sessionTransitionActive || !backendReady) return;
		clearError();
		addMessage("user", text);
		prompt.value = "";
		prompt.style.height = "auto";
		setTaskActive(true);
		try {
			await bridge.send("prompt", { message: text });
		} catch (error) {
			setTaskActive(false);
			showError(toError(error).message);
		}
	});
}

async function boot(): Promise<void> {
	const startedAt = performance.now();
	setupInteractions();
	bridge.onEvent(handleRpcEvent);
	try {
		await bridge.start();
		await connectBackend();
		await refreshSessions();
	} catch (error) {
		backendReady = false;
		setStatus("error", "Backend unavailable", "Check the development console");
		runtimeIndicator.className = "status-dot is-error";
		runtimeTitle.textContent = "Klerm could not start";
		runtimeDetail.textContent = toError(error).message;
		showError(toError(error).message);
		setTaskActive(false);
	} finally {
		const remainingSplashTime = Math.max(0, 950 - (performance.now() - startedAt));
		window.setTimeout(() => {
			app.classList.remove("is-booting");
			splash.classList.add("is-hidden");
		}, remainingSplashTime);
	}
}

void boot();
