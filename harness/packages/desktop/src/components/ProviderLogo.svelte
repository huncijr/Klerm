<script lang="ts">
	import { providerLogoSrc } from "../lib/provider-logos.ts";

	let { id, label, size = 36, decorative = false }: { id: string; label: string; size?: number; decorative?: boolean } = $props();

	let failed = $state(false);
	const src = $derived(providerLogoSrc(id));
</script>

{#if src && !failed}
	<img
		src={src}
		alt={decorative ? "" : `${label} logo`}
		aria-hidden={decorative}
		width={size}
		height={size}
		class={`shrink-0 rounded-md object-contain ${id === "openai" || id === "openai-codex" ? "bg-logo-plate p-1" : ""}`}
		onerror={() => (failed = true)}
	/>
{:else}
	<span
		class="grid shrink-0 place-items-center rounded-lg bg-panel font-sans text-ink"
		style={`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`}
		aria-label={decorative ? undefined : label}
		aria-hidden={decorative}
	>
		{label.slice(0, 1).toUpperCase()}
	</span>
{/if}
