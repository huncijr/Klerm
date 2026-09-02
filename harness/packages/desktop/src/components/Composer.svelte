<script lang="ts">
	import { ChevronDown, Hammer, ListTodo, Send, Square } from "@lucide/svelte";
	import { onMount, tick } from "svelte";
	import type { McpToolOption, SelectOption, ThinkingLevel, WorkerRole } from "../lib/model.ts";
	import ModelSelect from "./ModelSelect.svelte";
	import ThinkingSlider from "./ThinkingSlider.svelte";

	let {
		draft = $bindable(""),
		sendDisabled,
		taskActive,
		showMeta,
		emptyLayout,
		localOptions,
		frontierOptions,
		localValue,
		frontierValue,
		routingValue,
		localDisabled,
		frontierDisabled,
		routingDisabled,
		taskStateText,
		errorBanner,
		history,
		focusRequest,
		historyKey,
		localThinkingLevels,
		localThinkingValue,
		localThinkingDisabled,
		frontierThinkingLevels,
		frontierThinkingValue,
		frontierThinkingDisabled,
		mcpTools,
		localRole,
		frontierRole,
		activeAgent,
		roleDisabled,
		onsend,
		onstop,
		onlocalchange,
		onfrontierchange,
		onroutingchange,
		onlocalthinkingchange,
		onfrontierthinkingchange,
		onlocalrolechange,
		onfrontierrolechange,
	}: {
		draft: string;
		sendDisabled: boolean;
		taskActive: boolean;
		showMeta: boolean;
		emptyLayout: boolean;
		localOptions: SelectOption[];
		frontierOptions: SelectOption[];
		localValue: string;
		frontierValue: string;
		routingValue: string;
		localDisabled: boolean;
		frontierDisabled: boolean;
		routingDisabled: boolean;
		taskStateText: string;
		errorBanner: string;
		history: string[];
		focusRequest: number;
		historyKey: string;
		localThinkingLevels: ThinkingLevel[];
		localThinkingValue: ThinkingLevel;
		localThinkingDisabled: boolean;
		frontierThinkingLevels: ThinkingLevel[];
		frontierThinkingValue: ThinkingLevel;
		frontierThinkingDisabled: boolean;
		mcpTools: McpToolOption[];
		localRole: WorkerRole;
		frontierRole: WorkerRole;
		activeAgent: "agent1" | "agent2";
		roleDisabled: boolean;
		onsend: (text: string) => void;
		onstop: () => void;
		onlocalchange: (value: string) => void;
		onfrontierchange: (value: string) => void;
		onroutingchange: (value: string) => void;
		onlocalthinkingchange: (level: ThinkingLevel) => void;
		onfrontierthinkingchange: (level: ThinkingLevel) => void;
		onlocalrolechange: (role: WorkerRole) => void;
		onfrontierrolechange: (role: WorkerRole) => void;
	} = $props();

	const routingOptions: SelectOption[] = [
		{ value: "off", label: "Direct" },
		{ value: "local", label: "Agent 1" },
		{ value: "frontier", label: "Agent 2" },
		{ value: "frontier-local", label: "Agent 2 → Agent 1" },
		{ value: "auto", label: "Auto / Agent 1 first" },
	];

	let promptEl: HTMLTextAreaElement | undefined = $state();
	let historyIndex = $state(-1);
	let draftBeforeHistory = $state("");
	let roleMenuOpen = $state(false);
	let mcpPickerOpen = $state(false);
	let mcpQuery = $state("");
	let mcpTokenStart = $state(-1);
	let mcpSelectedIndex = $state(0);
	const activeAgentLabel = $derived(activeAgent === "agent1" ? "Agent 1" : "Agent 2");
	const activeRole = $derived(activeAgent === "agent1" ? localRole : frontierRole);
	const filteredMcpTools = $derived.by(() => {
		const query = mcpQuery.toLowerCase();
		const matches = mcpTools.filter((tool) =>
			`${tool.label} ${tool.name} ${tool.remoteName} ${tool.serverName}`.toLowerCase().includes(query),
		);
		return matches.slice(0, 7);
	});

	function resizePrompt(): void {
		if (!promptEl) return;
		promptEl.style.height = "auto";
		const configuredMaxHeight = Number.parseFloat(window.getComputedStyle(promptEl).maxHeight);
		const maxHeight = Number.isFinite(configuredMaxHeight) && configuredMaxHeight > 0 ? configuredMaxHeight : 150;
		promptEl.style.height = `${Math.min(promptEl.scrollHeight, maxHeight)}px`;
		promptEl.style.overflowY = promptEl.scrollHeight > maxHeight ? "auto" : "hidden";
	}

	$effect(() => {
		draft;
		resizePrompt();
	});

	$effect(() => {
		const request = focusRequest;
		if (request === 0) return;
		historyIndex = -1;
		draftBeforeHistory = "";
		void tick().then(() => {
			if (focusRequest !== request || !promptEl) return;
			promptEl.focus();
			promptEl.setSelectionRange(draft.length, draft.length);
		});
	});

	$effect(() => {
		historyKey;
		historyIndex = -1;
		draftBeforeHistory = "";
	});

	$effect(() => {
		if (roleDisabled) roleMenuOpen = false;
	});

	onMount(() => {
		const closeRoleMenu = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !roleMenuOpen) return;
			event.preventDefault();
			roleMenuOpen = false;
		};
		window.addEventListener("resize", resizePrompt);
		window.addEventListener("keydown", closeRoleMenu);
		return () => {
			window.removeEventListener("resize", resizePrompt);
			window.removeEventListener("keydown", closeRoleMenu);
		};
	});

	function submit(): void {
		const text = draft.trim();
		if (!text || sendDisabled) return;
		if (text === "/mode") {
			draft = "";
			roleMenuOpen = true;
			return;
		}
		historyIndex = -1;
		draftBeforeHistory = "";
		onsend(text);
	}

	function navigateHistory(direction: -1 | 1): void {
		if (history.length === 0) return;
		if (direction === -1) {
			if (historyIndex === -1) {
				draftBeforeHistory = draft;
				historyIndex = history.length - 1;
			} else {
				historyIndex = Math.max(0, historyIndex - 1);
			}
			draft = history[historyIndex] ?? draft;
		} else if (historyIndex !== -1) {
			if (historyIndex < history.length - 1) {
				historyIndex += 1;
				draft = history[historyIndex] ?? draft;
			} else {
				historyIndex = -1;
				draft = draftBeforeHistory;
				draftBeforeHistory = "";
			}
		}
		void tick().then(() => promptEl?.setSelectionRange(draft.length, draft.length));
	}

	function updateMcpPicker(): void {
		if (!promptEl || mcpTools.length === 0) {
			mcpPickerOpen = false;
			return;
		}
		const cursor = promptEl.selectionStart;
		const before = draft.slice(0, cursor);
		const match = before.match(/(^|\s)@([A-Za-z0-9_-]*)$/);
		if (!match || match.index === undefined) {
			mcpPickerOpen = false;
			return;
		}
		mcpTokenStart = match.index + (match[1]?.length ?? 0);
		mcpQuery = match[2] ?? "";
		mcpPickerOpen = true;
		if (mcpSelectedIndex >= filteredMcpTools.length) mcpSelectedIndex = 0;
	}

	function insertMcpTool(tool: McpToolOption | undefined): void {
		if (!tool || !promptEl || mcpTokenStart < 0) return;
		const cursor = promptEl.selectionStart;
		const insertion = `Use MCP tool ${tool.name}`;
		draft = `${draft.slice(0, mcpTokenStart)}${insertion}${draft.slice(cursor)}`;
		mcpPickerOpen = false;
		mcpQuery = "";
		mcpSelectedIndex = 0;
		void tick().then(() => {
			const position = mcpTokenStart + insertion.length;
			promptEl?.focus();
			promptEl?.setSelectionRange(position, position);
		});
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (mcpPickerOpen) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				mcpSelectedIndex = filteredMcpTools.length === 0 ? 0 : (mcpSelectedIndex + 1) % filteredMcpTools.length;
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				mcpSelectedIndex =
					filteredMcpTools.length === 0
						? 0
						: (mcpSelectedIndex - 1 + filteredMcpTools.length) % filteredMcpTools.length;
				return;
			}
			if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey)) {
				event.preventDefault();
				insertMcpTool(filteredMcpTools[mcpSelectedIndex]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				mcpPickerOpen = false;
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && draft.trim() === "/mode") {
			event.preventDefault();
			draft = "";
			roleMenuOpen = true;
			return;
		}
		if (event.key === "ArrowUp" && promptEl?.selectionStart === 0 && promptEl.selectionEnd === 0) {
			event.preventDefault();
			navigateHistory(-1);
			return;
		}
		if (
			event.key === "ArrowDown" &&
			historyIndex !== -1 &&
			promptEl?.selectionStart === draft.length &&
			promptEl.selectionEnd === draft.length
		) {
			event.preventDefault();
			navigateHistory(1);
			return;
		}
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			submit();
		}
	}

	function handleInput(): void {
		if (historyIndex !== -1) {
			historyIndex = -1;
			draftBeforeHistory = "";
		}
		void tick().then(updateMcpPicker);
	}
