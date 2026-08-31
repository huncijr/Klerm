<script lang="ts">
	import type { TimelineItem } from "../lib/model.ts";
	import TimelineCard from "./TimelineCard.svelte";

	let { items, ontoggle }: { items: TimelineItem[]; ontoggle: (id: number) => void } = $props();

	let containerEl: HTMLElement | undefined = $state();

	$effect(() => {
		const count = items.length;
		if (count > 0 && containerEl) {
			containerEl.lastElementChild?.scrollIntoView({ block: "nearest" });
		}
	});
</script>

<div
	bind:this={containerEl}
	class="mx-auto flex w-[min(820px,calc(100%-48px))] flex-col gap-2 pb-2 empty:hidden narrow-720:w-[calc(100%-30px)]"
>
	{#each items as item (item.id)}
		<TimelineCard {item} ontoggle={() => ontoggle(item.id)} />
	{/each}
</div>
