<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { listen, type UnlistenFn } from "@tauri-apps/api/event";
	import { ExternalLink, Globe2, X } from "@lucide/svelte";
	import { onMount } from "svelte";

	let { sessionId, url, onclose }: { sessionId: string; url: string; onclose: () => void } = $props();
	let surface: HTMLElement;
	let frame = $state("");
	let pageUrl = $state("");
	let error = $state("");
	let ready = $state(false);
	const hostId = $derived(`${sessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 110)}_web`);

	async function command(value: Record<string, unknown>): Promise<void> {
		await invoke("browser_host_command", { sessionId: hostId, command: value });
	}

	onMount(() => {
		let mounted = true;
		let unlisten: UnlistenFn | undefined;
		const observer = new ResizeObserver((entries) => {
			const size = entries[0]?.contentRect;
			if (size && ready) void command({ type: "resize", width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) }).catch(() => undefined);
		});
		void (async () => {
			try {
				unlisten = await listen<{ sessionId: string; event: { type: string; data?: string; url?: string; message?: string } }>("klerm://browser-host", ({ payload }) => {
					if (!mounted || payload.sessionId !== hostId) return;
					if (payload.event.type === "frame" && payload.event.data) frame = `data:image/png;base64,${payload.event.data}`;
					if (payload.event.type === "url" && payload.event.url) pageUrl = payload.event.url;
					if (payload.event.type === "crash" || payload.event.type === "error") {
						ready = false;
						error = payload.event.message ?? "Web preview stopped.";
					}
				});
				await invoke("start_browser_host", { sessionId: hostId });
				if (!mounted) return;
				ready = true;
				observer.observe(surface);
				const size = surface.getBoundingClientRect();
				await command({ type: "resize", width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) });
				await command({ type: "visible", visible: true });
			} catch (cause) {
				if (mounted) error = cause instanceof Error ? cause.message : String(cause);
			}
		})();
		return () => {
			mounted = false;
			observer.disconnect();
			unlisten?.();
			if (ready) void command({ type: "visible", visible: false }).catch(() => undefined);
		};
	});

	$effect(() => {
		if (!ready || !url) return;
		void command({ type: "navigate", url }).catch((cause) => { error = cause instanceof Error ? cause.message : String(cause); });
	});
</script>

<section aria-label="Agent web activity" class="flex min-h-0 flex-1 flex-col border-t border-[#34424d] bg-[#0b1116]">
	<header class="flex h-9 shrink-0 items-center gap-2 border-b border-[#27343b] px-3">
		<Globe2 size={13} class="text-[#8fc4ed]" />
		<span class="text-[10px] font-semibold text-[#cbd9dd]">Agent web activity</span>
		<a href={url} target="_blank" rel="noopener noreferrer" class="ml-auto truncate font-mono text-[8px] text-[#8fc4ed]" title={url}><ExternalLink size={11} /></a>
		<button type="button" aria-label="Close web activity" class="text-[#84939a] hover:text-white" onclick={onclose}><X size={13} /></button>
	</header>
	<div class="min-w-0 truncate border-b border-[#27343b] px-3 py-1 font-mono text-[8px] text-[#81949b]" title={pageUrl || url}>{pageUrl || url}</div>
	<div bind:this={surface} class="relative min-h-0 flex-1 bg-white">
		{#if frame}<img src={frame} alt="Page opened by agent web tool" draggable="false" class="h-full w-full select-none" />{:else}<p class="p-3 text-[10px] text-[#68818a]">{error || "Opening page…"}</p>{/if}
	</div>
</section>
