<script lang="ts">
	import { Send, Square } from "@lucide/svelte";
	import { onMount } from "svelte";
	import type { SelectOption } from "../lib/model.ts";
	import ModelSelect from "./ModelSelect.svelte";

	let {
		draft = $bindable(""),
		sendDisabled,
		taskActive,
		showMeta,
		emptyLayout,
		localOptions,
		frontierOptions,
		localValue,
		frontierValue,
		routingValue,
		localDisabled,
		frontierDisabled,
		routingDisabled,
		taskStateText,
		errorBanner,
		onsend,
		onstop,
		onlocalchange,
		onfrontierchange,
		onroutingchange,
	}: {
		draft: string;
		sendDisabled: boolean;
		taskActive: boolean;
		showMeta: boolean;
		emptyLayout: boolean;
		localOptions: SelectOption[];
		frontierOptions: SelectOption[];
		localValue: string;
		frontierValue: string;
		routingValue: string;
		localDisabled: boolean;
		frontierDisabled: boolean;
		routingDisabled: boolean;
		taskStateText: string;
		errorBanner: string;
		onsend: (text: string) => void;
		onstop: () => void;
		onlocalchange: (value: string) => void;
		onfrontierchange: (value: string) => void;
		onroutingchange: (value: string) => void;
	} = $props();

	const routingOptions: SelectOption[] = [
		{ value: "off", label: "Off" },
		{ value: "local", label: "Local" },
		{ value: "frontier", label: "Frontier" },
		{ value: "auto", label: "Auto" },
	];

	let promptEl: HTMLTextAreaElement | undefined = $state();

	function resizePrompt(): void {
		if (!promptEl) return;
		promptEl.style.height = "auto";
		const configuredMaxHeight = Number.parseFloat(window.getComputedStyle(promptEl).maxHeight);
		const maxHeight = Number.isFinite(configuredMaxHeight) && configuredMaxHeight > 0 ? configuredMaxHeight : 150;
		promptEl.style.height = `${Math.min(promptEl.scrollHeight, maxHeight)}px`;
		promptEl.style.overflowY = promptEl.scrollHeight > maxHeight ? "auto" : "hidden";
	}

	$effect(() => {
		draft;
		resizePrompt();
	});

	onMount(() => {
		window.addEventListener("resize", resizePrompt);
		return () => window.removeEventListener("resize", resizePrompt);
	});

	function submit(): void {
		const text = draft.trim();
		if (!text || sendDisabled) return;
		onsend(text);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	}
</script>

<footer
	class={`relative z-[3] min-h-0 px-7 pt-3 pb-[17px] narrow-720:px-[15px] narrow-520:px-2.5 narrow-520:pt-2 narrow-520:pb-2.5 ${
		emptyLayout ? "w-full self-center pt-0" : "bg-[linear-gradient(transparent,var(--color-bg)_18%)]"
	}`}
>
	{#if errorBanner}
		<div
			class="mx-auto mb-[7px] w-[min(820px,100%)] rounded-md border border-[rgba(255,111,97,.25)] bg-[rgba(255,111,97,.07)] px-3 py-2 text-[10px] text-[#e69a93]"
		>
			{errorBanner}
		</div>
	{/if}

	<form
		class="mx-auto w-[min(820px,100%)] overflow-visible rounded-xl border border-[#2a3239] bg-[#0d1116] shadow-[0_14px_40px_rgba(0,0,0,.24)] focus-within:border-[#46515a]"
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		<div class="relative min-h-[58px] pt-1 pr-[60px] pb-1 pl-4 narrow-520:min-h-[52px] narrow-520:pt-[3px] narrow-520:pr-[49px] narrow-520:pb-[3px] narrow-520:pl-[13px]">
			<textarea
				bind:this={promptEl}
				bind:value={draft}
				rows="1"
				placeholder="Describe a task for Klerm..."
				aria-label="Task prompt"
				class="block max-h-[min(150px,22dvh)] w-full resize-none border-0 bg-transparent pt-3.5 pr-3 pb-3.5 pl-0 text-left text-[13px] leading-[1.55] text-white outline-0 [scrollbar-width:thin] placeholder:text-[#56616a] narrow-520:max-h-[min(120px,20dvh)] narrow-520:py-3 narrow-520:text-[12px] short-650:max-h-[min(110px,20dvh)] short-500:max-h-[min(82px,18dvh)]"
				onkeydown={handleKeydown}
			></textarea>
			<div class="absolute right-[9px] bottom-2.5 h-[38px] w-[38px] narrow-520:right-[7px] narrow-520:bottom-[7px] narrow-520:h-9 narrow-520:w-9">
				{#if taskActive}
					<button
						type="button"
						aria-label="Stop task"
						class="grid h-full w-full cursor-pointer place-items-center rounded-lg border border-[rgba(255,111,97,.35)] bg-[rgba(255,111,97,.08)] text-[#ff968c]"
						onclick={onstop}
					>
						<Square size={13} fill="currentColor" />
					</button>
				{:else}
					<button
						type="submit"
						aria-label="Send task"
						disabled={sendDisabled}
						class="grid h-full w-full cursor-pointer place-items-center rounded-lg border-0 bg-[#e1e6e9] text-[#0b0e10] enabled:hover:bg-white disabled:cursor-not-allowed disabled:bg-[#20272c] disabled:text-[#51585d]"
					>
						<Send size={17} stroke-width={1.7} />
					</button>
				{/if}
			</div>
		</div>
	</form>

	<div class="mx-auto mt-2 grid w-[min(820px,100%)] grid-cols-3 gap-2 narrow-520:mt-[5px] narrow-520:gap-[5px]">
		<ModelSelect
			label="Local model"
			options={localOptions}
			value={localValue}
			disabled={localDisabled}
			placeholder="Discovering models..."
			onchange={onlocalchange}
		/>
		<ModelSelect
			label="Frontier model"
			options={frontierOptions}
			value={frontierValue}
			disabled={frontierDisabled}
			placeholder="Discovering models..."
			onchange={onfrontierchange}
		/>
		<ModelSelect
			label="Routing"
			options={routingOptions}
			value={routingValue}
			disabled={routingDisabled}
			placeholder="Choose routing"
			alignRight
			onchange={onroutingchange}
		/>
	</div>

	<div
		class={`mx-auto flex w-[min(820px,100%)] justify-between px-[3px] pt-2 font-mono text-[8px] text-dim ${showMeta ? "" : "invisible"}`}
	>
		<span class="narrow-720:hidden">Enter to send, Shift+Enter for a new line</span>
		<span aria-live="polite" class="flex items-center gap-1.5">
			{#if taskActive}
				<span class="h-2 w-2 animate-spin rounded-full border border-[#4e5962] border-t-[#d7dde1]"></span>
			{/if}
			{taskStateText}
		</span>
	</div>
</footer>
