<script lang="ts">
	import { onMount } from "svelte";
	import type { DesktopSession } from "../lib/model.ts";

	let {
		session,
		active,
		onswitch,
		ondelete,
	}: {
		session: DesktopSession;
		active: boolean;
		onswitch: () => void;
		ondelete: () => void;
	} = $props();

	let menuOpen = $state(false);
	let confirming = $state(false);
	let rootEl: HTMLElement | undefined = $state();

	const dateLabel = $derived(
		new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(session.modified)),
	);
	const baseLabel = $derived(active ? "Delete this conversation" : "Delete session");

	onMount(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || !rootEl?.contains(event.target)) {
				menuOpen = false;
				confirming = false;
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	});

	function toggleMenu(): void {
		menuOpen = !menuOpen;
		if (!menuOpen) confirming = false;
	}

	function handleDelete(): void {
		if (!confirming) {
			confirming = true;
			return;
		}
		ondelete();
	}
</script>

<div
	bind:this={rootEl}
	class={`group relative flex items-center rounded-md ${active ? "bg-[#0e1513]" : "hover:bg-[#11171c] focus-within:bg-[#11171c]"}`}
>
	<button type="button" class="min-w-0 flex-1 cursor-pointer rounded-md border-0 bg-transparent py-2.5 pr-9 pl-[11px] text-left short-650:py-2" onclick={onswitch}>
		<strong class="block truncate text-[11px] font-semibold text-[#b5bec5]">{session.name ?? session.firstMessage}</strong>
		<small class="mt-1 block font-mono text-[9px] text-[#55616a]">{dateLabel} / {session.messageCount} messages</small>
	</button>
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
			<div class="absolute top-[29px] right-0 z-[8] w-[130px] rounded-md border border-[#303941] bg-[#0b0f13] p-[5px] shadow-[0_14px_36px_rgba(0,0,0,.48)]">
				<button
					type="button"
					class={`w-full cursor-pointer rounded border-0 px-[9px] py-2 text-left text-[10px] ${
						confirming
							? "bg-[rgba(255,111,97,.1)] text-[#ff958c]"
							: "bg-transparent text-[#c9d0d4] hover:bg-[rgba(255,111,97,.12)] hover:text-white"
					}`}
					onclick={handleDelete}
				>
					{confirming ? "Confirm delete" : baseLabel}
				</button>
			</div>
		{/if}
	</div>
</div>
