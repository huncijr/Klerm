<script lang="ts">
	import { onMount, tick } from "svelte";
	import type { PersonalBot, SelectOption } from "../lib/model.ts";
	import { profileIcon } from "../lib/profiles.ts";

	let {
		label,
		options,
		value,
		disabled,
		placeholder,
		onchange,
		memories = [],
		selectedMemoryId,
		onmemory,
		flyout = "right",
		direction = "up",
		allowEmpty = false,
		emptyLabel = "None",
	}: {
		label: string;
		options: SelectOption[];
		value: string;
		disabled: boolean;
		placeholder: string;
		onchange: (value: string) => void;
		memories?: PersonalBot[];
		selectedMemoryId?: string;
		onmemory?: (model: string, botId: string) => void;
		flyout?: "left" | "right";
		direction?: "up" | "down";
		allowEmpty?: boolean;
		emptyLabel?: string;
	} = $props();

	let open = $state(false);
	let hovered = $state("");
	let query = $state("");
	let queryInput: HTMLInputElement | undefined = $state();
	let rootEl: HTMLElement | undefined = $state();
	let buttonEl: HTMLButtonElement | undefined = $state();

	const selected = $derived(options.find((option) => option.value === value));
	const displayLabel = $derived(selected?.label ?? placeholder);
	const selectedMemory = $derived(memories.find((memory) => memory.id === selectedMemoryId));
	const filteredOptions = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return options;
		return options.filter(
			(option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
		);
	});

	$effect(() => {
		if (disabled) open = false;
	});

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
		if (open) {
			query = "";
			void tick().then(() => queryInput?.focus());
		}
	}

	function select(option: SelectOption): void {
		if (disabled) return;
		if (!option.value && !allowEmpty) return;
		open = false;
		hovered = "";
		onchange(option.value);
		buttonEl?.focus();
	}

	function selectMemory(botId: string): void {
		if (!hovered || !onmemory) return;
		open = false;
		onmemory(hovered, botId);
		hovered = "";
		buttonEl?.focus();
	}

	function handleButtonKeydown(event: KeyboardEvent): void {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (disabled) return;
			open = true;
			void tick().then(() => {
				const buttons = rootEl?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)");
				buttons?.[event.key === "ArrowDown" ? 0 : buttons.length - 1]?.focus();
			});
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			toggle();
			return;
		}
		if (event.key === "Escape" && open) {
			event.preventDefault();
			open = false;
		}
	}

	function handleMenuKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			open = false;
			buttonEl?.focus();
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
			return;
		}
		event.preventDefault();
		const menu = rootEl?.querySelector<HTMLDivElement>("[role=listbox]");
		if (!menu) return;
		const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
		const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === "Home" || event.key === "End") {
			buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
			return;
		}
		const offset = event.key === "ArrowDown" ? 1 : -1;
		buttons[(currentIndex + offset + buttons.length) % buttons.length]?.focus();
	}
</script>

