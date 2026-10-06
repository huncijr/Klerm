<script lang="ts">
	import { Check, PencilLine, X } from "@lucide/svelte";
	import { onMount, tick } from "svelte";
	import { imageDataUrl } from "../lib/helpers.ts";
	import { MCP_COLOR_BG_CSS, MCP_COLOR_CSS, splitMcpMentions } from "../lib/mcp-mentions.ts";
	import type { ChatMessage, McpServerStatus } from "../lib/model.ts";
	import MarkdownLite from "./MarkdownLite.svelte";

	let {
		message,
		taskActive,
		mcpServers,
		onrerun,
	}: { message: ChatMessage; taskActive: boolean; mcpServers: McpServerStatus[]; onrerun: (text: string) => void } = $props();

	let rootEl: HTMLElement | undefined = $state();
	let editEl: HTMLTextAreaElement | undefined = $state();
	let editing = $state(false);
	let editValue = $state("");
	const mentionSegments = $derived(splitMcpMentions(message.text, mcpServers));
	const participantLabel = (participant: string): string => {
		if (participant === "user") return "You";
		if (participant === "klerm") return "Klerm";
		if (participant.startsWith("agent")) return `Agent ${participant.slice(5)}`;
		return participant;
	};
	const messageLabel = $derived(
		message.sender && message.recipient
			? `${participantLabel(message.sender)} → ${participantLabel(message.recipient)}`
			: message.role === "user"
				? "You"
				: (message.model ?? "Klerm"),
	);

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
		class={`mb-2 flex items-center gap-2 font-sans text-[12px] tracking-[.06em] text-muted ${message.role === "user" ? "pr-1" : ""}`}
	>
		<span>{messageLabel}</span>
		{#if message.kind === "handoff"}<span class="rounded border border-warning bg-raised px-1.5 py-0.5 text-[11px] text-warning uppercase">Handoff</span>{/if}
		{#if message.kind !== "handoff" && message.sender && message.model}<span class="text-dim">{message.model}</span>{/if}
		{#if message.role === "user" && message.kind !== "handoff" && !editing}
			<button
				type="button"
				class="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-sans text-[11px] text-muted hover:text-ink"
				onclick={startEdit}
			>
				<PencilLine size={10} stroke-width={1.7} />
				Edit
			</button>
		{/if}
	</div>
	{#if editing}
		<div class="w-full max-w-[78%] rounded-[10px] border border-line bg-panel p-2.5 narrow-520:max-w-[92%]">
			<textarea
				bind:this={editEl}
				bind:value={editValue}
				rows="4"
				aria-label="Edit sent prompt"
				class="block max-h-[220px] min-h-[86px] w-full resize-y rounded-md border border-line bg-bg px-3 py-2 text-[13px]/[1.6] text-ink outline-none focus:border-line"
				onkeydown={handleEditKeydown}
			></textarea>
			<div class="mt-2 flex items-center justify-end gap-2">
				<span class="mr-auto font-sans text-[11px] text-dim">Ctrl/Cmd+Enter to {taskActive ? "move to composer" : "rerun"}</span>
				<button type="button" class="flex items-center gap-1 rounded px-2 py-1.5 text-[12px] text-muted hover:bg-raised hover:text-ink" onclick={() => (editing = false)}><X size={11} /> Cancel</button>
				<button type="button" class="flex items-center gap-1 rounded bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-on-primary hover:bg-primary" onclick={saveEdit}><Check size={11} /> {taskActive ? "Use after stop" : "Save & rerun"}</button>
			</div>
		</div>
	{:else}
	<div
		class={`whitespace-pre-wrap break-words text-[14px] leading-[1.75] narrow-900:text-[13px] ${
			message.role === "user"
				? "w-fit max-w-[78%] rounded-[10px] border border-line bg-panel px-[15px] py-3 text-ink narrow-520:max-w-[88%] narrow-520:px-3 narrow-520:py-2.5 narrow-520:text-[13px] narrow-520:leading-[1.65]"
				: message.kind === "handoff"
					? "rounded-[10px] border border-line bg-panel px-[15px] py-3 text-ink narrow-520:text-[13px] narrow-520:leading-[1.65]"
					: "px-[2px] text-ink narrow-520:text-[13px] narrow-520:leading-[1.65]"
		}`}
	>
		{#if message.role === "assistant" || message.kind === "handoff"}
			<MarkdownLite text={message.text} />
		{:else}
			{#each mentionSegments as segment, index (`${index}-${segment.text}`)}
				{#if segment.mention}
					<span
						class="rounded px-0.5 font-semibold"
						style={`color: ${MCP_COLOR_CSS[segment.mention.color ?? "base"]}; background: ${MCP_COLOR_BG_CSS[segment.mention.color ?? "base"]}; box-shadow: 0 0 0 1px color-mix(in srgb, ${MCP_COLOR_CSS[segment.mention.color ?? "base"]} 35%, transparent);`}
					>{segment.text}</span>
				{:else}{segment.text}{/if}
			{/each}
		{/if}
		{#if message.streaming}<span class="ml-[3px] inline-block h-[13px] w-[5px] animate-pulse bg-raised align-[-2px]"></span>{/if}
		{#if message.images?.length}
			<div class={`mt-3 grid gap-2 ${message.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
				{#each message.images as image, index (`${index}-${image.mimeType}-${image.data.length}`)}
					{@const src = imageDataUrl(image)}
					{#if src}
						<a href={src} download={image.name ?? `klerm-image-${index + 1}`} class="block overflow-hidden rounded-lg border border-line bg-bg" aria-label={`Open ${image.name ?? `image ${index + 1}`}`}>
							<img src={src} alt={image.name ?? `Attached image ${index + 1}`} class="block max-h-[420px] w-full object-contain" />
						</a>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
	{/if}
</article>
