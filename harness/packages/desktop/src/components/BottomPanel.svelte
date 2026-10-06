<script lang="ts">
	import { ChevronDown, ChevronUp, CircleDot, ExternalLink, RefreshCw, ScrollText, Square, TerminalSquare } from "@lucide/svelte";
	import { tick, onMount } from "svelte";
	import { useDesktopShortcuts } from "../lib/shortcuts.ts";
	import type { RunningService, StatusInfo } from "../lib/model.ts";

	let {
		open,
		services,
		logs,
		status,
		terminalOutput,
		terminalBusy,
		terminalCurrentCommand,
		pendingApproval,
		ontoggle,
		onrefresh,
		onopenurl,
		onruncommand,
		onstopcommand,
		onclearterminal,
		onapprove,
		onreject,
	}: {
		open: boolean;
		services: RunningService[];
		logs: string[];
		status: StatusInfo;
		terminalOutput: string;
		terminalBusy: boolean;
		terminalCurrentCommand: string;
		pendingApproval?: { title: string; message: string };
		ontoggle: () => void;
		onrefresh: () => void;
		onopenurl: (url: string) => void;
		onruncommand: (command: string) => void;
		onstopcommand: () => void;
		onclearterminal: () => void;
		onapprove: () => void;
		onreject: () => void;
	} = $props();

	let tab = $state<"terminal" | "running" | "logs">("running");
	let command = $state("");
	const shortcuts = useDesktopShortcuts();
	const commandFocused = () => document.activeElement?.getAttribute("aria-label") === "Workspace terminal command";
	onMount(() => {
		const remove = [shortcuts?.register("run", submitCommand, () => !terminalBusy && status.state === "online", 30, commandFocused), shortcuts?.register("stop", onstopcommand, () => terminalBusy, 30, commandFocused), shortcuts?.register("save", () => {}, () => false, 30, commandFocused)];
		return () => { for (const cleanup of remove) cleanup?.(); };
	});
	let historyIndex = $state(-1);
	let terminalEl: HTMLDivElement | undefined = $state();
	const history: string[] = [];

	$effect(() => {
		terminalOutput;
		void tick().then(() => {
			if (terminalEl) terminalEl.scrollTop = terminalEl.scrollHeight;
		});
	});

	$effect(() => {
		if (pendingApproval) tab = "running";
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

<section class={`mx-3 overflow-hidden rounded-t-lg border border-b-0 border-line bg-panel transition-[height] ${open ? "h-[250px]" : "h-8"}`}>
	<header class="flex h-8 items-center gap-1 border-b border-line bg-panel px-1.5">
		<button type="button" class={`flex h-7 items-center gap-1.5 rounded px-2 font-mono text-[11px] ${tab === "terminal" && open ? "bg-info-soft text-info" : "text-muted hover:text-ink"}`} onclick={() => selectTab("terminal")}><TerminalSquare size={11} /> Terminal</button>
		<button type="button" class={`flex h-7 items-center gap-1.5 rounded px-2 font-mono text-[11px] ${tab === "running" && open ? "bg-success-soft text-success" : "text-muted hover:text-ink"}`} onclick={() => selectTab("running")}><CircleDot size={11} /> Running <span class="rounded bg-raised px-1 text-[11px]">{services.length + (terminalBusy ? 1 : 0) + (pendingApproval ? 1 : 0)}</span></button>
		<button type="button" class={`flex h-7 items-center gap-1.5 rounded px-2 font-sans text-[11px] ${tab === "logs" && open ? "bg-danger-soft text-warning" : "text-muted hover:text-ink"}`} onclick={() => selectTab("logs")}><ScrollText size={11} /> Logs</button>
		<button type="button" aria-label="Refresh current workspace processes" class="ml-auto grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink" onclick={onrefresh}><RefreshCw size={11} /></button>
		<button type="button" aria-label={open ? "Collapse bottom panel" : "Expand bottom panel"} class="grid h-7 w-7 place-items-center rounded text-muted hover:bg-raised hover:text-ink" onclick={ontoggle}>{#if open}<ChevronDown size={12} />{:else}<ChevronUp size={12} />{/if}</button>
	</header>
	{#if open}
		<div class="h-[218px] min-h-0">
			{#if tab === "running"}
				<div class="h-full overflow-auto bg-panel p-3 [scrollbar-width:thin]">
					<div class="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
						{#if pendingApproval}
							<div class="col-span-full rounded-md border border-warning bg-panel p-3">
								<div class="flex items-center gap-2"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"></span><strong class="font-mono text-[12px] text-warning">Command approval required</strong></div>
								<small class="mt-1 block font-sans text-[11px] text-warning">{pendingApproval.title}</small>
								<pre class="mt-2 mb-0 overflow-x-auto rounded border border-warning bg-bg p-2.5 font-mono text-[12px]/[1.55] whitespace-pre-wrap text-accent"><code>{pendingApproval.message}</code></pre>
								<div class="mt-2.5 flex justify-end gap-2">
									<button type="button" class="rounded px-2.5 py-1.5 font-sans text-[11px] text-muted hover:bg-raised hover:text-ink" onclick={onreject}>Cancel</button>
									<button type="button" class="rounded bg-warning-soft px-2.5 py-1.5 font-sans text-[11px] font-semibold text-warning hover:bg-warning-soft" onclick={onapprove}>Approve</button>
								</div>
							</div>
						{/if}
						{#if terminalBusy}
							<div class="rounded-md border border-danger bg-panel p-2.5">
								<div class="flex items-center gap-2"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"></span><strong class="font-mono text-[12px] text-warning">Active terminal command</strong></div>
								<small class="mt-1.5 block truncate font-mono text-[11px] text-warning" title={terminalCurrentCommand}>{terminalCurrentCommand}</small>
							</div>
						{/if}
						{#each services as service (service.id)}
							<div class={`rounded-md border p-2.5 ${service.kind === "backend" ? "border-info bg-panel" : "border-success bg-panel"}`}>
								<div class="flex items-center gap-2"><span class={`h-1.5 w-1.5 rounded-full ${service.kind === "backend" ? "bg-primary" : "bg-primary"}`}></span><strong class="min-w-0 truncate font-sans text-[12px] text-ink">{service.kind === "listener" ? `localhost:${service.port}` : service.processName}</strong>{#if service.url}<button type="button" aria-label={`Open ${service.url}`} class="ml-auto text-muted hover:text-ink" onclick={() => onopenurl(service.url!)}><ExternalLink size={11} /></button>{/if}</div>
								<small class="mt-1.5 block truncate font-sans text-[11px] text-muted" title={service.cwd}>{service.kind === "listener" ? service.processName : "current workspace"}{service.pid > 0 ? ` / pid ${service.pid}` : ""}</small>
								<small class="mt-1 block truncate font-sans text-[11px] text-dim" title={service.cwd}>{service.cwd}</small>
								{#if service.url}<button type="button" class="mt-2 max-w-full truncate rounded border border-info bg-info-soft px-2 py-1 font-sans text-[11px] text-info hover:bg-info-soft hover:text-ink" title={service.url} onclick={() => onopenurl(service.url!)}>{service.url}</button>{/if}
							</div>
						{/each}
					</div>
				</div>
			{:else if tab === "logs"}
				<div class="h-full overflow-auto bg-panel p-3 [scrollbar-width:thin]">{#if logs.length === 0}<p class="font-mono text-[12px] text-muted">No recent command or error activity.</p>{:else}<pre class="m-0 font-mono text-[12px]/[1.6] whitespace-pre-wrap text-ink">{logs.join("\n\n")}</pre>{/if}</div>
			{:else}
				<div class="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_38px] bg-bg">
					<div bind:this={terminalEl} class="min-h-0 overflow-auto p-3 [scrollbar-width:thin]"><pre class="m-0 font-mono text-[12px]/[1.55] whitespace-pre-wrap text-ink">{terminalOutput || "Run a command in the current workspace.\n"}{#if terminalBusy}<span class="text-warning">running...</span>{/if}</pre></div>
					<div class="flex items-center gap-2 border-t border-line bg-panel px-2">
						<span class="font-sans text-[13px] text-info">$</span>
						<input bind:value={command} disabled={terminalBusy || status.state !== "online"} aria-label="Workspace terminal command" placeholder={terminalBusy ? "Command running..." : "Run in workspace root"} class="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-dim disabled:cursor-not-allowed" onkeydown={handleCommandKeydown} />
						<span class="hidden font-mono text-[11px] text-dim narrow-720:inline">fresh shell per command</span>
						{#if terminalBusy}<button type="button" class="flex h-7 items-center gap-1 rounded border border-danger bg-danger-soft px-2 font-mono text-[11px] text-danger hover:bg-danger-soft" onclick={onstopcommand}><Square size={9} fill="currentColor" /> Stop</button>{:else}<button type="button" class="h-7 rounded border border-line px-2 font-mono text-[11px] text-muted hover:bg-raised hover:text-ink" onclick={onclearterminal}>Clear</button><button type="button" disabled={!command.trim()} class="h-7 rounded border border-info bg-info-soft px-2.5 font-mono text-[11px] font-semibold text-ink hover:bg-info-soft disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-dim" onclick={submitCommand}>Run</button>{/if}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</section>
