<script lang="ts">
	import { Check, PencilLine, X } from "@lucide/svelte";
	import { onMount, tick } from "svelte";
	import type { ChatMessage } from "../lib/model.ts";
	import MarkdownLite from "./MarkdownLite.svelte";

	let {
		message,
		taskActive,
		onrerun,
	}: { message: ChatMessage; taskActive: boolean; onrerun: (text: string) => void } = $props();

	let rootEl: HTMLElement | undefined = $state();
	let editEl: HTMLTextAreaElement | undefined = $state();
	let editing = $state(false);
	let editValue = $state("");

	onMount(() => {
		rootEl?.scrollIntoView({ behavior: "smooth", block: "end" });
	});

	function startEdit(): void {
		editValue = message.text;
		editing = true;
		void tick().then(() => {
			editEl?.focus();
			editEl?.setSelectionRange(editValue.length, editValue.length);
		});
	}

	function saveEdit(): void {
		const text = editValue.trim();
		if (!text) return;
		editing = false;
		onrerun(text);
	}

	function handleEditKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") editing = false;
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			saveEdit();
		}
	}
</script>

<article
	bind:this={rootEl}
	class={`mb-[30px] narrow-520:mb-6 ${message.role === "user" ? "flex flex-col items-end" : ""}`}
>
	<div
		class={`mb-2 flex items-center gap-2 font-mono text-[9px] tracking-[.06em] text-[#657079] ${message.role === "user" ? "pr-1" : ""}`}
	>
		<span>{message.role === "user" ? "You" : (message.model ?? "Klerm")}</span>
		{#if message.role === "user" && !editing}
			<button
				type="button"
				class="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-mono text-[8px] text-[#657079] hover:text-[#cbd2d7]"
				onclick={startEdit}
			>
				<PencilLine size={10} stroke-width={1.7} />
				Edit
			</button>
		{/if}
	</div>
	{#if editing}
		<div class="w-full max-w-[78%] rounded-[10px] border border-[#3b464e] bg-[#11171c] p-2.5 narrow-520:max-w-[92%]">
			<textarea
				bind:this={editEl}
				bind:value={editValue}
				rows="4"
				aria-label="Edit sent prompt"
				class="block max-h-[220px] min-h-[86px] w-full resize-y rounded-md border border-[#2d373e] bg-[#0a0f13] px-3 py-2 text-[12px]/[1.6] text-[#edf1f3] outline-none focus:border-[#66747d]"
				onkeydown={handleEditKeydown}
			></textarea>
			<div class="mt-2 flex items-center justify-end gap-2">
				<span class="mr-auto font-mono text-[8px] text-[#626e76]">Ctrl/Cmd+Enter to {taskActive ? "move to composer" : "rerun"}</span>
				<button type="button" class="flex items-center gap-1 rounded px-2 py-1.5 text-[9px] text-[#7f8a91] hover:bg-[#1a2025] hover:text-[#d5dce0]" onclick={() => (editing = false)}><X size={11} /> Cancel</button>
				<button type="button" class="flex items-center gap-1 rounded bg-[#dce3e6] px-2.5 py-1.5 text-[9px] font-semibold text-[#0a0d0f] hover:bg-white" onclick={saveEdit}><Check size={11} /> {taskActive ? "Use after stop" : "Save & rerun"}</button>
			</div>
		</div>
	{:else}
	<div
		class={`whitespace-pre-wrap break-words text-[13px] leading-[1.75] narrow-900:text-[12px] ${
			message.role === "user"
				? "w-fit max-w-[78%] rounded-[10px] border border-[#293139] bg-[#151a1f] px-[15px] py-3 text-[#edf1f3] narrow-520:max-w-[88%] narrow-520:px-3 narrow-520:py-2.5 narrow-520:text-[12px] narrow-520:leading-[1.65]"
				: "px-[2px] text-[#cbd2d7] narrow-520:text-[12px] narrow-520:leading-[1.65]"
		}`}
	>
		{#if message.role === "assistant"}
			<MarkdownLite text={message.text} />
		{:else}
			{message.text}
		{/if}
		{#if message.streaming}<span class="ml-[3px] inline-block h-[13px] w-[5px] animate-pulse bg-[#8b969e] align-[-2px]"></span>{/if}
	</div>
	{/if}
</article>
