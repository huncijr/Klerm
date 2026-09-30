<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { listen, type UnlistenFn } from "@tauri-apps/api/event";
	import { ExternalLink, Globe2, X } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { webSourceIdentity } from "../lib/web-activity.ts";

	let { sessionId, url, sources, onclose, openRequest = 0 }: { sessionId: string; url: string; sources: string[]; onclose: () => void; openRequest?: number } = $props();
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
		openRequest;
		if (!ready || !url) return;
		void command({ type: "navigate", url }).catch((cause) => { error = cause instanceof Error ? cause.message : String(cause); });
	});

	function pointer(event: PointerEvent, kind: "move" | "down" | "up"): void {
		if (!ready) return;
		const bounds = surface.getBoundingClientRect();
		void command({ type: "mouse", kind, x: Math.round(event.clientX - bounds.left), y: Math.round(event.clientY - bounds.top), button: event.button === 2 ? "right" : "left" }).catch((cause) => { error = String(cause); });
	}
	function wheel(event: WheelEvent): void {
		if (!ready) return;
		event.preventDefault();
		const bounds = surface.getBoundingClientRect();
		void command({ type: "mouse", kind: "wheel", x: Math.round(event.clientX - bounds.left), y: Math.round(event.clientY - bounds.top), delta_y: Math.round(-event.deltaY) }).catch((cause) => { error = String(cause); });
	}
</script>

<section aria-label="External browser" class="flex min-h-0 flex-1 flex-col border-t border-[#34424d] bg-[#0b1116]">
	<header class="flex h-9 shrink-0 items-center gap-2 border-b border-[#27343b] px-3">
		<Globe2 size={13} class="text-[#8fc4ed]" />
		<span class="text-[10px] font-semibold text-[#cbd9dd]">External browser</span>
		<a href={url} target="_blank" rel="noopener noreferrer" class="ml-auto truncate font-mono text-[8px] text-[#8fc4ed]" title={url}><ExternalLink size={11} /></a>
		<button type="button" aria-label="Close web activity" class="text-[#84939a] hover:text-white" onclick={onclose}><X size={13} /></button>
	</header>
	<div class="min-w-0 truncate border-b border-[#27343b] px-3 py-1 font-mono text-[8px] text-[#81949b]" title={pageUrl || url}>{pageUrl || url}</div>
	<button type="button" aria-label="Interactive external browser page" bind:this={surface} class="relative block min-h-0 w-full flex-1 bg-white p-0 text-left" onpointermove={(event) => pointer(event, "move")} onpointerdown={(event) => pointer(event, "down")} onpointerup={(event) => pointer(event, "up")} onwheel={wheel}>
		{#if frame}<img src={frame} alt="Page opened by agent web tool" draggable="false" class="h-full w-full select-none" />{:else}<p class="p-3 text-[10px] text-[#68818a]">{error || "Opening page…"}</p>{/if}
	</button>
	<div class="group relative shrink-0 border-t border-[#27343b] px-3 py-2">
		<button type="button" class="flex items-center gap-1.5 text-[9px] text-[#8fc4ed]" aria-label="Show website sources"><Globe2 size={11} /> Source <span class="text-[#81949b]">{sources.length}</span></button>
		<div class="absolute right-2 bottom-full left-2 z-40 hidden max-h-64 flex-wrap gap-1 overflow-y-auto rounded-lg border border-[#34424d] bg-[#10171d] p-2 shadow-xl group-hover:flex group-focus-within:flex" aria-label="Website sources">
			{#each [...sources].reverse() as source (source)}
				{@const identity = webSourceIdentity(source)}
				<button type="button" onclick={() => void command({ type: "navigate", url: source })} class="flex min-w-0 items-center gap-1.5 rounded-full border border-[#34424d] px-2 py-1.5 hover:bg-[#1c2933] focus-visible:bg-[#1c2933]" title={source}>
					<span class="relative grid h-5 w-5 shrink-0 place-items-center"><Globe2 size={14} class="text-[#81949b]" /><img src={identity.icon} alt="" referrerpolicy="no-referrer" class="absolute h-4 w-4" onerror={(event) => { if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.style.display = "none"; }} /></span>
					<span class="max-w-48 truncate font-mono text-[9px] text-[#cbd9dd]">{source.replace(/^https?:\/\//, "").replace(/^www\./, "")}</span>
				</button>
			{/each}
		</div>
	</div>
</section>
