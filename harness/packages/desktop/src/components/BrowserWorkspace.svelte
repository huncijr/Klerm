<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { listen, type UnlistenFn } from "@tauri-apps/api/event";
	import {
		ArrowLeft,
		ArrowRight,
		Check,
		ChevronDown,
		CircleStop,
		Globe2,
		Hand,
		LayoutPanelLeft,
		LoaderCircle,
		LockKeyhole,
		MessageSquareText,
		PanelRight,
		PanelTop,
		Play,
		RefreshCw,
		Send,
		ShieldAlert,
		ShieldCheck,
		Sparkles,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { useDesktopShortcuts } from "../lib/shortcuts.ts";
	import { mayAutoResumeBrowser, visibleBrowserActivity } from "../lib/browser-presentation.ts";
	import type { BrowserActivityEvent, BrowserAvailability, BrowserRunState, PersonalBot, ThinkingLevel } from "../lib/model.ts";

	let {
		sessionId,
		personalAgents,
		availability,
		run,
		activity,
		loading,
		onrefresh,
		onprobe,
		onstart,
		onresolveorigin,
		onresolveaction,
		onstop,
		oncrash,
		ontakeover,
		onresume,
		onclose,
		onnew,
	}: {
		sessionId: string;
		personalAgents: PersonalBot[];
		availability?: BrowserAvailability;
		run?: BrowserRunState;
		activity: BrowserActivityEvent[];
		loading: boolean;
		onrefresh: () => Promise<void>;
		onprobe: (model: string, reasoning: ThinkingLevel, personalBotId: string) => Promise<{ status: "passed" | "failed"; code: string; reason: string; levels: ThinkingLevel[] }>;
		onstart: (input: {
			context?: string;
			model: string;
			personalBotId: string;
			reasoning: ThinkingLevel;
			prompt: string;
			startUrl?: string;
			currentUrl?: string;
			cdpUrl?: string;
		}) => Promise<BrowserRunState>;
		onresolveorigin: (
			decision: "approved" | "denied",
			scope?: "allow_once" | "current_run",
		) => Promise<void>;
		onresolveaction: (decision: "approved" | "denied") => Promise<void>;
		onstop: () => Promise<void>;
		oncrash: () => Promise<void>;
		ontakeover: (reason?: string) => Promise<void>;
		onresume: () => Promise<void>;
		onclose: () => void;
		onnew?: () => Promise<void>;
	} = $props();

	type ChatPlacement = "left" | "center" | "right";
	type BrowserMessage = { id: number; role: "user" | "assistant"; text: string; tone?: "normal" | "error" };

	let selectedModel = $state("");
	const shortcuts = useDesktopShortcuts();
	onMount(() => {
		const removeNew = shortcuts?.register("newItem", () => onnew?.(), () => !running && !commandBusy);
		const remove = [shortcuts?.register("run", submit, () => !running && !commandBusy), shortcuts?.register("stop", stop, () => running && !commandBusy), shortcuts?.register("close", onclose), shortcuts?.register("refresh", onrefresh, () => !running && !commandBusy), shortcuts?.register("browser.continue", () => resume(), () => running && run?.control === "human" && !commandBusy), shortcuts?.register("browser.takeover", () => takeover(), () => running && run?.control === "ai" && !commandBusy), shortcuts?.register("compose.focus", () => document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Ask the browser"]')?.focus()), shortcuts?.register("save", () => {}, () => false)];
		return () => { removeNew?.(); for (const cleanup of remove) cleanup?.(); };
	});
	let selectedPersonalBotId = $state("");
	let selectedReasoning = $state<ThinkingLevel>("off");
	let probeRetry = $state(0);
	let placement = $state<ChatPlacement>("right");
	let chatRatio = $state(40);
	let layoutElement: HTMLElement;
	let prompt = $state("");
	let address = $state("");
	let frame = $state.raw("");
	let hostError = $state("");
	let hostReady = $state(false);
	let cdpUrl: string | undefined;
	let retryHost: () => void = () => undefined;
	let browserSurface: HTMLButtonElement;
	let commandBusy = $state(false);
	let transientResumePending = false;
	$effect(() => {
		const paused = mayAutoResumeBrowser(run?.control, run?.controlReason, run?.status);
		if (!paused) return;
		const timer = window.setTimeout(() => {
			if (!transientResumePending) {
				transientResumePending = true;
				void onresume().catch(pushError).finally(() => (transientResumePending = false));
			}
		}, 3000);
		return () => window.clearTimeout(timer);
	});
	let messageId = 0;
	let localRunId = $state<string | undefined>(undefined);
	let renderedSettlement = $state<string | undefined>(undefined);
	let messages = $state<BrowserMessage[]>([]);
	let chatLoaded = $state(false);
	$effect(() => {
		if (!chatLoaded) return;
		localStorage.setItem(`klerm-browser-chat-${sessionId}`, JSON.stringify({ messages: messages.slice(-100), localRunId, renderedSettlement, selectedPersonalBotId }));
	});
	let modelProbe = $state<{ model: string; reasoning: ThinkingLevel; status: "checking" | "passed" | "failed"; code?: string; reason: string } | undefined>();
	let probeGeneration = 0;
	let cursorRunId = $state("");
	let lastCursor = $state<{ x: number; y: number; action: string } | undefined>();
	const cursorModel = $derived(run?.model.split("/").slice(1).join("/") || run?.model || "AI");
	$effect(() => {
		if (cursorRunId !== run?.runId) {
			cursorRunId = run?.runId ?? "";
			lastCursor = undefined;
		}
		if (run?.agentCursor) lastCursor = { ...run.agentCursor };
		if (run?.control !== "ai" || !["queued", "running", "waiting-approval"].includes(run?.status ?? "")) lastCursor = undefined;
	});

	const running = $derived(run?.status === "queued" || run?.status === "running" || run?.status === "waiting-approval");
	const humanControl = $derived(run?.control === "human");
	const pausingControl = $derived(run?.control === "pausing");
	const browserFirst = $derived(placement === "left");
	const currentActivity = $derived(activity.filter((item) => (!run || !item.runId || item.runId === run.runId) && visibleBrowserActivity(item)));
	const runStageLabel = $derived.by(() => {
		if (!running) return "Browser task running";
		if (run?.status === "waiting-approval")
			return run?.pendingAction ? "Waiting for action approval" : "Waiting for origin approval";
		if (
			!currentActivity.some((item) =>
				["ACTION", "ACTION_DISPATCHED", "ACTION_COMPLETED", "ACTION_FAILED", "ACTION_VERIFIED"].includes(item.event),
			)
		)
			return "Model is planning the first step…";
		return "Browser task running";
	});
	const runtimeLabel = $derived.by(() => {
		if (loading) return "checking runtime";
		if (!availability) return "runtime unchecked";
		if (!availability.available) return "runtime unavailable";
		return `${availability.runtime}${availability.version ? ` / ${availability.version}` : ""}`;
	});
	const blockReason = $derived.by(() => {
		if (running) return "";
		if (!hostReady) return hostError || "Starting embedded Chromium";
		if (loading && !availability) return "Checking browser runtime";
		if (!availability) return "Browser runtime is not checked yet";
		if (!availability.available) return availability.reason;
		const selectedAgent = personalAgents.find((agent) => agent.id === selectedPersonalBotId);
		if (!selectedAgent?.enabled) return "Select an enabled Personal Agent";
		if (!selectedAgent.browserEnabled) return "Enable Browser access in Personal Agent settings";
		if (!selectedModel) return "Select a model";
		if (!modelProbe || modelProbe.model !== selectedModel || modelProbe.reasoning !== selectedReasoning) return "Checking the selected model";
		if (modelProbe.status === "checking") return "Checking the selected model";
		if (modelProbe.status === "failed") return modelProbe.reason;
		if (!prompt.trim()) return "Enter a task";
		return "";
	});

	$effect(() => {
		if (!selectedPersonalBotId) selectedPersonalBotId = personalAgents.find((agent) => agent.enabled && agent.browserEnabled && agent.model)?.id ?? "";
		const agent = personalAgents.find((candidate) => candidate.id === selectedPersonalBotId);
		selectedModel = agent?.model ?? "";
		selectedReasoning = agent?.effort ?? "off";
	});

	$effect(() => {
		const model = selectedModel;
		const reasoning = selectedReasoning;
		probeRetry;
		if (!model || !availability?.available) return;
		const generation = ++probeGeneration;
		modelProbe = { model, reasoning, status: "checking", reason: "Checking provider tool-request support…" };
		void onprobe(model, reasoning, selectedPersonalBotId).then(
			(result) => {
				if (generation !== probeGeneration) return;
				modelProbe = { model, reasoning, ...result };
			},
			() => { if (generation === probeGeneration) modelProbe = { model, reasoning, status: "failed", code: "probe_failed", reason: "Model check failed. Retry the check." }; },
		);
		return () => { probeGeneration += 1; };
	});

	$effect(() => {
		if (!run || run.runId !== localRunId || renderedSettlement === run.runId) return;
		if (run.status !== "completed" && run.status !== "failed" && run.status !== "cancelled") return;
		renderedSettlement = run.runId;
		messages = [
			...messages,
			{
				id: ++messageId,
				role: "assistant",
				text:
					run.error ??
					run.resultSummary ??
					(run.status === "cancelled" ? "The browser task was stopped." : "The browser task settled."),
				tone: run.status === "failed" ? "error" : "normal",
			},
		];
	});

	type HostEvent = { sessionId: string; event: { type: string; data?: string; url?: string; message?: string } };

	async function sendHost(command: Record<string, unknown>): Promise<void> {
		if (!hostReady || !sessionId) return;
		await invoke("browser_host_command", { sessionId, command });
	}

	onMount(() => {
		try {
			const stored = JSON.parse(localStorage.getItem(`klerm-browser-chat-${sessionId}`) ?? "{}");
			if (Array.isArray(stored.messages)) messages = stored.messages.filter((message: BrowserMessage) => message && typeof message.text === "string" && typeof message.id === "number" && ["user", "assistant"].includes(message.role)).slice(-100);
			messageId = Math.max(0, ...messages.map((message) => message.id));
			localRunId = typeof stored.localRunId === "string" ? stored.localRunId : undefined;
			renderedSettlement = typeof stored.renderedSettlement === "string" ? stored.renderedSettlement : undefined;
			if (typeof stored.selectedPersonalBotId === "string") selectedPersonalBotId = stored.selectedPersonalBotId;
		} catch { messages = []; }
		chatLoaded = true;
		const savedRatio = Number(localStorage.getItem("klerm-browser-chat-ratio"));
		if (Number.isFinite(savedRatio) && savedRatio >= 25 && savedRatio <= 75) chatRatio = savedRatio;
		let mounted = true;
		let unlisten: UnlistenFn | undefined;
		const observer = new ResizeObserver((entries) => {
			const bounds = entries[0]?.contentRect;
			if (bounds) void sendHost({ type: "resize", width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
		});
		const connect = async () => {
			try {
				unlisten?.();
				unlisten = await listen<HostEvent>("klerm://browser-host", ({ payload }) => {
					if (payload.sessionId !== sessionId || !mounted) return;
					if (payload.event.type === "frame" && typeof payload.event.data === "string") {
						frame = `data:image/png;base64,${payload.event.data}`;
					} else if (payload.event.type === "url" && typeof payload.event.url === "string") {
						address = payload.event.url === "about:blank" ? "" : payload.event.url;
					} else if (payload.event.type === "crash" || payload.event.type === "error") {
						hostReady = false;
						cdpUrl = undefined;
						frame = "";
						hostError = payload.event.message ?? "Browser stopped. Restart it to open a blank page.";
						void oncrash().catch(pushError);
					}
				});
				if (!mounted) {
					unlisten?.();
					return;
				}
				const result = await invoke<{ cdpUrl: string }>("start_browser_host", { sessionId });
				if (!mounted) {
					void invoke("browser_host_command", { sessionId, command: { type: "visible", visible: false } });
					return;
				}
				cdpUrl = result.cdpUrl;
				hostReady = true;
				hostError = "";
				observer.observe(browserSurface);
				const bounds = browserSurface.getBoundingClientRect();
				await sendHost({ type: "resize", width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
				await sendHost({ type: "visible", visible: true });
			} catch (error) {
				if (mounted) hostError = error instanceof Error ? error.message : String(error);
			}
			};
		retryHost = () => void connect();
		void connect();
		void onrefresh();
		return () => {
			mounted = false;
			retryHost = () => undefined;
			observer.disconnect();
			unlisten?.();
			void sendHost({ type: "visible", visible: false });
		};
	});

	function resizeChat(event: PointerEvent): void {
		if (!layoutElement || window.innerWidth <= 850) return;
		event.preventDefault();
		const move = (pointer: PointerEvent) => {
			const bounds = layoutElement.getBoundingClientRect();
			const percentage = ((pointer.clientX - bounds.left) / bounds.width) * 100;
			chatRatio = Math.round(Math.max(25, Math.min(75, browserFirst ? 100 - percentage : percentage)));
		};
		const release = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", release);
			localStorage.setItem("klerm-browser-chat-ratio", String(chatRatio));
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", release);
	}

	function resizeChatWithKeys(event: KeyboardEvent): void {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const direction = event.key === "ArrowRight" ? 1 : -1;
		chatRatio = Math.max(25, Math.min(75, chatRatio + direction * (browserFirst ? -5 : 5)));
		localStorage.setItem("klerm-browser-chat-ratio", String(chatRatio));
	}

	async function navigate(): Promise<void> {
		if (running && !humanControl) {
			await takeover("User requested browser navigation.");
			return;
		}
		try {
			const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
			if (!/^https?:$/.test(url.protocol)) throw new Error("Only HTTP and HTTPS pages are supported.");
			await sendHost({ type: "navigate", url: url.href });
			hostError = "";
		} catch (error) {
			hostError = error instanceof Error ? error.message : String(error);
		}
	}

	async function toolbarCommand(type: "back" | "forward" | "reload"): Promise<void> {
		if (running && !humanControl) {
			await takeover("User requested browser navigation.");
			return;
		}
		await sendHost({ type });
	}

	async function submit(): Promise<void> {
		const text = prompt.trim();
		if (blockReason || !text || !selectedModel || running || commandBusy) return;
		messages = [...messages, { id: ++messageId, role: "user", text }];
		prompt = "";
		commandBusy = true;
		try {
			if (!cdpUrl) throw new Error(hostError || "The in-app Chromium browser is not ready yet.");
			const started = await onstart({
				context: messages.slice(0, -1).slice(-6).map((message) => `${message.role}: ${message.text.slice(0, 2000)}`).join("\n").slice(-8000),
				model: selectedModel,
				personalBotId: selectedPersonalBotId,
				reasoning: selectedReasoning,
				prompt: text,
				cdpUrl,
				...(/^https?:\/\//.test(address) ? { currentUrl: address } : {}),
			});
			localRunId = started.runId;
			renderedSettlement = undefined;
		} catch (error) {
			messages = [
				...messages,
				{
					id: ++messageId,
					role: "assistant",
					text: error instanceof Error ? error.message : String(error),
					tone: "error",
				},
			];
		} finally {
			commandBusy = false;
		}
	}

	async function stop(): Promise<void> {
		if (commandBusy) return;
		commandBusy = true;
		try {
			await onstop();
		} catch (error) {
			messages = [
				...messages,
				{ id: ++messageId, role: "assistant", text: error instanceof Error ? error.message : String(error), tone: "error" },
			];
		} finally {
			commandBusy = false;
		}
	}

	async function resolveOrigin(decision: "approved" | "denied", scope?: "allow_once" | "current_run"): Promise<void> {
		if (commandBusy) return;
		commandBusy = true;
		try {
			await onresolveorigin(decision, scope);
		} catch (error) {
			messages = [
				...messages,
				{ id: ++messageId, role: "assistant", text: error instanceof Error ? error.message : String(error), tone: "error" },
			];
		} finally {
			commandBusy = false;
		}
	}

	async function resolveAction(decision: "approved" | "denied"): Promise<void> {
		if (commandBusy) return;
		commandBusy = true;
		try { await onresolveaction(decision); }
		catch (error) { pushError(error); }
		finally { commandBusy = false; }
	}

	function pushError(error: unknown): void {
		messages = [
			...messages,
			{ id: ++messageId, role: "assistant", text: error instanceof Error ? error.message : String(error), tone: "error" },
		];
	}

	async function takeover(reason?: string): Promise<void> {
		if (commandBusy || !run || run.control !== "ai" || !running) return;
		commandBusy = true;
		try {
			await ontakeover(reason);
		} catch (error) {
			pushError(error);
		} finally {
			commandBusy = false;
		}
	}

	async function resume(): Promise<void> {
		if (commandBusy || !run || (run.control !== "human" && run.control !== "pausing")) return;
		commandBusy = true;
		try {
			await onresume();
		} catch (error) {
			pushError(error);
		} finally {
			commandBusy = false;
		}
	}

	let shakeRunId = $state<string | undefined>(undefined);
	let shakeLastX = 0;
	let shakeLastDir = 0;
	let shakeReversals = 0;
	let shakeWindowStart = 0;

	function handleViewportPointerMove(event: PointerEvent): void {
		if (!run || run.control !== "ai" || !running || commandBusy) return;
		if (shakeRunId !== run.runId) {
			shakeRunId = run.runId;
			shakeReversals = 0;
			shakeWindowStart = 0;
			shakeLastDir = 0;
			shakeLastX = event.clientX;
			return;
		}
		const now = performance.now();
		if (now - shakeWindowStart > 900) {
			shakeWindowStart = now;
			shakeReversals = 0;
			shakeLastDir = 0;
			shakeLastX = event.clientX;
			return;
		}
		const dx = event.clientX - shakeLastX;
		shakeLastX = event.clientX;
		if (Math.abs(dx) < 4) return;
		const dir = dx > 0 ? 1 : -1;
		if (shakeLastDir !== 0 && dir !== shakeLastDir) {
			shakeReversals += 1;
			if (shakeReversals >= 4) {
				shakeReversals = 0;
				shakeWindowStart = 0;
				shakeLastDir = 0;
				void takeover("Pointer shake takeover gesture.");
				return;
			}
		}
		shakeLastDir = dir;
	}

	function forwardPointer(event: PointerEvent, kind: "move" | "down" | "up"): void {
		if (running && !humanControl) return;
		const bounds = browserSurface.getBoundingClientRect();
		void sendHost({ type: "mouse", kind, x: Math.round(event.clientX - bounds.left), y: Math.round(event.clientY - bounds.top), button: event.button === 2 ? "right" : "left" });
	}

	function forwardWheel(event: WheelEvent): void {
		if (running && !humanControl) return;
		event.preventDefault();
		const bounds = browserSurface.getBoundingClientRect();
		void sendHost({ type: "mouse", kind: "wheel", x: Math.round(event.clientX - bounds.left), y: Math.round(event.clientY - bounds.top), delta_y: Math.round(-event.deltaY) });
	}

	function forwardKey(event: KeyboardEvent): void {
		if (running && !humanControl) {
			void takeover("Human keyboard input in the browser.");
			return;
		}
		event.preventDefault();
		void sendHost({ type: "key", kind: "down", key: event.key });
		if (event.key.length === 1) void sendHost({ type: "key", kind: "char", key: event.key });
		void sendHost({ type: "key", kind: "up", key: event.key });
	}

	function handleViewportPointerDown(): void {
		if (!run || run.control !== "ai" || !running || commandBusy) return;
		void takeover("Human input in the browser viewport.");
	}

	function handleViewportWheel(): void {
		if (!run || run.control !== "ai" || !running || commandBusy) return;
		void takeover("Human input in the browser viewport.");
	}

	function handlePromptKeydown(event: KeyboardEvent): void {
		if (!event.isComposing && (shortcuts?.matches(event, "compose.send") || shortcuts?.matches(event, "run"))) {
			event.preventDefault();
			void submit();
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg text-ink">
	<header class="relative z-20 flex h-[58px] shrink-0 items-center gap-3 border-b border-line bg-bg px-4 backdrop-blur-xl sm:px-5">
		<button type="button" aria-label="Back to Klerm" class="grid h-9 w-9 place-items-center rounded-xl border border-line bg-panel text-ink transition hover:-translate-x-0.5 hover:border-line hover:text-ink" onclick={onclose}><ArrowLeft size={15} /></button>
		<div class="flex min-w-0 items-center gap-2.5">
			<div class="grid h-8 w-8 place-items-center rounded-xl border border-warning bg-panel text-success"><Globe2 size={16} /></div>
			<div><p class="m-0 text-[13px] font-semibold text-ink">Klerm <span class="font-normal text-dim">/</span> Browser Task</p></div>
		</div>
		{#if !availability?.available}<div class="ml-auto max-w-[320px] truncate font-sans text-[11px] text-danger">{runtimeLabel}</div>{/if}
	</header>

	<div class="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
		<div class="mx-auto flex w-full max-w-[1480px] shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel p-2 shadow-sm">
			<label class="relative min-w-[220px] flex-[1.3] sm:max-w-[390px]"><span class="sr-only">Browser Personal Agent</span><Sparkles size={12} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-warning" /><select bind:value={selectedPersonalBotId} disabled={personalAgents.length === 0 || running} class="h-9 w-full appearance-none rounded-xl border border-line bg-bg pr-8 pl-8 font-sans text-[12px] text-ink outline-none focus:border-line disabled:opacity-45"><option value="">Choose a Personal Agent</option>{#each personalAgents as agent (agent.id)}<option value={agent.id} disabled={!agent.enabled || !agent.browserEnabled}>{agent.name} · {agent.model || "No model"}{!agent.browserEnabled ? " · Browser disabled" : ""}</option>{/each}</select><ChevronDown size={11} class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" /></label>
			<button type="button" aria-label="Refresh browser runtime" disabled={loading || running} class="grid h-9 w-9 place-items-center rounded-xl border border-line bg-bg text-muted transition hover:text-ink disabled:opacity-40" onclick={() => void onrefresh()}><RefreshCw size={12} class={loading ? "animate-spin" : ""} /></button>
			<div class="ml-auto flex items-center gap-1 rounded-xl border border-line bg-bg p-1" aria-label="Prompt placement">
				<button type="button" aria-label="Prompt left" aria-pressed={placement === "left"} class={`grid h-7 w-8 place-items-center rounded-lg transition ${placement === "left" ? "bg-raised text-success" : "text-muted hover:text-ink"}`} onclick={() => (placement = "left")}><LayoutPanelLeft size={13} /></button>
				<button type="button" aria-label="Prompt center" aria-pressed={placement === "center"} class={`grid h-7 w-8 place-items-center rounded-lg transition ${placement === "center" ? "bg-raised text-success" : "text-muted hover:text-ink"}`} onclick={() => (placement = "center")}><PanelTop size={13} /></button>
				<button type="button" aria-label="Prompt right" aria-pressed={placement === "right"} class={`grid h-7 w-8 place-items-center rounded-lg transition ${placement === "right" ? "bg-raised text-success" : "text-muted hover:text-ink"}`} onclick={() => (placement = "right")}><PanelRight size={13} /></button>
			</div>
		</div>

		{#if availability && !availability.available}
			<div class="mx-auto mt-3 flex w-full max-w-[1480px] items-start gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-[12px] text-accent"><ShieldAlert size={13} class="mt-0.5 shrink-0" /><span>{availability.reason}</span></div>
		{/if}
		{#if modelProbe && modelProbe.model === selectedModel && modelProbe.reasoning === selectedReasoning}
			<div class={`mx-auto mt-2 flex w-full max-w-[1480px] items-center gap-2 rounded-xl border px-3 py-2 text-[12px] ${modelProbe.status === "failed" ? "border-line bg-panel text-accent" : "border-line bg-bg text-ink"}`} role="status">
			<span>Model check: {modelProbe.reason}</span>
			{#if modelProbe.status === "failed"}<button type="button" class="ml-auto underline" onclick={() => (probeRetry += 1)}>Retry</button>{/if}
			</div>
		{/if}
		{#if run?.verifiedActions && run.model === selectedModel && (run.reasoning ?? "off") === selectedReasoning}
			<div class="mx-auto mt-2 w-full max-w-[1480px] rounded-xl border border-line bg-bg px-3 py-2 text-[12px] text-ink" role="status">Browser action verified: the search field value matched after the AI input ({run.verifiedActions} verified).</div>
		{/if}
		{#if run?.browserReset}
			<div class="mx-auto mt-3 flex w-full max-w-[1480px] items-start gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-[12px] text-accent" role="status"><ShieldAlert size={13} class="mt-0.5 shrink-0" /><span>The browser stopped unexpectedly. Your previous page was lost; your next question starts on a blank page.</span></div>
		{/if}

		<div bind:this={layoutElement} class={`browser-layout relative mx-auto mt-3 grid min-h-0 w-full max-w-[1480px] flex-1 gap-3 ${placement === "center" ? "stacked grid-rows-[minmax(210px,1fr)_minmax(260px,.9fr)]" : "horizontal"}`} style={`--first-width: ${browserFirst ? 100 - chatRatio : chatRatio}%; --split-position: ${browserFirst ? 100 - chatRatio : chatRatio}%;`}>
			<section aria-label="In-app Chromium browser" class={`relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-sm ${placement !== "center" && !browserFirst ? "order-2" : "order-1"}`}>
				<div class="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
					<button type="button" aria-label="Browser back" disabled={!hostReady} onclick={() => void toolbarCommand("back")} class="text-ink disabled:opacity-40"><ArrowLeft size={14} /></button>
					<button type="button" aria-label="Browser forward" disabled={!hostReady} onclick={() => void toolbarCommand("forward")} class="text-ink disabled:opacity-40"><ArrowRight size={14} /></button>
					<button type="button" aria-label="Reload browser page" disabled={!hostReady} onclick={() => void toolbarCommand("reload")} class="text-ink disabled:opacity-40"><RefreshCw size={13} /></button>
					<div class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5"><LockKeyhole size={10} class="text-muted" /><input aria-label="Browser address" bind:value={address} placeholder="Enter an address" class="min-w-0 flex-1 bg-transparent font-sans text-[12px] text-ink outline-none" onkeydown={(event) => { event.stopPropagation(); if (event.key === "Enter") void navigate(); }} /></div>
					{#if running && run?.control === "ai"}<button type="button" aria-label="Take browser control" disabled={commandBusy} class="flex shrink-0 items-center gap-1.5 rounded-lg border border-warning bg-raised px-2.5 py-1.5 text-[11px] font-semibold text-success disabled:opacity-40" onclick={() => void takeover()}><Hand size={11} /> Take control</button>{/if}
					{#if hostError}<button type="button" aria-label="Restart embedded browser" disabled={running && !run?.browserReset} class="shrink-0 rounded-lg border border-line px-2 py-1 text-[12px] text-warning disabled:opacity-40" onclick={() => retryHost()}>Restart browser</button>{/if}
				</div>
				{#if running && run && (humanControl || pausingControl)}
					<div class={`flex shrink-0 items-start gap-2 border-b px-3 py-2 ${humanControl ? "border-line bg-bg" : "border-warning bg-panel"}`}><Hand size={13} class={`mt-0.5 shrink-0 ${humanControl ? "text-warning" : "text-warning"}`} /><div class="min-w-0 flex-1"><p class="m-0 text-[12px] font-semibold {humanControl ? "text-success" : "text-warning"}">{humanControl ? "You are in control" : "Pausing the AI"}</p><p class="mt-0.5 mb-0 text-[11px] leading-[1.5] {humanControl ? "text-success" : "text-warning"}">{humanControl ? `${run.controlReason ?? "Human takeover."} The AI waits; nothing resumes without your Continue.` : "The in-flight action drains first, then the AI waits for you."}</p></div><div class="flex shrink-0 gap-2">{#if humanControl}<button type="button" aria-label="Continue browser task" disabled={commandBusy} class="flex items-center gap-1.5 rounded-lg border border-warning bg-panel px-2.5 py-1.5 text-[11px] font-semibold text-ink disabled:opacity-40" onclick={() => void resume()}><Play size={11} /> Continue</button>{/if}<button type="button" aria-label="Stop browser task" disabled={commandBusy} class="grid h-8 w-8 place-items-center rounded-xl border border-danger bg-raised text-danger transition hover:bg-raised disabled:opacity-40" onclick={() => void stop()}>{#if commandBusy}<LoaderCircle size={13} class="animate-spin" />{:else}<CircleStop size={13} />{/if}</button></div></div>
				{/if}
				<button type="button" bind:this={browserSurface} aria-label="Interactive Chromium page" class="relative block min-h-0 w-full flex-1 overflow-hidden bg-primary p-0 text-left outline-none" onpointermove={(event) => { handleViewportPointerMove(event); forwardPointer(event, "move"); }} onpointerdown={(event) => { handleViewportPointerDown(); forwardPointer(event, "down"); }} onpointerup={(event) => forwardPointer(event, "up")} onwheel={(event) => { handleViewportWheel(); forwardWheel(event); }} onkeydown={forwardKey}>
					{#if frame}<img alt="Chromium browser page" src={frame} draggable="false" class="h-full w-full select-none" />{:else}<div class="grid h-full place-items-center bg-bg p-6 text-center text-[13px] text-muted">{hostError || (hostReady ? "Loading Chromium page…" : "Starting embedded Chromium…")}</div>{/if}
					{#if running && run?.control === "ai"}<div class="pointer-events-none absolute top-3 right-3 z-10 rounded-lg border border-warning bg-panel/90 px-2.5 py-1.5 text-[12px] font-semibold text-success shadow-sm" aria-label={`Active browser model ${cursorModel}`}>{cursorModel} · {run.agentCursor?.action ?? "observing"}</div>{/if}
					{#if running && run?.control === "ai" && lastCursor}
						<div class="pointer-events-none absolute z-10 flex items-start gap-1 text-warning drop-shadow-sm motion-safe:transition-[top,left] motion-safe:duration-300" style={`left: ${lastCursor.x}px; top: ${lastCursor.y}px;`} aria-label={`${cursorModel} cursor`}><span class="absolute -top-10 -left-10 h-24 w-24 rounded-full border border-warning/65 bg-primary/15 shadow-sm ${run.agentCursor ? "motion-safe:animate-pulse" : "opacity-50"}"></span><span class="relative text-xl leading-none">◆</span><span class="relative rounded border border-success bg-raised/95 px-1.5 py-0.5 text-[12px]">{cursorModel} · {run.agentCursor?.action ?? "last position"}</span></div>
					{/if}
				</button>
			</section>

			<section class={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-sm ${placement !== "center" && browserFirst ? "order-2" : "order-1"}`}>
				<div class="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4"><MessageSquareText size={13} class="text-success" /><span class="text-[12px] font-semibold text-ink">Browser task</span></div>
				<div class="min-h-0 flex-1 overflow-y-auto p-4">
					{#if messages.length === 0}
						<div class="grid h-full min-h-[170px] place-items-center"><div class="max-w-[390px] text-center"><div class="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-line bg-panel text-success"><Sparkles size={17} /></div><h3 class="mt-3 mb-1.5 text-[14px] font-semibold text-ink">Explore a public site</h3><p class="m-0 text-[12px] leading-[1.6] text-muted">Ask your Personal Agent to browse, read or compare pages.</p></div></div>
					{:else}
						<div class="space-y-3">{#each messages as message (message.id)}<div class={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><article class={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-[1.6] ${message.role === "user" ? "rounded-br-md border border-line bg-panel text-ink" : message.tone === "error" ? "rounded-bl-md border border-line bg-panel text-danger" : "rounded-bl-md border border-line bg-panel text-ink"}`}><p class="m-0">{message.text}</p></article></div>{/each}{#if running}<div class="flex justify-start"><div class="flex items-center gap-2 rounded-2xl rounded-bl-md border border-line bg-panel px-3.5 py-2.5"><LoaderCircle size={12} class="animate-spin text-warning" /><span class="font-sans text-[11px] text-muted">{runStageLabel}</span></div></div>{/if}</div>
					{/if}
					{#if run?.status === "waiting-approval" && run?.pendingApproval}
						<div class="mt-4 rounded-xl border border-warning bg-panel p-3"><div class="flex items-start gap-2"><ShieldAlert size={14} class="mt-0.5 shrink-0 text-warning" /><div class="min-w-0"><p class="m-0 text-[12px] font-semibold text-warning">New origin requested</p><p class="mt-1 mb-0 break-all font-mono text-[11px] text-warning">{run.pendingApproval.origin}</p></div></div><div class="mt-3 flex flex-wrap gap-2"><button type="button" disabled={commandBusy} class="rounded-lg border border-warning bg-raised px-2.5 py-1.5 text-[11px] font-semibold text-success disabled:opacity-40" onclick={() => void resolveOrigin("approved", "allow_once")}>Allow once</button><button type="button" disabled={commandBusy} class="rounded-lg border border-warning bg-raised px-2.5 py-1.5 text-[11px] font-semibold text-success disabled:opacity-40" onclick={() => void resolveOrigin("approved", "current_run")}>Allow for run</button><button type="button" disabled={commandBusy} class="rounded-lg border border-danger bg-raised px-2.5 py-1.5 text-[11px] font-semibold text-danger disabled:opacity-40" onclick={() => void resolveOrigin("denied")}>Deny and stop</button></div></div>
					{/if}
					{#if run?.pendingAction}
						<div class="mt-4 rounded-xl border border-warning bg-panel p-3" role="alert"><p class="m-0 text-[12px] font-semibold text-warning">Agent requests browser action: {run.pendingAction.action.replaceAll("_", " ")}</p><p class="mt-1 break-all font-mono text-[11px] text-warning">{run.pendingAction.target} · {run.pendingAction.origin || "Current page"} · Input content is never included in this request.</p><div class="mt-3 flex gap-2"><button type="button" disabled={commandBusy} class="rounded-lg border border-warning bg-raised px-2.5 py-1.5 text-[11px] text-success disabled:opacity-40" onclick={() => void resolveAction("approved")}>Allow once</button><button type="button" disabled={commandBusy} class="rounded-lg border border-danger bg-raised px-2.5 py-1.5 text-[11px] text-danger disabled:opacity-40" onclick={() => void resolveAction("denied")}>Deny</button></div></div>
					{/if}
					<div class="mt-4 space-y-2" aria-label="Browser activity">
						{#each currentActivity as item (`${item.sequence}-${item.event}`)}
							{#if item.event === "ASSISTANT_MESSAGE"}
								<div class="whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-line bg-panel px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">{item.reason}</div>
							{:else}
								<div class="flex items-start gap-2 rounded-xl border border-line bg-bg px-3 py-2"><span class="mt-0.5 font-sans text-[11px] text-muted">#{item.sequence}</span><div class="min-w-0"><p class="m-0 font-sans text-[11px] text-ink">{item.event.replaceAll("_", " ")}</p>{#if item.reason}<p class="mt-0.5 mb-0 text-[11px] leading-[1.45] text-muted">{item.reason}</p>{/if}</div></div>
							{/if}
						{/each}
					</div>
				</div>
				<div class="shrink-0 border-t border-line bg-bg p-3">
					<div class="rounded-2xl border border-line bg-bg p-2 focus-within:border-success"><textarea bind:value={prompt} rows="2" disabled={running} placeholder="Ask the browser to read, research, compare, or extract..." class="max-h-28 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-1 text-[13px] leading-[1.5] text-ink outline-none placeholder:text-dim disabled:opacity-45" onkeydown={handlePromptKeydown}></textarea><div class="flex items-center gap-2 px-1 pb-0.5"><span class={`min-w-0 flex-1 truncate font-mono text-[11px] ${blockReason && !running ? "text-danger" : "text-dim"}`}>{running ? selectedModel || "Browser task running" : blockReason || selectedModel || "No model selected"}</span>{#if running}<button type="button" aria-label="Stop browser task" disabled={commandBusy} class="grid h-8 w-8 place-items-center rounded-xl border border-danger bg-raised text-danger transition hover:bg-raised disabled:opacity-40" onclick={() => void stop()}>{#if commandBusy}<LoaderCircle size={13} class="animate-spin" />{:else}<CircleStop size={13} />{/if}</button>{:else}<button type="button" aria-label="Send browser task" disabled={!!blockReason || commandBusy} class="grid h-8 w-8 place-items-center rounded-xl border border-warning bg-panel text-ink shadow-sm transition hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35" onclick={() => void submit()} title={blockReason || "Send browser task"}>{#if commandBusy}<LoaderCircle size={13} class="animate-spin" />{:else}<Send size={13} />{/if}</button>{/if}</div></div>
					<div class="mt-2 flex items-center gap-1.5 px-1 font-sans text-[11px] text-dim"><ShieldCheck size={10} class="text-success" /><span>Guarded browser task. Audit: .klerm/browser-events.jsonl</span>{#if run && !running}<span class="ml-auto flex items-center gap-1 text-muted"><Check size={9} /> {run.status}</span>{/if}</div>
				</div>
			</section>
			{#if placement !== "center"}
				<button type="button" aria-label={`Resize browser and chat panels, chat ${chatRatio}%`} title="Drag or use arrow keys to resize" class="browser-divider absolute top-0 bottom-0 z-10 w-3 -translate-x-1/2 cursor-col-resize border-0 bg-transparent hover:bg-warning-soft focus-visible:bg-warning-soft" style={`left: var(--split-position);`} onpointerdown={resizeChat} onkeydown={resizeChatWithKeys}></button>
			{/if}
		</div>
	</div>
</div>

<style>
	.browser-layout.horizontal { grid-template-columns: minmax(0, var(--first-width)) minmax(0, 1fr); }
	@media (max-width: 850px) {
		.browser-layout.horizontal { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(210px, 1fr) minmax(260px, .9fr); }
		.browser-divider { display: none; }
	}
</style>
