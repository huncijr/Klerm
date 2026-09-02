<script lang="ts">
	import { Trash2 } from "@lucide/svelte";
	import { onMount, tick } from "svelte";
	import type { DesktopSession } from "../lib/model.ts";

	let {
		session,
		active,
		onswitch,
		onrename,
		ondelete,
	}: {
		session: DesktopSession;
		active: boolean;
		onswitch: () => void;
		onrename: (name: string) => Promise<boolean>;
		ondelete: () => void;
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
	class={`group relative flex items-center rounded-md ${active ? "bg-[#0e1513]" : "hover:bg-[#11171c] focus-within:bg-[#11171c]"}`}
>
	{#if editing}
		<div class="min-w-0 flex-1 py-2 pr-2 pl-[7px]">
			<input
				bind:this={renameInput}
				bind:value={renameValue}
				aria-label="Session name"
				class="w-full rounded border border-[#3b464e] bg-[#0a0f13] px-2 py-1.5 text-[10px] text-[#dce2e5] outline-none focus:border-[#66747d]"
				onkeydown={handleRenameKeydown}
				onblur={() => void commitRename()}
			/>
		</div>
	{:else}
		<div class="min-w-0 flex-1 py-2.5 pr-9 pl-[11px] text-left short-650:py-2">
			<button type="button" class="block max-w-full truncate border-0 bg-transparent p-0 text-left text-[11px] font-semibold text-[#b5bec5]" onclick={startRename}>{session.name ?? session.firstMessage}</button>
			<button type="button" class="mt-1 block border-0 bg-transparent p-0 font-mono text-[9px] text-[#55616a]" onclick={onswitch}>{dateLabel} / {session.messageCount} messages</button>
		</div>
	{/if}
	<div class="absolute top-[7px] right-[5px] z-[4]">
		<button
			type="button"
			aria-label={`Options for ${session.name ?? session.firstMessage}`}
			aria-expanded={menuOpen}
			class={`h-6 w-7 cursor-pointer rounded border-0 bg-[#171d22] pb-1.5 font-bold tracking-widest text-[#77828a] hover:bg-[#20272d] hover:text-[#e0e5e8] ${
				menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
			}`}
			onclick={toggleMenu}
		>
			...
		</button>
		{#if menuOpen}
			<div class="absolute top-[29px] right-0 z-[8] w-[154px] rounded-md border border-[#303941] bg-[#0b0f13] p-[5px] shadow-[0_14px_36px_rgba(0,0,0,.48)]">
				<button
					type="button"
					class="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-[9px] py-2 text-left text-[10px] text-[#e38780] hover:bg-[rgba(255,111,97,.1)] hover:text-[#ffada6]"
					onclick={requestDelete}
				>
					<Trash2 size={12} /> {baseLabel}
				</button>
			</div>
		{/if}
	</div>
</div>
