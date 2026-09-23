<script lang="ts">
	import {
		ArrowLeft,
		Bot,
		Check,
		ChevronDown,
		CircleStop,
		ExternalLink,
		Globe2,
		LayoutPanelLeft,
		LoaderCircle,
		LockKeyhole,
		MessageSquareText,
		PanelRight,
		PanelTop,
		RefreshCw,
		Send,
		ShieldAlert,
		ShieldCheck,
		Sparkles,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import type {
		BrowserActivityEvent,
		BrowserAvailability,
		BrowserRunState,
		CodingHarnessSetup,
		SelectOption,
	} from "../lib/model.ts";

	let {
		setup,
		models,
		availability,
		run,
		activity,
		loading,
		onrefresh,
		onstart,
		onresolveorigin,
		onstop,
		onclose,
	}: {
		setup?: CodingHarnessSetup;
		models: SelectOption[];
		availability?: BrowserAvailability;
		run?: BrowserRunState;
		activity: BrowserActivityEvent[];
		loading: boolean;
		onrefresh: () => Promise<void>;
		onstart: (input: {
			agentId: string;
			model: string;
			prompt: string;
			startUrl: string;
		}) => Promise<BrowserRunState>;
		onresolveorigin: (
			decision: "approved" | "denied",
			scope?: "allow_once" | "current_run",
		) => Promise<void>;
		onstop: () => Promise<void>;
		onclose: () => void;
	} = $props();

	type ChatPlacement = "left" | "center" | "right";
	type BrowserMessage = { id: number; role: "user" | "assistant"; text: string; tone?: "normal" | "error" };

	let selectedAgentId = $state("");
	let selectedModel = $state("");
	let placement = $state<ChatPlacement>("right");
	let prompt = $state("");
	let startUrl = $state("");
	let commandBusy = $state(false);
	let messageId = 0;
	let localRunId = $state<string | undefined>(undefined);
	let renderedSettlement = $state<string | undefined>(undefined);
	let messages = $state<BrowserMessage[]>([]);

	const agents = $derived((setup?.slots.agents ?? []).filter((agent) => agent.enabled && agent.kind === "klerm"));
	const selectedAgent = $derived(agents.find((agent) => agent.id === selectedAgentId) ?? agents[0]);
	const running = $derived(run?.status === "queued" || run?.status === "running" || run?.status === "waiting-approval");
	const browserFirst = $derived(placement === "left");
	const currentActivity = $derived(activity.filter((item) => !run || !item.runId || item.runId === run.runId));
	const runtimeLabel = $derived.by(() => {
		if (loading) return "checking runtime";
		if (!availability) return "runtime unchecked";
		if (!availability.available) return "runtime unavailable";
		return `${availability.runtime}${availability.version ? ` / ${availability.version}` : ""}`;
	});

	$effect(() => {
		if (!selectedAgentId && agents[0]) selectedAgentId = agents[0].id;
	});

	$effect(() => {
		if (models.some((option) => option.value === selectedModel)) return;
		const preferred = selectedAgent?.model;
		selectedModel = (preferred && models.some((option) => option.value === preferred) ? preferred : models[0]?.value) ?? "";
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

	onMount(() => {
		void onrefresh();
	});

	function changeAgent(event: Event): void {
		selectedAgentId = (event.currentTarget as HTMLSelectElement).value;
		const agent = agents.find((candidate) => candidate.id === selectedAgentId);
		if (agent?.model && models.some((option) => option.value === agent.model)) selectedModel = agent.model;
	}

	async function submit(): Promise<void> {
		const text = prompt.trim();
		const url = startUrl.trim();
		if (!text || !url || !selectedAgent || !selectedModel || running || commandBusy || !availability?.available) return;
		messages = [...messages, { id: ++messageId, role: "user", text }];
		prompt = "";
		commandBusy = true;
		try {
			const started = await onstart({ agentId: selectedAgent.id, model: selectedModel, prompt: text, startUrl: url });
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
			<div><p class="m-0 text-[12px] font-semibold text-[#f0f5f5]">Klerm <span class="font-normal text-[#617178]">/</span> Browser Task</p><p class="m-0 font-mono text-[7px] tracking-[.15em] text-[#60747a] uppercase">Ephemeral read-only run</p></div>
		</div>
		<div class={`ml-auto hidden items-center gap-2 rounded-full border px-3 py-1.5 sm:flex ${availability?.available ? "border-[#31432f] bg-[#0c1510]" : "border-[#3b3330] bg-[#15100e]"}`}><span class={`h-1.5 w-1.5 rounded-full ${availability?.available ? "bg-[#a9e66f] shadow-[0_0_9px_#a9e66f]" : "bg-[#c9816f]"}`}></span><span class="max-w-[320px] truncate font-mono text-[7px] tracking-[.11em] text-[#7f9297] uppercase">{runtimeLabel}</span></div>
	</header>

	<div class="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
		<div class="mx-auto flex w-full max-w-[1480px] shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-[#27353c] bg-[linear-gradient(110deg,rgba(14,21,26,.96),rgba(9,15,19,.96))] p-2 shadow-[0_14px_40px_rgba(0,0,0,.2)]">
			<label class="relative min-w-[180px] flex-1 sm:max-w-[250px]"><span class="sr-only">Browser agent</span><Bot size={12} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#95b978]" /><select value={selectedAgent?.id ?? ""} disabled={running} class="h-9 w-full appearance-none rounded-xl border border-[#34434a] bg-[#0a1014] pr-8 pl-8 font-mono text-[9px] text-[#d8e2e4] outline-none focus:border-[#718b63] disabled:opacity-45" onchange={changeAgent}><option value="" disabled>Choose Klerm agent</option>{#each agents as agent (agent.id)}<option value={agent.id}>Agent {agent.id.replace(/^agent-?/, "")}</option>{/each}</select><ChevronDown size={11} class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[#708087]" /></label>
			<label class="relative min-w-[220px] flex-[1.3] sm:max-w-[390px]"><span class="sr-only">Browser model</span><Sparkles size={12} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#d4df8c]" /><select bind:value={selectedModel} disabled={models.length === 0 || running} class="h-9 w-full appearance-none rounded-xl border border-[#34434a] bg-[#0a1014] pr-8 pl-8 font-mono text-[9px] text-[#d8e2e4] outline-none focus:border-[#718b63] disabled:opacity-45"><option value="" disabled>Choose Klerm model</option>{#each models as model (model.value)}<option value={model.value}>{model.label}</option>{/each}</select><ChevronDown size={11} class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[#708087]" /></label>
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

		<div class={`mx-auto mt-3 grid min-h-0 w-full max-w-[1480px] flex-1 gap-3 ${placement === "center" ? "grid-rows-[minmax(210px,1fr)_minmax(260px,.9fr)]" : "grid-cols-[minmax(320px,.82fr)_minmax(420px,1.25fr)] max-[850px]:grid-cols-1"}`}>
			<section class={`relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#293940] bg-[#091116] shadow-[0_24px_70px_rgba(0,0,0,.3)] ${placement !== "center" && !browserFirst ? "order-2" : "order-1"}`}>
				<div class="flex h-11 shrink-0 items-center gap-2 border-b border-[#26363d] bg-[#0d171c] px-3"><span class="h-2 w-2 rounded-full bg-[#ff766f]"></span><span class="h-2 w-2 rounded-full bg-[#dfb960]"></span><span class="h-2 w-2 rounded-full bg-[#83ce75]"></span><div class="ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#2e4046] bg-[#070d11] px-2.5 py-1.5"><LockKeyhole size={10} class="text-[#789081]" /><span class="truncate font-mono text-[8px] text-[#657a80]">{run?.startUrl ?? "browser-use://isolated-chromium"}</span></div><ExternalLink size={11} class="text-[#61767b]" /></div>
				<div class="pointer-events-none absolute inset-x-0 top-11 bottom-0 opacity-50 [background-image:linear-gradient(rgba(169,229,190,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(169,229,190,.035)_1px,transparent_1px)] [background-size:25px_25px]"></div>
				<div class="relative min-h-0 flex-1 overflow-y-auto p-5">
					<div class="mx-auto max-w-[560px]">
						<div class={`mx-auto grid h-14 w-14 place-items-center rounded-2xl border ${running ? "border-[#bde67f] bg-[rgba(173,229,99,.13)] text-[#d6f5ae] shadow-[0_0_50px_rgba(163,221,89,.16)]" : "border-[#3a5057] bg-[#0d181d] text-[#8fac95]"}`}><Globe2 size={24} class={running ? "animate-pulse" : ""} /></div>
						<h2 class="mt-4 mb-1 text-center text-[16px] font-semibold tracking-[-.03em] text-[#e9f0f1]">{run ? `Browser run: ${run.status}` : "Dedicated Chromium"}</h2>
						<p class="m-0 text-center text-[9px] leading-[1.65] text-[#788d91]">The visible headed browser opens in its own isolated window. Klerm shows only normalized, ordered activity here; the Tauri webview is never automated.</p>
						{#if run?.pendingApproval}
							<div class="mt-4 rounded-xl border border-[#65522d] bg-[#1a160b] p-3"><div class="flex items-start gap-2"><ShieldAlert size={14} class="mt-0.5 shrink-0 text-[#e3c06b]" /><div class="min-w-0"><p class="m-0 text-[10px] font-semibold text-[#f0d58e]">New origin requested</p><p class="mt-1 mb-0 break-all font-mono text-[8px] text-[#bba96f]">{run.pendingApproval.origin}</p></div></div><div class="mt-3 flex flex-wrap gap-2"><button type="button" disabled={commandBusy} class="rounded-lg border border-[#58713d] bg-[#26391c] px-2.5 py-1.5 text-[8px] font-semibold text-[#daf5b8] disabled:opacity-40" onclick={() => void resolveOrigin("approved", "allow_once")}>Allow once</button><button type="button" disabled={commandBusy} class="rounded-lg border border-[#58713d] bg-[#26391c] px-2.5 py-1.5 text-[8px] font-semibold text-[#daf5b8] disabled:opacity-40" onclick={() => void resolveOrigin("approved", "current_run")}>Allow for run</button><button type="button" disabled={commandBusy} class="rounded-lg border border-[#704847] bg-[#301a1a] px-2.5 py-1.5 text-[8px] font-semibold text-[#f3aaa4] disabled:opacity-40" onclick={() => void resolveOrigin("denied")}>Deny and stop</button></div></div>
						{/if}
						<div class="mt-4 space-y-2">
							{#if currentActivity.length === 0}<p class="rounded-xl border border-[#28383e] bg-[#0a1216] p-3 text-center font-mono text-[8px] text-[#60757a]">No browser activity yet.</p>{:else}{#each currentActivity as item (`${item.sequence}-${item.event}`)}<div class="flex items-start gap-2 rounded-xl border border-[#28383e] bg-[#0a1216] px-3 py-2"><span class="mt-0.5 font-mono text-[7px] text-[#67806e]">#{item.sequence}</span><div class="min-w-0"><p class="m-0 font-mono text-[8px] text-[#b4c5c7]">{item.event.replaceAll("_", " ")}</p>{#if item.reason}<p class="mt-0.5 mb-0 text-[8px] leading-[1.45] text-[#6f8489]">{item.reason}</p>{/if}</div></div>{/each}{/if}
						</div>
					</div>
				</div>
			</section>

			<section class={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#2d3c42] bg-[linear-gradient(155deg,#0d1419,#080d11)] shadow-[0_24px_70px_rgba(0,0,0,.24)] ${placement !== "center" && browserFirst ? "order-2" : "order-1"}`}>
				<div class="flex h-11 shrink-0 items-center gap-2 border-b border-[#28363c] px-4"><MessageSquareText size={13} class="text-[#b6db8e]" /><span class="text-[10px] font-semibold text-[#dbe5e6]">Browser task</span><span class="ml-auto rounded-full border border-[#2f4046] px-2 py-0.5 font-mono text-[7px] text-[#64787d]">NOT A SESSION</span></div>
				<div class="min-h-0 flex-1 overflow-y-auto p-4">
					{#if messages.length === 0}
						<div class="grid h-full min-h-[170px] place-items-center"><div class="max-w-[390px] text-center"><div class="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-[#34464c] bg-[#10191e] text-[#a8c98b]"><Sparkles size={17} /></div><h3 class="mt-3 mb-1.5 text-[13px] font-semibold text-[#dfe8e9]">Read a public site</h3><p class="m-0 text-[9px] leading-[1.6] text-[#718489]">Provide a public start URL and a read-only task. Login, clicking controls, forms, uploads, downloads, account changes, purchases, publishing, and deletion are blocked.</p></div></div>
					{:else}
						<div class="space-y-3">{#each messages as message (message.id)}<div class={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><article class={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[10px] leading-[1.6] ${message.role === "user" ? "rounded-br-md border border-[#496038] bg-[linear-gradient(135deg,#304526,#22351e)] text-[#ecf7df]" : message.tone === "error" ? "rounded-bl-md border border-[#65413e] bg-[#211313] text-[#e7aaa4]" : "rounded-bl-md border border-[#304148] bg-[#111a1f] text-[#bcc9cc]"}`}><p class="m-0">{message.text}</p></article></div>{/each}{#if running}<div class="flex justify-start"><div class="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#304148] bg-[#111a1f] px-3.5 py-2.5"><LoaderCircle size={12} class="animate-spin text-[#b9e184]" /><span class="font-mono text-[8px] text-[#84979b]">{run?.status === "waiting-approval" ? "Waiting for origin approval" : "Browser task running"}</span></div></div>{/if}</div>
					{/if}
				</div>
				<div class="shrink-0 border-t border-[#29373d] bg-[#0a1014] p-3">
					<div class="mb-2 flex items-center gap-2 rounded-xl border border-[#34444b] bg-[#070c10] px-3"><LockKeyhole size={11} class="shrink-0 text-[#789081]" /><input bind:value={startUrl} type="url" disabled={running} placeholder="https://example.com/start" class="h-9 min-w-0 flex-1 border-0 bg-transparent font-mono text-[9px] text-[#d8e2e4] outline-none placeholder:text-[#4d5c62] disabled:opacity-45" /></div>
					<div class="rounded-2xl border border-[#34444b] bg-[#070c10] p-2 focus-within:border-[#617f50]"><textarea bind:value={prompt} rows="2" disabled={running} placeholder="Ask the browser to read, research, compare, or extract..." class="max-h-28 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-1 text-[11px] leading-[1.5] text-[#e1e8ea] outline-none placeholder:text-[#4d5c62] disabled:opacity-45" onkeydown={handlePromptKeydown}></textarea><div class="flex items-center gap-2 px-1 pb-0.5"><span class="min-w-0 flex-1 truncate font-mono text-[7px] text-[#5e7075]">{selectedModel || "Select a Klerm agent and model"}</span>{#if running}<button type="button" aria-label="Stop browser task" disabled={commandBusy} class="grid h-8 w-8 place-items-center rounded-xl border border-[#704847] bg-[#301a1a] text-[#f3a6a1] transition hover:bg-[#442121] disabled:opacity-40" onclick={() => void stop()}>{#if commandBusy}<LoaderCircle size={13} class="animate-spin" />{:else}<CircleStop size={13} />{/if}</button>{:else}<button type="button" aria-label="Send browser task" disabled={!prompt.trim() || !startUrl.trim() || !selectedAgent || !selectedModel || !availability?.available || commandBusy} class="grid h-8 w-8 place-items-center rounded-xl border border-[#648643] bg-[linear-gradient(145deg,#5f843c,#3e602d)] text-[#efffd9] shadow-[0_8px_20px_rgba(90,133,51,.2)] transition hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35" onclick={() => void submit()}>{#if commandBusy}<LoaderCircle size={13} class="animate-spin" />{:else}<Send size={13} />{/if}</button>{/if}</div></div>
					<div class="mt-2 flex items-center gap-1.5 px-1 font-mono text-[7px] text-[#586a70]"><ShieldCheck size={10} class="text-[#80a86d]" /><span>Temporary read-only task. Audit: .klerm/browser-events.jsonl</span>{#if run && !running}<span class="ml-auto flex items-center gap-1 text-[#718d6a]"><Check size={9} /> {run.status}</span>{/if}</div>
				</div>
			</section>
		</div>
	</div>
</div>
