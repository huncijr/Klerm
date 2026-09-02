<script lang="ts">
	import { ChevronDown, ChevronUp, CircleDot, ExternalLink, RefreshCw, ScrollText, Square, TerminalSquare } from "@lucide/svelte";
	import { tick } from "svelte";
	import type { RunningService, StatusInfo } from "../lib/model.ts";

	let {
		open,
		services,
		logs,
		status,
		terminalOutput,
		terminalBusy,
		terminalCurrentCommand,
		ontoggle,
		onrefresh,
		onopenurl,
		onruncommand,
		onstopcommand,
		onclearterminal,
	}: {
		open: boolean;
		services: RunningService[];
		logs: string[];
		status: StatusInfo;
		terminalOutput: string;
		terminalBusy: boolean;
		terminalCurrentCommand: string;
		ontoggle: () => void;
		onrefresh: () => void;
		onopenurl: (url: string) => void;
		onruncommand: (command: string) => void;
		onstopcommand: () => void;
		onclearterminal: () => void;
	} = $props();

	let tab = $state<"terminal" | "running" | "logs">("running");
	let command = $state("");
	let historyIndex = $state(-1);
	let terminalEl: HTMLDivElement | undefined = $state();
	const history: string[] = [];

	$effect(() => {
		terminalOutput;
		void tick().then(() => {
			if (terminalEl) terminalEl.scrollTop = terminalEl.scrollHeight;
		});
	});

	function selectTab(next: typeof tab): void {
		tab = next;
		if (!open) ontoggle();
	}

	function submitCommand(): void {
		const value = command.trim();
		if (!value || terminalBusy || status.state !== "online") return;
		history.push(value);
		historyIndex = history.length;
		command = "";
		onruncommand(value);
	}

	function handleCommandKeydown(event: KeyboardEvent): void {
		if (event.key === "Enter") {
			event.preventDefault();
			submitCommand();
			return;
		}
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		if (history.length === 0) return;
		event.preventDefault();
		historyIndex = Math.max(0, Math.min(history.length, historyIndex + (event.key === "ArrowUp" ? -1 : 1)));
		command = historyIndex === history.length ? "" : (history[historyIndex] ?? "");
	}
</script>

