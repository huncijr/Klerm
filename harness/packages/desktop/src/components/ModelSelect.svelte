<script lang="ts">
	import { onMount, tick } from "svelte";
	import type { SelectOption } from "../lib/model.ts";

	let {
		label,
		options,
		value,
		disabled,
		placeholder,
		onchange,
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
		direction?: "up" | "down";
		allowEmpty?: boolean;
		emptyLabel?: string;
	} = $props();

	let open = $state(false);
	let query = $state("");
	let queryInput: HTMLInputElement | undefined = $state();
	let rootEl: HTMLElement | undefined = $state();
	let buttonEl: HTMLButtonElement | undefined = $state();

	const selected = $derived(options.find((option) => option.value === value));
	const displayLabel = $derived(selected?.label ?? placeholder);
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
		onchange(option.value);
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
	{#if label}<span class="block text-[11px] font-medium text-muted">{label}</span>{/if}
	<div bind:this={rootEl} class="relative mt-[3px] min-w-0">
		<button
			bind:this={buttonEl}
			type="button"
			{disabled}
			aria-label={label}
			aria-haspopup="listbox"
			aria-expanded={open}
			class={`flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-[3px] text-left text-[12px] outline-0 focus-visible:text-ink enabled:hover:text-ink enabled:active:opacity-60 disabled:cursor-not-allowed disabled:text-dim ${
				disabled ? "" : "text-ink"
			}`}
			onclick={toggle}
			onkeydown={handleButtonKeydown}
		>
			<span class="min-w-0 truncate" title={selected?.label ?? ""}>{displayLabel}</span>
			<i
				class={`h-1.75 w-1.75 shrink-0 border-r border-b border-line transition-transform duration-150 ${
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
					class="max-h-[min(280px,45vh)] overflow-y-auto rounded-lg border border-line-soft bg-bg p-[5px] shadow-sm"
					onkeydown={handleMenuKeydown}
				>
					<input
						bind:this={queryInput}
						bind:value={query}
						type="text"
						placeholder="Search models..."
						aria-label={`Search ${label} options`}
						class="mb-1 h-7 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0 placeholder:text-dim focus:border-line"
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
							class={`block w-full cursor-pointer truncate rounded-md border-0 px-2.5 py-[9px] text-left text-[12px] focus-visible:bg-panel focus-visible:text-ink focus-visible:outline-0 enabled:hover:bg-panel enabled:hover:text-ink disabled:cursor-default disabled:text-dim ${
								value === "" ? "bg-panel text-ink" : "bg-transparent text-muted"
							}`}
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
							class={`block w-full cursor-pointer truncate rounded-md border-0 px-2.5 py-[9px] text-left text-[12px] focus-visible:bg-panel focus-visible:text-ink focus-visible:outline-0 enabled:hover:bg-panel enabled:hover:text-ink disabled:cursor-default disabled:text-dim ${
								option.value === value ? "bg-panel text-ink" : "bg-transparent text-ink"
							}`}
							onclick={() => select(option)}
							>
							{option.label}
							</button>
							{/each}
							{#if filteredOptions.length === 0}
							<p class="m-0 px-2.5 py-2 font-sans text-[12px] text-dim">No models match "{query.trim()}".</p>
							{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
