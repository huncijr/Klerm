<script lang="ts">
	import { Plus } from "@lucide/svelte";
	import type { DesktopSession, StatusInfo } from "../lib/model.ts";
	import SessionRow from "./SessionRow.svelte";

	let {
		sessions,
		activeSessionId,
		status,
		open,
		collapsed,
		onnewsession,
		onrefresh,
		onswitch,
		onrename,
		ondelete,
		onexpand,
		oncollapse,
	}: {
		sessions: DesktopSession[];
		activeSessionId: string;
		status: StatusInfo;
		open: boolean;
		collapsed: boolean;
		onnewsession: () => void;
		onrefresh: () => void;
		onswitch: (session: DesktopSession) => void;
		onrename: (session: DesktopSession, name: string) => Promise<boolean>;
		ondelete: (session: DesktopSession) => void;
		onexpand: () => void;
		oncollapse: () => void;
	} = $props();

	const dotClass = $derived(
		status.state === "online"
			? "bg-accent shadow-[0_0_9px_rgba(214,255,63,.45)]"
			: status.state === "starting"
				? "animate-pulse bg-[#d6a63f]"
				: "bg-danger",
	);
</script>

<aside
	id="sidebar"
	class={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-line bg-[#090d11] narrow-720:fixed narrow-720:inset-y-0 narrow-720:left-0 narrow-720:z-20 narrow-720:w-[min(280px,84vw)] narrow-720:shadow-[24px_0_70px_rgba(0,0,0,.55)] narrow-720:transition-transform narrow-720:duration-200 ${
		open ? "narrow-720:translate-x-0" : "narrow-720:-translate-x-[102%]"
	}`}
>
	{#if collapsed}
		<div class="flex h-full min-h-0 flex-col items-center py-2.5">
			<button
				type="button"
				aria-label="Expand sessions"
				class="relative mt-1 grid h-11 w-11 place-items-center rounded-[13px] border border-[#33424c] bg-[#12181d] shadow-[0_10px_24px_rgba(0,0,0,.35)] hover:border-[#5a6a74] hover:bg-[#171e24]"
				onclick={onexpand}
			>
				<img src="/Klerm_logo_no_background.png" alt="" class="h-7 w-7 object-contain" />
				<span class={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${dotClass}`}></span>
				<span class="absolute right-0 -bottom-0.5 h-1.5 w-1.5 rounded-sm bg-[#2c3942]"></span>
			</button>
			<button
				type="button"
				aria-label="New session"
				class="mt-3 grid h-9 w-9 place-items-center rounded-lg border border-[#313a41] bg-[#12171c] text-[#c5ced3] hover:border-[#58636b] hover:bg-[#171d22]"
				onclick={onnewsession}
			>
				<Plus size={16} stroke-width={1.7} />
			</button>
			<button
				type="button"
				aria-label="Expand sessions"
				class="mt-auto mb-2 grid h-8 w-8 place-items-center rounded-md text-[#6d7a83] hover:bg-[#151c21] hover:text-[#d5dce0]"
				onclick={onexpand}
			>
				<span class="font-mono text-[9px]">›</span>
			</button>
		</div>
	{:else}
		<header
			class="relative flex min-h-[112px] items-center border-b border-line-soft px-[13px] py-3.5 short-650:min-h-[76px] short-650:py-2"
		>
			<img src="/Klerm_logo_no_background.png" alt="Klerm" class="block h-auto w-full max-h-[84px] object-contain short-650:max-h-[58px]" />
			<button
				type="button"
				aria-label="Collapse sessions"
				class="absolute top-2.5 right-2 hidden h-7 w-7 place-items-center rounded-md text-[#66747d] hover:bg-[#151c21] hover:text-[#d5dce0] min-[721px]:grid"
				onclick={oncollapse}
			>
				<span class="font-mono text-[10px]">‹</span>
			</button>
		</header>

		<button
			type="button"
			class="mx-4 mt-[18px] mb-3 flex h-[42px] cursor-pointer items-center justify-center gap-[9px] rounded-lg border border-[#313a41] bg-[#12171c] font-semibold transition-colors hover:border-[#58636b] hover:bg-[#171d22] short-650:mx-3 short-650:mt-2.5 short-650:mb-[7px] short-650:h-9 short-650:text-[11px]"
			onclick={onnewsession}
		>
			<Plus size={18} stroke-width={1.7} />
			New session
		</button>

		<section class="flex min-h-0 flex-1 flex-col pt-[17px] px-2.5 pb-2.5">
			<div class="flex items-center justify-between px-[11px] pb-2.5">
				<p class="m-0 font-mono text-[9px] tracking-[.15em] text-[#59646d] uppercase">Sessions</p>
				<button
					type="button"
					aria-label="Refresh sessions"
					class="cursor-pointer border-0 bg-transparent font-mono text-[9px] text-[#69757e] uppercase hover:text-accent"
					onclick={onrefresh}
				>
					Refresh
				</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
				{#if sessions.length === 0}
					<p class="px-[11px] py-2 text-[11px] text-muted">No saved sessions yet.</p>
				{:else}
					{#each sessions.slice(0, 30) as session (session.id)}
						<SessionRow
							{session}
							active={session.id === activeSessionId}
							onswitch={() => onswitch(session)}
							onrename={(name) => onrename(session, name)}
							ondelete={() => ondelete(session)}
						/>
					{/each}
				{/if}
			</div>
		</section>

		<footer
			class="flex min-h-16 items-center gap-2.5 border-t border-line-soft px-5 py-3 short-650:min-h-[50px] short-650:py-2"
		>
			<span class={`h-1.75 w-1.75 shrink-0 rounded-full ${dotClass}`}></span>
			<div>
				<strong class="block text-[10px] text-[#aab4bb]">{status.label}</strong>
				<small class="mt-[3px] block font-mono text-[8px] text-[#536069]">{status.detail}</small>
			</div>
		</footer>
	{/if}
</aside>
