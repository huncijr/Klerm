<script lang="ts">
	import { ChevronDown, ChevronUp, CircleDot, ExternalLink, RefreshCw, ScrollText, TerminalSquare } from "@lucide/svelte";
	import type { RunningService, StatusInfo } from "../lib/model.ts";

	let {
		open,
		services,
		logs,
		status,
		ontoggle,
		onrefresh,
		onopenurl,
	}: {
		open: boolean;
		services: RunningService[];
		logs: string[];
		status: StatusInfo;
		ontoggle: () => void;
		onrefresh: () => void;
		onopenurl: (url: string) => void;
	} = $props();

	let tab = $state<"terminal" | "running" | "logs">("running");
</script>

<section class={`mx-3 overflow-hidden rounded-t-lg border border-b-0 border-[#273039] bg-[#090d11] transition-[height] ${open ? "h-[190px]" : "h-8"}`}>
	<header class="flex h-8 items-center gap-1 border-b border-line-soft px-1.5">
		<button type="button" class={`flex h-7 items-center gap-1.5 rounded px-2 font-mono text-[8px] ${tab === "terminal" && open ? "bg-[#171e24] text-[#d0d8dc]" : "text-[#68747c] hover:text-[#c7d0d4]"}`} onclick={() => { tab = "terminal"; if (!open) ontoggle(); }}><TerminalSquare size={11} /> Terminal</button>
		<button type="button" class={`flex h-7 items-center gap-1.5 rounded px-2 font-mono text-[8px] ${tab === "running" && open ? "bg-[#171e24] text-[#d0d8dc]" : "text-[#68747c] hover:text-[#c7d0d4]"}`} onclick={() => { tab = "running"; if (!open) ontoggle(); }}><CircleDot size={11} /> Running <span class="rounded bg-[#1d252b] px-1 text-[7px]">{services.length}</span></button>
		<button type="button" class={`flex h-7 items-center gap-1.5 rounded px-2 font-mono text-[8px] ${tab === "logs" && open ? "bg-[#171e24] text-[#d0d8dc]" : "text-[#68747c] hover:text-[#c7d0d4]"}`} onclick={() => { tab = "logs"; if (!open) ontoggle(); }}><ScrollText size={11} /> Logs</button>
		<span class="ml-auto mr-2 font-mono text-[7px] text-[#566169]">{status.label}</span>
		<button type="button" aria-label="Refresh running services" class="grid h-7 w-7 place-items-center rounded text-[#69757d] hover:bg-[#171d22] hover:text-[#d2d9dd]" onclick={onrefresh}><RefreshCw size={11} /></button>
		<button type="button" aria-label={open ? "Collapse bottom panel" : "Expand bottom panel"} class="grid h-7 w-7 place-items-center rounded text-[#69757d] hover:bg-[#171d22] hover:text-[#d2d9dd]" onclick={ontoggle}>{#if open}<ChevronDown size={12} />{:else}<ChevronUp size={12} />{/if}</button>
	</header>
	{#if open}
		<div class="h-[158px] overflow-auto p-3 [scrollbar-width:thin]">
			{#if tab === "running"}
				{#if services.length === 0}<p class="font-mono text-[9px] text-[#65717a]">No listening localhost services detected.</p>{:else}<div class="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">{#each services as service (service.port)}<div class="rounded-md border border-[#263039] bg-[#0d1318] p-2.5"><div class="flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-[#78bd87]"></span><strong class="font-mono text-[9px] text-[#c5ced3]">localhost:{service.port}</strong><button type="button" aria-label={`Open ${service.url}`} class="ml-auto text-[#77848c] hover:text-[#d2dade]" onclick={() => onopenurl(service.url)}><ExternalLink size={11} /></button></div><small class="mt-1.5 block truncate font-mono text-[7px] text-[#5c6870]">{service.processName ?? "listening process"}{service.pid ? ` / pid ${service.pid}` : ""}</small></div>{/each}</div>{/if}
			{:else if tab === "logs"}
				{#if logs.length === 0}<p class="font-mono text-[9px] text-[#65717a]">No recent command or error activity.</p>{:else}<pre class="m-0 font-mono text-[9px]/[1.6] whitespace-pre-wrap text-[#89959d]">{logs.join("\n\n")}</pre>{/if}
			{:else}
				<div class="rounded-md border border-[#253039] bg-[#070b0e] p-3 font-mono text-[9px]/[1.6] text-[#79868e]"><strong class="text-[#b7c1c6]">Read-only command history</strong><p class="mt-1">Interactive PTY input is deferred until process lifecycle and permission handling are reviewed.</p>{#if logs.length > 0}<pre class="mt-3 whitespace-pre-wrap text-[#89959d]">{logs.join("\n\n")}</pre>{/if}</div>
			{/if}
		</div>
	{/if}
</section>
