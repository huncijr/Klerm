<script lang="ts">
	import { Check, Files, FolderGit2, Menu, X } from "@lucide/svelte";
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

<div class="bg-[rgba(8,11,15,.82)] backdrop-blur-[18px]">
<header
	class="flex items-center gap-5 border-b border-line px-7 py-2.5 narrow-900:gap-3 narrow-900:px-[18px] narrow-720:justify-between narrow-520:gap-2.5 narrow-520:px-3"
>
	<button
		type="button"
		aria-controls="sidebar"
		aria-expanded={sidebarOpen}
		aria-label="Toggle navigation"
		class="hidden h-[34px] w-[34px] cursor-pointer place-items-center rounded-md border border-line bg-[#0e1317] narrow-720:grid"
		onclick={ontogglesidebar}
	>
		<Menu size={14} stroke-width={1.7} />
	</button>

	<div class="min-w-0 flex-1">
		{#if editing}
			<div class="flex max-w-[340px] items-center gap-1">
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
			<button type="button" class="group/title mt-0.5 flex max-w-[340px] items-center text-left" onclick={startRename}>
				<strong class="min-w-0 truncate text-[13px] narrow-720:max-w-[180px] narrow-720:text-[11px]">{title}</strong>
			</button>
		{/if}
		<small class="mt-0.5 block max-w-[420px] truncate font-mono text-[8px]/[1.3] text-muted narrow-720:max-w-[180px]">{cwd}</small>
	</div>

	<button
		type="button"
		aria-label="Change workspace root"
		title={projectRoot}
		class="mx-auto flex min-w-0 max-w-[300px] cursor-pointer items-center gap-2 border-0 bg-transparent px-1 py-1 text-left narrow-720:hidden"
		onclick={onchangeroot}
	>
		<FolderGit2 size={14} stroke-width={1.6} class="shrink-0 text-[#8a969e]" />
		<span class="min-w-0">
			<span class="block font-mono text-[7px] tracking-[.12em] text-[#536069] uppercase">{isGit ? "Git root" : "Project root"}</span>
			<strong class="mt-0.5 block truncate text-[11px] font-medium text-[#bec7cc]">{projectRoot || "Choose project"}</strong>
		</span>
	</button>

	<div class="ml-auto flex min-w-0 items-center gap-2 text-right narrow-720:flex-1 narrow-720:justify-end">
		<i class={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}></i>
		<span class="min-w-0">
			<span class="block truncate text-[11px] text-[#d7dfe2] narrow-520:text-[9px]" title={model.reference}>{model.reference}</span>
			<span class="mt-0.5 block font-mono text-[7px] tracking-[.1em] text-[#536069] uppercase">{model.badge}</span>
		</span>
	</div>
</header>
	<div class="flex justify-end px-7 py-1 narrow-900:px-[18px] narrow-520:px-3">
		<button type="button" aria-pressed={workspacePanelOpen} class={`flex h-6 items-center gap-1 rounded px-2 font-mono text-[7px] uppercase ${workspacePanelOpen ? "bg-[#1a2228] text-[#c5ced3]" : "text-[#65717a] hover:bg-[#171d22] hover:text-[#c5ced3]"}`} onclick={ontogglefiles}><Files size={10} /> Files</button>
	</div>
</div>
