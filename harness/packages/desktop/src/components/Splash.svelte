<script lang="ts">
	let { visible }: { visible: boolean } = $props();
</script>

<div
	aria-label="Klerm is starting"
	class={`fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#030506] transition-[opacity,visibility] duration-500 ${
		visible ? "" : "pointer-events-none invisible opacity-0"
	}`}
>
	<div
		class="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(circle_at_center,black,transparent_68%)]"
	></div>
	<div class="absolute aspect-square w-[42vw] rounded-full bg-[rgba(214,255,63,.09)] blur-[100px]"></div>
	<img
		src="/Klerm_logo.png"
		alt="Klerm"
		class="relative w-[min(580px,72vw)] animate-[reveal_.9s_cubic-bezier(.2,.8,.2,1)_both] rounded-3xl shadow-[0_32px_90px_rgba(0,0,0,.6)]"
	/>
	<div
		class="absolute bottom-[9vh] flex items-center gap-2.5 font-mono text-[11px] tracking-[.14em] text-[#7e898f] uppercase"
	>
		<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)]"></span>
		Starting local workspace
	</div>
</div>
