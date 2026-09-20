<script lang="ts">
	import {
		ArrowLeft,
		Bot,
		Check,
		ChevronDown,
		CircleStop,
		Globe2,
		LayoutPanelLeft,
		LoaderCircle,
		LockKeyhole,
		MessageSquareText,
		PanelRight,
		PanelTop,
		Send,
		ShieldCheck,
		Sparkles,
	} from "@lucide/svelte";
	import { onDestroy } from "svelte";
	import type { CodingHarnessSetup } from "../lib/model.ts";

	let { setup, onclose }: { setup?: CodingHarnessSetup; onclose: () => void } = $props();

	type ChatPlacement = "left" | "center" | "right";
	type PreviewMessage = { id: number; role: "user" | "assistant"; text: string };

	let selectedAgentId = $state("");
	let selectedModel = $state("");
	let placement = $state<ChatPlacement>("right");
	let prompt = $state("");
	let running = $state(false);
	let messageId = 0;
	let responseTimer: number | undefined;
	let messages = $state<PreviewMessage[]>([]);

	const agents = $derived((setup?.slots.agents ?? []).filter((agent) => agent.enabled && agent.kind));
	const selectedAgent = $derived(agents.find((agent) => agent.id === selectedAgentId) ?? agents[0]);
	const selectedHarness = $derived(setup?.harnesses.find((harness) => harness.kind === selectedAgent?.kind));
	const models = $derived.by(() => {
		const values = [selectedAgent?.model, ...(selectedHarness?.models ?? [])].filter(
			(value): value is string => Boolean(value),
		);
		return [...new Set(values)];
	});
	const browserFirst = $derived(placement === "left");

	$effect(() => {
		if (!selectedAgentId && agents[0]) selectedAgentId = agents[0].id;
	});

	$effect(() => {
		if (!models.includes(selectedModel)) selectedModel = selectedAgent?.model ?? models[0] ?? "";
	});

	onDestroy(() => {
		if (responseTimer !== undefined) window.clearTimeout(responseTimer);
	});

	function changeAgent(event: Event): void {
		selectedAgentId = (event.currentTarget as HTMLSelectElement).value;
	}

	function changeModel(event: Event): void {
		selectedModel = (event.currentTarget as HTMLSelectElement).value;
	}

	function submit(): void {
		const text = prompt.trim();
		if (!text || !selectedAgent || !selectedModel || running) return;
		messages = [...messages, { id: ++messageId, role: "user", text }];
		prompt = "";
		running = true;
		responseTimer = window.setTimeout(() => {
			messages = [
				...messages,
				{
					id: ++messageId,
					role: "assistant",
					text: "UI preview only. The open-source browser-use worker is not connected yet, so no Chromium action was executed and this task was not saved as a Klerm session.",
				},
			];
			running = false;
			responseTimer = undefined;
		}, 900);
	}

	function stopPreview(): void {
		if (responseTimer !== undefined) window.clearTimeout(responseTimer);
		responseTimer = undefined;
		running = false;
	}

	function handlePromptKeydown(event: KeyboardEvent): void {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#05080b] text-[#e6edef]">
	<header class="relative z-20 flex h-[58px] shrink-0 items-center gap-3 border-b border-[#263138] bg-[rgba(7,11,14,.96)] px-4 backdrop-blur-xl sm:px-5">
		<button type="button" aria-label="Back to Klerm" class="grid h-9 w-9 place-items-center rounded-xl border border-[#303c43] bg-[#10161a] text-[#a7b3b8] transition hover:-translate-x-0.5 hover:border-[#617078] hover:text-white" onclick={onclose}><ArrowLeft size={15} /></button>
		<div class="flex min-w-0 items-center gap-2.5">
			<div class="grid h-8 w-8 place-items-center rounded-xl border border-[rgba(190,240,112,.3)] bg-[linear-gradient(145deg,rgba(178,232,92,.16),rgba(72,103,50,.08))] text-[#cef49b] shadow-[0_0_24px_rgba(171,226,91,.08)]"><Globe2 size={16} /></div>
			<div><p class="m-0 text-[12px] font-semibold tracking-[-.01em] text-[#f0f5f5]">Klerm <span class="font-normal text-[#617178]">/</span> Browser Task</p><p class="m-0 font-mono text-[7px] tracking-[.15em] text-[#60747a] uppercase">Ephemeral workspace</p></div>
		</div>
		<div class="ml-auto hidden items-center gap-2 rounded-full border border-[#27343a] bg-[#0b1115] px-3 py-1.5 sm:flex"><span class="h-1.5 w-1.5 rounded-full bg-[#a9e66f] shadow-[0_0_9px_#a9e66f]"></span><span class="font-mono text-[7px] tracking-[.11em] text-[#7f9297] uppercase">browser-use / MIT / UI preview</span></div>
	</header>

	<div class="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
		<div class="mx-auto flex w-full max-w-[1480px] shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-[#27353c] bg-[linear-gradient(110deg,rgba(14,21,26,.96),rgba(9,15,19,.96))] p-2 shadow-[0_14px_40px_rgba(0,0,0,.2)]">
			<label class="relative min-w-[180px] flex-1 sm:max-w-[250px]"><span class="sr-only">Browser agent</span><Bot size={12} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#95b978]" /><select value={selectedAgent?.id ?? ""} class="h-9 w-full appearance-none rounded-xl border border-[#34434a] bg-[#0a1014] pr-8 pl-8 font-mono text-[9px] text-[#d8e2e4] outline-none focus:border-[#718b63]" onchange={changeAgent}><option value="" disabled>Choose agent</option>{#each agents as agent (agent.id)}<option value={agent.id}>Agent {agent.id.replace(/^agent-?/, "")} / {agent.kind}</option>{/each}</select><ChevronDown size={11} class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[#708087]" /></label>
			<label class="relative min-w-[220px] flex-[1.3] sm:max-w-[360px]"><span class="sr-only">Browser model</span><Sparkles size={12} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#d4df8c]" /><select bind:value={selectedModel} disabled={models.length === 0} class="h-9 w-full appearance-none rounded-xl border border-[#34434a] bg-[#0a1014] pr-8 pl-8 font-mono text-[9px] text-[#d8e2e4] outline-none focus:border-[#718b63] disabled:opacity-45" onchange={changeModel}><option value="" disabled>Choose model</option>{#each models as model (model)}<option value={model}>{model}</option>{/each}</select><ChevronDown size={11} class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[#708087]" /></label>
			<div class="ml-auto flex items-center gap-1 rounded-xl border border-[#303e44] bg-[#080e12] p-1" aria-label="Prompt placement">
				<button type="button" aria-label="Prompt left" aria-pressed={placement === "left"} class={`grid h-7 w-8 place-items-center rounded-lg transition ${placement === "left" ? "bg-[#344b2a] text-[#d7f2b8]" : "text-[#697a80] hover:text-white"}`} onclick={() => (placement = "left")}><LayoutPanelLeft size={13} /></button>
				<button type="button" aria-label="Prompt center" aria-pressed={placement === "center"} class={`grid h-7 w-8 place-items-center rounded-lg transition ${placement === "center" ? "bg-[#344b2a] text-[#d7f2b8]" : "text-[#697a80] hover:text-white"}`} onclick={() => (placement = "center")}><PanelTop size={13} /></button>
				<button type="button" aria-label="Prompt right" aria-pressed={placement === "right"} class={`grid h-7 w-8 place-items-center rounded-lg transition ${placement === "right" ? "bg-[#344b2a] text-[#d7f2b8]" : "text-[#697a80] hover:text-white"}`} onclick={() => (placement = "right")}><PanelRight size={13} /></button>
			</div>
		</div>

		<div class={`mx-auto mt-3 grid min-h-0 w-full max-w-[1480px] flex-1 gap-3 ${placement === "center" ? "grid-rows-[minmax(210px,1fr)_minmax(230px,.82fr)]" : "grid-cols-[minmax(320px,.82fr)_minmax(420px,1.25fr)] max-[850px]:grid-cols-1"}`}>
			<section class={`relative min-h-0 overflow-hidden rounded-2xl border border-[#293940] bg-[#091116] shadow-[0_24px_70px_rgba(0,0,0,.3)] ${placement !== "center" && !browserFirst ? "order-2" : "order-1"}`}>
				<div class="flex h-11 items-center gap-2 border-b border-[#26363d] bg-[#0d171c] px-3"><span class="h-2 w-2 rounded-full bg-[#ff766f]"></span><span class="h-2 w-2 rounded-full bg-[#dfb960]"></span><span class="h-2 w-2 rounded-full bg-[#83ce75]"></span><div class="ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#2e4046] bg-[#070d11] px-2.5 py-1.5"><LockKeyhole size={10} class="text-[#789081]" /><span class="truncate font-mono text-[8px] text-[#657a80]">browser-use://isolated-chromium</span></div></div>
				<div class="pointer-events-none absolute inset-x-0 top-11 bottom-0 opacity-50 [background-image:linear-gradient(rgba(169,229,190,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(169,229,190,.035)_1px,transparent_1px)] [background-size:25px_25px]"></div>
				<div class="relative grid h-[calc(100%_-_44px)] min-h-[230px] place-items-center p-5 text-center">
					<div class="max-w-[380px]"><div class={`mx-auto grid h-16 w-16 place-items-center rounded-2xl border transition-all duration-500 ${running ? "scale-105 border-[#bde67f] bg-[rgba(173,229,99,.13)] text-[#d6f5ae] shadow-[0_0_50px_rgba(163,221,89,.16)]" : "border-[#3a5057] bg-[#0d181d] text-[#8fac95]"}`}><Globe2 size={28} class={running ? "animate-pulse" : ""} /></div><h2 class="mt-5 mb-2 text-[18px] font-semibold tracking-[-.03em] text-[#e9f0f1]">{running ? "Browser task is preparing" : "Chromium appears here"}</h2><p class="m-0 text-[10px] leading-[1.65] text-[#788d91]">{running ? "This animation previews the future browser-use handoff. No browser process is running yet." : "The implementation phase will open a visible browser-use Chromium window and mirror its URL, screenshot, and actions in this pane."}</p><div class="mt-4 flex justify-center gap-2"><span class="rounded-full border border-[#304148] bg-[#0a1216] px-2.5 py-1 font-mono text-[7px] text-[#769087]">LOCAL</span><span class="rounded-full border border-[#304148] bg-[#0a1216] px-2.5 py-1 font-mono text-[7px] text-[#769087]">ISOLATED</span><span class="rounded-full border border-[#304148] bg-[#0a1216] px-2.5 py-1 font-mono text-[7px] text-[#769087]">NOT SAVED</span></div></div>
				</div>
			</section>

			<section class={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#2d3c42] bg-[linear-gradient(155deg,#0d1419,#080d11)] shadow-[0_24px_70px_rgba(0,0,0,.24)] ${placement !== "center" && browserFirst ? "order-2" : "order-1"}`}>
				<div class="flex h-11 shrink-0 items-center gap-2 border-b border-[#28363c] px-4"><MessageSquareText size={13} class="text-[#b6db8e]" /><span class="text-[10px] font-semibold text-[#dbe5e6]">Browser conversation</span><span class="ml-auto rounded-full border border-[#2f4046] px-2 py-0.5 font-mono text-[7px] text-[#64787d]">TEMPORARY</span></div>
				<div class="min-h-0 flex-1 overflow-y-auto p-4">
					{#if messages.length === 0}
						<div class="grid h-full min-h-[170px] place-items-center"><div class="max-w-[370px] text-center"><div class="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-[#34464c] bg-[#10191e] text-[#a8c98b]"><Sparkles size={17} /></div><h3 class="mt-3 mb-1.5 text-[13px] font-semibold text-[#dfe8e9]">What should the browser do?</h3><p class="m-0 text-[9px] leading-[1.6] text-[#718489]">Ask it to research, compare, collect, or navigate. This UI preview stays outside your Klerm sessions.</p></div></div>
					{:else}
						<div class="space-y-3">{#each messages as message (message.id)}<div class={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><article class={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[10px] leading-[1.6] ${message.role === "user" ? "rounded-br-md border border-[#496038] bg-[linear-gradient(135deg,#304526,#22351e)] text-[#ecf7df]" : "rounded-bl-md border border-[#304148] bg-[#111a1f] text-[#bcc9cc]"}`}><p class="m-0">{message.text}</p></article></div>{/each}{#if running}<div class="flex justify-start"><div class="flex items-center gap-2 rounded-2xl rounded-bl-md border border-[#304148] bg-[#111a1f] px-3.5 py-2.5"><LoaderCircle size={12} class="animate-spin text-[#b9e184]" /><span class="font-mono text-[8px] text-[#84979b]">Preparing browser-use...</span></div></div>{/if}</div>
					{/if}
				</div>
				<div class="shrink-0 border-t border-[#29373d] bg-[#0a1014] p-3">
					<div class="rounded-2xl border border-[#34444b] bg-[#070c10] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,.02)] focus-within:border-[#617f50]"><textarea bind:value={prompt} rows="2" placeholder="Ask the browser to find, compare, or complete something..." class="max-h-28 min-h-12 w-full resize-none border-0 bg-transparent px-2 py-1 text-[11px] leading-[1.5] text-[#e1e8ea] outline-none placeholder:text-[#4d5c62]" onkeydown={handlePromptKeydown}></textarea><div class="flex items-center gap-2 px-1 pb-0.5"><span class="min-w-0 flex-1 truncate font-mono text-[7px] text-[#5e7075]">{selectedModel || "Select an agent and model"}</span>{#if running}<button type="button" aria-label="Stop browser task preview" class="grid h-8 w-8 place-items-center rounded-xl border border-[#704847] bg-[#301a1a] text-[#f3a6a1] transition hover:bg-[#442121]" onclick={stopPreview}><CircleStop size={13} /></button>{:else}<button type="button" aria-label="Send browser task" disabled={!prompt.trim() || !selectedAgent || !selectedModel} class="grid h-8 w-8 place-items-center rounded-xl border border-[#648643] bg-[linear-gradient(145deg,#5f843c,#3e602d)] text-[#efffd9] shadow-[0_8px_20px_rgba(90,133,51,.2)] transition hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35" onclick={submit}><Send size={13} /></button>{/if}</div></div>
					<div class="mt-2 flex items-center gap-1.5 px-1 font-mono text-[7px] text-[#586a70]"><ShieldCheck size={10} class="text-[#80a86d]" /><span>Temporary task. No session or conversation file is created.</span>{#if messages.length > 0}<span class="ml-auto flex items-center gap-1 text-[#718d6a]"><Check size={9} /> local UI state</span>{/if}</div>
				</div>
			</section>
		</div>
	</div>
</div>
