<script lang="ts">
	import { onMount } from "svelte";
	import type { ChatMessage } from "../lib/model.ts";

	let { message }: { message: ChatMessage } = $props();

	let rootEl: HTMLElement | undefined = $state();

	onMount(() => {
		rootEl?.scrollIntoView({ behavior: "smooth", block: "end" });
	});
</script>

<article
	bind:this={rootEl}
	class={`mb-[30px] narrow-520:mb-6 ${message.role === "user" ? "flex flex-col items-end" : ""}`}
>
	<div
		class={`mb-2 flex items-center gap-2 font-mono text-[9px] tracking-[.06em] text-[#657079] ${message.role === "user" ? "pr-1" : ""}`}
	>
		<span>{message.role === "user" ? "You" : (message.model ?? "Klerm")}</span>
	</div>
	<div
		class={`whitespace-pre-wrap break-words text-[13px] leading-[1.75] narrow-900:text-[12px] ${
			message.role === "user"
				? "w-fit max-w-[78%] rounded-[10px] border border-[#293139] bg-[#151a1f] px-[15px] py-3 text-[#edf1f3] narrow-520:max-w-[88%] narrow-520:px-3 narrow-520:py-2.5 narrow-520:text-[12px] narrow-520:leading-[1.65]"
				: "px-[2px] text-[#cbd2d7] narrow-520:text-[12px] narrow-520:leading-[1.65]"
		}`}
	>
		{message.text}{#if message.streaming}<span class="ml-[3px] inline-block h-[13px] w-[5px] animate-pulse bg-[#8b969e] align-[-2px]"></span>{/if}
	</div>
</article>
