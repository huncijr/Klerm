<script lang="ts">
	import { Globe2 } from "@lucide/svelte";
	import { webSourceIdentity } from "../lib/web-activity.ts";
	let { sources, onselect }: { sources: string[]; onselect: (url: string) => void } = $props();
</script>

<div class="group relative">
	<button type="button" class="flex h-6 items-center gap-1 rounded px-2 font-mono text-[7px] text-[#8fc4ed] uppercase hover:bg-[#171d22]" aria-label="Show website sources"><Globe2 size={10} /> Sources <span>{sources.length}</span></button>
	<div class="absolute top-full right-0 z-40 hidden max-h-64 w-[min(520px,80vw)] flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-[#34424d] bg-[#10171d] p-2 shadow-xl group-hover:flex group-focus-within:flex" aria-label="Website sources">
		{#if sources.length === 0}<p class="px-2 py-1 text-[9px] text-[#81949b]">No web fetch has run in this session yet.</p>{/if}
		{#each [...sources].reverse() as source (source)}
			{@const identity = webSourceIdentity(source)}
			<button type="button" onclick={() => onselect(source)} class="flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[#34424d] px-2 py-1.5 text-left hover:bg-[#1c2933]" title={source}>
				<span class="relative grid h-5 w-5 shrink-0 place-items-center"><Globe2 size={14} class="text-[#81949b]" /><img src={identity.icon} alt="" referrerpolicy="no-referrer" class="absolute h-4 w-4" onerror={(event) => { if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.style.display = "none"; }} /></span>
				<span class="max-w-56 truncate font-mono text-[9px] text-[#cbd9dd]">{source.replace(/^https?:\/\//, "").replace(/^www\./, "")}</span>
			</button>
		{/each}
	</div>
</div>