<section class={`mx-3 overflow-hidden rounded-t-lg border border-b-0 border-[#34414b] bg-[#0e151a] transition-[height] ${open ? "h-[250px]" : "h-8"}`}>
	<header class="flex h-8 items-center gap-1 border-b border-[#2e3942] bg-[#121a20] px-1.5">
		<button type="button" class={`flex h-7 items-center gap-1.5 rounded px-2 font-mono text-[8px] ${tab === "terminal" && open ? "bg-[rgba(48,105,151,.28)] text-[#add0ed]" : "text-[#75828b] hover:text-[#c7d0d4]"}`} onclick={() => selectTab("terminal")}><TerminalSquare size={11} /> Terminal</button>
		<button type="button" class={`flex h-7 items-center gap-1.5 rounded px-2 font-mono text-[8px] ${tab === "running" && open ? "bg-[rgba(48,126,75,.25)] text-[#acd8b8]" : "text-[#75828b] hover:text-[#c7d0d4]"}`} onclick={() => selectTab("running")}><CircleDot size={11} /> Running <span class="rounded bg-[#26323a] px-1 text-[7px]">{services.length + (terminalBusy ? 1 : 0)}</span></button>
		<button type="button" class={`flex h-7 items-center gap-1.5 rounded px-2 font-mono text-[8px] ${tab === "logs" && open ? "bg-[rgba(129,87,42,.28)] text-[#e0bc83]" : "text-[#75828b] hover:text-[#c7d0d4]"}`} onclick={() => selectTab("logs")}><ScrollText size={11} /> Logs</button>
		<span class="ml-auto mr-2 font-mono text-[7px] text-[#64717a]">{status.label}</span>
		<button type="button" aria-label="Refresh current workspace processes" class="grid h-7 w-7 place-items-center rounded text-[#75828b] hover:bg-[#1b252c] hover:text-[#d2d9dd]" onclick={onrefresh}><RefreshCw size={11} /></button>
		<button type="button" aria-label={open ? "Collapse bottom panel" : "Expand bottom panel"} class="grid h-7 w-7 place-items-center rounded text-[#75828b] hover:bg-[#1b252c] hover:text-[#d2d9dd]" onclick={ontoggle}>{#if open}<ChevronDown size={12} />{:else}<ChevronUp size={12} />{/if}</button>
	</header>
	{#if open}
		<div class="h-[218px] min-h-0">
			{#if tab === "running"}
				<div class="h-full overflow-auto bg-[#111a20] p-3 [scrollbar-width:thin]">
					<div class="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
						{#if terminalBusy}
							<div class="rounded-md border border-[rgba(205,143,52,.42)] bg-[linear-gradient(135deg,rgba(108,70,19,.35),rgba(22,29,34,.9))] p-2.5">
								<div class="flex items-center gap-2"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-[#e6b45f]"></span><strong class="font-mono text-[9px] text-[#f0ca8b]">Active terminal command</strong></div>
								<small class="mt-1.5 block truncate font-mono text-[7px] text-[#b39870]" title={terminalCurrentCommand}>{terminalCurrentCommand}</small>
							</div>
						{/if}
						{#each services as service (service.id)}
							<div class={`rounded-md border p-2.5 ${service.kind === "backend" ? "border-[rgba(72,129,184,.42)] bg-[linear-gradient(135deg,rgba(32,73,111,.36),rgba(20,29,35,.94))]" : "border-[rgba(66,151,89,.4)] bg-[linear-gradient(135deg,rgba(30,91,48,.34),rgba(19,29,34,.94))]"}`}>
								<div class="flex items-center gap-2"><span class={`h-1.5 w-1.5 rounded-full ${service.kind === "backend" ? "bg-[#72aee4]" : "bg-[#78ca8a]"}`}></span><strong class="min-w-0 truncate font-mono text-[9px] text-[#d1d9dd]">{service.kind === "listener" ? `localhost:${service.port}` : service.processName}</strong>{#if service.url}<button type="button" aria-label={`Open ${service.url}`} class="ml-auto text-[#82919b] hover:text-white" onclick={() => onopenurl(service.url!)}><ExternalLink size={11} /></button>{/if}</div>
								<small class="mt-1.5 block truncate font-mono text-[7px] text-[#74828b]" title={service.cwd}>{service.kind === "listener" ? `${service.processName} / ` : "current workspace / "}pid {service.pid}</small>
								<small class="mt-1 block truncate font-mono text-[7px] text-[#53626c]" title={service.cwd}>{service.cwd}</small>
							</div>
						{/each}
					</div>
				</div>
			{:else if tab === "logs"}
				<div class="h-full overflow-auto bg-[#111820] p-3 [scrollbar-width:thin]">{#if logs.length === 0}<p class="font-mono text-[9px] text-[#65717a]">No recent command or error activity.</p>{:else}<pre class="m-0 font-mono text-[9px]/[1.6] whitespace-pre-wrap text-[#a4afb6]">{logs.join("\n\n")}</pre>{/if}</div>
			{:else}
				<div class="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_38px] bg-[#0b1116]">
					<div bind:this={terminalEl} class="min-h-0 overflow-auto p-3 [scrollbar-width:thin]"><pre class="m-0 font-mono text-[10px]/[1.55] whitespace-pre-wrap text-[#bdc9cf]">{terminalOutput || "Run a command in the current workspace.\n"}{#if terminalBusy}<span class="text-[#e5b968]">running...</span>{/if}</pre></div>
					<div class="flex items-center gap-2 border-t border-[#2d3942] bg-[#111a20] px-2">
						<span class="font-mono text-[11px] text-[#72b5e6]">$</span>
						<input bind:value={command} disabled={terminalBusy || status.state !== "online"} aria-label="Workspace terminal command" placeholder={terminalBusy ? "Command running..." : "Run in workspace root"} class="min-w-0 flex-1 border-0 bg-transparent font-mono text-[10px] text-[#d5dde1] outline-none placeholder:text-[#53616b] disabled:cursor-not-allowed" onkeydown={handleCommandKeydown} />
						<span class="hidden font-mono text-[7px] text-[#53616b] narrow-720:inline">fresh shell per command</span>
						{#if terminalBusy}<button type="button" class="flex h-7 items-center gap-1 rounded border border-[rgba(208,80,74,.42)] bg-[rgba(113,35,35,.32)] px-2 font-mono text-[8px] text-[#f2a39c] hover:bg-[rgba(137,42,42,.45)]" onclick={onstopcommand}><Square size={9} fill="currentColor" /> Stop</button>{:else}<button type="button" class="h-7 rounded border border-[#2d3b45] px-2 font-mono text-[8px] text-[#7f8c94] hover:bg-[#1a252d] hover:text-[#d4dce0]" onclick={onclearterminal}>Clear</button><button type="button" disabled={!command.trim()} class="h-7 rounded border border-[#4b88b5] bg-[#285f87] px-2.5 font-mono text-[8px] font-semibold text-white hover:bg-[#34739f] disabled:cursor-not-allowed disabled:border-[#2a3841] disabled:bg-[#202a30] disabled:text-[#56636b]" onclick={submitCommand}>Run</button>{/if}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</section>
