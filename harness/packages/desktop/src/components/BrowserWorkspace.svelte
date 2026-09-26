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
	import type { BrowserActivityEvent, BrowserAvailability, BrowserRunState, SelectOption } from "../lib/model.ts";

	let {
		sessionId,
		models,
		availability,
		run,
		activity,
		loading,
		onrefresh,
		onstart,
		onresolveorigin,
		onresolveaction,
		onstop,
		oncrash,
		ontakeover,
		onresume,
		onclose,
	}: {
		sessionId: string;
		models: SelectOption[];
		availability?: BrowserAvailability;
		run?: BrowserRunState;
		activity: BrowserActivityEvent[];
		loading: boolean;
		onrefresh: () => Promise<void>;
		onstart: (input: {
			model: string;
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
	} = $props();

	type ChatPlacement = "left" | "center" | "right";
	type BrowserMessage = { id: number; role: "user" | "assistant"; text: string; tone?: "normal" | "error" };

	let selectedModel = $state("");
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
	let messageId = 0;
	let localRunId = $state<string | undefined>(undefined);
	let renderedSettlement = $state<string | undefined>(undefined);
	let messages = $state<BrowserMessage[]>([]);

	const running = $derived(run?.status === "queued" || run?.status === "running" || run?.status === "waiting-approval");
	const humanControl = $derived(run?.control === "human");
	const pausingControl = $derived(run?.control === "pausing");
	const browserFirst = $derived(placement === "left");
	const currentActivity = $derived(activity.filter((item) => !run || !item.runId || item.runId === run.runId));
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
		if (!selectedModel) return "Select a model";
		if (!prompt.trim()) return "Enter a task";
		return "";
	});

	$effect(() => {
		if (models.some((option) => option.value === selectedModel)) return;
		selectedModel = models[0]?.value ?? "";
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
				model: selectedModel,
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
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void submit();
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#05080b] text-[#e6edef]">
	<header class="relative z-20 flex h-[58px] shrink-0 items-center gap-3 border-b border-[#263138] bg-[rgba(7,11,14,.96)] px-4 backdrop-blur-xl sm:px-5">
		<button type="button" aria-label="Back to Klerm" class="grid h-9 w-9 place-items-center rounded-xl border border-[#303c43] bg-[#10161a] text-[#a7b3b8] transition hover:-translate-x-0.5 hover:border-[#617078] hover:text-white" onclick={onclose}><ArrowLeft size={15} /></button>
		<div class="flex min-w-0 items-center gap-2.5">
			<div class="grid h-8 w-8 place-items-center rounded-xl border border-[rgba(190,240,112,.3)] bg-[linear-gradient(145deg,rgba(178,232,92,.16),rgba(72,103,50,.08))] text-[#cef49b]"><Globe2 size={16} /></div>
			<div><p class="m-0 text-[12px] font-semibold text-[#f0f5f5]">Klerm <span class="font-normal text-[#617178]">/</span> Browser Task</p><p class="m-0 font-mono text-[7px] tracking-[.15em] text-[#60747a] uppercase">Session browser / guarded actions</p></div>
		</div>
		<div class={`ml-auto hidden items-center gap-2 rounded-full border px-3 py-1.5 sm:flex ${availability?.available ? "border-[#31432f] bg-[#0c1510]" : "border-[#3b3330] bg-[#15100e]"}`}><span class={`h-1.5 w-1.5 rounded-full ${availability?.available ? "bg-[#a9e66f] shadow-[0_0_9px_#a9e66f]" : "bg-[#c9816f]"}`}></span><span class="max-w-[320px] truncate font-mono text-[7px] tracking-[.11em] text-[#7f9297] uppercase">{runtimeLabel}</span></div>
	</header>

	<div class="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
		<div class="mx-auto flex w-full max-w-[1480px] shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-[#27353c] bg-[linear-gradient(110deg,rgba(14,21,26,.96),rgba(9,15,19,.96))] p-2 shadow-[0_14px_40px_rgba(0,0,0,.2)]">
			<label class="relative min-w-[220px] flex-[1.3] sm:max-w-[390px]"><span class="sr-only">Browser model</span><Sparkles size={12} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#d4df8c]" /><select bind:value={selectedModel} disabled={models.length === 0 || running} class="h-9 w-full appearance-none rounded-xl border border-[#34434a] bg-[#0a1014] pr-8 pl-8 font-mono text-[9px] text-[#d8e2e4] outline-none focus:border-[#718b63] disabled:opacity-45"><option value="" disabled>Choose a model</option>{#each models as model (model.value)}<option value={model.value}>{model.label}</option>{/each}</select><ChevronDown size={11} class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[#708087]" /></label>
			<button type="button" aria-label="Refresh browser runtime" disabled={loading || running} class="grid h-9 w-9 place-items-center rounded-xl border border-[#303e44] bg-[#080e12] text-[#7f9297] transition hover:text-white disabled:opacity-40" onclick={() => void onrefresh()}><RefreshCw size={12} class={loading ? "animate-spin" : ""} /></button>
			<div class="ml-auto flex items-center gap-1 rounded-xl border border-[#303e44] bg-[#080e12] p-1" aria-label="Prompt placement">
				<button type="button" aria-label="Prompt left" aria-pressed={placement === "left"} class={`grid h-7 w-8 place-items-center rounded-lg transition ${placement === "left" ? "bg-[#344b2a] text-[#d7f2b8]" : "text-[#697a80] hover:text-white"}`} onclick={() => (placement = "left")}><LayoutPanelLeft size={13} /></button>
				<button type="button" aria-label="Prompt center" aria-pressed={placement === "center"} class={`grid h-7 w-8 place-items-center rounded-lg transition ${placement === "center" ? "bg-[#344b2a] text-[#d7f2b8]" : "text-[#697a80] hover:text-white"}`} onclick={() => (placement = "center")}><PanelTop size={13} /></button>
				<button type="button" aria-label="Prompt right" aria-pressed={placement === "right"} class={`grid h-7 w-8 place-items-center rounded-lg transition ${placement === "right" ? "bg-[#344b2a] text-[#d7f2b8]" : "text-[#697a80] hover:text-white"}`} onclick={() => (placement = "right")}><PanelRight size={13} /></button>
			</div>
		</div>

		{#if availability && !availability.available}
			<div class="mx-auto mt-3 flex w-full max-w-[1480px] items-start gap-2 rounded-xl border border-[#563c34] bg-[#1a100e] px-3 py-2 text-[9px] text-[#d7aaa0]"><ShieldAlert size={13} class="mt-0.5 shrink-0" /><span>{availability.reason}</span></div>
		{/if}
		{#if run?.browserReset}
			<div class="mx-auto mt-3 flex w-full max-w-[1480px] items-start gap-2 rounded-xl border border-[#563c34] bg-[#1a100e] px-3 py-2 text-[9px] text-[#d7aaa0]" role="status"><ShieldAlert size={13} class="mt-0.5 shrink-0" /><span>The browser stopped unexpectedly. Your previous page was lost; your next question starts on a blank page.</span></div>
		{/if}

		<div bind:this={layoutElement} class={`browser-layout relative mx-auto mt-3 grid min-h-0 w-full max-w-[1480px] flex-1 gap-3 ${placement === "center" ? "stacked grid-rows-[minmax(210px,1fr)_minmax(260px,.9fr)]" : "horizontal"}`} style={`--first-width: ${browserFirst ? 100 - chatRatio : chatRatio}%; --split-position: ${browserFirst ? 100 - chatRatio : chatRatio}%;`}>
			<section aria-label="In-app Chromium browser" class={`relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#293940] bg-[#091116] shadow-[0_24px_70px_rgba(0,0,0,.3)] ${placement !== "center" && !browserFirst ? "order-2" : "order-1"}`}>
				<div class="flex h-11 shrink-0 items-center gap-2 border-b border-[#26363d] bg-[#0d171c] px-3">
					<button type="button" aria-label="Browser back" disabled={!hostReady} onclick={() => void toolbarCommand("back")} class="text-[#9badb0] disabled:opacity-40"><ArrowLeft size={14} /></button>
					<button type="button" aria-label="Browser forward" disabled={!hostReady} onclick={() => void toolbarCommand("forward")} class="text-[#9badb0] disabled:opacity-40"><ArrowRight size={14} /></button>
					<button type="button" aria-label="Reload browser page" disabled={!hostReady} onclick={() => void toolbarCommand("reload")} class="text-[#9badb0] disabled:opacity-40"><RefreshCw size={13} /></button>
					<div class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#2e4046] bg-[#070d11] px-2.5 py-1.5"><LockKeyhole size={10} class="text-[#789081]" /><input aria-label="Browser address" bind:value={address} placeholder="Enter an address" class="min-w-0 flex-1 bg-transparent font-mono text-[9px] text-[#d6e2e1] outline-none" onkeydown={(event) => { event.stopPropagation(); if (event.key === "Enter") void navigate(); }} /></div>
					{#if running && run?.control === "ai"}<button type="button" aria-label="Take browser control" disabled={commandBusy} class="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#58713d] bg-[#26391c] px-2.5 py-1.5 text-[8px] font-semibold text-[#daf5b8] disabled:opacity-40" onclick={() => void takeover()}><Hand size={11} /> Take control</button>{/if}
					{#if hostError}<button type="button" aria-label="Restart embedded browser" disabled={running && !run?.browserReset} class="shrink-0 rounded-lg border border-[#5a5940] px-2 py-1 text-[9px] text-[#e3d29a] disabled:opacity-40" onclick={() => retryHost()}>Restart browser</button>{/if}
				</div>
				{#if run && (humanControl || pausingControl)}
					<div class={`flex shrink-0 items-start gap-2 border-b px-3 py-2 ${humanControl ? "border-[#31432f] bg-[#0c1510]" : "border-[#65522d] bg-[#1a160b]"}`}><Hand size={13} class={`mt-0.5 shrink-0 ${humanControl ? "text-[#a9e66f]" : "text-[#e3c06b]"}`} /><div class="min-w-0 flex-1"><p class="m-0 text-[10px] font-semibold {humanControl ? "text-[#daf5b8]" : "text-[#f0d58e]"}">{humanControl ? "You are in control" : "Pausing the AI"}</p><p class="mt-0.5 mb-0 text-[8px] leading-[1.5] {humanControl ? "text-[#9db98c]" : "text-[#bba96f]"}">{humanControl ? `${run.controlReason ?? "Human takeover."} The AI waits; nothing resumes without your Continue.` : "The in-flight action drains first, then the AI waits for you."}</p></div><div class="flex shrink-0 gap-2">{#if humanControl}<button type="button" aria-label="Continue browser task" disabled={commandBusy} class="flex items-center gap-1.5 rounded-lg border border-[#648643] bg-[linear-gradient(145deg,#5f843c,#3e602d)] px-2.5 py-1.5 text-[8px] font-semibold text-[#efffd9] disabled:opacity-40" onclick={() => void resume()}><Play size={11} /> Continue</button>{/if}<button type="button" aria-label="Stop browser task" disabled={commandBusy} class="grid h-8 w-8 place-items-center rounded-xl border border-[#704847] bg-[#301a1a] text-[#f3a6a1] transition hover:bg-[#442121] disabled:opacity-40" onclick={() => void stop()}>{#if commandBusy}<LoaderCircle size={13} class="animate-spin" />{:else}<CircleStop size={13} />{/if}</button></div></div>
				{/if}
				<button type="button" bind:this={browserSurface} aria-label="Interactive Chromium page" class="relative block min-h-0 w-full flex-1 overflow-hidden bg-white p-0 text-left outline-none" onpointermove={(event) => { handleViewportPointerMove(event); forwardPointer(event, "move"); }} onpointerdown={(event) => { handleViewportPointerDown(); forwardPointer(event, "down"); }} onpointerup={(event) => forwardPointer(event, "up")} onwheel={(event) => { handleViewportWheel(); forwardWheel(event); }} onkeydown={forwardKey}>
					{#if frame}<img alt="Chromium browser page" src={frame} draggable="false" class="h-full w-full select-none" />{:else}<div class="grid h-full place-items-center bg-[#0b1115] p-6 text-center text-[11px] text-[#8fa2a4]">{hostError || (hostReady ? "Loading Chromium page…" : "Starting embedded Chromium…")}</div>{/if}
					{#if running && run?.control === "ai" && run.agentCursor}
						<div class="pointer-events-none absolute z-10 flex items-start gap-1 text-[#d6fa9c] drop-shadow-[0_2px_5px_#000] motion-safe:transition-[top,left] motion-safe:duration-200" style={`left: ${run.agentCursor.x}px; top: ${run.agentCursor.y}px;`} aria-label={`Agent ${run.agentCursor.action}`}><span class="text-xl leading-none">◆</span><span class="rounded bg-[#19271c] px-1.5 py-0.5 text-[9px]">AI {run.agentCursor.action}</span></div>
					{/if}
				</button>
			</section>

			<section class={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#2d3c42] bg-[linear-gradient(155deg,#0d1419,#080d11)] shadow-[0_24px_70px_rgba(0,0,0,.24)] ${placement !== "center" && browserFirst ? "order-2" : "order-1"}`}>
				<div class="flex h-11 shrink-0 items-center gap-2 border-b border-[#28363c] px-4"><MessageSquareText size={13} class="text-[#b6db8e]" /><span class="text-[10px] font-semibold text-[#dbe5e6]">Browser task</span><span class="ml-auto rounded-full border border-[#2f4046] px-2 py-0.5 font-mono text-[7px] text-[#64787d]">SESSION BROWSER</span></div>
				<div class="min-h-0 flex-1 overflow-y-auto p-4">
					{#if messages.length === 0}
						<div class="grid h-full min-h-[170px] place-items-center"><div class="max-w-[390px] text-center"><div class="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-[#34464c] bg-[#10191e] text-[#a8c98b]"><Sparkles size={17} /></div><h3 class="mt-3 mb-1.5 text-[13px] font-semibold text-[#dfe8e9]">Explore a public site</h3><p class="m-0 text-[9px] leading-[1.6] text-[#718489]">New origins require approval. The agent can follow ordinary links and fill search fields; other controls, forms, uploads and downloads require human control.</p></div></div>
					{:else}
						<div class="space-y-3">{#each messages as message (message.id)}<div class={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><article class={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[10px] leading-[1.6] ${message.role === "user" ? "rounded-br-md border border-[#496038] bg-[linear-gradient(135deg,#304526,#22351e)] text-[#ecf7df]" : message.tone === "error" ? "rounded-bl-md border border-[#65413e] bg-[#211313] text-[#e7aaa4]" : "rounded-bl-md border border-[#304148] bg-[#111a1f] text-[#bcc9cc]"}`}><p class="m-0">{message.text}</p></article></div>{/each}{#if running}<div class="flex justify-start"><div class="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#304148] bg-[#111a1f] px-3.5 py-2.5"><LoaderCircle size={12} class="animate-spin text-[#b9e184]" /><span class="font-mono text-[8px] text-[#84979b]">{run?.status === "waiting-approval" ? "Waiting for origin approval" : "Browser task running"}</span></div></div>{/if}</div>
					{/if}
					{#if run?.pendingApproval}
						<div class="mt-4 rounded-xl border border-[#65522d] bg-[#1a160b] p-3"><div class="flex items-start gap-2"><ShieldAlert size={14} class="mt-0.5 shrink-0 text-[#e3c06b]" /><div class="min-w-0"><p class="m-0 text-[10px] font-semibold text-[#f0d58e]">New origin requested</p><p class="mt-1 mb-0 break-all font-mono text-[8px] text-[#bba96f]">{run.pendingApproval.origin}</p></div></div><div class="mt-3 flex flex-wrap gap-2"><button type="button" disabled={commandBusy} class="rounded-lg border border-[#58713d] bg-[#26391c] px-2.5 py-1.5 text-[8px] font-semibold text-[#daf5b8] disabled:opacity-40" onclick={() => void resolveOrigin("approved", "allow_once")}>Allow once</button><button type="button" disabled={commandBusy} class="rounded-lg border border-[#58713d] bg-[#26391c] px-2.5 py-1.5 text-[8px] font-semibold text-[#daf5b8] disabled:opacity-40" onclick={() => void resolveOrigin("approved", "current_run")}>Allow for run</button><button type="button" disabled={commandBusy} class="rounded-lg border border-[#704847] bg-[#301a1a] px-2.5 py-1.5 text-[8px] font-semibold text-[#f3aaa4] disabled:opacity-40" onclick={() => void resolveOrigin("denied")}>Deny and stop</button></div></div>
					{/if}
					{#if run?.pendingAction}
						<div class="mt-4 rounded-xl border border-[#65522d] bg-[#1a160b] p-3" role="alert"><p class="m-0 text-[10px] font-semibold text-[#f0d58e]">Agent requests browser action: {run.pendingAction.action.replaceAll("_", " ")}</p><p class="mt-1 break-all font-mono text-[8px] text-[#bba96f]">{run.pendingAction.target} · {run.pendingAction.origin || "Current page"} · Input content is never included in this request.</p><div class="mt-3 flex gap-2"><button type="button" disabled={commandBusy} class="rounded-lg border border-[#58713d] bg-[#26391c] px-2.5 py-1.5 text-[8px] text-[#daf5b8] disabled:opacity-40" onclick={() => void resolveAction("approved")}>Allow once</button><button type="button" disabled={commandBusy} class="rounded-lg border border-[#704847] bg-[#301a1a] px-2.5 py-1.5 text-[8px] text-[#f3aaa4] disabled:opacity-40" onclick={() => void resolveAction("denied")}>Deny</button></div></div>
					{/if}
					<div class="mt-4 space-y-2" aria-label="Browser activity">
						{#each currentActivity as item (`${item.sequence}-${item.event}`)}
							<div class="flex items-start gap-2 rounded-xl border border-[#28383e] bg-[#0a1216] px-3 py-2"><span class="mt-0.5 font-mono text-[7px] text-[#67806e]">#{item.sequence}</span><div class="min-w-0"><p class="m-0 font-mono text-[8px] text-[#b4c5c7]">{item.event.replaceAll("_", " ")}</p>{#if item.reason}<p class="mt-0.5 mb-0 text-[8px] leading-[1.45] text-[#6f8489]">{item.reason}</p>{/if}</div></div>
						{/each}
					</div>
				</div>
				<div class="shrink-0 border-t border-[#29373d] bg-[#0a1014] p-3">
					<div class="rounded-2xl border border-[#34444b] bg-[#070c10] p-2 focus-within:border-[#617f50]"><textarea bind:value={prompt} rows="2" disabled={running} placeholder="Ask the browser to read, research, compare, or extract..." class="max-h-28 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-1 text-[11px] leading-[1.5] text-[#e1e8ea] outline-none placeholder:text-[#4d5c62] disabled:opacity-45" onkeydown={handlePromptKeydown}></textarea><div class="flex items-center gap-2 px-1 pb-0.5"><span class={`min-w-0 flex-1 truncate font-mono text-[7px] ${blockReason && !running ? "text-[#c9816f]" : "text-[#5e7075]"}`}>{running ? selectedModel || "Browser task running" : blockReason || selectedModel || "No model selected"}</span>{#if running}<button type="button" aria-label="Stop browser task" disabled={commandBusy} class="grid h-8 w-8 place-items-center rounded-xl border border-[#704847] bg-[#301a1a] text-[#f3a6a1] transition hover:bg-[#442121] disabled:opacity-40" onclick={() => void stop()}>{#if commandBusy}<LoaderCircle size={13} class="animate-spin" />{:else}<CircleStop size={13} />{/if}</button>{:else}<button type="button" aria-label="Send browser task" disabled={!!blockReason || commandBusy} class="grid h-8 w-8 place-items-center rounded-xl border border-[#648643] bg-[linear-gradient(145deg,#5f843c,#3e602d)] text-[#efffd9] shadow-[0_8px_20px_rgba(90,133,51,.2)] transition hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35" onclick={() => void submit()} title={blockReason || "Send browser task"}>{#if commandBusy}<LoaderCircle size={13} class="animate-spin" />{:else}<Send size={13} />{/if}</button>{/if}</div></div>
					<div class="mt-2 flex items-center gap-1.5 px-1 font-mono text-[7px] text-[#586a70]"><ShieldCheck size={10} class="text-[#80a86d]" /><span>Guarded browser task. Audit: .klerm/browser-events.jsonl</span>{#if run && !running}<span class="ml-auto flex items-center gap-1 text-[#718d6a]"><Check size={9} /> {run.status}</span>{/if}</div>
				</div>
			</section>
			{#if placement !== "center"}
				<button type="button" aria-label={`Resize browser and chat panels, chat ${chatRatio}%`} title="Drag or use arrow keys to resize" class="browser-divider absolute top-0 bottom-0 z-10 w-3 -translate-x-1/2 cursor-col-resize border-0 bg-transparent hover:bg-[rgba(157,199,109,.3)] focus-visible:bg-[rgba(157,199,109,.3)]" style={`left: var(--split-position);`} onpointerdown={resizeChat} onkeydown={resizeChatWithKeys}></button>
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
