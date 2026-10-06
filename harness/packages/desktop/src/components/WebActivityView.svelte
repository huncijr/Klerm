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

<section aria-label="External browser" class="flex min-h-0 flex-1 flex-col border-t border-line bg-bg">
	<header class="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
		<Globe2 size={13} class="text-info" />
		<span class="text-[12px] font-semibold text-ink">External browser</span>
		<a href={url} target="_blank" rel="noopener noreferrer" class="ml-auto truncate font-sans text-[11px] text-info" title={url}><ExternalLink size={11} /></a>
		<button type="button" aria-label="Close web activity" class="text-muted hover:text-ink" onclick={onclose}><X size={13} /></button>
	</header>
	<div class="min-w-0 truncate border-b border-line px-3 py-1 font-sans text-[11px] text-muted" title={pageUrl || url}>{pageUrl || url}</div>
	<button type="button" aria-label="Interactive external browser page" bind:this={surface} class="relative block min-h-0 w-full flex-1 bg-primary p-0 text-left" onpointermove={(event) => pointer(event, "move")} onpointerdown={(event) => pointer(event, "down")} onpointerup={(event) => pointer(event, "up")} onwheel={wheel}>
		{#if frame}<img src={frame} alt="Page opened by agent web tool" draggable="false" class="h-full w-full select-none" />{:else}<p class="p-3 text-[12px] text-muted">{error || "Opening page…"}</p>{/if}
	</button>
	<div class="group relative shrink-0 border-t border-line px-3 py-2">
		<button type="button" class="flex items-center gap-1.5 text-[12px] text-info" aria-label="Show website sources"><Globe2 size={11} /> Source <span class="text-muted">{sources.length}</span></button>
		<div class="absolute right-2 bottom-full left-2 z-40 hidden max-h-64 flex-wrap gap-1 overflow-y-auto rounded-lg border border-line bg-panel p-2 shadow-xl group-hover:flex group-focus-within:flex" aria-label="Website sources">
			{#each [...sources].reverse() as source (source)}
				{@const identity = webSourceIdentity(source)}
				<button type="button" onclick={() => void command({ type: "navigate", url: source })} class="flex min-w-0 items-center gap-1.5 rounded-full border border-line px-2 py-1.5 hover:bg-raised focus-visible:bg-raised" title={source}>
					<span class="relative grid h-5 w-5 shrink-0 place-items-center"><Globe2 size={14} class="text-muted" /><img src={identity.icon} alt="" referrerpolicy="no-referrer" class="absolute h-4 w-4" onerror={(event) => { if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.style.display = "none"; }} /></span>
					<span class="max-w-48 truncate font-sans text-[12px] text-ink">{source.replace(/^https?:\/\//, "").replace(/^www\./, "")}</span>
				</button>
			{/each}
		</div>
	</div>
</section>
