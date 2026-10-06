<script lang="ts">
	import { FolderInput, FolderMinus, PencilLine, Trash2 } from "@lucide/svelte";
	import { onMount, tick } from "svelte";
	import type { DesktopProject, DesktopSession } from "../lib/model.ts";

	let {
		session,
		active,
		onswitch,
		onrename,
		ondelete,
		projects = [],
		currentProjectId,
		onmove,
		onremove,
	}: {
		session: DesktopSession;
		active: boolean;
		onswitch: () => void;
		onrename: (name: string) => Promise<boolean>;
		ondelete: () => void;
		projects?: DesktopProject[];
		currentProjectId?: string;
		onmove?: (projectId: string) => void;
		onremove?: () => void;
	} = $props();

	let menuOpen = $state(false);
	let editing = $state(false);
	let renameBusy = $state(false);
	let renameValue = $state("");
	let rootEl: HTMLElement | undefined = $state();
	let renameInput: HTMLInputElement | undefined = $state();

	const dateLabel = $derived(
		new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(session.modified)),
	);
	const baseLabel = $derived(active ? "Delete this conversation" : "Delete session");

	onMount(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || !rootEl?.contains(event.target)) menuOpen = false;
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	});

	function toggleMenu(): void {
		menuOpen = !menuOpen;
	}

	function startRename(): void {
		menuOpen = false;
		renameValue = session.name ?? session.firstMessage;
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

	function requestDelete(): void {
		menuOpen = false;
		ondelete();
	}
</script>

<div
	bind:this={rootEl}
	class={`group relative flex items-center rounded-md ${active ? "bg-panel" : "hover:bg-panel focus-within:bg-panel"}`}
>
	{#if editing}
		<div class="min-w-0 flex-1 py-2 pr-2 pl-[7px]">
			<input
				bind:this={renameInput}
				bind:value={renameValue}
				aria-label="Session name"
				class="w-full rounded border border-line bg-bg px-2 py-1.5 text-[12px] text-ink outline-none focus:border-line"
				onkeydown={handleRenameKeydown}
				onblur={() => void commitRename()}
			/>
		</div>
	{:else}
		<div class="min-w-0 flex-1 py-2.5 pr-9 pl-[11px] text-left short-650:py-2">
			<button type="button" class="block max-w-full truncate border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-ink" onclick={onswitch}>{session.name ?? session.firstMessage}</button>
			<button type="button" class="mt-1 block border-0 bg-transparent p-0 font-sans text-[12px] text-dim" onclick={onswitch}>{dateLabel} / {session.messageCount} messages</button>
		</div>
	{/if}
	<div class="absolute top-[7px] right-[5px] z-[4]">
		<button
			type="button"
			aria-label={`Options for ${session.name ?? session.firstMessage}`}
			aria-expanded={menuOpen}
			class={`h-6 w-7 cursor-pointer rounded border-0 bg-raised pb-1.5 font-bold tracking-widest text-muted hover:bg-raised hover:text-ink ${
				menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
			}`}
			onclick={toggleMenu}
		>
			...
		</button>
		{#if menuOpen}
			<div class="absolute top-[29px] right-0 z-[8] w-[154px] rounded-md border border-line bg-bg p-[5px] shadow-sm">
				<button
					type="button"
					class="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-[9px] py-2 text-left text-[12px] text-ink hover:bg-raised hover:text-ink"
					onclick={startRename}
				>
					<PencilLine size={12} /> Rename
				</button>
				{#if onmove && projects.some((project) => project.id !== currentProjectId)}
					<p class="m-0 px-[9px] pt-1.5 pb-1 font-sans text-[11px] tracking-[.1em] text-dim uppercase">Move to project</p>
					<div class="max-h-32 overflow-y-auto [scrollbar-width:thin]">
						{#each projects.filter((project) => project.id !== currentProjectId) as project (project.id)}
							<button
								type="button"
								class="flex w-full cursor-pointer items-center gap-2 truncate rounded border-0 bg-transparent px-[9px] py-1.5 text-left text-[12px] text-ink hover:bg-raised hover:text-ink"
								onclick={() => {
									menuOpen = false;
									onmove(project.id);
								}}
							>
								<FolderInput size={12} class="shrink-0" /> <span class="truncate">{project.name}</span>
							</button>
						{/each}
					</div>
				{/if}
				{#if onremove}
					<button
						type="button"
						class="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-[9px] py-2 text-left text-[12px] text-ink hover:bg-raised hover:text-ink"
						onclick={() => {
							menuOpen = false;
							onremove();
						}}
					>
						<FolderMinus size={12} /> Remove from project
					</button>
				{/if}
				<button
					type="button"
					class="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-[9px] py-2 text-left text-[12px] text-danger hover:bg-danger-soft hover:text-danger"
					onclick={requestDelete}
				>
					<Trash2 size={12} /> {baseLabel}
				</button>
			</div>
		{/if}
	</div>
</div>
