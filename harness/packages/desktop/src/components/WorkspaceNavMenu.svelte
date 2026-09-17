<script lang="ts">
	import { Bot, Boxes, ChevronRight, Network, PanelsTopLeft } from "@lucide/svelte";
	import { onMount } from "svelte";
	import type { WorkspaceView } from "../lib/model.ts";

	let {
		activeView,
		compact = false,
		onselect,
	}: {
		activeView?: WorkspaceView;
		compact?: boolean;
		onselect: (view: WorkspaceView) => void;
	} = $props();

	let open = $state(false);
	let root: HTMLDivElement | undefined = $state();
	const items: Array<{ id: WorkspaceView; label: string; detail: string; icon: typeof Bot }> = [
		{ id: "agents-routing", label: "Agents & Routing", detail: "Shared prompt and agent workspace", icon: Network },
		{ id: "personal-bots", label: "Personal Bots", detail: "Personalities and private chats", icon: Bot },
		{ id: "kanban", label: "Kanban", detail: "Assigned and scheduled tasks", icon: Boxes },
	];

	onMount(() => {
		const close = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || !root?.contains(event.target)) open = false;
		};
		document.addEventListener("pointerdown", close);
		return () => document.removeEventListener("pointerdown", close);
	});

	function select(view: WorkspaceView): void {
		onselect(view);
		open = false;
	}
</script>

<div bind:this={root} class="relative">
	<button
		type="button"
		aria-label="Open workspace menu"
		aria-expanded={open}
		aria-pressed={activeView !== undefined}
		class={`grid place-items-center rounded-lg border ${compact ? "h-9 w-9" : "h-8 w-8"} ${activeView ? "border-[#7a8a94] bg-[#1b252b] text-white" : "border-[#313a41] bg-[#12171c] text-[#849199] hover:border-[#58636b] hover:text-white"}`}
		onclick={() => (open = !open)}
	>
		<PanelsTopLeft size={15} stroke-width={1.7} />
	</button>
	{#if open}
		<div class={`absolute z-30 w-[250px] rounded-xl border border-[#303b43] bg-[#0b1014] p-2 shadow-[0_20px_55px_rgba(0,0,0,.58)] ${compact ? "top-0 left-[46px]" : "top-[38px] left-0"}`}>
			<p class="m-0 px-2 pt-1 pb-2 font-mono text-[8px] tracking-[.14em] text-[#64717a] uppercase">Open view</p>
			{#each items as item (item.id)}
				{@const Icon = item.icon}
				<button type="button" class={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left ${activeView === item.id ? "bg-[#1a242a]" : "hover:bg-[#141c21]"}`} onclick={() => select(item.id)}>
					<span class={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${activeView === item.id ? "border-[rgba(214,255,63,.26)] bg-[rgba(214,255,63,.07)] text-accent" : "border-[#303b43] bg-[#10161b] text-[#9aa6ad]"}`}><Icon size={14} /></span>
					<span class="min-w-0 flex-1"><strong class="block text-[10px] text-[#dce3e6]">{item.label}</strong><small class="mt-0.5 block truncate text-[8px] text-[#64717a]">{item.detail}</small></span>
					<ChevronRight size={12} class="text-[#56626a]" />
				</button>
			{/each}
		</div>
	{/if}
</div>
