<script lang="ts">
	import type { TimelineItem } from "../lib/model.ts";

	let { item, ontoggle }: { item: TimelineItem; ontoggle: () => void } = $props();

	const toneBorder: Record<string, string> = {
		neutral: "border-[#263039]",
		green: "border-[rgba(107,168,120,.4)]",
		blue: "border-[rgba(88,132,196,.45)]",
		red: "border-[rgba(255,111,97,.4)]",
		amber: "border-[rgba(214,166,63,.45)]",
	};
	const toneBg: Record<string, string> = {
		neutral: "bg-[#0e1318]",
		green: "bg-[rgba(23,40,29,.35)]",
		blue: "bg-[rgba(18,30,48,.4)]",
		red: "bg-[rgba(46,20,20,.35)]",
		amber: "bg-[rgba(48,38,16,.35)]",
	};
	const kindClass: Record<string, string> = {
		neutral: "border-[#333d44] text-[#97a2aa]",
		green: "border-[rgba(107,168,120,.45)] text-[#8fcf9f]",
		blue: "border-[rgba(88,132,196,.5)] text-[#9cc0f2]",
		red: "border-[rgba(255,111,97,.45)] text-[#f3a49c]",
		amber: "border-[rgba(214,166,63,.5)] text-[#d9b06a]",
	};
	const detailClass: Record<string, string> = {
		neutral: "text-[#8b959d]",
		green: "text-[#9fb7a6]",
		blue: "text-[#9db4d8]",
		red: "text-[#e69a93]",
		amber: "text-[#c9b184]",
	};
	const statusDot = $derived(
		item.status === "running"
			? "animate-pulse bg-[#d6a63f]"
			: item.status === "error"
				? "bg-danger"
				: item.tone === "green"
					? "bg-[#6fae7e]"
					: item.tone === "blue"
						? "bg-[#6f96d4]"
						: item.tone === "amber"
							? "bg-[#d6a63f]"
							: "bg-[#5d6871]",
	);
	const showDetail = $derived(item.detail.length > 0 && (item.open || item.status === "error"));

	function diffLineClass(line: string): string {
		if (line.startsWith("-")) return "block bg-[rgba(85,28,28,.32)] px-2 text-[#f0aaa3]";
		if (line.startsWith("+")) return "block bg-[rgba(28,76,43,.28)] px-2 text-[#9bd6aa]";
		return "block px-2 text-[#7f8991]";
	}
</script>

<article class={`rounded-lg border ${toneBorder[item.tone]} ${toneBg[item.tone]}`}>
	<button
		type="button"
		class="flex w-full cursor-pointer flex-col items-stretch gap-1.5 border-0 bg-transparent px-3 py-2.5 text-left font-mono text-[10px]/[1.4] narrow-720:px-2.5 narrow-720:py-2"
		aria-expanded={item.open}
		onclick={ontoggle}
	>
		<span class="flex items-center gap-2">
			<span class={`rounded border px-[5px] py-[2px] text-[7px] tracking-[.08em] uppercase ${kindClass[item.tone]}`}>
				{item.kind}
			</span>
			<i class={`h-1.75 w-1.75 shrink-0 rounded-full ${statusDot}`}></i>
			<i
				class={`ml-auto h-1.5 w-1.5 shrink-0 border-r border-b border-[#6f7a82] transition-transform duration-150 ${
					item.open ? "-translate-x-[1px] -translate-y-[1px] rotate-[225deg]" : "translate-y-[1px] rotate-45"
				}`}
			></i>
		</span>
		<span class="block text-[11px] break-words text-[#c3ccd2]">{item.title}</span>
	</button>
	{#if showDetail}
		{#if item.detailType === "diff"}
			<pre class="mx-3 mt-0 mb-2.5 overflow-x-auto rounded border border-[#252d34] bg-[#0a0e12] py-1 font-mono text-[9px]/[1.55] whitespace-pre-wrap break-words">{#each item.detail.split("\n") as line, index (`${index}-${line}`)}<span class={diffLineClass(line)}>{line || " "}</span>{/each}</pre>
		{:else if item.detailType === "code"}
			<pre class="mx-3 mt-0 mb-2.5 overflow-x-auto rounded border border-[#29323a] bg-[#090d11] p-3 font-mono text-[9px]/[1.6] whitespace-pre-wrap text-[#cbd4d9]"><code>{item.detail}</code></pre>
		{:else}
			<pre class={`m-0 overflow-hidden px-3 pb-2.5 font-mono text-[9px]/[1.55] whitespace-pre-wrap break-words ${detailClass[item.tone]}`}>{item.detail}</pre>
		{/if}
	{/if}
</article>
