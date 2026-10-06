<script module lang="ts">
	let lastHeadline: number | undefined;
</script>

<script lang="ts">
	import { Code2, FolderSearch, ShieldAlert, SquareTerminal } from "@lucide/svelte";
	import { EMPTY_HEADLINES, EMPTY_SUBTITLE, pickHeadline } from "../lib/empty-copy.ts";
	import type { RuntimeStatus } from "../lib/model.ts";

	let {
		runtimeStatus,
		onrefresh,
		onprompt,
	}: { runtimeStatus: RuntimeStatus; onrefresh: () => void; onprompt: (prompt: string) => void } = $props();

	lastHeadline = pickHeadline(lastHeadline);
	const headline = EMPTY_HEADLINES[lastHeadline] ?? EMPTY_HEADLINES[0];

	const suggestions = [
		{ icon: "code", text: "Create a simple website in this folder" },
		{ icon: "search", text: "Inspect this workspace and summarize folder sizes" },
		{ icon: "risk", text: "Review this repo and list the riskiest files to change" },
		{ icon: "terminal", text: "Create a small command-line tool in this folder" },
	];

	const dotClass = $derived(
		runtimeStatus.state === "online"
			? "bg-success"
			: runtimeStatus.state === "starting"
				? "animate-pulse bg-warning"
				: "bg-danger",
	);
</script>

<div
	class="mx-auto flex min-h-full w-full max-w-[720px] flex-col items-start justify-end px-2 pt-8 pb-2 text-left short-500:justify-center short-500:pt-0"
>
	<img
		src="/K_Klerm_no_background.png"
		alt="Klerm"
		class="mb-5 h-10 w-10 object-contain short-650:mb-3 short-500:hidden"
	/>
	<p class="mb-2 section-label short-500:hidden">
		Your workspace
	</p>
	<h1
		class="m-0 max-w-[600px] font-display text-[clamp(28px,3vw,38px)] leading-[1.2] tracking-[-.025em] narrow-520:text-[26px] short-500:text-[24px]"
	>
		{headline}
	</h1>
	<p
		class="mt-3 mb-6 max-w-[560px] text-[14px] leading-[1.65] text-muted narrow-520:my-3 short-650:mb-4 short-500:hidden"
	>
		{EMPTY_SUBTITLE}
	</p>
	<div class="mb-5 grid w-full grid-cols-2 gap-x-6 gap-y-1 text-left narrow-520:grid-cols-1 short-500:hidden">
		{#each suggestions as suggestion}
			<button
				type="button"
				class="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-left text-[13px] leading-[1.4] text-muted transition-colors hover:bg-raised hover:text-ink"
				onclick={() => onprompt(suggestion.text)}
			>
				<span class="mt-0.5 shrink-0 text-muted">
					{#if suggestion.icon === "code"}
						<Code2 size={12} />
					{:else if suggestion.icon === "search"}
						<FolderSearch size={12} />
					{:else if suggestion.icon === "risk"}
						<ShieldAlert size={12} />
					{:else}
						<SquareTerminal size={12} />
					{/if}
				</span>
				<span>{suggestion.text}</span>
			</button>
		{/each}
	</div>
	<div
		class="grid w-full grid-cols-[8px_1fr_auto] items-center gap-3 border-t border-line-soft pt-4 pb-1 text-left short-500:mt-3"
	>
		<span class={`h-[7px] w-[7px] shrink-0 rounded-full ${dotClass}`}></span>
		<div>
			<strong class="block text-[12px] text-ink">{runtimeStatus.title}</strong>
			<small class="mt-[3px] block font-sans text-[11px]/[1.3] text-dim">{runtimeStatus.detail}</small>
		</div>
		<button
			type="button"
			class="border-0 bg-transparent font-sans text-[12px] uppercase text-muted cursor-pointer hover:text-accent"
			onclick={onrefresh}
		>
			Refresh
		</button>
	</div>
</div>
