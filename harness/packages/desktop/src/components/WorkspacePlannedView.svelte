<script lang="ts">
	import { ArrowLeft, Boxes } from "@lucide/svelte";
	let { onclose }: { onclose: () => void } = $props();
</script>

<div class="flex min-h-0 flex-col overflow-hidden">
	<header class="flex items-center gap-3 border-b border-line bg-[rgba(8,11,15,.82)] px-6 py-3.5"><button type="button" aria-label="Back to workspace" class="grid h-9 w-9 place-items-center rounded-lg border border-[#303b43] bg-[#11171c] text-[#9ba7ae]" onclick={onclose}><ArrowLeft size={15} /></button><div><p class="m-0 font-mono text-[8px] tracking-[.14em] text-[#66737b] uppercase">Workspace view</p><h1 class="mt-0.5 mb-0 text-[16px] font-semibold text-[#e5eaed]">Kanban</h1></div></header>
	<div class="grid min-h-0 flex-1 place-items-center p-6"><section class="max-w-[520px] rounded-2xl border border-[#303b43] bg-[#0d1317] p-7 text-center shadow-[0_24px_70px_rgba(0,0,0,.25)]"><Boxes size={28} class="mx-auto text-accent" /><h2 class="mt-4 mb-2 text-[15px] text-[#e3e9ec]">Persistent task board comes next</h2><p class="m-0 text-[11px]/[1.6] text-[#718089]">The backend-owned card registry, selected-agent execution, due times, and truthful interruption recovery are specified in APP_PLAN.md. No browser-only placeholder tasks are stored.</p></section></div>
</div>
