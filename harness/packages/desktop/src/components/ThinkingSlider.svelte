<script lang="ts">
	import type { ThinkingLevel } from "../lib/model.ts";

	let {
		label,
		levels,
		value,
		disabled,
		onchange,
	}: {
		label: string;
		levels: ThinkingLevel[];
		value: ThinkingLevel;
		disabled: boolean;
		onchange: (level: ThinkingLevel) => void;
	} = $props();

	const selectedIndex = $derived(Math.max(0, levels.indexOf(value)));

	function commit(event: Event): void {
		const index = Number((event.currentTarget as HTMLInputElement).value);
		const level = levels[index];
		if (level && level !== value) onchange(level);
	}
</script>

<div class="mt-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 narrow-520:px-[7px]">
	<div class="mb-0.5 flex items-center justify-between font-sans text-[11px] tracking-[.08em] uppercase">
		<span class="text-dim">{label}</span>
		<span class="text-ink">{value}</span>
	</div>
	<input
		type="range"
		min="0"
		max={Math.max(0, levels.length - 1)}
		step="1"
		value={selectedIndex}
		{disabled}
		aria-label={label}
		aria-valuetext={value}
		class="block h-2.5 w-full cursor-pointer accent-warning disabled:cursor-not-allowed disabled:opacity-40"
		onchange={commit}
	/>
</div>
