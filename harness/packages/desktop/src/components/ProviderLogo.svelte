<script lang="ts">
	import { providerLogoSrc } from "../lib/provider-logos.ts";

	let { id, label, size = 36 }: { id: string; label: string; size?: number } = $props();

	let failed = $state(false);
	const src = $derived(providerLogoSrc(id));
</script>

{#if src && !failed}
	<img
		src={src}
		alt={`${label} logo`}
		width={size}
		height={size}
		class="shrink-0 rounded-lg object-contain"
		onerror={() => (failed = true)}
	/>
{:else}
	<span
		class="grid shrink-0 place-items-center rounded-lg bg-[#141a1f] font-mono text-[#d7e7ff]"
		style={`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`}
		aria-label={label}
	>
		{label.slice(0, 1).toUpperCase()}
	</span>
{/if}
