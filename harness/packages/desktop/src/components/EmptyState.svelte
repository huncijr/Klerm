<script lang="ts">
	import { Code2, FolderSearch, ShieldAlert, SquareTerminal } from "@lucide/svelte";
	import type { RuntimeStatus } from "../lib/model.ts";

	let {
		runtimeStatus,
		onrefresh,
		onprompt,
	}: { runtimeStatus: RuntimeStatus; onrefresh: () => void; onprompt: (prompt: string) => void } = $props();

	const suggestions = [
		{ icon: "code", text: "Create a simple website in this folder" },
		{ icon: "search", text: "Inspect this workspace and summarize folder sizes" },
		{ icon: "risk", text: "Review this repo and list the riskiest files to change" },
		{ icon: "terminal", text: "Scaffold an Agent 1-first todo CLI here" },
	];

	const dotClass = $derived(
		runtimeStatus.state === "online"
			? "bg-accent shadow-[0_0_9px_rgba(214,255,63,.45)]"
			: runtimeStatus.state === "starting"
				? "animate-pulse bg-[#d6a63f]"
				: "bg-danger",
	);
</script>

<div
	class="flex min-h-full w-full flex-col items-center justify-end pt-7 text-center short-500:justify-center short-500:pt-0"
>
	<div class="relative mb-6 grid h-[78px] w-[78px] place-items-center short-650:mb-3.5 short-650:h-[54px] short-650:w-[54px] short-500:hidden">
		<div class="absolute inset-0 rotate-[62deg] scale-x-[.34] rounded-full border border-[#2b343a]"></div>
		<div class="absolute inset-0 -rotate-[62deg] scale-x-[.34] rounded-full border border-[#2b343a]"></div>
		<div class="absolute inset-0 scale-y-[.34] rounded-full border border-[#2b343a]"></div>
		<span class="font-mono text-[21px] text-hero [text-shadow:0_0_18px_rgba(240,160,68,.24)]">K</span>
	</div>
	<p class="mb-3.5 font-mono text-[9px] tracking-[.2em] text-accent short-500:mb-[9px] short-500:text-[7px]">
		LOCAL-FIRST CODING AGENT
	</p>
	<h1
		class="m-0 text-[clamp(32px,4vw,52px)] leading-[1.05] tracking-[-.045em] narrow-900:text-[clamp(30px,5vw,42px)] narrow-520:text-[28px] short-650:text-[clamp(27px,4vw,38px)] short-500:text-[25px]"
	>
		What should we build?
	</h1>
	<p
		class="mx-auto mt-[18px] mb-[26px] max-w-[510px] text-[13px] leading-[1.7] text-muted narrow-520:my-3 narrow-520:text-[11px] short-650:mt-2.5 short-650:mb-4 short-650:leading-[1.45] short-500:hidden"
	>
		Choose models for Agent 1 and Agent 2, then send a task. They can be local or cloud, but not the same model.
	</p>
	<div class="mb-4 grid w-[min(560px,100%)] grid-cols-2 gap-2 text-left narrow-520:grid-cols-1 short-500:hidden">
		{#each suggestions as suggestion}
			<button
				type="button"
				class="flex items-start gap-2 rounded-lg border border-line bg-[rgba(14,19,24,.62)] px-3 py-2.5 text-left text-[10px] leading-[1.4] text-[#8c979f] cursor-pointer transition-colors hover:border-[#3b464e] hover:bg-[#11171c] hover:text-[#d7dde1]"
				onclick={() => onprompt(suggestion.text)}
			>
				<span class="mt-0.5 shrink-0 text-[#78858d]">
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
		class="grid w-[min(470px,100%)] grid-cols-[8px_1fr_auto] items-center gap-3 rounded-lg border border-line bg-[rgba(14,19,24,.8)] px-[15px] py-3 text-left short-650:py-[9px] short-500:mt-3.5"
	>
		<span class={`h-[7px] w-[7px] shrink-0 rounded-full ${dotClass}`}></span>
		<div>
			<strong class="block text-[10px] text-[#bac3c9]">{runtimeStatus.title}</strong>
			<small class="mt-[3px] block font-mono text-[8px]/[1.3] text-[#59656e]">{runtimeStatus.detail}</small>
		</div>
		<button
			type="button"
			class="border-0 bg-transparent font-mono text-[9px] uppercase text-[#69757e] cursor-pointer hover:text-accent"
			onclick={onrefresh}
		>
			Refresh
		</button>
	</div>
</div>
