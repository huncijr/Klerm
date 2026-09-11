<script lang="ts">
	import { ChevronDown, Hammer, ListTodo, Plus, Send, Square, X } from "@lucide/svelte";
	import { onMount, tick } from "svelte";
	import {
		filterMcpSuggestions,
		findActiveMention,
		MCP_COLOR_BG_CSS,
		MCP_COLOR_CSS,
		type McpSuggestion,
		splitMcpMentions,
	} from "../lib/mcp-mentions.ts";
	import { imageDataUrl } from "../lib/helpers.ts";
	import type {
		ApprovalMode,
		CodingHarnessSetup,
		CodingHarnessSlotSettings,
		ImageAttachment,
		KlermProfile,
		McpColor,
		McpServerStatus,
		SelectOption,
		ThinkingLevel,
		WorkerRole,
	} from "../lib/model.ts";
	import ModelSelect from "./ModelSelect.svelte";
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
		localValue,
		frontierValue,
		routingValue,
		localDisabled,
		frontierDisabled,
		routingDisabled,
		taskStateText,
		errorBanner,
		externalHarnessSetup,
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
		profiles,
		localProfileId,
		frontierProfileId,
		profileDisabled,
		localRole,
		frontierRole,
		localApprovalMode,
		frontierApprovalMode,
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
		onlocalapprovalchange,
		onfrontierapprovalchange,
		onlocalprofilechange,
		onfrontierprofilechange,
		onbuildofferdismiss,
		onbuildofferswitch,
	}: {
		draft: string;
		attachments: ImageAttachment[];
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
		externalHarnessSetup: CodingHarnessSetup | undefined;
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
		profiles: KlermProfile[];
		localProfileId: string;
		frontierProfileId: string;
		profileDisabled: boolean;
		localRole: WorkerRole;
		frontierRole: WorkerRole;
		localApprovalMode: ApprovalMode;
		frontierApprovalMode: ApprovalMode;
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
		onlocalapprovalchange: (mode: ApprovalMode) => void;
		onfrontierapprovalchange: (mode: ApprovalMode) => void;
		onlocalprofilechange: (id: string) => void;
		onfrontierprofilechange: (id: string) => void;
		onbuildofferdismiss: (id: number) => void;
		onbuildofferswitch: (id: number) => void;
	} = $props();

	const routingOptions: SelectOption[] = [
		{ value: "off", label: "Direct" },
		{ value: "local", label: "Agent 1" },
		{ value: "frontier", label: "Agent 2" },
		{ value: "frontier-local", label: "Agent 2 → Agent 1" },
		{ value: "auto", label: "Auto / Agent 1 first" },
	];

	let promptEl: HTMLTextAreaElement | undefined = $state();
	let fileEl: HTMLInputElement | undefined = $state();
	let historyIndex = $state(-1);
	let draftBeforeHistory = $state("");
	let roleMenuOpen = $state(false);
	let roleMenuRoot: HTMLElement | undefined = $state();
	let mcpPickerOpen = $state(false);
	let mcpQuery = $state("");
	let mcpTokenStart = $state(-1);
	let mcpSelectedIndex = $state(0);
	const activeAgentLabel = $derived(activeAgent === "agent1" ? "Agent 1" : "Agent 2");
	const activeRole = $derived(activeAgent === "agent1" ? localRole : frontierRole);
	const activeApprovalMode = $derived(activeAgent === "agent1" ? localApprovalMode : frontierApprovalMode);
	const approvalModes: ApprovalMode[] = ["never", "risky", "always"];
	const approvalLabel = $derived(
		activeApprovalMode === "always" ? "Always allow" : activeApprovalMode === "never" ? "Block risky" : "Ask risky",
	);
	const filteredMcpSuggestions = $derived(filterMcpSuggestions(mcpServers, mcpQuery));
	const mentionSegments = $derived(splitMcpMentions(draft, mcpServers));
	const hasMcpMentions = $derived(mentionSegments.some((segment) => segment.mention));
	const externalAgentSlots = $derived<Array<{ label: string; slot: CodingHarnessSlotSettings }>>(
		externalHarnessSetup
			? externalHarnessSetup.slots.agents.map((slot) => ({ label: `Agent ${slot.id.replace(/^agent/, "")}`, slot }))
			: [],
	);

	function mentionStyle(color: McpColor = "base"): string {
		return `color: ${MCP_COLOR_CSS[color]}; background: ${MCP_COLOR_BG_CSS[color]}; box-shadow: 0 0 0 1px ${MCP_COLOR_CSS[color]}55; border-radius: 4px;`;
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
		if (roleDisabled) roleMenuOpen = false;
	});

	$effect(() => {
		const offerId = buildModeOffer?.id;
		if (offerId === undefined) return;
		const timer = window.setTimeout(() => onbuildofferdismiss(offerId), 10_000);
		return () => window.clearTimeout(timer);
	});

	onMount(() => {
		const closeRoleMenu = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !roleMenuOpen) return;
			event.preventDefault();
			roleMenuOpen = false;
		};
		const closeRoleMenuOutside = (event: PointerEvent) => {
			if (!roleMenuOpen || !(event.target instanceof Node) || roleMenuRoot?.contains(event.target)) return;
			roleMenuOpen = false;
		};
		window.addEventListener("resize", resizePrompt);
		window.addEventListener("keydown", closeRoleMenu);
		document.addEventListener("pointerdown", closeRoleMenuOutside);
		return () => {
			window.removeEventListener("resize", resizePrompt);
			window.removeEventListener("keydown", closeRoleMenu);
			document.removeEventListener("pointerdown", closeRoleMenuOutside);
		};
	});

	function submit(): void {
		const text = draft.trim();
		if ((!text && attachments.length === 0) || sendDisabled) return;
		if (text === "/mode") {
			draft = "";
			roleMenuOpen = true;
			return;
		}
		historyIndex = -1;
		draftBeforeHistory = "";
		onsend(text, attachments);
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
		if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
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
	{#if buildModeOffer}
		{#key buildModeOffer.id}
			<div class="mx-auto mb-2 flex w-[min(820px,100%)] flex-wrap items-center gap-3 rounded-lg border border-[rgba(255,82,82,.5)] bg-[linear-gradient(90deg,rgba(105,25,25,.45),rgba(50,16,20,.72))] px-3 py-2 shadow-[0_10px_30px_rgba(75,0,0,.2)]" role="status" aria-live="polite">
				<div class="relative grid h-8 w-8 shrink-0 place-items-center" aria-label="This suggestion expires in 10 seconds">
					<svg viewBox="0 0 36 36" class="h-8 w-8 -rotate-90" aria-hidden="true">
						<circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,120,120,.2)" stroke-width="3"></circle>
						<circle cx="18" cy="18" r="15" pathLength="100" fill="none" stroke="#ff6f61" stroke-width="3" stroke-linecap="round" stroke-dasharray="100" class="build-offer-countdown"></circle>
					</svg>
					<Hammer size={12} class="absolute text-[#ff9b91]" />
				</div>
				<div class="min-w-[160px] flex-1">
					<strong class="block text-[11px] text-[#ffd0cb]">Plan ready</strong>
					<span class="mt-0.5 block font-mono text-[8px] text-[#b98d89]">Switch {buildModeOffer.agent === "agent1" ? "Agent 1" : "Agent 2"} to Build mode?</span>
				</div>
				<button type="button" class="rounded px-2.5 py-1.5 font-mono text-[8px] text-[#bc8e8a] hover:bg-[rgba(255,255,255,.06)] hover:text-white" onclick={() => onbuildofferdismiss(buildModeOffer!.id)}>Cancel</button>
				<button type="button" disabled={roleDisabled} class="rounded border border-[rgba(255,111,97,.55)] bg-[rgba(255,82,82,.15)] px-3 py-1.5 font-mono text-[8px] font-semibold text-[#ff9b91] hover:bg-[rgba(255,82,82,.25)] disabled:cursor-not-allowed disabled:opacity-45" onclick={() => onbuildofferswitch(buildModeOffer!.id)}>Switch to Build mode</button>
			</div>
		{/key}
	{/if}
	{#if externalHarnessSetup?.slots.externalHarnessesEnabled}
		<div class="mx-auto mb-2 w-[min(820px,100%)] rounded-lg border border-[#33404a] bg-[#0a1015] p-2.5">
			<div class="mb-2 flex items-center justify-between gap-3 font-mono text-[8px] uppercase tracking-[.12em]">
				<strong class="text-[#d7e7ff]">External Agents</strong>
				<span class="text-[#8b969e]">{externalHarnessSetup.effectiveRouting === "auto" ? "Auto / Agent 1 first" : externalHarnessSetup.effectiveRouting === "none" ? "None" : "Disabled"}</span>
			</div>
			<div class="grid grid-cols-2 gap-2 narrow-520:grid-cols-1">
				{#each externalAgentSlots as { label, slot }}
					<div class={`rounded-md border px-2.5 py-2 ${slot.enabled ? "border-[#40512e] bg-[#11180c]" : "border-[#293239] bg-[#0d1217] opacity-60"}`}>
						<div class="flex items-center justify-between gap-2">
							<strong class="font-mono text-[9px] text-white">{label}</strong>
							<span class={`h-1.5 w-1.5 rounded-full ${slot.enabled ? "bg-[#9fca43]" : "bg-[#56616a]"}`}></span>
						</div>
						<span class="mt-1 block truncate font-mono text-[8px] text-[#7f8b93]">{slot.kind ?? "Not configured"}{slot.model ? ` · ${slot.model}` : ""} · {slot.enabled ? "On" : "Off"}</span>
					</div>
				{/each}
			</div>
			{#if externalHarnessSetup.blockingReason}
				<p class="m-0 mt-2 font-mono text-[8px] leading-[1.45] text-[#d6b16e]">{externalHarnessSetup.blockingReason}</p>
			{/if}
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
		<div class="relative min-h-[58px] pt-1 pr-[116px] pb-1 pl-[55px] narrow-520:min-h-[52px] narrow-520:pt-[3px] narrow-520:pr-[101px] narrow-520:pb-[3px] narrow-520:pl-[49px]">
			<input bind:this={fileEl} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple class="hidden" onchange={(event) => void attachImages(event)} />
			{#if attachments.length > 0}
				<div class="flex gap-2 overflow-x-auto pt-2 pb-1">
					{#each attachments as image, index (`${image.name ?? index}-${image.data.length}`)}
						{@const src = imageDataUrl(image)}
						{#if src}
							<div class="group relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-[#364149] bg-[#080b0e]">
								<img src={src} alt={image.name ?? `Attachment ${index + 1}`} class="h-full w-full object-cover" />
								<button type="button" aria-label={`Remove ${image.name ?? `attachment ${index + 1}`}`} class="absolute top-0.5 right-0.5 grid h-5 w-5 place-items-center rounded bg-black/80 text-white opacity-80 hover:opacity-100" onclick={() => (attachments = attachments.filter((_, candidate) => candidate !== index))}><X size={11} /></button>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
			{#if mcpPickerOpen}
				<div class="absolute right-3 bottom-[56px] left-3 z-30 max-h-[220px] overflow-y-auto rounded-lg border border-[rgba(88,132,196,.45)] bg-[#0c131c] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,.5)] narrow-520:bottom-[50px]">
					{#if filteredMcpSuggestions.length === 0}
						<p class="m-0 px-2 py-2 font-mono text-[10px] text-[#71808a]">No MCP match @{mcpQuery}</p>
					{:else}
						{#each filteredMcpSuggestions as suggestion, index (`${suggestion.kind}-${suggestion.serverName}-${suggestion.remoteName ?? ""}`)}
							<button
								type="button"
								class={`flex w-full cursor-pointer items-start gap-2 rounded-md border px-2 py-2 text-left ${index === mcpSelectedIndex ? "ring-1 ring-white/70" : "opacity-80 hover:opacity-100"}`}
								style={mentionStyle(suggestion.color ?? "base")}
								onmousedown={(event) => event.preventDefault()}
								onclick={() => insertMcpSuggestion(suggestion)}
							>
								<span class="mt-1 h-1.75 w-1.75 shrink-0 rounded-full" style={`background: ${MCP_COLOR_CSS[suggestion.color ?? "base"]}`}></span>
								<span class="min-w-0 flex-1">
									<strong class="block truncate font-mono text-[10px] font-semibold">{suggestion.kind === "server" ? suggestion.displayName : `${suggestion.displayName} / ${suggestion.remoteName}`}</strong>
									<small class="mt-0.5 block truncate font-mono text-[8px] text-[#758ca8]">{suggestion.kind === "server" ? suggestion.serverName : suggestion.toolName}</small>
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
						class="pointer-events-none absolute inset-0 overflow-hidden pt-3.5 pr-3 pb-3.5 pl-0 text-left text-[13px] leading-[1.55] whitespace-pre-wrap break-words narrow-520:py-3 narrow-520:text-[12px]"
					>
						{#each mentionSegments as segment, index (`${index}-${segment.text}`)}
							{#if segment.mention}
								<span class="font-semibold" style={mentionStyle(segment.mention.color ?? "base")}>{segment.text}</span>
							{:else}<span class="text-white">{segment.text}</span>{/if}
						{/each}
					</div>
				{/if}
				<textarea
					bind:this={promptEl}
					bind:value={draft}
					rows="1"
					placeholder="Describe a task for Klerm..."
					aria-label="Task prompt"
					class={`relative z-[1] block max-h-[min(150px,22dvh)] w-full resize-none border-0 bg-transparent pt-3.5 pr-3 pb-3.5 pl-0 text-left text-[13px] leading-[1.55] outline-0 [scrollbar-width:thin] placeholder:text-[#56616a] narrow-520:max-h-[min(120px,20dvh)] narrow-520:py-3 narrow-520:text-[12px] short-650:max-h-[min(110px,20dvh)] short-500:max-h-[min(82px,18dvh)] ${hasMcpMentions ? "text-transparent caret-white" : "text-white"}`}
					onkeydown={handleKeydown}
					oninput={handleInput}
				></textarea>
			</div>
			<button
				type="button"
				aria-label="Attach images"
				disabled={sendDisabled || taskActive || attachments.length >= 8}
				class="absolute bottom-2.5 left-[9px] grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-lg border border-[#293239] bg-[#11171c] text-[#9ba5ac] hover:border-[#46515a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 narrow-520:bottom-[7px] narrow-520:left-[7px] narrow-520:h-9 narrow-520:w-9"
				onclick={() => fileEl?.click()}
			>
				<Plus size={17} stroke-width={1.7} />
			</button>
			<div bind:this={roleMenuRoot} class="absolute right-[55px] bottom-2.5 narrow-520:right-[49px] narrow-520:bottom-[7px]">
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
											if (agent === "agent1") onlocalrolechange(option as WorkerRole);
											else onfrontierrolechange(option as WorkerRole);
										}}
									>
										{option === "planner" ? "Plan" : "Build"}
									</button>
								{/each}
							</div>
						{/each}
						<p class="m-0 border-t border-[#273038] px-1 pt-2 text-[8px] leading-[1.45] text-[#59656e]">Plan is read-only. Build has full tools and asks before risky actions.</p>
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
						disabled={sendDisabled || (!draft.trim() && attachments.length === 0)}
						class="grid h-full w-full cursor-pointer place-items-center rounded-lg border-0 bg-[#e1e6e9] text-[#0b0e10] enabled:hover:bg-white disabled:cursor-not-allowed disabled:bg-[#20272c] disabled:text-[#51585d]"
					>
						<Send size={17} stroke-width={1.7} />
					</button>
				{/if}
			</div>
		</div>
	</form>
	<div class="mx-auto mt-1.5 flex w-[min(820px,100%)] justify-end px-1">
		<label class="flex items-center gap-2 font-mono text-[8px] text-[#66727b]">
			<span>{activeAgentLabel} approval</span>
			<input
				type="range"
				min="0"
				max="2"
				step="1"
				value={approvalModes.indexOf(activeApprovalMode)}
				disabled={roleDisabled || activeRole !== "builder"}
				aria-label={`${activeAgentLabel} builder approval mode`}
				class="h-1 w-20 cursor-pointer accent-[#d6ff3f] disabled:cursor-not-allowed disabled:opacity-40"
				oninput={(event) => {
					const mode = approvalModes[Number(event.currentTarget.value)] ?? "risky";
					if (activeAgent === "agent1") onlocalapprovalchange(mode);
					else onfrontierapprovalchange(mode);
				}}
			/>
			<strong class="min-w-[66px] text-right font-medium text-[#aab4bb]">{activeRole === "builder" ? approvalLabel : "Plan locked"}</strong>
		</label>
	</div>

	<div class="mx-auto mt-1.5 grid w-[min(820px,100%)] grid-cols-3 gap-2 narrow-520:mt-[5px] narrow-520:gap-[5px]">
		<div class="min-w-0">
			<ModelSelect
				label="Agent 1 model"
				options={localOptions}
				value={localValue}
				disabled={localDisabled}
				placeholder="Discovering models..."
				profiles={profileDisabled ? [] : profiles}
				selectedProfile={profiles.find((profile) => profile.id === localProfileId)}
				onchange={(value) => {
					onlocalchange(value);
					if (localProfileId) onlocalprofilechange("");
				}}
				onprofile={(model, profileId) => {
					onlocalchange(model);
					onlocalprofilechange(profileId);
				}}
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
				profiles={profileDisabled ? [] : profiles}
				selectedProfile={profiles.find((profile) => profile.id === frontierProfileId)}
				flyout="left"
				onchange={(value) => {
					onfrontierchange(value);
					if (frontierProfileId) onfrontierprofilechange("");
				}}
				onprofile={(model, profileId) => {
					onfrontierchange(model);
					onfrontierprofilechange(profileId);
				}}
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
		<span class="narrow-720:hidden">Enter to send, Shift+Enter for a new line</span>
		<span aria-live="polite" class="flex items-center gap-1.5">
			{#if taskActive}
				<span class="h-2 w-2 animate-spin rounded-full border border-[#4e5962] border-t-[#d7dde1]"></span>
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
