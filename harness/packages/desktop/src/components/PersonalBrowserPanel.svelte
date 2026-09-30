<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { listen, type UnlistenFn } from "@tauri-apps/api/event";
	import { onMount } from "svelte";
	import type { BrowserRunState } from "../lib/model.ts";
	let { botId, run, onattach, oncommand }: {
		botId: string; run?: BrowserRunState;
		onattach: (botId: string, cdpUrl: string) => Promise<void>;
		oncommand: (command: string, input: Record<string, unknown>) => Promise<void>;
	} = $props();
	let frame = $state("");
	let error = $state("");
	let ready = $state(false);
	let expanded = $state(false);
	let surface: HTMLButtonElement;
	const owner = $derived(`personal-${botId}`);
	const active = $derived(run && ["queued", "running", "waiting-approval"].includes(run.status));
	async function control(type: string, extra: Record<string, unknown> = {}): Promise<void> {
		if (!run) return;
		try { await oncommand(type, { runId: run.runId, ...extra }); } catch (cause) { error = String(cause); }
	}
	async function host(command: Record<string, unknown>): Promise<void> { await invoke("browser_host_command", { sessionId: owner, command }); }
	onMount(() => {
		let alive = true;
		let unlisten: UnlistenFn | undefined;
		const resize = new ResizeObserver((entries) => { const rect = entries[0]?.contentRect; if (ready && rect) void host({ type: "resize", width: Math.round(rect.width), height: Math.round(rect.height) }); });
		void (async () => {
			try {
				unlisten = await listen<{ sessionId: string; event: { type: string; data?: string; message?: string } }>("klerm://browser-host", ({ payload }) => {
					if (!alive || payload.sessionId !== owner) return;
					if (payload.event.type === "frame" && payload.event.data) frame = `data:image/png;base64,${payload.event.data}`;
					if (["error", "crash"].includes(payload.event.type)) { ready = false; error = payload.event.message ?? "Browser stopped."; if (run) void oncommand("report_browser_host_crash", { runId: run.runId }).catch(() => undefined); }
				});
				const result = await invoke<{ cdpUrl: string }>("start_browser_host", { sessionId: owner });
				if (!alive) { unlisten?.(); return; }
				await onattach(botId, result.cdpUrl);
				if (!alive) { await host({ type: "visible", visible: false }); return; }
				ready = true;
				resize.observe(surface);
				const rect = surface.getBoundingClientRect();
				await host({ type: "resize", width: Math.round(rect.width), height: Math.round(rect.height) });
				await host({ type: "visible", visible: true });
			} catch (cause) { if (alive) error = String(cause); }
		})();
		return () => { alive = false; resize.disconnect(); unlisten?.(); void host({ type: "visible", visible: false }).catch(() => undefined); };
	});
	function pointer(event: PointerEvent, kind: string): void {
		if (!ready) return;
		if (active && run?.control !== "human") { if (kind === "down") void control("request_browser_takeover", { reason: "Human input in Personal Agent browser." }); return; }
		const rect = surface.getBoundingClientRect();
		void host({ type: "mouse", kind, x: Math.round(event.clientX - rect.left), y: Math.round(event.clientY - rect.top), button: event.button === 2 ? "right" : "left" });
	}
	function wheel(event: WheelEvent): void {
		if (!ready) return;
		event.preventDefault();
		if (active && run?.control !== "human") { void control("request_browser_takeover", { reason: "Human scrolling in Personal Agent browser." }); return; }
		const rect = surface.getBoundingClientRect();
		void host({ type: "mouse", kind: "wheel", x: Math.round(event.clientX - rect.left), y: Math.round(event.clientY - rect.top), delta_y: Math.round(-event.deltaY) });
	}
	function key(event: KeyboardEvent): void {
		if (!ready) return;
		event.preventDefault();
		if (active && run?.control !== "human") { void control("request_browser_takeover", { reason: "Human keyboard input in Personal Agent browser." }); return; }
		void host({ type: "key", kind: "down", key: event.key });
		if (event.key.length === 1) void host({ type: "key", kind: "char", key: event.key });
		void host({ type: "key", kind: "up", key: event.key });
	}
</script>

<section class={expanded ? "fixed inset-5 z-50 flex flex-col rounded-xl border border-[#34424d] bg-[#0b1116] p-2 shadow-2xl" : "my-3 flex h-64 w-full max-w-lg flex-col rounded-xl border border-[#34424d] bg-[#0b1116] p-2"} aria-label="Personal Agent browser">
	<header class="flex shrink-0 items-center gap-2 px-1 py-1 text-[10px] text-[#cbd9dd]"><strong>Browser · {run?.model ?? "Ready"}</strong><button type="button" class="ml-auto text-[#8fc4ed]" onclick={() => (expanded = !expanded)}>{expanded ? "Minimize" : "Expand"}</button></header>
	{#if active}<div class="flex shrink-0 gap-2 py-1 text-[9px] text-[#a9c29b]"><span>{run?.control === "human" ? "You are in control" : run?.control === "pausing" ? "Pausing AI…" : "AI working"}</span>{#if run?.control === "human"}<button type="button" onclick={() => void control("resume_browser_run")}>Continue</button>{:else if run?.control === "ai"}<button type="button" onclick={() => void control("request_browser_takeover")}>Take control</button>{/if}<button type="button" class="text-[#e7aaa4]" onclick={() => void control("stop_browser_run")}>Stop</button></div>{/if}
	{#if run?.pendingAction}<div class="shrink-0 text-[9px] text-[#e3c06b]">Approve {run.pendingAction.action}? <button type="button" onclick={() => void control("resolve_browser_action", { actionId: run.pendingAction!.actionId, decision: "approved" })}>Allow once</button><button type="button" onclick={() => void control("resolve_browser_action", { actionId: run.pendingAction!.actionId, decision: "denied" })}>Deny</button></div>{/if}
	<button type="button" bind:this={surface} class="relative block min-h-0 w-full flex-1 overflow-hidden bg-[#0b1116] p-0 text-left" aria-label="Personal Agent Chromium page" onpointermove={(event) => pointer(event, "move")} onpointerdown={(event) => pointer(event, "down")} onpointerup={(event) => pointer(event, "up")} onwheel={wheel} onkeydown={key}>{#if frame}<img src={frame} alt="Personal Agent browser page" class="h-full w-full" draggable="false" />{:else}<span class="block p-3 text-[10px] text-[#81949b]">{error || "Starting browser…"}</span>{/if}{#if active && run?.control === "ai" && run.agentCursor}<span class="pointer-events-none absolute text-[9px] text-[#d6fa9c]" style={`left: ${run.agentCursor.x}px; top: ${run.agentCursor.y}px;`}>◆ {run.model.split("/").at(-1)} · {run.agentCursor.action}</span>{/if}</button>
	{#if error || run?.error}<p class="m-0 shrink-0 text-[9px] text-[#e7aaa4]">{error || run?.error}</p>{/if}
</section>
