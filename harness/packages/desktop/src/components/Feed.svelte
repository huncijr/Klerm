<script lang="ts">
	import type { FeedItem } from "../lib/model.ts";
	import ChatMessage from "./ChatMessage.svelte";
	import TimelineCard from "./TimelineCard.svelte";

	let {
		items,
		taskActive,
		onrerun,
		ontoggle,
	}: {
		items: FeedItem[];
		taskActive: boolean;
		onrerun: (text: string) => void;
		ontoggle: (id: number) => void;
	} = $props();

	let containerEl: HTMLElement | undefined = $state();

	$effect(() => {
		const count = items.length;
		if (count > 0 && containerEl) containerEl.lastElementChild?.scrollIntoView({ block: "nearest" });
	});
</script>

<div bind:this={containerEl} class="flex flex-col pb-2">
	{#each items as item (item.id)}
		{#if item.type === "message"}
			<ChatMessage message={item.message} {taskActive} {onrerun} />
		{:else}
			<div class="mb-2">
				<TimelineCard item={item.activity} ontoggle={() => ontoggle(item.activity.id)} />
			</div>
		{/if}
	{/each}
</div>
