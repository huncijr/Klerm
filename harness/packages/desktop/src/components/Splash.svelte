<script lang="ts">
	let { visible }: { visible: boolean } = $props();
</script>

<div
	aria-label="Klerm is starting"
	class={`fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-bg transition-[opacity,visibility] duration-500 ${
		visible ? "" : "pointer-events-none invisible opacity-0"
	}`}
>
	<img
		src="/K_Klerm_no_background.png"
		alt="Klerm"
		class="relative h-16 w-16 object-contain"
	/>
	<div
		class="absolute bottom-[12vh] flex items-center gap-2.5 text-[13px] text-muted"
	>
		<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"></span>
		Starting local workspace
	</div>
</div>
