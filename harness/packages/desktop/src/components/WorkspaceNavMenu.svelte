<script lang="ts">
	import { Bot, Boxes, ChevronRight, MonitorUp, Network, PanelsTopLeft } from "@lucide/svelte";
	import { onMount } from "svelte";
	import type { WorkspaceView } from "../lib/model.ts";
	import { useDesktopShortcuts, type DesktopAction } from "../lib/shortcuts.ts";
	const shortcuts = useDesktopShortcuts();
	const viewAction: Record<WorkspaceView, DesktopAction> = { "agents-routing": "view.agents", "personal-bots": "view.personal", kanban: "view.kanban", graph: "view.graph", browser: "view.browser" };

	let {
		activeView,
		compact = false,
		embedded = false,
		onselect,
	}: {
		activeView?: WorkspaceView;
		compact?: boolean;
		embedded?: boolean;
		onselect: (view: WorkspaceView) => void;
	} = $props();

	let open = $state(false);
	let root: HTMLDivElement | undefined = $state();
	const items: Array<{ id: WorkspaceView; label: string; detail: string; icon: typeof Bot }> = [
		{ id: "agents-routing", label: "Agents & Routing", detail: "Shared prompt and agent workspace", icon: Network },
		{ id: "personal-bots", label: "Personal Bots", detail: "Personalities and private chats", icon: Bot },
		{ id: "kanban", label: "Kanban", detail: "Assigned and scheduled tasks", icon: Boxes },
		{ id: "graph", label: "Workflows / Graph", detail: "Connect existing agents, cards and history", icon: Network },
		{ id: "browser", label: "Browser Agent", detail: "Visible Chromium workspace", icon: MonitorUp },
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
	{#if embedded}
		<nav aria-label="Workspace views" class="space-y-1">
			{#each items as item (item.id)}
				{@const Icon = item.icon}
				<button type="button" aria-current={activeView === item.id ? "page" : undefined} class={`flex min-h-9 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] ${activeView === item.id ? "bg-raised font-medium text-ink" : "text-muted hover:bg-raised hover:text-ink"}`} onclick={() => select(item.id)} title={`${item.detail} · ${shortcuts?.label(viewAction[item.id])}`}>
					<Icon size={16} stroke-width={1.7} class={activeView === item.id ? "text-accent" : ""} />{item.label}
				</button>
			{/each}
		</nav>
	{:else}
	<button
		type="button"
		aria-label="Open workspace menu"
		aria-expanded={open}
		aria-pressed={activeView !== undefined}
		class={`grid place-items-center rounded-lg border ${compact ? "h-9 w-9" : "h-8 w-8"} ${activeView ? "border-line bg-raised text-ink" : "border-line bg-panel text-muted hover:border-line hover:text-ink"}`}
		onclick={() => (open = !open)}
	>
		<PanelsTopLeft size={15} stroke-width={1.7} />
	</button>
	{#if open}
		<div class={`absolute z-30 w-[min(420px,calc(100vw-64px))] rounded-lg border border-line bg-panel p-2 shadow-popover ${compact ? "top-0 left-[46px]" : "top-[38px] left-0"}`}>
			<p class="m-0 px-2 pt-1 pb-2 font-sans text-[11px] tracking-[.14em] text-muted uppercase">Open view</p>
			{#each items as item (item.id)}
				{@const Icon = item.icon}
				<button type="button" class={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left ${activeView === item.id ? "bg-raised" : "hover:bg-panel"}`} onclick={() => select(item.id)}>
					<span class={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${activeView === item.id ? "border-warning bg-warning-soft text-accent" : "border-line bg-panel text-muted"}`}><Icon size={14} /></span>
					<span class="min-w-0 flex-1"><strong class="block text-[12px] text-ink">{item.label}</strong><small class="mt-0.5 block truncate text-[11px] text-muted">{item.detail}</small></span>
					<kbd class="text-[11px] text-muted">{shortcuts?.label(viewAction[item.id])}</kbd>
					<ChevronRight size={12} class="text-dim" />
				</button>
			{/each}
		</div>
	{/if}
	{/if}
</div>
