<script lang="ts">
	import { onMount } from "svelte";
	import type { SelectOption } from "../lib/model.ts";

	let {
		label,
		options,
		value,
		disabled,
		placeholder,
		alignRight = false,
		onchange,
	}: {
		label: string;
		options: SelectOption[];
		value: string;
		disabled: boolean;
		placeholder: string;
		alignRight?: boolean;
		onchange: (value: string) => void;
	} = $props();

	let open = $state(false);
	let rootEl: HTMLElement | undefined = $state();

	const selected = $derived(options.find((option) => option.value === value));
	const displayLabel = $derived(selected?.label ?? options[0]?.label ?? placeholder);

	onMount(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || !rootEl?.contains(event.target)) open = false;
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	});

	function toggle(): void {
		if (disabled) return;
		open = !open;
	}

	function select(option: SelectOption): void {
		if (!option.value) return;
		open = false;
		onchange(option.value);
	}

	function handleButtonKeydown(event: KeyboardEvent): void {
		if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			toggle();
		}
	}

	function handleMenuKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			open = false;
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const menu = rootEl?.querySelector<HTMLDivElement>("[role=listbox]");
		if (!menu) return;
		const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
		const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const offset = event.key === "ArrowDown" ? 1 : -1;
		buttons[(currentIndex + offset + buttons.length) % buttons.length]?.focus();
	}
</script>

<div class="min-w-0 rounded-lg border border-line bg-panel px-2.5 pt-2 pb-1.5 narrow-520:px-[7px] narrow-520:pt-1.5 narrow-520:pb-[5px]">
	<span class="block font-mono text-[8px] tracking-[.1em] text-[#59636b] uppercase narrow-520:text-[6px]">{label}</span>
	<div bind:this={rootEl} class="relative mt-[3px] min-w-0">
		<button
			type="button"
			{disabled}
			aria-haspopup="listbox"
			aria-expanded={open}
			class={`flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-[3px] text-left text-[10px] outline-0 focus-visible:text-[#f1f4f5] enabled:hover:text-[#f1f4f5] disabled:cursor-not-allowed disabled:text-[#59635c] ${
				disabled ? "" : "text-[#b7c0c6]"
			}`}
			onclick={toggle}
			onkeydown={handleButtonKeydown}
		>
			<span class="min-w-0 truncate" title={selected?.label ?? ""}>{displayLabel}</span>
			<i
				class={`h-1.75 w-1.75 shrink-0 border-r border-b border-[#6f7a82] transition-transform duration-150 ${
					open ? "-translate-x-[2px] -translate-y-[1px] rotate-[225deg]" : "translate-y-[-2px] rotate-45"
				}`}
			></i>
		</button>
		{#if open}
			<div
				role="listbox"
				tabindex="-1"
				class={`absolute bottom-[calc(100%+12px)] z-30 max-h-[min(280px,45vh)] overflow-y-auto rounded-lg border border-[#303941] bg-[#0b0f13] p-[5px] shadow-[0_18px_55px_rgba(0,0,0,.62)] [scrollbar-width:thin] ${
					alignRight
						? "left-auto right-[-6px] w-[max(100%,190px)] max-w-[calc(100vw-24px)]"
						: "left-[-12px] right-[-12px]"
				}`}
				onkeydown={handleMenuKeydown}
			>
				{#each options as option (option.value || option.label)}
					<button
						type="button"
						role="option"
						aria-selected={option.value === value}
						disabled={!option.value}
						class={`block w-full cursor-pointer truncate rounded-md border-0 px-2.5 py-[9px] text-left text-[10px] focus-visible:bg-[#1a2026] focus-visible:text-[#f1f4f5] focus-visible:outline-0 enabled:hover:bg-[#1a2026] enabled:hover:text-[#f1f4f5] disabled:cursor-default disabled:text-[#535d64] ${
							option.value === value ? "bg-[#171d22] text-[#f1f4f5]" : "bg-transparent text-[#aeb7bd]"
						}`}
						onclick={() => select(option)}
					>
						{option.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
