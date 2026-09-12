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
		class="shrink-0 rounded-lg object-contain"
		onerror={() => (failed = true)}
	/>
{:else}
	<span
		class="grid shrink-0 place-items-center rounded-lg bg-[#141a1f] font-mono text-[#d7e7ff]"
		style={`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`}
		aria-label={decorative ? undefined : label}
		aria-hidden={decorative}
	>
		{label.slice(0, 1).toUpperCase()}
	</span>
{/if}
