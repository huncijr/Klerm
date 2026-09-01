<script lang="ts">
	import { Check, Files, FolderGit2, Menu, PencilLine, X } from "@lucide/svelte";
	import { tick } from "svelte";

	let {
		title,
		cwd,
		projectRoot,
		isGit,
		model,
		sidebarOpen,
		ontogglesidebar,
		onrename,
		onchangeroot,
		workspacePanelOpen,
		ontogglefiles,
	}: {
		title: string;
		cwd: string;
		projectRoot: string;
		isGit: boolean;
		model: { reference: string; statusClass: string; badge: string };
		sidebarOpen: boolean;
		ontogglesidebar: () => void;
		onrename: (name: string) => Promise<boolean>;
		onchangeroot: () => void;
		workspacePanelOpen: boolean;
		ontogglefiles: () => void;
	} = $props();

	let editing = $state(false);
	let renameBusy = $state(false);
	let renameValue = $state("");
	let renameInput: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (!editing) renameValue = title;
	});

	function startRename(): void {
		renameValue = title;
		editing = true;
		void tick().then(() => {
			renameInput?.focus();
			renameInput?.select();
		});
	}

	async function commitRename(): Promise<void> {
		const name = renameValue.trim();
		if (!name || renameBusy) return;
		renameBusy = true;
		if (await onrename(name)) editing = false;
		renameBusy = false;
	}

	function handleRenameKeydown(event: KeyboardEvent): void {
		if (event.key === "Enter") {
			event.preventDefault();
			void commitRename();
		} else if (event.key === "Escape") {
			editing = false;
		}
	}

	const dotClass = $derived(
		model.statusClass === "online"
			? "bg-accent shadow-[0_0_9px_rgba(214,255,63,.45)]"
			: model.statusClass === "starting"
				? "animate-pulse bg-[#d6a63f]"
				: "bg-danger",
	);
</script>

<header
	class="grid grid-cols-[minmax(180px,1fr)_minmax(180px,1.15fr)_minmax(250px,1fr)] items-center gap-4 border-b border-line bg-[rgba(8,11,15,.82)] px-7 backdrop-blur-[18px] narrow-900:grid-cols-[minmax(150px,1fr)_minmax(150px,.9fr)_minmax(170px,1fr)] narrow-900:px-[18px] narrow-720:flex narrow-720:justify-between narrow-520:grid narrow-520:grid-cols-[minmax(0,1fr)_minmax(130px,1.35fr)] narrow-520:grid-rows-[auto_auto] narrow-520:gap-x-2.5 narrow-520:gap-y-[3px] narrow-520:px-3"
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
		{#if editing}
			<div class="mt-1 flex max-w-[340px] items-center gap-1 narrow-520:hidden">
				<input
					bind:this={renameInput}
					bind:value={renameValue}
					aria-label="Session name"
					class="min-w-0 flex-1 rounded border border-[#3a454d] bg-[#0c1115] px-2 py-1 text-[12px] text-[#e5eaed] outline-none focus:border-[#68757e]"
					onkeydown={handleRenameKeydown}
				/>
				<button type="button" aria-label="Save session name" class="grid h-6 w-6 place-items-center rounded text-[#a9c94d] hover:bg-[#1a211b]" onclick={() => void commitRename()}><Check size={13} /></button>
				<button type="button" aria-label="Cancel rename" class="grid h-6 w-6 place-items-center rounded text-[#737e85] hover:bg-[#171d22]" onclick={() => (editing = false)}><X size={13} /></button>
			</div>
		{:else}
			<div class="group/title mt-1.5 flex max-w-[340px] items-center gap-1.5 narrow-520:hidden">
				<strong class="min-w-0 truncate text-[13px] narrow-720:max-w-[180px] narrow-720:text-[11px]">{title}</strong>
				<button type="button" aria-label="Rename session" class="grid h-5 w-5 shrink-0 place-items-center rounded text-[#59656d] opacity-0 group-hover/title:opacity-100 focus:opacity-100 hover:bg-[#171d22] hover:text-[#cbd2d7]" onclick={startRename}><PencilLine size={11} /></button>
			</div>
		{/if}
		<small class="mt-1 block max-w-[420px] truncate font-mono text-[8px]/[1.3] text-muted narrow-720:max-w-[180px] narrow-520:hidden">{cwd}</small>
	</div>

	<button
		type="button"
		aria-label="Change workspace root"
		title={projectRoot}
		class="mx-auto flex min-w-0 max-w-[320px] items-center gap-2 rounded-lg border border-[#273039] bg-[#0d1217] px-3 py-2 text-left hover:border-[#46525b] hover:bg-[#12181d] narrow-720:hidden"
		onclick={onchangeroot}
	>
		<FolderGit2 size={14} stroke-width={1.6} class="shrink-0 text-[#8a969e]" />
		<span class="min-w-0">
			<span class="block font-mono text-[7px] tracking-[.12em] text-[#536069] uppercase">{isGit ? "Git root" : "Project root"}</span>
			<strong class="mt-0.5 block truncate text-[10px] font-medium text-[#bec7cc]">{projectRoot || "Choose project"}</strong>
		</span>
	</button>

	<div
		class="ml-auto min-w-[250px] max-w-[360px] rounded-lg border border-line bg-panel px-3 pt-[9px] pb-[10px] narrow-900:min-w-[170px] narrow-720:min-w-0 narrow-720:flex-1 narrow-520:col-start-2 narrow-520:row-span-2 narrow-520:row-start-1 narrow-520:min-w-0 narrow-520:px-[9px] narrow-520:py-[7px]"
	>
		<div class="flex items-center justify-end gap-2">
			<button type="button" aria-pressed={workspacePanelOpen} class={`mr-auto flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[7px] uppercase ${workspacePanelOpen ? "bg-[#1a2228] text-[#c5ced3]" : "text-[#65717a] hover:bg-[#171d22] hover:text-[#c5ced3]"}`} onclick={ontogglefiles}><Files size={10} /> Files</button>
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