<div class="min-w-0 rounded-lg border border-line bg-panel px-2.5 pt-2 pb-1.5 narrow-520:px-[7px] narrow-520:pt-1.5 narrow-520:pb-[5px]">
	<span class="block font-mono text-[8px] tracking-[.1em] text-[#59636b] uppercase narrow-520:text-[6px]">{label}</span>
	<div bind:this={rootEl} class="relative mt-[3px] min-w-0">
		<button
			bind:this={buttonEl}
			type="button"
			{disabled}
			aria-label={label}
			aria-haspopup="listbox"
			aria-expanded={open}
			class={`flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-[3px] text-left text-[10px] outline-0 focus-visible:text-[#f1f4f5] enabled:hover:text-[#f1f4f5] enabled:active:opacity-60 disabled:cursor-not-allowed disabled:text-[#59635c] ${
				disabled ? "" : "text-[#b7c0c6]"
			}`}
			onclick={toggle}
			onkeydown={handleButtonKeydown}
		>
			<span class="flex min-w-0 items-center gap-1.5" title={selected?.label ?? ""}>
				{#if selectedMemory}<span class="shrink-0 text-[12px]">{profileIcon(selectedMemory.face)}</span>{/if}
				<span class="min-w-0 truncate">{displayLabel}</span>
			</span>
			<i
				class={`h-1.75 w-1.75 shrink-0 border-r border-b border-[#6f7a82] transition-transform duration-150 ${
					open ? "-translate-x-[2px] -translate-y-[1px] rotate-[225deg]" : "translate-y-[-2px] rotate-45"
				}`}
			></i>
		</button>
		{#if open}
			<div class="absolute right-0 left-0 z-30" class:top-[calc(100%+8px)]={direction === "down"} class:bottom-[calc(100%+12px)]={direction === "up"}>
				<div
					role="listbox"
					aria-label={`${label} options`}
					tabindex="-1"
					class="max-h-[min(280px,45vh)] overflow-y-auto rounded-lg border border-[#1b2228] bg-[#05080b] p-[5px] shadow-[0_18px_55px_rgba(0,0,0,.62)]"
					onkeydown={handleMenuKeydown}
				>
					<input
						bind:this={queryInput}
						bind:value={query}
						type="text"
						placeholder="Search models..."
						aria-label={`Search ${label} options`}
						class="mb-1 h-7 w-full rounded-md border border-[#2d3740] bg-[#0b1014] px-2 font-mono text-[9px] text-[#e5eaed] outline-0 placeholder:text-[#59636b] focus:border-[#4a5861]"
						onkeydown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								open = false;
								buttonEl?.focus();
							} else if (event.key === "Enter") {
								event.preventDefault();
								const first = filteredOptions.find((option) => option.value);
								if (first) select(first);
							} else if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
								event.stopPropagation();
							}
						}}
					/>
					{#if allowEmpty}
						<button
							type="button"
							role="option"
							aria-selected={value === ""}
							disabled={disabled}
							class={`block w-full cursor-pointer truncate rounded-md border-0 px-2.5 py-[9px] text-left text-[10px] focus-visible:bg-[#141a1f] focus-visible:text-[#f1f4f5] focus-visible:outline-0 enabled:hover:bg-[#141a1f] enabled:hover:text-[#f1f4f5] disabled:cursor-default disabled:text-[#535d64] ${
								value === "" ? "bg-[#141a1f] text-[#f1f4f5]" : "bg-transparent text-[#77828a]"
							}`}
							onmouseenter={() => hovered = ""}
							onclick={() => select({ value: "", label: emptyLabel })}
						>
							{emptyLabel}
						</button>
					{/if}
					{#each filteredOptions as option (option.value || option.label)}
						<button
							type="button"
							role="option"
							aria-selected={option.value === value}
							disabled={disabled || !option.value}
							class={`block w-full cursor-pointer truncate rounded-md border-0 px-2.5 py-[9px] text-left text-[10px] focus-visible:bg-[#141a1f] focus-visible:text-[#f1f4f5] focus-visible:outline-0 enabled:hover:bg-[#141a1f] enabled:hover:text-[#f1f4f5] disabled:cursor-default disabled:text-[#535d64] ${
								option.value === value || option.value === hovered ? "bg-[#141a1f] text-[#f1f4f5]" : "bg-transparent text-[#aeb7bd]"
							}`}
							onmouseenter={() => {
								if (option.value) hovered = option.value;
							}}
							onclick={() => select(option)}
							>
							{option.label}
							</button>
							{/each}
							{#if filteredOptions.length === 0}
							<p class="m-0 px-2.5 py-2 font-mono text-[9px] text-[#59636b]">No models match "{query.trim()}".</p>
							{/if}
				</div>
				{#if memories.length > 0 && hovered}
					<div class={`absolute top-0 w-[158px] rounded-lg border border-[#1b2228] bg-[#05080b] p-1 shadow-[0_18px_55px_rgba(0,0,0,.62)] ${flyout === "left" ? "right-[calc(100%+6px)]" : "left-[calc(100%+6px)]"}`}>
						<p class="px-2 py-1 font-mono text-[7px] tracking-[.12em] text-[#66747d] uppercase">Memories</p>
						{#each memories as memory (memory.id)}
							<button
								type="button"
								class={`flex w-full cursor-pointer items-center gap-2 rounded-md border-0 px-2 py-1.5 text-left font-mono text-[10px] hover:bg-[#141a1f] ${selectedMemoryId === memory.id ? "bg-[#141a1f] text-white" : "text-[#d7dfe2]"}`}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => selectMemory(memory.id)}
							>
								<span>{profileIcon(memory.face)}</span>
								<span class="truncate">{memory.name}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