</script>

<footer
	class={`relative z-[3] min-h-0 px-7 pt-3 pb-[17px] narrow-720:px-[15px] narrow-520:px-2.5 narrow-520:pt-2 narrow-520:pb-2.5 ${
		emptyLayout ? "w-full self-center pt-0" : "bg-[linear-gradient(transparent,var(--color-bg)_18%)]"
	}`}
>
	{#if errorBanner}
		<div
			role="alert"
			class="mx-auto mb-[7px] w-[min(820px,100%)] rounded-md border border-[rgba(255,111,97,.25)] bg-[rgba(255,111,97,.07)] px-3 py-2 text-[10px] text-[#e69a93]"
		>
			{errorBanner}
		</div>
	{/if}
	<div class="mx-auto mb-1 flex w-[min(820px,100%)] justify-end px-1">
		<button
			type="button"
			disabled={roleDisabled}
			class="border-0 bg-transparent p-0 font-mono text-[8px] uppercase tracking-[.1em] text-[#737f87] cursor-pointer hover:text-[#cbd2d6] disabled:cursor-not-allowed disabled:opacity-45"
			onclick={() => (roleMenuOpen = !roleMenuOpen)}
		>
			{activeAgentLabel} Mode: {activeRole === "planner" ? "Plan" : "Build"}
		</button>
	</div>

	<form
		class="mx-auto w-[min(820px,100%)] overflow-visible rounded-xl border border-[#2a3239] bg-[#0d1116] shadow-[0_14px_40px_rgba(0,0,0,.24)] focus-within:border-[#46515a]"
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		<div class="relative min-h-[58px] pt-1 pr-[116px] pb-1 pl-4 narrow-520:min-h-[52px] narrow-520:pt-[3px] narrow-520:pr-[101px] narrow-520:pb-[3px] narrow-520:pl-[13px]">
			{#if mcpPickerOpen}
				<div class="absolute right-3 bottom-[56px] left-3 z-30 max-h-[220px] overflow-y-auto rounded-lg border border-[rgba(88,132,196,.45)] bg-[#0c131c] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,.5)] narrow-520:bottom-[50px]">
					{#if filteredMcpTools.length === 0}
						<p class="m-0 px-2 py-2 font-mono text-[10px] text-[#71808a]">No MCP tools match @{mcpQuery}</p>
					{:else}
						{#each filteredMcpTools as tool, index (tool.name)}
							<button
								type="button"
								class={`flex w-full cursor-pointer items-start gap-2 rounded-md border-0 px-2 py-2 text-left ${index === mcpSelectedIndex ? "bg-[rgba(88,132,196,.18)]" : "bg-transparent hover:bg-[#151e28]"}`}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => insertMcpTool(tool)}
							>
								<span class="mt-1 h-1.75 w-1.75 shrink-0 rounded-full bg-[#6f96d4]"></span>
								<span class="min-w-0 flex-1">
									<strong class="block truncate font-mono text-[10px] text-[#d9e7ff]">{tool.serverName} / {tool.remoteName}</strong>
									<small class="mt-0.5 block truncate font-mono text-[8px] text-[#758ca8]">{tool.name}</small>
								</span>
							</button>
						{/each}
					{/if}
				</div>
			{/if}
			<textarea
				bind:this={promptEl}
				bind:value={draft}
				rows="1"
				placeholder="Describe a task for Klerm..."
				aria-label="Task prompt"
				class="block max-h-[min(150px,22dvh)] w-full resize-none border-0 bg-transparent pt-3.5 pr-3 pb-3.5 pl-0 text-left text-[13px] leading-[1.55] text-white outline-0 [scrollbar-width:thin] placeholder:text-[#56616a] narrow-520:max-h-[min(120px,20dvh)] narrow-520:py-3 narrow-520:text-[12px] short-650:max-h-[min(110px,20dvh)] short-500:max-h-[min(82px,18dvh)]"
				onkeydown={handleKeydown}
				oninput={handleInput}
			></textarea>
			<div class="absolute right-[55px] bottom-2.5 narrow-520:right-[49px] narrow-520:bottom-[7px]">
				<button
					type="button"
					aria-label="Configure worker roles"
					aria-expanded={roleMenuOpen}
					disabled={roleDisabled}
					class="flex h-[38px] items-center gap-1 rounded-lg border border-[#293239] bg-[#11171c] px-2 font-mono text-[9px] text-[#9ba5ac] cursor-pointer hover:border-[#46515a] hover:text-white disabled:cursor-not-allowed disabled:opacity-45 narrow-520:h-9 narrow-520:px-1.5"
					onclick={() => (roleMenuOpen = !roleMenuOpen)}
				>
					{#if activeRole === "planner"}<ListTodo size={13} />{:else}<Hammer size={13} />{/if}
					<ChevronDown size={11} />
				</button>
				{#if roleMenuOpen}
					<div class="absolute right-0 bottom-[44px] z-20 w-[238px] rounded-lg border border-[#303a42] bg-[#10161b] p-2 shadow-[0_14px_34px_rgba(0,0,0,.42)]">
						{#each [["agent1", localRole], ["agent2", frontierRole]] as [agent, role]}
							<div class="grid grid-cols-[1fr_auto_auto] items-center gap-1 py-1">
								<span class="px-1 font-mono text-[8px] uppercase tracking-[.12em] text-[#66727b]">{agent === "agent1" ? "Agent 1" : "Agent 2"}</span>
								{#each ["planner", "builder"] as option}
									<button
										type="button"
										class={`rounded-md border px-2 py-1.5 font-mono text-[8px] capitalize cursor-pointer ${role === option ? "border-[#58646d] bg-[#252d33] text-white" : "border-transparent text-[#7d8991] hover:bg-[#192127] hover:text-[#cbd2d6]"}`}
										onclick={() => {
											roleMenuOpen = false;
											if (agent === "agent1") onlocalrolechange(option as WorkerRole);
											else onfrontierrolechange(option as WorkerRole);
										}}
									>
										{option === "planner" ? "Plan" : "Build"}
									</button>
								{/each}
							</div>
						{/each}
						<p class="m-0 border-t border-[#273038] px-1 pt-2 text-[8px] leading-[1.45] text-[#59656e]">Plan sees names only. Build has full tools and asks before risky actions.</p>
					</div>
				{/if}
			</div>
			<div class="absolute right-[9px] bottom-2.5 h-[38px] w-[38px] narrow-520:right-[7px] narrow-520:bottom-[7px] narrow-520:h-9 narrow-520:w-9">
				{#if taskActive}
					<button
						type="button"
						aria-label="Stop task"
						class="grid h-full w-full cursor-pointer place-items-center rounded-lg border border-[rgba(255,111,97,.35)] bg-[rgba(255,111,97,.08)] text-[#ff968c]"
						onclick={onstop}
					>
						<Square size={13} fill="currentColor" />
					</button>
				{:else}
					<button
						type="submit"
						aria-label="Send task"
						disabled={sendDisabled}
						class="grid h-full w-full cursor-pointer place-items-center rounded-lg border-0 bg-[#e1e6e9] text-[#0b0e10] enabled:hover:bg-white disabled:cursor-not-allowed disabled:bg-[#20272c] disabled:text-[#51585d]"
					>
						<Send size={17} stroke-width={1.7} />
					</button>
				{/if}
			</div>
		</div>
	</form>

	<div class="mx-auto mt-2 grid w-[min(820px,100%)] grid-cols-3 gap-2 narrow-520:mt-[5px] narrow-520:gap-[5px]">
		<div class="min-w-0">
			<ModelSelect
				label="Agent 1 model"
				options={localOptions}
				value={localValue}
				disabled={localDisabled}
				placeholder="Discovering models..."
				onchange={onlocalchange}
			/>
			{#if localThinkingLevels.length > 1}
				<ThinkingSlider
					label="Agent 1 effort"
					levels={localThinkingLevels}
					value={localThinkingValue}
					disabled={localThinkingDisabled}
					onchange={onlocalthinkingchange}
				/>
			{/if}
		</div>
		<div class="min-w-0">
			<ModelSelect
				label="Agent 2 model"
				options={frontierOptions}
				value={frontierValue}
				disabled={frontierDisabled}
				placeholder="Discovering models..."
				onchange={onfrontierchange}
			/>
			{#if frontierThinkingLevels.length > 1}
				<ThinkingSlider
					label="Agent 2 effort"
					levels={frontierThinkingLevels}
					value={frontierThinkingValue}
					disabled={frontierThinkingDisabled}
					onchange={onfrontierthinkingchange}
				/>
			{/if}
		</div>
		<ModelSelect
			label="Routing"
			options={routingOptions}
			value={routingValue}
			disabled={routingDisabled}
			placeholder="Choose routing"
			onchange={onroutingchange}
		/>
	</div>

	<div
		class={`mx-auto flex w-[min(820px,100%)] justify-between px-[3px] pt-2 font-mono text-[8px] text-dim ${showMeta ? "" : "invisible"}`}
	>
		<span class="narrow-720:hidden">Ctrl/Cmd+Enter to send, Enter for a new line</span>
		<span aria-live="polite" class="flex items-center gap-1.5">
			{#if taskActive}
				<span class="h-2 w-2 animate-spin rounded-full border border-[#4e5962] border-t-[#d7dde1]"></span>
			{/if}
			{taskStateText}
		</span>
	</div>
</footer>
