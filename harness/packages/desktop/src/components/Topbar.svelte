<script lang="ts">
	import { Menu } from "@lucide/svelte";

	let {
		title,
		cwd,
		model,
		sidebarOpen,
		ontogglesidebar,
	}: {
		title: string;
		cwd: string;
		model: { reference: string; statusClass: string; badge: string };
		sidebarOpen: boolean;
		ontogglesidebar: () => void;
	} = $props();

	const dotClass = $derived(
		model.statusClass === "online"
			? "bg-accent shadow-[0_0_9px_rgba(214,255,63,.45)]"
			: model.statusClass === "starting"
				? "animate-pulse bg-[#d6a63f]"
				: "bg-danger",
	);
</script>

<header
	class="flex items-center justify-between gap-6 border-b border-line bg-[rgba(8,11,15,.82)] px-7 backdrop-blur-[18px] narrow-900:px-[18px] narrow-520:grid narrow-520:grid-cols-[minmax(0,1fr)_minmax(130px,1.35fr)] narrow-520:grid-rows-[auto_auto] narrow-520:gap-x-2.5 narrow-520:gap-y-[3px] narrow-520:px-3"
>
	<button
		type="button"
		aria-controls="sidebar"
		aria-expanded={sidebarOpen}
		aria-label="Toggle navigation"
		class="hidden h-[34px] w-[34px] cursor-pointer place-items-center rounded-md border border-line bg-[#0e1317] narrow-720:grid narrow-520:col-start-1 narrow-520:row-start-2 narrow-520:h-[22px] narrow-520:w-fit narrow-520:border-0 narrow-520:bg-transparent narrow-520:px-[7px] narrow-520:font-mono narrow-520:text-[8px] narrow-520:tracking-normal narrow-520:text-[#77828a] narrow-520:uppercase"
		onclick={ontogglesidebar}
	>
		<Menu size={14} stroke-width={1.7} class="narrow-520:w-[11px]" />
		<span class="hidden narrow-520:inline">Menu</span>
	</button>

	<div class="min-w-0 narrow-520:col-start-1 narrow-520:row-start-1 narrow-520:self-end">
		<span class="block font-mono text-[8px] tracking-[.14em] text-[#536069]">WORKSPACE</span>
		<strong class="mt-1.5 block max-w-[320px] truncate text-[13px] narrow-720:max-w-[180px] narrow-720:text-[11px] narrow-520:hidden">{title}</strong>
		<small class="mt-1 block max-w-[420px] truncate font-mono text-[8px]/[1.3] text-muted narrow-720:max-w-[180px] narrow-520:hidden">{cwd}</small>
	</div>

	<div
		class="min-w-[250px] max-w-[360px] rounded-lg border border-line bg-panel px-3 pt-[9px] pb-[10px] narrow-900:min-w-[170px] narrow-720:min-w-0 narrow-720:flex-1 narrow-520:col-start-2 narrow-520:row-span-2 narrow-520:row-start-1 narrow-520:min-w-0 narrow-520:px-[9px] narrow-520:py-[7px]"
	>
		<div class="flex items-center justify-end gap-2">
			<span class="block font-mono text-[8px] tracking-[.14em] text-[#536069]">CURRENT MODEL</span>
			<i class={`h-1.5 w-1.5 rounded-full ${dotClass}`}></i>
		</div>
		<div class="flex items-center justify-end gap-2">
			<strong class="mt-1.5 min-w-0 truncate text-[11px] text-[#d7dfe2] narrow-520:text-[9px]" title={model.reference}>{model.reference}</strong>
			<b
				class="mt-1.5 shrink-0 rounded-full border border-[#303941] bg-[#141a1f] px-1.5 py-[3px] font-mono text-[7px] font-semibold tracking-[.08em] text-[#8d989f] uppercase narrow-520:text-[6px]"
			>
				{model.badge}
			</b>
		</div>
	</div>
</header>
