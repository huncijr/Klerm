<script lang="ts">
	import { ChevronDown, Eye, EyeOff, Hammer, ListTodo, Plus, Send, Square, Users, X } from "@lucide/svelte";
	import { onMount, tick } from "svelte";
	import { useDesktopShortcuts } from "../lib/shortcuts.ts";
	import {
		filterMcpSuggestions,
		findActiveMention,
		MCP_COLOR_BG_CSS,
		MCP_COLOR_CSS,
		type McpSuggestion,
		splitMcpMentions,
	} from "../lib/mcp-mentions.ts";
	import { imageDataUrl } from "../lib/helpers.ts";
	import {
		canPromptTogether,
		codingHarnessDisplayName,
		codingHarnessModelOptions,
	} from "../lib/coding-harnesses.ts";
	import type {
		ApprovalMode,
		CodingHarnessKind,
		CodingHarnessSetup,
		CodingHarnessSlotSettings,
		ImageAttachment,
		McpColor,
		McpServerStatus,
		SelectOption,
		ThinkingLevel,
		WorkerRole,
	} from "../lib/model.ts";
	import ModelSelect from "./ModelSelect.svelte";
	import ProviderLogo from "./ProviderLogo.svelte";
	import ThinkingSlider from "./ThinkingSlider.svelte";

	let {
		draft = $bindable(""),
		attachments = $bindable([]),
		sendDisabled,
		taskActive,
		showMeta,
		emptyLayout,
		localOptions,
		frontierOptions,
		klermLocalOptions,
		klermFrontierOptions,
		localValue,
		frontierValue,
		routingValue,
		hasSecondKlermModel,
		codingHarnessOptions,
		localDisabled,
		frontierDisabled,
		routingDisabled,
		taskStateText,
		errorBanner,
		externalHarnessSetup,
		visibleAgentIds,
		externalHarnessBusy,
		workTogetherEnabled,
		workTogetherAvailable,
		workTogetherVisible,
		history,
		focusRequest,
		historyKey,
		localThinkingLevels,
		localThinkingValue,
		localThinkingDisabled,
		frontierThinkingLevels,
		frontierThinkingValue,
		frontierThinkingDisabled,
		mcpServers,
		localProfileId,
		frontierProfileId,
		localRole,
		frontierRole,
		approvalMode,
		activeAgent,
		roleDisabled,
		buildModeOffer,
		onsend,
		onattachmenterror,
		onstop,
		onlocalchange,
		onfrontierchange,
		onroutingchange,
		onlocalthinkingchange,
		onfrontierthinkingchange,
		onlocalrolechange,
		onfrontierrolechange,
		onapprovalchange,
		onlocalprofilechange,
		onfrontierprofilechange,
		onbuildofferdismiss,
		onbuildofferswitch,
		onexternalharnesschange,
		onexternalharnesskindchange,
		onexternalmodelchange,
		onexternaleffortchange,
		onaddexternalagent,
		onremoveexternalagent,
		ondisableallexternalagents,
		onenableallexternalagents,
		onturnoffexternalagents,
		onviewexternalagent,
		onworktogetherchange,
		onprompttogether,
	}: {
		draft: string;
		attachments: ImageAttachment[];
		sendDisabled: boolean;
		taskActive: boolean;
		showMeta: boolean;
		emptyLayout: boolean;
		localOptions: SelectOption[];
		frontierOptions: SelectOption[];
		klermLocalOptions: SelectOption[];
		klermFrontierOptions: SelectOption[];
		localValue: string;
		frontierValue: string;
		routingValue: string;
		hasSecondKlermModel: boolean;
		codingHarnessOptions: SelectOption[];
		localDisabled: boolean;
		frontierDisabled: boolean;
		routingDisabled: boolean;
		taskStateText: string;
		errorBanner: string;
		externalHarnessSetup: CodingHarnessSetup | undefined;
		visibleAgentIds: string[];
		externalHarnessBusy: boolean;
		workTogetherEnabled: boolean;
		workTogetherAvailable: boolean;
		workTogetherVisible: boolean;
		history: string[];
		focusRequest: number;
		historyKey: string;
		localThinkingLevels: ThinkingLevel[];
		localThinkingValue: ThinkingLevel;
		localThinkingDisabled: boolean;
		frontierThinkingLevels: ThinkingLevel[];
		frontierThinkingValue: ThinkingLevel;
		frontierThinkingDisabled: boolean;
		mcpServers: McpServerStatus[];
		localProfileId: string;
		frontierProfileId: string;
		localRole: WorkerRole;
		frontierRole: WorkerRole;
		approvalMode: ApprovalMode;
		activeAgent: "agent1" | "agent2";
		roleDisabled: boolean;
		buildModeOffer?: { id: number; agent: "agent1" | "agent2" };
		onsend: (text: string, images: ImageAttachment[]) => void;
		onattachmenterror: (message: string) => void;
		onstop: () => void;
		onlocalchange: (value: string) => void;
		onfrontierchange: (value: string) => void;
		onroutingchange: (value: string) => void;
		onlocalthinkingchange: (level: ThinkingLevel) => void;
		onfrontierthinkingchange: (level: ThinkingLevel) => void;
		onlocalrolechange: (role: WorkerRole) => void;
		onfrontierrolechange: (role: WorkerRole) => void;
		onapprovalchange: (mode: ApprovalMode) => void;
		onlocalprofilechange: (id: string) => void;
		onfrontierprofilechange: (id: string) => void;
		onbuildofferdismiss: (id: number) => void;
		onbuildofferswitch: (id: number) => void;
		onexternalharnesschange: (id: string, enabled: boolean) => void;
		onexternalharnesskindchange: (id: string, kind: CodingHarnessKind) => void;
		onexternalmodelchange: (id: string, model: string) => void;
		onexternaleffortchange: (id: string, effort: ThinkingLevel) => void;
		onaddexternalagent: () => void;
		onremoveexternalagent: (id: string) => void;
		ondisableallexternalagents: () => void;
		onenableallexternalagents: () => void;
		onturnoffexternalagents: () => void;
		onviewexternalagent: (id: string) => void;
		onworktogetherchange: (enabled: boolean) => void;
		onprompttogether: (text: string) => void;
	} = $props();

	const routingOptions: SelectOption[] = [
		{ value: "off", label: "Direct" },
		{ value: "local", label: "Agent 1" },
		{ value: "frontier", label: "Agent 2" },
		{ value: "frontier-local", label: "Agent 2 → Agent 1" },
		{ value: "auto", label: "Auto / Agent 1 first" },
	];

	let promptEl: HTMLTextAreaElement | undefined = $state();
	const shortcuts = useDesktopShortcuts();
	let fileEl: HTMLInputElement | undefined = $state();
	let historyIndex = $state(-1);
	let draftBeforeHistory = $state("");
	let roleMenuOpen = $state(false);
	let roleMenuRoot: HTMLElement | undefined = $state();
	let agentStripRoot: HTMLElement | undefined = $state();
	let pinnedAgentId = $state("");
	let externalAgentsCollapsed = $state(false);
	let agent2PickerOpen = $state(false);
	let mcpPickerOpen = $state(false);
	let mcpQuery = $state("");
	let mcpTokenStart = $state(-1);
	let mcpSelectedIndex = $state(0);
	const activeAgentLabel = $derived(activeAgent === "agent1" ? "Agent 1" : "Agent 2");
	const activeRole = $derived(activeAgent === "agent1" ? localRole : frontierRole);
	const approvalModes: ApprovalMode[] = ["never", "risky", "always"];
	const approvalLabel = $derived(
		approvalMode === "always" ? "Always allow" : approvalMode === "never" ? "Block risky" : "Ask risky",
	);
	const filteredMcpSuggestions = $derived(filterMcpSuggestions(mcpServers, mcpQuery));
	const mentionSegments = $derived(splitMcpMentions(draft, mcpServers));
	const hasMcpMentions = $derived(mentionSegments.some((segment) => segment.mention));
	const configuredAgentSlots = $derived<Array<{ label: string; slot: CodingHarnessSlotSettings }>>(
		externalHarnessSetup?.slots.agents.map((slot) => ({ label: `Agent ${slot.id.replace(/^agent/, "")}`, slot })) ?? [],
	);
	const externalAgentSlots = $derived<Array<{ label: string; slot: CodingHarnessSlotSettings }>>(
		externalHarnessSetup?.slots.externalHarnessesEnabled ? configuredAgentSlots : [],
	);
	const externalMode = $derived(externalHarnessSetup?.slots.externalHarnessesEnabled === true);
	const showSecondAgent = $derived(externalMode || hasSecondKlermModel || agent2PickerOpen);
	const roleControlDisabled = $derived(externalMode ? externalHarnessBusy : roleDisabled);
	const allExternalAgentsDisabled = $derived(
		externalAgentSlots.length > 0 && externalAgentSlots.every(({ slot }) => !slot.enabled),
	);
	const compactWorkTogetherLayout = $derived(externalMode && workTogetherVisible && externalAgentSlots.length > 2);

	function harnessModels(slot: CodingHarnessSlotSettings): SelectOption[] {
		return codingHarnessModelOptions(slot, externalHarnessSetup, klermLocalOptions, klermFrontierOptions);
	}

	function mentionStyle(color: McpColor = "base"): string {
		return `color: ${MCP_COLOR_CSS[color]}; background: ${MCP_COLOR_BG_CSS[color]}; box-shadow: 0 0 0 1px color-mix(in srgb, ${MCP_COLOR_CSS[color]} 35%, transparent); border-radius: 4px;`;
	}

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
		if (roleControlDisabled) roleMenuOpen = false;
	});

	$effect(() => {
		if (!allExternalAgentsDisabled) return;
		externalAgentsCollapsed = true;
		pinnedAgentId = "";
	});

	$effect(() => {
		if (hasSecondKlermModel) agent2PickerOpen = false;
	});

	$effect(() => {
		const offerId = buildModeOffer?.id;
		if (offerId === undefined) return;
		const timer = window.setTimeout(() => onbuildofferdismiss(offerId), 10_000);
		return () => window.clearTimeout(timer);
	});

	onMount(() => {
		const removeShortcuts = [shortcuts?.register("run", submit, () => !sendDisabled && !taskActive), shortcuts?.register("compose.focus", () => promptEl?.focus()), shortcuts?.register("close", () => { roleMenuOpen = false; pinnedAgentId = ""; mcpPickerOpen = false; }, undefined, 30, () => roleMenuOpen || Boolean(pinnedAgentId) || mcpPickerOpen)];
		const closeRoleMenuOutside = (event: PointerEvent) => {
			if (!roleMenuOpen || !(event.target instanceof Node) || roleMenuRoot?.contains(event.target)) return;
			roleMenuOpen = false;
		};
		const closeAgentMenuOutside = (event: PointerEvent) => {
			if (!pinnedAgentId || !(event.target instanceof Node) || agentStripRoot?.contains(event.target)) return;
			pinnedAgentId = "";
		};
		window.addEventListener("resize", resizePrompt);
		document.addEventListener("pointerdown", closeRoleMenuOutside);
		document.addEventListener("pointerdown", closeAgentMenuOutside);
		return () => {
			window.removeEventListener("resize", resizePrompt);
			for (const cleanup of removeShortcuts) cleanup?.();
			document.removeEventListener("pointerdown", closeRoleMenuOutside);
			document.removeEventListener("pointerdown", closeAgentMenuOutside);
		};
	});

	function submit(): void {
		const text = draft.trim();
		if ((!text && attachments.length === 0) || sendDisabled) return;
		if (text === "/mode" && !externalMode) {
			draft = "";
			roleMenuOpen = true;
			return;
		}
		historyIndex = -1;
		draftBeforeHistory = "";
		onsend(text, attachments);
	}

	function submitTogether(): void {
		const text = draft.trim();
		if (!text || attachments.length > 0 || sendDisabled) return;
		historyIndex = -1;
		draftBeforeHistory = "";
		onprompttogether(text);
	}

	async function attachImages(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = "";
		const available = Math.max(0, 8 - attachments.length);
		if (files.length > available) onattachmenterror("You can attach up to 8 images.");
		for (const file of files.slice(0, available)) {
			if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
				onattachmenterror(`${file.name} is not a supported PNG, JPEG, GIF, or WebP image.`);
				continue;
			}
			if (file.size > 10 * 1024 * 1024) {
				onattachmenterror(`${file.name} is larger than 10 MiB.`);
				continue;
			}
			let dataUrl: string;
			try {
				dataUrl = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(String(reader.result ?? ""));
					reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
					reader.readAsDataURL(file);
				});
			} catch {
				onattachmenterror(`Could not read ${file.name}.`);
				continue;
			}
			const marker = ";base64,";
			const markerIndex = dataUrl.indexOf(marker);
			if (markerIndex < 0) continue;
			attachments = [
				...attachments,
				{ type: "image", mimeType: file.type, data: dataUrl.slice(markerIndex + marker.length), name: file.name },
			];
		}
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
		if (!promptEl || mcpServers.length === 0) {
			mcpPickerOpen = false;
			return;
		}
		const mention = findActiveMention(draft, promptEl.selectionStart, mcpServers);
		if (!mention) {
			mcpPickerOpen = false;
			return;
		}
		mcpTokenStart = mention.start;
		mcpQuery = mention.query;
		mcpPickerOpen = true;
		if (mcpSelectedIndex >= filteredMcpSuggestions.length) mcpSelectedIndex = 0;
	}

	function insertMcpSuggestion(suggestion: McpSuggestion | undefined): void {
		if (!suggestion || !promptEl || mcpTokenStart < 0) return;
		const cursor = promptEl.selectionStart;
		draft = `${draft.slice(0, mcpTokenStart)}${suggestion.insertText}${draft.slice(cursor)}`;
		mcpPickerOpen = false;
		mcpQuery = "";
		mcpSelectedIndex = 0;
		void tick().then(() => {
			const position = mcpTokenStart + suggestion.insertText.length;
			promptEl?.focus();
			promptEl?.setSelectionRange(position, position);
		});
	}

	function insertNewline(): void {
		if (!promptEl) {
			draft += "\n";
			return;
		}
		const start = promptEl.selectionStart ?? draft.length;
		const end = promptEl.selectionEnd ?? draft.length;
		draft = `${draft.slice(0, start)}\n${draft.slice(end)}`;
		historyIndex = -1;
		draftBeforeHistory = "";
		const position = start + 1;
		void tick().then(() => {
			promptEl?.focus();
			promptEl?.setSelectionRange(position, position);
			resizePrompt();
			updateMcpPicker();
		});
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if (shortcuts?.matches(event, "run")) { event.preventDefault(); submit(); return; }
		if (shortcuts?.matches(event, "compose.send") && (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) { event.preventDefault(); submit(); return; }
		if (shortcuts?.matches(event, "compose.newline")) { event.preventDefault(); if (mcpPickerOpen) mcpPickerOpen = false; insertNewline(); return; }
		if (event.key === "Enter" && (event.shiftKey || event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			if (mcpPickerOpen) mcpPickerOpen = false;
			insertNewline();
			return;
		}
		if (mcpPickerOpen) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				mcpSelectedIndex =
					filteredMcpSuggestions.length === 0 ? 0 : (mcpSelectedIndex + 1) % filteredMcpSuggestions.length;
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				mcpSelectedIndex =
					filteredMcpSuggestions.length === 0
						? 0
						: (mcpSelectedIndex - 1 + filteredMcpSuggestions.length) % filteredMcpSuggestions.length;
				return;
			}
			if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey)) {
				if (filteredMcpSuggestions.length === 0) {
					mcpPickerOpen = false;
					if (event.key === "Tab") {
						event.preventDefault();
						return;
					}
				} else {
					event.preventDefault();
					insertMcpSuggestion(filteredMcpSuggestions[mcpSelectedIndex]);
					return;
				}
			}
			if (event.key === "Escape") {
				event.preventDefault();
				mcpPickerOpen = false;
				return;
			}
		}
		if (shortcuts?.matches(event, "compose.send") && draft.trim() === "/mode" && !externalMode) {
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
		if (shortcuts?.matches(event, "compose.send")) {
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
		emptyLayout ? "w-full self-center pt-0" : "bg-panel"
	}`}
>
	{#if errorBanner}
		<div
			role="alert"
			class="mx-auto mb-[7px] w-[min(820px,100%)] rounded-md border border-danger bg-danger-soft px-3 py-2 text-[12px] text-danger"
		>
			{errorBanner}
		</div>
	{/if}
	{#if buildModeOffer && !externalMode}
		{#key buildModeOffer.id}
			<div class="mx-auto mb-2 flex w-[min(820px,100%)] flex-wrap items-center gap-3 rounded-lg border border-danger bg-panel px-3 py-2 shadow-sm" role="status" aria-live="polite">
				<div class="relative grid h-8 w-8 shrink-0 place-items-center" aria-label="This suggestion expires in 10 seconds">
					<svg viewBox="0 0 36 36" class="h-8 w-8 -rotate-90" aria-hidden="true">
						<circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-warning-soft)" stroke-width="3"></circle>
						<circle cx="18" cy="18" r="15" pathLength="100" fill="none" stroke="var(--color-warning)" stroke-width="3" stroke-linecap="round" stroke-dasharray="100" class="build-offer-countdown"></circle>
					</svg>
					<Hammer size={12} class="absolute text-danger" />
				</div>
				<div class="min-w-[160px] flex-1">
					<strong class="block text-[13px] text-accent">Plan ready</strong>
					<span class="mt-0.5 block font-sans text-[11px] text-danger">Switch {buildModeOffer.agent === "agent1" ? "Agent 1" : "Agent 2"} to Build mode?</span>
				</div>
				<button type="button" class="rounded px-2.5 py-1.5 font-sans text-[11px] text-danger hover:bg-raised hover:text-ink" onclick={() => onbuildofferdismiss(buildModeOffer!.id)}>Cancel</button>
				<button type="button" disabled={roleDisabled} class="rounded border border-danger bg-danger-soft px-3 py-1.5 font-sans text-[11px] font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-45" onclick={() => onbuildofferswitch(buildModeOffer!.id)}>Switch to Build mode</button>
			</div>
		{/key}
	{/if}
	{#if !externalMode}
	<div class="mx-auto mb-1 flex w-[min(820px,100%)] justify-end px-1">
		<button
			type="button"
			disabled={roleDisabled}
			class="border-0 bg-transparent p-0 font-sans text-[11px] uppercase tracking-[.1em] text-muted cursor-pointer hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
			onclick={() => (roleMenuOpen = !roleMenuOpen)}
		>
			{activeAgentLabel} Mode: {activeRole === "planner" ? "Plan" : "Build"}
		</button>
	</div>
	{/if}

	<form
		class="mx-auto w-[min(820px,100%)] overflow-visible rounded-xl border border-line bg-panel shadow-sm focus-within:border-line"
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		{#if externalAgentSlots.length > 0}
			<div bind:this={agentStripRoot} class="flex min-h-9 flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-1.5">
				{#if externalAgentsCollapsed}
					<span class="mr-auto font-sans text-[11px] tracking-[.08em] text-muted uppercase">External Agents · {externalAgentSlots.length}</span>
					{#if allExternalAgentsDisabled}
						<button type="button" disabled={externalHarnessBusy} class="rounded-md border border-line bg-panel px-2 py-1 font-sans text-[11px] text-accent hover:bg-panel disabled:cursor-wait disabled:opacity-45" onclick={onenableallexternalagents}>Enable all</button>
						<button type="button" disabled={externalHarnessBusy} class="rounded-md border border-line px-2 py-1 font-sans text-[11px] text-danger hover:bg-panel disabled:cursor-wait disabled:opacity-45" onclick={onturnoffexternalagents}>Turn off</button>
					{/if}
				{:else}
				{#each externalAgentSlots as { label, slot }, index (slot.id)}
					{@const models = harnessModels(slot)}
					{@const viewVisible = visibleAgentIds.includes(slot.id)}
					<div class="group relative">
						<div class={`flex h-11 min-w-[190px] items-center rounded-md border transition-colors ${slot.enabled ? "border-line bg-panel text-ink" : "border-line bg-bg text-muted"}`}>
							<button
								type="button"
								aria-label={`${viewVisible ? "Hide" : "Show"} ${label} view`}
								aria-pressed={viewVisible}
								title={`${viewVisible ? "Hide" : "Show"} ${label} context`}
								class={`ml-1 grid h-7 w-7 place-items-center rounded hover:bg-raised ${viewVisible ? "text-ink" : "text-muted"}`}
								onclick={() => onviewexternalagent(slot.id)}
							>
								{#if viewVisible}<Eye size={13} />{:else}<EyeOff size={13} />{/if}
							</button>
							<button
								type="button"
								aria-expanded={pinnedAgentId === slot.id}
								aria-label={`Configure ${label} ${codingHarnessDisplayName(slot.kind)}`}
								class="flex h-full min-w-0 flex-1 items-center gap-2 px-1.5 text-left font-sans"
								onfocus={() => (pinnedAgentId = slot.id)}
								onclick={() => (pinnedAgentId = pinnedAgentId === slot.id ? "" : slot.id)}
							>
								<ProviderLogo id={slot.kind ?? "klerm"} label={codingHarnessDisplayName(slot.kind)} size={16} decorative />
								<span class="min-w-0 flex-1">
									<span class="block text-[11px] text-ink">{label} · {codingHarnessDisplayName(slot.kind)}</span>
									<span class="mt-0.5 block max-w-[120px] truncate text-[11px] text-muted" title={slot.model ?? "Default model"}>{slot.model ?? "Default model"} · thinking {slot.effort}</span>
								</span>
							</button>
							<button
								type="button"
								role="switch"
								aria-checked={slot.enabled}
								aria-label={`${slot.enabled ? "Disable" : "Enable"} ${label}`}
								disabled={externalHarnessBusy}
								class="mr-1 flex h-full items-center pl-1 disabled:cursor-wait disabled:opacity-50"
								onclick={() => onexternalharnesschange(slot.id, !slot.enabled)}
							>
								<span class={`relative h-3.5 w-6 rounded-full transition-colors ${slot.enabled ? "bg-warning-soft" : "bg-raised"}`} aria-hidden="true"><span class={`absolute top-0.5 left-0.5 h-2.5 w-2.5 rounded-full bg-primary transition-transform ${slot.enabled ? "translate-x-2.5" : "translate-x-0"}`}></span></span>
							</button>
							{#if slot.id !== "agent1" || externalAgentSlots.length >= 3}
								<button
									type="button"
									aria-label={`Remove ${label}`}
									disabled={externalHarnessBusy}
									class="mr-1 grid h-4 w-4 place-items-center rounded text-muted hover:bg-panel hover:text-danger disabled:cursor-wait disabled:opacity-40"
									onclick={() => {
										pinnedAgentId = "";
										onremoveexternalagent(slot.id);
									}}
								>
									<X size={10} />
								</button>
							{/if}
						</div>
						<div class={`absolute top-full z-40 w-64 rounded-lg border border-line bg-panel p-2 shadow-sm group-hover:block ${pinnedAgentId === slot.id ? "block" : "hidden"} ${index > 1 ? "right-0" : "left-0"}`}>
							<ModelSelect
								label="Model"
								options={models}
								value={slot.model ?? (slot.id === "agent1" ? localValue : slot.id === "agent2" ? frontierValue : "")}
								disabled={externalHarnessBusy || models.length === 0}
								placeholder={slot.kind === "klerm" ? "Choose a model" : models.length > 0 ? "Choose a harness model" : "No models reported"}
								direction="down"
								allowEmpty
								emptyLabel="No model"
								onchange={(value) => onexternalmodelchange(slot.id, value)}
							/>
							<label class="mt-2 block font-sans text-[11px] tracking-[.12em] text-muted uppercase" for={`composer-harness-${slot.id}`}>Harness</label>
							<select
								id={`composer-harness-${slot.id}`}
								value={slot.kind ?? "klerm"}
								disabled={externalHarnessBusy}
								class="mt-1 h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[11px] text-ink  disabled:opacity-45"
								onchange={(event) => onexternalharnesskindchange(slot.id, event.currentTarget.value as CodingHarnessKind)}
							>
								{#each codingHarnessOptions as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
							</select>
							<label class="mt-2 block font-sans text-[11px] tracking-[.12em] text-muted uppercase" for={`composer-effort-${slot.id}`}>Thinking</label>
							<select
								id={`composer-effort-${slot.id}`}
								value={slot.effort}
								disabled={externalHarnessBusy}
								class="mt-1 h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[11px] text-ink capitalize  disabled:opacity-45"
								onchange={(event) => onexternaleffortchange(slot.id, event.currentTarget.value as ThinkingLevel)}
							>
								{#each ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as effort}<option value={effort}>{effort}</option>{/each}
							</select>
							{#if slot.id !== "agent1"}
								<button type="button" class="mt-2 w-full rounded-md border border-line px-2 py-1.5 font-sans text-[11px] text-danger hover:bg-panel" onclick={() => { pinnedAgentId = ""; onremoveexternalagent(slot.id); }}>Remove agent</button>
							{/if}
						</div>
					</div>
				{/each}
				<button type="button" aria-label="Add agent" disabled={externalHarnessBusy || externalAgentSlots.length >= 4} class="grid h-7 w-7 place-items-center rounded-md border border-dashed border-line bg-bg font-sans text-[14px] text-ink hover:border-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-40" onclick={onaddexternalagent}>+</button>
				{/if}
				{#if externalAgentSlots.length >= 3}
					<div class="ml-auto flex shrink-0 flex-col items-stretch gap-1">
						{#if !externalAgentsCollapsed}
							<button type="button" disabled={externalHarnessBusy || allExternalAgentsDisabled} class="rounded-md border border-line px-1.5 py-1 font-sans text-[11px] text-danger hover:bg-panel disabled:cursor-wait disabled:opacity-45" onclick={ondisableallexternalagents}>Disable all</button>
						{/if}
						<button
							type="button"
							aria-label={externalAgentsCollapsed ? "Expand External Agents" : "Collapse External Agents"}
							aria-expanded={!externalAgentsCollapsed}
							title={externalAgentsCollapsed ? "Expand External Agents" : "Collapse External Agents"}
							class={`grid h-7 w-full shrink-0 place-items-center rounded-md border border-line text-muted transition-colors hover:border-line hover:bg-raised hover:text-ink ${externalAgentsCollapsed ? "" : "rotate-180"}`}
							onclick={() => {
								externalAgentsCollapsed = !externalAgentsCollapsed;
								pinnedAgentId = "";
							}}
						>
							<ChevronDown size={13} />
						</button>
					</div>
				{:else if !externalAgentsCollapsed}
					<button type="button" disabled={externalHarnessBusy || allExternalAgentsDisabled} class="ml-auto rounded-md border border-line px-2 py-1 font-sans text-[11px] text-danger hover:bg-panel disabled:cursor-wait disabled:opacity-45" onclick={ondisableallexternalagents}>Disable all</button>
				{/if}
			</div>
		{/if}
		<div class="relative min-h-[58px] pt-1 pr-[116px] pb-1 pl-[55px] narrow-520:min-h-[52px] narrow-520:pt-[3px] narrow-520:pr-[101px] narrow-520:pb-[3px] narrow-520:pl-[49px]">
			<input bind:this={fileEl} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple class="hidden" onchange={(event) => void attachImages(event)} />
			{#if attachments.length > 0}
				<div class="flex gap-2 overflow-x-auto pt-2 pb-1">
					{#each attachments as image, index (`${image.name ?? index}-${image.data.length}`)}
						{@const src = imageDataUrl(image)}
						{#if src}
							<div class="group relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-line bg-bg">
								<img src={src} alt={image.name ?? `Attachment ${index + 1}`} class="h-full w-full object-cover" />
								<button type="button" aria-label={`Remove ${image.name ?? `attachment ${index + 1}`}`} class="absolute top-0.5 right-0.5 grid h-5 w-5 place-items-center rounded bg-primary text-on-primary opacity-80 hover:opacity-100" onclick={() => (attachments = attachments.filter((_, candidate) => candidate !== index))}><X size={11} /></button>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
			{#if mcpPickerOpen}
				<div class="absolute right-3 bottom-[56px] left-3 z-30 max-h-[220px] overflow-y-auto rounded-lg border border-info bg-panel p-1.5 shadow-sm narrow-520:bottom-[50px]">
					{#if filteredMcpSuggestions.length === 0}
						<p class="m-0 px-2 py-2 font-sans text-[12px] text-muted">No MCP match @{mcpQuery}</p>
					{:else}
						{#each filteredMcpSuggestions as suggestion, index (`${suggestion.kind}-${suggestion.serverName}-${suggestion.remoteName ?? ""}`)}
							<button
								type="button"
								class={`flex w-full cursor-pointer items-start gap-2 rounded-md border px-2 py-2 text-left ${index === mcpSelectedIndex ? "ring-1 ring-accent/70" : "opacity-80 hover:opacity-100"}`}
								style={mentionStyle(suggestion.color ?? "base")}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => insertMcpSuggestion(suggestion)}
							>
								<span class="mt-1 h-1.75 w-1.75 shrink-0 rounded-full" style={`background: ${MCP_COLOR_CSS[suggestion.color ?? "base"]}`}></span>
								<span class="min-w-0 flex-1">
									<strong class="block truncate font-sans text-[12px] font-semibold">{suggestion.kind === "server" ? suggestion.displayName : `${suggestion.displayName} / ${suggestion.remoteName}`}</strong>
									<small class="mt-0.5 block truncate font-sans text-[11px] text-info">{suggestion.kind === "server" ? suggestion.serverName : suggestion.toolName}</small>
								</span>
							</button>
						{/each}
					{/if}
				</div>
			{/if}
			<div class="relative">
				{#if hasMcpMentions}
					<div
						aria-hidden="true"
						class="pointer-events-none absolute inset-0 overflow-hidden pt-3.5 pr-3 pb-3.5 pl-0 text-left text-[14px] leading-[1.55] whitespace-pre-wrap break-words narrow-520:py-3 narrow-520:text-[13px]"
					>
						{#each mentionSegments as segment, index (`${index}-${segment.text}`)}
							{#if segment.mention}
								<span class="font-semibold" style={mentionStyle(segment.mention.color ?? "base")}>{segment.text}</span>
							{:else}<span class="text-ink">{segment.text}</span>{/if}
						{/each}
					</div>
				{/if}
				<textarea
					bind:this={promptEl}
					bind:value={draft}
					rows="1"
					placeholder="Describe a task for Klerm..."
					aria-label="Task prompt"
					class={`relative z-[1] block max-h-[min(150px,22dvh)] w-full resize-none border-0 bg-transparent pt-3.5 pr-3 pb-3.5 pl-0 text-left text-[14px] leading-[1.55] outline-0 [scrollbar-width:thin] placeholder:text-dim narrow-520:max-h-[min(120px,20dvh)] narrow-520:py-3 narrow-520:text-[13px] short-650:max-h-[min(110px,20dvh)] short-500:max-h-[min(82px,18dvh)] ${hasMcpMentions ? "text-transparent caret-white" : "text-ink"}`}
					onkeydown={handleKeydown}
					oninput={handleInput}
				></textarea>
			</div>
			<button
				type="button"
				aria-label="Attach images"
				disabled={sendDisabled || taskActive || attachments.length >= 8}
				class="absolute bottom-2.5 left-[9px] grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-lg border border-line bg-panel text-muted hover:border-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 narrow-520:bottom-[7px] narrow-520:left-[7px] narrow-520:h-9 narrow-520:w-9"
				onclick={() => fileEl?.click()}
			>
				<Plus size={17} stroke-width={1.7} />
			</button>
			{#if !externalMode}
			<div bind:this={roleMenuRoot} class="absolute right-[55px] bottom-2.5 narrow-520:right-[49px] narrow-520:bottom-[7px]">
				<button
					type="button"
					aria-label="Configure worker roles"
					aria-expanded={roleMenuOpen}
					disabled={roleControlDisabled}
					class="flex h-[38px] items-center gap-1 rounded-lg border border-line bg-panel px-2 font-sans text-[12px] text-muted cursor-pointer hover:border-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 narrow-520:h-9 narrow-520:px-1.5"
					onclick={() => (roleMenuOpen = !roleMenuOpen)}
				>
					{#if activeRole === "planner"}<ListTodo size={13} />{:else}<Hammer size={13} />{/if}
					<ChevronDown size={11} />
				</button>
				{#if roleMenuOpen}
					<div class="absolute right-0 bottom-[44px] z-20 w-[238px] rounded-lg border border-line bg-panel p-2 shadow-sm">
							{#each (hasSecondKlermModel ? [["agent1", localRole], ["agent2", frontierRole]] : [["agent1", localRole]]) as [agent, role]}
								<div class="grid grid-cols-[1fr_auto_auto] items-center gap-1 py-1">
									<span class="px-1 font-sans text-[11px] uppercase tracking-[.12em] text-muted">{agent === "agent1" ? "Agent 1" : "Agent 2"}</span>
									{#each ["planner", "builder"] as option}
										<button type="button" class={`rounded-md border px-2 py-1.5 font-sans text-[11px] capitalize cursor-pointer ${role === option ? "border-line bg-raised text-ink" : "border-transparent text-muted hover:bg-raised hover:text-ink"}`} onclick={() => { if (agent === "agent1") onlocalrolechange(option as WorkerRole); else onfrontierrolechange(option as WorkerRole); }}>{option === "planner" ? "Plan" : "Build"}</button>
									{/each}
								</div>
							{/each}
							<p class="m-0 border-t border-line px-1 pt-2 text-[11px] leading-[1.45] text-dim">Plan is read-only. Build has full tools and asks before risky actions.</p>
					</div>
				{/if}
			</div>
			{/if}
			<div class="absolute right-[9px] bottom-2.5 h-[38px] w-[38px] narrow-520:right-[7px] narrow-520:bottom-[7px] narrow-520:h-9 narrow-520:w-9">
				{#if taskActive}
					<button
						type="button"
						aria-label="Stop task"
						class="grid h-full w-full cursor-pointer place-items-center rounded-lg border border-danger bg-danger-soft text-danger"
						onclick={onstop}
					>
						<Square size={13} fill="currentColor" />
					</button>
				{:else}
					<button
						type="submit"
						aria-label="Send task"
						disabled={sendDisabled || (!draft.trim() && attachments.length === 0)}
						class="grid h-full w-full cursor-pointer place-items-center rounded-lg border-0 bg-primary text-on-primary enabled:hover:bg-primary disabled:cursor-not-allowed disabled:bg-raised disabled:text-dim"
					>
						<Send size={17} stroke-width={1.7} />
					</button>
				{/if}
			</div>
		</div>
	</form>
	{#if externalHarnessSetup?.blockingReason}
		<p class="mx-auto mt-1.5 w-[min(820px,100%)] px-1 font-sans text-[11px] text-warning">
			External routing setup: {externalHarnessSetup.blockingReason} Normal Klerm chat remains available.
		</p>
	{/if}
	<div class="mx-auto mt-1.5 flex w-[min(820px,100%)] justify-end px-1">
		<label class="flex items-center gap-2 font-sans text-[11px] text-muted">
			<span>{externalMode || hasSecondKlermModel ? "All agents approval" : "Agent 1 approval"}</span>
			<input
				type="range"
				min="0"
				max="2"
				step="1"
				value={approvalModes.indexOf(approvalMode)}
				disabled={roleDisabled}
				aria-label="All agents builder approval mode"
				class="h-1 w-20 cursor-pointer accent-warning disabled:cursor-not-allowed disabled:opacity-40"
				oninput={(event) => {
					const mode = approvalModes[Number(event.currentTarget.value)] ?? "risky";
					onapprovalchange(mode);
				}}
			/>
			<strong class="min-w-[66px] text-right font-medium text-ink">{approvalLabel}</strong>
		</label>
	</div>

	<div class={`mx-auto mt-1.5 grid w-[min(820px,100%)] gap-2 narrow-520:mt-[5px] narrow-520:gap-[5px] ${compactWorkTogetherLayout || (externalMode && externalAgentSlots.length < 2) ? "grid-cols-2" : externalMode && workTogetherVisible ? "grid-cols-2 min-[760px]:grid-cols-4" : "grid-cols-3"}`}>
		{#if !compactWorkTogetherLayout}
			<div class="min-w-0">
			<ModelSelect
				label={`${externalAgentSlots[0]?.label ?? "Agent 1"} model`}
				options={localOptions}
				value={localValue}
				disabled={localDisabled}
				placeholder="Discovering models..."
				onchange={(value) => {
					onlocalchange(value);
					if (localProfileId) onlocalprofilechange("");
				}}
			/>
			{#if !externalMode && localThinkingLevels.length > 1}
				<ThinkingSlider
					label="Agent 1 effort"
					levels={localThinkingLevels}
					value={localThinkingValue}
					disabled={localThinkingDisabled}
					onchange={onlocalthinkingchange}
				/>
			{/if}
			</div>
		{/if}
		{#if !compactWorkTogetherLayout && (!externalMode ? showSecondAgent : externalAgentSlots.length > 1)}
			<div class="min-w-0">
			<ModelSelect
				label={`${externalAgentSlots[1]?.label ?? "Agent 2"} model`}
				options={frontierOptions}
				value={frontierValue}
				disabled={frontierDisabled}
				placeholder="Choose a model"
				allowEmpty={!externalMode}
				emptyLabel="Remove Agent 2"
				onchange={(value) => {
						onfrontierchange(value);
						if (!value) agent2PickerOpen = false;
					if (frontierProfileId) onfrontierprofilechange("");
				}}
			/>
			{#if !externalMode && frontierThinkingLevels.length > 1}
				<ThinkingSlider
					label="Agent 2 effort"
					levels={frontierThinkingLevels}
					value={frontierThinkingValue}
					disabled={frontierThinkingDisabled}
					onchange={onfrontierthinkingchange}
				/>
			{/if}
			{#if !externalMode && hasSecondKlermModel}
				<button
					type="button"
					disabled={routingDisabled}
					class="mt-1 w-full rounded-md border border-line px-2 py-1 font-sans text-[11px] text-danger hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40"
					onclick={() => onfrontierchange("")}
				>
					Remove Agent 2
				</button>
			{/if}
			</div>
		{:else if !externalMode}
			<button
				type="button"
				disabled={frontierDisabled}
				class="flex min-w-0 items-center justify-between rounded-lg border border-dashed border-line bg-bg px-3 py-2 text-left text-ink transition-colors hover:border-line hover:bg-panel hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
				onclick={() => (agent2PickerOpen = true)}
			>
				<span><strong class="block font-sans text-[11px] tracking-[.1em] text-muted uppercase">Agent 2</strong><span class="mt-1 block font-sans text-[12px]">Add model</span></span>
				<Plus size={15} stroke-width={1.6} />
			</button>
		{/if}
		{#if canPromptTogether(externalHarnessSetup)}
			<button
				type="button"
				disabled={sendDisabled || !draft.trim() || attachments.length > 0}
				title={attachments.length > 0 ? "Prompt Together does not support image attachments yet" : "Run bounded Planner, Builder, and Reviewer iterations"}
				class="flex min-w-0 items-center justify-between rounded-lg border border-warning bg-panel px-3 py-2 text-left text-warning hover:border-warning hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40"
				onclick={submitTogether}
			>
				<span><strong class="block font-sans text-[11px] tracking-[.1em] text-warning uppercase">Iterative mode</strong><span class="mt-1 block font-sans text-[12px]">Prompt Together</span></span>
				<Users size={15} stroke-width={1.6} />
			</button>
		{:else if externalMode || hasSecondKlermModel}
			<ModelSelect
				label="Routing"
				options={routingOptions}
				value={routingValue}
				disabled={routingDisabled || workTogetherEnabled}
				placeholder="Choose routing"
				onchange={onroutingchange}
			/>
		{/if}
		{#if workTogetherVisible}
			<button
				type="button"
				role="switch"
				aria-checked={workTogetherEnabled}
				aria-label="Toggle Work together mode"
				disabled={externalHarnessBusy || !workTogetherAvailable}
				title={externalHarnessBusy ? "Saving harness setup" : workTogetherAvailable ? "Toggle Work together mode" : "Enable two runnable agents"}
				class={`flex min-w-0 items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-left disabled:opacity-50 ${externalHarnessBusy ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"}`}
				onclick={() => onworktogetherchange(!workTogetherEnabled)}
			>
				<span>
					<strong class="block font-sans text-[11px] tracking-[.1em] text-dim uppercase">Harness mode</strong>
					<span class="mt-1 block font-sans text-[12px] text-ink">Work together</span>
				</span>
				<span class={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${workTogetherEnabled ? "bg-warning-soft" : "bg-raised"}`} aria-hidden="true"><span class={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-primary transition-transform ${workTogetherEnabled ? "translate-x-3" : "translate-x-0"}`}></span></span>
			</button>
		{/if}
	</div>

	<div
		class={`mx-auto flex w-[min(820px,100%)] justify-between px-[3px] pt-2 font-sans text-[11px] text-dim ${showMeta ? "" : "invisible"}`}
	>
		<span class="narrow-720:hidden">{shortcuts?.label("compose.send") || "Send shortcut disabled"} to send, {shortcuts?.label("compose.newline") || "New-line shortcut disabled"} for a new line</span>
		<span aria-live="polite" class="flex items-center gap-1.5">
			{#if taskActive}
				<span class="h-2 w-2 animate-spin rounded-full border border-line border-t-line"></span>
			{/if}
			{taskStateText}
		</span>
	</div>
</footer>

<style>
	.build-offer-countdown {
		stroke-dashoffset: 100;
		animation: build-offer-progress 10s linear forwards;
	}

	@keyframes build-offer-progress {
		to {
			stroke-dashoffset: 0;
		}
	}
</style>
