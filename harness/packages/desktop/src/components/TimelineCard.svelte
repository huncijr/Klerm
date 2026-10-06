<script lang="ts">
	import { imageDataUrl } from "../lib/helpers.ts";
	import { MCP_COLOR_BG_CSS, MCP_COLOR_CSS } from "../lib/mcp-mentions.ts";
	import type { TimelineItem } from "../lib/model.ts";

	let { item, ontoggle }: { item: TimelineItem; ontoggle: () => void } = $props();

	const toneBorder: Record<string, string> = {
		neutral: "border-line",
		green: "border-success",
		blue: "border-info",
		red: "border-danger",
		amber: "border-warning",
	};
	const toneBg: Record<string, string> = {
		neutral: "bg-panel",
		green: "bg-raised",
		blue: "bg-raised",
		red: "bg-raised",
		amber: "bg-raised",
	};
	const kindClass: Record<string, string> = {
		neutral: "border-line text-muted",
		green: "border-success text-success",
		blue: "border-info text-info",
		red: "border-danger text-danger",
		amber: "border-warning text-warning",
	};
	const detailClass: Record<string, string> = {
		neutral: "text-muted",
		green: "text-ink",
		blue: "text-info",
		red: "text-danger",
		amber: "text-warning",
	};
	const statusDot = $derived(
		item.status === "running"
			? "animate-pulse bg-warning"
			: item.status === "error"
				? "bg-danger"
				: item.tone === "green"
					? "bg-success"
					: item.tone === "blue"
						? "bg-info"
						: item.tone === "amber"
							? "bg-warning"
							: "bg-raised",
	);
	const showDetail = $derived(item.detail.length > 0 && (item.open || item.status === "error"));
	const mcpStyle = $derived(
		item.mcp && item.status !== "error"
			? `border-color: ${MCP_COLOR_CSS[item.mcp.color]}; background: ${MCP_COLOR_BG_CSS[item.mcp.color]}`
			: undefined,
	);

	function diffLineClass(line: string): string {
		if (line.startsWith("-")) return "block bg-danger-soft px-2 text-danger";
		if (line.startsWith("+")) return "block bg-success-soft px-2 text-success";
		return "block px-2 text-muted";
	}
</script>

<article class={`rounded-lg border ${toneBorder[item.tone]} ${toneBg[item.tone]}`} style={mcpStyle}>
	<button
		type="button"
		class="flex w-full cursor-pointer flex-col items-stretch gap-1.5 border-0 bg-transparent px-3 py-2.5 text-left font-sans text-[12px]/[1.4] narrow-720:px-2.5 narrow-720:py-2"
		aria-expanded={item.open}
		onclick={ontoggle}
	>
		<span class="flex items-center gap-2">
			<span class={`rounded border px-[5px] py-[2px] text-[11px] tracking-[.08em] uppercase ${kindClass[item.tone]}`} style={item.mcp && item.status !== "error" ? `border-color: ${MCP_COLOR_CSS[item.mcp.color]}; color: ${MCP_COLOR_CSS[item.mcp.color]}; background: ${MCP_COLOR_BG_CSS[item.mcp.color]}` : undefined}>
				{item.kind}
			</span>
			<i class={`h-1.75 w-1.75 shrink-0 rounded-full ${statusDot}`}></i>
			<i
				class={`ml-auto h-1.5 w-1.5 shrink-0 border-r border-b border-line transition-transform duration-150 ${
					item.open ? "-translate-x-[1px] -translate-y-[1px] rotate-[225deg]" : "translate-y-[1px] rotate-45"
				}`}
			></i>
		</span>
		<span class="block text-[13px] break-words text-ink">{item.title}</span>
	</button>
	{#if showDetail}
		{#if item.detailType === "diff"}
			<pre class="mx-3 mt-0 mb-2.5 overflow-x-auto rounded border border-line bg-bg py-1 font-mono text-[12px]/[1.55] whitespace-pre-wrap break-words">{#each item.detail.split("\n") as line, index (`${index}-${line}`)}<span class={diffLineClass(line)}>{line || " "}</span>{/each}</pre>
		{:else if item.detailType === "code"}
			<pre class="mx-3 mt-0 mb-2.5 overflow-x-auto rounded border border-line bg-bg p-3 font-mono text-[12px]/[1.6] whitespace-pre-wrap text-ink"><code>{item.detail}</code></pre>
		{:else}
			<pre class={`m-0 overflow-hidden px-3 pb-2.5 font-mono text-[12px]/[1.55] whitespace-pre-wrap break-words ${detailClass[item.tone]}`}>{item.detail}</pre>
		{/if}
	{/if}
	{#if item.images?.length}
		<div class="grid grid-cols-2 gap-2 px-3 pb-3">
			{#each item.images as image, index (`${index}-${image.mimeType}-${image.data.length}`)}
				{@const src = imageDataUrl(image)}
				{#if src}<a href={src} download={`klerm-tool-image-${index + 1}`}><img src={src} alt={`Tool result ${index + 1}`} class="max-h-72 w-full rounded-md border border-line bg-bg object-contain" /></a>{/if}
			{/each}
		</div>
	{/if}
</article>
