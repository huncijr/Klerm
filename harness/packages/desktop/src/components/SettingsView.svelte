<script lang="ts">
	import { BookOpen, Check, Eye, Maximize2, Plus, Shrink, Trash2 } from "@lucide/svelte";
	import { slide } from "svelte/transition";
	import { untrack, onMount } from "svelte";
	import type { CliBinding } from "../../../coding-agent/src/klerm/cli-keybinding-store.ts";
	import { MCP_COLOR_CSS, MCP_COLORS, mcpDisplayName, mcpServerIdFromName } from "../lib/mcp-mentions.ts";
	import {
		addCodingHarnessSlot,
		codingHarnessDisplayName,
		codingHarnessReadiness,
		codingHarnessSlotsEqual,
		removeCodingHarnessSlot,
		updateCodingHarnessSlot,
	} from "../lib/coding-harnesses.ts";
	import type {
		CodingHarnessKind,
		CodingHarnessSetup,
		CustomModelEntry,
		DesktopAppearance,
		DesktopSettings,
		DesktopShortcut,
		KlermConfig,
		McpServerStatus,
		McpServerUpdate,
		McpStatus,
		ProviderAccount,
		ProviderConnect,
		ProviderOauthStep,
		ThinkingLevel,
		PersonalBot,
	} from "../lib/model.ts";
	import ModelSelect from "./ModelSelect.svelte";
	import { groupProviderAccounts, orderProviderGroups } from "../lib/provider-cards.ts";
	import ProviderLogo from "./ProviderLogo.svelte";
	import {
		saveDesktopSettingsChanges,
		shouldReplaceSettingsDrafts,
		type DesktopSettingsSaveOperation,
	} from "../lib/helpers.ts";
	import { normalizeShortcut, shortcutConflicts, shortcutsEqual, useDesktopShortcuts } from "../lib/shortcuts.ts";

	type SettingsTab = "general" | "agents" | "models" | "shortcuts" | "mcp" | "memory";

	let {
		settings,
		personalAgents,
		klermConfig,
		mcpStatus,
		mcpBusy,
		codingHarnessSetup,
		codingHarnessLoading,
		codingHarnessError,
		providers,
		providerBusy,
		fullscreen,
		ontogglefullscreen,
		onclose,
		onappearance,
		onmaxdelegationcycles,
		onrefreshharnesses,
		onrefreshharnessmodels,
		onsaveharnesses,
		onpersonalagentmodel,
		onaddmodel,
		onconnectprovider,
		ondisconnectprovider,
		oauthStep,
		onstartoauth,
		oncanceloauth,
		onoauthsubmit,
		onsharedmemorychange,
		onsavedefaultsharedmemory,
		onsavesharedmemory,
		ondeletesharedmemory,
		onrefreshmcp,
		onreloadmcp,
		onaddmcpserver,
		onshortcuts,
		onclikeybindings,
		focusTab,
		focusTabRequest = 0,
		ondirty,
	}: {
		settings: DesktopSettings;
		personalAgents: PersonalBot[];
		klermConfig: KlermConfig | undefined;
		mcpStatus: McpStatus | undefined;
		mcpBusy: boolean;
		codingHarnessSetup: CodingHarnessSetup | undefined;
		codingHarnessLoading: boolean;
		codingHarnessError: string;
		providers: ProviderAccount[];
		providerBusy: boolean;
		oauthStep: ProviderOauthStep | undefined;
		onstartoauth: (provider: string) => Promise<boolean>;
		oncanceloauth: () => void;
		onoauthsubmit: (value: string) => void;
		fullscreen: boolean;
		ontogglefullscreen: () => void;
		onclose: () => void;
		onappearance: (value: DesktopAppearance) => Promise<boolean>;
		onmaxdelegationcycles: (value: number) => Promise<boolean>;
		onrefreshharnesses: () => void;
		onrefreshharnessmodels: (kind: CodingHarnessKind) => Promise<void>;
		onsaveharnesses: (slots: CodingHarnessSetup["slots"]) => Promise<boolean>;
		onpersonalagentmodel: (botId: string, model: string) => Promise<void>;
		onaddmodel: (model: CustomModelEntry) => Promise<boolean>;
		onconnectprovider: (account: ProviderConnect) => Promise<boolean>;
		ondisconnectprovider: (provider: string) => Promise<boolean>;
		onsharedmemorychange: (memory: string, presetId?: string) => Promise<boolean>;
		onsavedefaultsharedmemory: (memory: string) => Promise<boolean>;
		onsavesharedmemory: (name: string, memory: string) => Promise<boolean>;
		ondeletesharedmemory: (id: string) => Promise<boolean>;
		onrefreshmcp: () => void;
		onreloadmcp: () => void;
		onaddmcpserver: (server: McpServerUpdate) => Promise<boolean>;
		onshortcuts: (shortcuts: DesktopShortcut[]) => Promise<boolean>;
		onclikeybindings: (overrides: Record<string, string[]>) => Promise<boolean>;
		focusTab?: SettingsTab;
		focusTabRequest?: number;
		ondirty?: (dirty: boolean) => void;
	} = $props();

	let tab = $state<SettingsTab>("general");
	let draftAppearance = $state<DesktopAppearance>("dark");
	let draftMaxDelegationCycles = $state(0);
	let draftShortcuts = $state<DesktopShortcut[]>([]);
	let draftCliBindings = $state<CliBinding[]>([]);
	let shortcutSearch = $state("");
	let bindingTab = $state<"desktop" | "cli">("desktop");
	const shortcuts = useDesktopShortcuts();
	$effect(() => { focusTabRequest; if (focusTab) tab = focusTab; });
	onMount(() => {
		const remove = [shortcuts?.register("save", saveCurrentSettingsContext, () => !savingChanges && !defaultSharedMemorySaving && capturingIndex === undefined, 100), shortcuts?.register("close", () => { if (capturingIndex !== undefined) capturingIndex = undefined; else if (customOpen) customOpen = false; else if (addingMcp) discardMcp(); else if (dirty) confirmDiscardSettings = true; else onclose(); }, undefined, 100)];
		return () => { for (const cleanup of remove) cleanup?.(); };
	});
	let draftHarnessSlots = $state<CodingHarnessSetup["slots"]>({
		externalHarnessesEnabled: false,
		agents: [{ id: "agent1", kind: "klerm", enabled: true, role: "builder", effort: "off", tools: [] }],
	});
	let savingChanges = $state(false);
	let saveNotice = $state("");
	let saveError = $state("");
	let draftsInitialized = $state(false);
	let appliedSettingsSource = "";
	let capturingIndex = $state<number | undefined>(undefined);
	let provider = $state("custom");
	let modelId = $state("");
	let modelName = $state("");
	let modelApi = $state("openai-completions");
	let modelUrl = $state("");
	let modelKey = $state("");
	let modelError = $state("");
	let customOpen = $state(false);
	let connectId = $state("");
	let oauthInput = $state("");
	let copiedUrl = $state("");
	let connectNotice = $state("");
	let connectNoticeTimer: ReturnType<typeof setTimeout> | undefined;
	let loadingHarnessModels = $state<CodingHarnessKind[]>([]);
	let confirmDiscardSettings = $state(false);
	let connectForms = $state<Record<string, { key: string; url: string; error: string; confirmDiscard: boolean }>>({});
	let sharedMemoryPresetName = $state("");
	let sharedMemoryPresetText = $state("");
	let sharedMemorySaving = $state(false);
	let defaultSharedMemoryDraft = $state("");
	let appliedDefaultSharedMemory = $state("");
	let defaultSharedMemorySaving = $state(false);
	let addMemoryOpen = $state(false);
	let mcpName = $state("");
	let mcpColor = $state<(typeof MCP_COLORS)[number]>("base");
	let mcpTransport = $state<"stdio" | "http" | "sse">("stdio");
	let mcpCommand = $state("");
	let mcpArgs = $state("");
	let mcpUrl = $state("");
	let mcpHeaders = $state("");
	let mcpFormError = $state("");
	let addingMcp = $state(false);

	const tabs: Array<{ id: SettingsTab; label: string }> = [
		{ id: "general", label: "General" },
		{ id: "agents", label: "Agents" },
		{ id: "models", label: "Models" },
		{ id: "shortcuts", label: "Shortcuts" },
		{ id: "mcp", label: "MCP" },
		{ id: "memory", label: "Memory" },
	];
	const mcpServers = $derived(mcpStatus?.servers ?? []);
	const providerCards = $derived(orderProviderGroups(groupProviderAccounts(providers)));
	let modelSearch = $state("");
	const filteredProviderCards = $derived.by(() => {
		const needle = modelSearch.trim().toLowerCase();
		if (!needle) return providerCards;
		return providerCards.filter(
			(card) =>
				card.id.toLowerCase().includes(needle) ||
				card.label.toLowerCase().includes(needle) ||
				card.members.some(
					(member) =>
						member.id.toLowerCase().includes(needle) ||
						member.label.toLowerCase().includes(needle),
				),
		);
	});
	const conflicts = $derived(shortcutConflicts(draftShortcuts));
	const connectGroup = $derived(providerCards.find((group) => group.id === connectId));
	const harnessOptions = $derived.by<Array<{ kind: CodingHarnessKind; label: string }>>(() => [
		...(codingHarnessSetup?.harnesses
			.filter((harness) => harness.available)
			.map((harness) => ({ kind: harness.kind, label: codingHarnessDisplayName(harness.kind) })) ?? []),
	]);

	function formFor(id: string): { key: string; url: string; error: string; confirmDiscard: boolean } {
		return connectForms[id] ?? { key: "", url: "", error: "", confirmDiscard: false };
	}

	function setForm(id: string, patch: Partial<{ key: string; url: string; error: string; confirmDiscard: boolean }>): void {
		connectForms = { ...connectForms, [id]: { ...formFor(id), ...patch } };
	}

	function openConnect(id: string): void {
		connectId = id;
		connectForms = {};
	}

	function showConnectNotice(message: string): void {
		connectNotice = message;
		if (connectNoticeTimer) clearTimeout(connectNoticeTimer);
		connectNoticeTimer = setTimeout(() => {
			connectNotice = "";
			connectNoticeTimer = undefined;
		}, 2000);
	}

	async function saveConnect(memberId: string): Promise<void> {
		const form = formFor(memberId);
		setForm(memberId, { error: "" });
		const saved = await onconnectprovider({
			provider: memberId,
			apiKey: form.key.trim() || undefined,
			baseUrl: form.url.trim() || undefined,
		});
		if (saved) {
			setForm(memberId, { key: "", url: "" });
			showConnectNotice("Added");
		} else setForm(memberId, { error: "Could not connect this provider." });
	}

	async function startOauth(memberId: string): Promise<void> {
		if (await onstartoauth(memberId)) showConnectNotice("Successfully auth");
	}

	function openAuthUrl(url: string): void {
		window.open(url, "_blank", "noopener,noreferrer");
	}

	async function discardConnect(memberId: string): Promise<void> {
		setForm(memberId, { error: "" });
		const removed = await ondisconnectprovider(memberId);
		if (removed) setForm(memberId, { confirmDiscard: false });
		else setForm(memberId, { error: "Could not discard this provider." });
	}

	function groupSubtitle(members: ProviderAccount[]): string {
		const configured = members.filter((member) => member.configured);
		if (configured.length > 0) {
			const count = configured.reduce((total, member) => total + member.models.length, 0);
			return `connected · ${count} model${count === 1 ? "" : "s"}`;
		}
		if (members.every((member) => member.local)) return members[0]?.detected ?? "not detected";
		return "not connected";
	}

	function harnessStatus(kind: CodingHarnessKind | null): string {
		if (kind === null) return "No coding harness assigned";
		const harness = codingHarnessSetup?.harnesses.find((item) => item.kind === kind);
		if (!harness) return "Discovery state unavailable";
		const state = harness.available ? (harness.builtin ? "Built-in · Available" : "Available") : "Not installed";
		const detail = harness.acp
			? `ACP${harness.acp.agentName ? ` · ${harness.acp.agentName}` : ""}`
			: harness.version;
		return detail ? `${state} · ${detail}` : state;
	}

	function harnessAvailable(kind: CodingHarnessKind | null): boolean {
		return kind === null || codingHarnessSetup?.harnesses.some((item) => item.kind === kind && item.available) === true;
	}

	function harnessOptionLabel(option: { kind: CodingHarnessKind; label: string }): string {
		const harness = codingHarnessSetup?.harnesses.find((item) => item.kind === option.kind);
		if (!harness) return option.label;
		const state = harness.available ? (harness.builtin ? "Built-in · Available" : "Available") : "Not installed";
		const detail = harness.acp
			? `ACP${harness.acp.agentName ? ` · ${harness.acp.agentName}` : ""}`
			: harness.version;
		return `${option.label} · ${state}${detail ? ` · ${detail}` : ""}`;
	}

	function harnessModels(kind: CodingHarnessKind | null): string[] {
		if (!kind) return [];
		return codingHarnessSetup?.harnesses.find((item) => item.kind === kind)?.models ?? [];
	}

	function agentNumber(id: string): number {
		const number = Number(id.replace(/^agent/, ""));
		return Number.isSafeInteger(number) ? number : 0;
	}

	function addAgent(): void {
		draftHarnessSlots = addCodingHarnessSlot(draftHarnessSlots);
	}

	function updateAgent(id: string, update: Partial<CodingHarnessSetup["slots"]["agents"][number]>): void {
		draftHarnessSlots = updateCodingHarnessSlot(draftHarnessSlots, id, update);
	}

	async function selectHarness(id: string, kind: CodingHarnessKind): Promise<void> {
		updateAgent(id, { kind, enabled: harnessAvailable(kind), model: undefined, personalBotId: undefined });
		if (kind === "klerm") return;
		await loadHarnessModels(kind);
	}

	async function loadHarnessModels(kind: CodingHarnessKind): Promise<void> {
		loadingHarnessModels = [...new Set([...loadingHarnessModels, kind])];
		try {
			await onrefreshharnessmodels(kind);
		} finally {
			loadingHarnessModels = loadingHarnessModels.filter((candidate) => candidate !== kind);
		}
	}

	async function addExternalHarnessAgent(kind: CodingHarnessKind): Promise<void> {
		if (!codingHarnessSetup || savingChanges) return;
		const slots = addCodingHarnessSlot(draftHarnessSlots);
		if (slots === draftHarnessSlots) return;
		const newId = slots.agents[slots.agents.length - 1]?.id;
		if (!newId) return;
		const previous = structuredClone(draftHarnessSlots);
		const next = updateCodingHarnessSlot(slots, newId, { kind, enabled: true, model: undefined });
		draftHarnessSlots = next;
		savingChanges = true;
		saveNotice = "";
		saveError = "";
		try {
			if (!(await onsaveharnesses(structuredClone(next)))) {
				draftHarnessSlots = previous;
				saveError = "Could not add the external agent.";
				return;
			}
			draftHarnessSlots = structuredClone(next);
			saveNotice = "Changes saved";
		} finally {
			savingChanges = false;
		}
		await loadHarnessModels(kind);
	}

	async function saveCustomModel(): Promise<void> {
		modelError = "";
		const saved = await onaddmodel({
			provider: provider.trim(),
			id: modelId.trim(),
			name: modelName.trim() || undefined,
			api: modelApi,
			baseUrl: modelUrl.trim(),
			apiKey: modelKey.trim() || undefined,
		});
		if (!saved) {
			modelError = "Could not save custom model.";
			return;
		}
		modelId = "";
		modelName = "";
		modelUrl = "";
		modelKey = "";
		customOpen = false;
	}

	async function saveMcp(): Promise<void> {
		mcpFormError = "";
		const entered = mcpName.trim();
		const name = mcpServerIdFromName(entered);
		if (!name) {
			mcpFormError = "Name needs at least one letter or number.";
			return;
		}
		const headers: Record<string, string> = {};
		for (const line of mcpHeaders.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const separator = trimmed.indexOf("=");
			if (separator < 1) {
				mcpFormError = "Headers must use Header-Name=value lines.";
				return;
			}
			headers[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
		}
		const label = entered === name ? undefined : entered;
		const server: McpServerUpdate =
			mcpTransport === "stdio"
				? { name, transport: "stdio", command: mcpCommand.trim(), args: mcpArgs.split(/\s+/).filter(Boolean), enabled: true, label, color: mcpColor }
				: { name, transport: mcpTransport, url: mcpUrl.trim(), headers, enabled: true, label, color: mcpColor };
		if (await onaddmcpserver(server)) {
			addingMcp = false;
			mcpName = "";
			mcpCommand = "";
			mcpArgs = "";
			mcpUrl = "";
			mcpHeaders = "";
		}
	}

	function discardMcp(): void {
		addingMcp = false;
		mcpName = "";
		mcpColor = "base";
		mcpTransport = "stdio";
		mcpCommand = "";
		mcpArgs = "";
		mcpUrl = "";
		mcpHeaders = "";
		mcpFormError = "";
	}

	function mcpDot(server: McpServerStatus): string {
		if (server.state === "failed") return "var(--color-danger)";
		if (server.color) return MCP_COLOR_CSS[server.color];
		return server.state === "connected" ? "var(--color-success)" : "var(--color-dim)";
	}

	function captureShortcut(index: number, event: KeyboardEvent): void {
		event.preventDefault();
		event.stopImmediatePropagation();
		const keys = normalizeShortcut(event);
		if (!keys) return;
		draftShortcuts = draftShortcuts.map((item, itemIndex) => (itemIndex === index ? { ...item, keys } : item));
		capturingIndex = undefined;
	}

	$effect(() => {
		if (capturingIndex === undefined) return;
		const onKey = (event: KeyboardEvent) => {
			if (capturingIndex !== undefined) captureShortcut(capturingIndex, event);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});

	$effect(() => {
		const next = settings.profiles.defaultSharedMemory;
		if (next === appliedDefaultSharedMemory) return;
		appliedDefaultSharedMemory = next;
		defaultSharedMemoryDraft = next;
	});

	const harnessDirty = $derived(
		codingHarnessSetup !== undefined && !codingHarnessSlotsEqual(draftHarnessSlots, codingHarnessSetup.slots),
	);
	const harnessReadiness = $derived(codingHarnessReadiness(codingHarnessSetup));

	let autoScanDone = $state(false);
	$effect(() => {
		if (autoScanDone || tab !== "general") return;
		if (draftHarnessSlots.externalHarnessesEnabled && codingHarnessSetup && !codingHarnessLoading) {
			autoScanDone = true;
			onrefreshharnesses();
		}
	});

	const externalHarnessChoices = $derived(
		codingHarnessSetup?.harnesses.filter(
			(harness) => harness.available && !harness.builtin && harness.kind !== "klerm",
		) ?? [],
	);
	const dirty = $derived(
		draftAppearance !== settings.appearance ||
			draftMaxDelegationCycles !== (klermConfig?.maxDelegationCycles ?? 0) ||
			harnessDirty ||
			!shortcutsEqual(draftShortcuts, settings.shortcuts) || JSON.stringify(draftCliBindings) !== JSON.stringify(settings.cliKeybindings),
	);
	$effect(() => { ondirty?.(dirty); });

	$effect(() => {
		const nextAppearance = settings.appearance;
		const nextCycles = klermConfig?.maxDelegationCycles ?? 0;
		const nextShortcuts = settings.shortcuts;
		const nextHarnessSlots = codingHarnessSetup?.slots;
		const source = `${nextAppearance}\0${nextCycles}\0${nextShortcuts.map((item) => item.keys).join(",")}\0${JSON.stringify(settings.cliKeybindings)}\0${nextHarnessSlots?.externalHarnessesEnabled ?? false}\0${nextHarnessSlots?.workTogetherEnabled ?? false}\0${nextHarnessSlots?.agents.map((agent) => `${agent.id}:${agent.kind}:${agent.enabled}:${agent.model ?? ""}`).join(",")}`;
		const replace = untrack(() =>
			shouldReplaceSettingsDrafts({
				appliedSource: appliedSettingsSource,
				source,
				initialized: draftsInitialized,
				saving: savingChanges,
				dirty,
			}),
		);
		if (!replace) return;
		appliedSettingsSource = source;
		untrack(() => {
			draftAppearance = nextAppearance;
			draftMaxDelegationCycles = nextCycles;
			draftShortcuts = nextShortcuts;
			draftCliBindings = settings.cliKeybindings;
			if (nextHarnessSlots) draftHarnessSlots = nextHarnessSlots;
			draftsInitialized = true;
		});
	});

	async function saveChanges(): Promise<void> {
		if (savingChanges) return;
		if (conflicts.size) { saveError = "Resolve conflicting desktop shortcuts before saving."; return; }
		savingChanges = true;
		saveNotice = "";
		saveError = "";
		try {
			const operations: DesktopSettingsSaveOperation[] = [];
			if (!shortcutsEqual(draftShortcuts, settings.shortcuts)) {
				const rows = $state.snapshot(draftShortcuts);
				operations.push({ error: "Could not save desktop shortcuts.", save: () => onshortcuts(rows) });
			}
			if (JSON.stringify(draftCliBindings) !== JSON.stringify(settings.cliKeybindings)) {
				const overrides = Object.fromEntries(draftCliBindings.map((row) => [row.id, row.keys.map((key) => key.trim()).filter(Boolean)]));
				operations.push({ error: "Could not save CLI keybindings.", save: () => onclikeybindings(overrides) });
			}
			const appearance = draftAppearance;
			const maxDelegationCycles = draftMaxDelegationCycles;
			if (harnessDirty) {
				const slots = structuredClone(draftHarnessSlots);
				operations.push({
					error: "Could not save external agent settings.",
					save: () => onsaveharnesses(slots),
				});
			}
			if (appearance !== settings.appearance) {
				operations.push({
					error: "Could not save appearance settings.",
					save: () => onappearance(appearance),
				});
			}
			if (maxDelegationCycles !== (klermConfig?.maxDelegationCycles ?? 0)) {
				operations.push({
					error: "Could not save delegation settings.",
					save: () => onmaxdelegationcycles(maxDelegationCycles),
				});
			}
			const error = await saveDesktopSettingsChanges(operations);
			if (error) {
				saveError = error;
				return;
			}
			draftAppearance = settings.appearance;
			draftMaxDelegationCycles = klermConfig?.maxDelegationCycles ?? 0;
			draftShortcuts = settings.shortcuts;
			draftCliBindings = settings.cliKeybindings;
			if (codingHarnessSetup) draftHarnessSlots = codingHarnessSetup.slots;
			saveNotice = "Changes saved";
		} finally {
			savingChanges = false;
		}
	}
	async function saveCurrentSettingsContext(): Promise<void> {
		if (customOpen) { await saveCustomModel(); return; }
		if (addingMcp) { await saveMcp(); return; }
		const providerForm = document.activeElement?.closest<HTMLFormElement>("form[data-provider-save]");
		if (providerForm?.dataset.providerSave) { await saveConnect(providerForm.dataset.providerSave); return; }
		if (tab === "memory" && addMemoryOpen && sharedMemoryPresetName.trim()) { await onsavesharedmemory(sharedMemoryPresetName, sharedMemoryPresetText); return; }
		if (tab === "memory" && defaultSharedMemoryDraft !== settings.profiles.defaultSharedMemory) {
			defaultSharedMemorySaving = true;
			try { await onsavedefaultsharedmemory(defaultSharedMemoryDraft); }
			finally { defaultSharedMemorySaving = false; }
			return;
		}
		await saveChanges();
	}

	async function toggleExternalHarnesses(): Promise<void> {
		if (!codingHarnessSetup || savingChanges) return;
		const previous = structuredClone(draftHarnessSlots);
		const next = {
			...draftHarnessSlots,
			externalHarnessesEnabled: !draftHarnessSlots.externalHarnessesEnabled,
			...(!draftHarnessSlots.externalHarnessesEnabled ? {} : { workTogetherEnabled: undefined }),
		};
		autoScanDone = next.externalHarnessesEnabled ? false : autoScanDone;
		draftHarnessSlots = next;
		savingChanges = true;
		saveNotice = "";
		saveError = "";
		try {
			if (!(await onsaveharnesses(structuredClone(next)))) {
				draftHarnessSlots = previous;
				saveError = codingHarnessError || "Could not save external harness settings.";
				return;
			}
			draftHarnessSlots = structuredClone(next);
			saveNotice = "Changes saved";
		} finally {
			savingChanges = false;
		}
	}

	async function toggleAgentEnabled(
		agent: CodingHarnessSetup["slots"]["agents"][number],
	): Promise<void> {
		if (!codingHarnessSetup || savingChanges) return;
		const previous = structuredClone(draftHarnessSlots);
		const next = updateCodingHarnessSlot(draftHarnessSlots, agent.id, {
			kind: agent.kind ?? "klerm",
			enabled: !agent.enabled,
		});
		draftHarnessSlots = next;
		savingChanges = true;
		saveNotice = "";
		saveError = "";
		try {
			if (!(await onsaveharnesses(structuredClone(next)))) {
				draftHarnessSlots = previous;
				saveError = codingHarnessError || "Could not save external agent settings.";
				return;
			}
			draftHarnessSlots = structuredClone(next);
			saveNotice = "Changes saved";
		} finally {
			savingChanges = false;
		}
	}

	function discardDrafts(): void {
		draftAppearance = settings.appearance;
		draftMaxDelegationCycles = klermConfig?.maxDelegationCycles ?? 0;
		draftShortcuts = settings.shortcuts.map((item) => ({ ...item }));
		draftCliBindings = $state.snapshot(settings.cliKeybindings);
		if (codingHarnessSetup) draftHarnessSlots = structuredClone(codingHarnessSetup.slots);
		saveError = "";
		saveNotice = "";
		confirmDiscardSettings = false;
	}
</script>

<section class="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
	{#if connectNotice}
		<div class="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4">
			<p class="m-0 rounded-md border border-line bg-panel px-3 py-1.5 font-sans text-[12px] text-success shadow-sm">{connectNotice}</p>
		</div>
	{/if}
	<header class="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-line px-5">
		<button
			type="button"
			aria-label={fullscreen ? "Exit fullscreen settings" : "Fullscreen settings"}
			aria-pressed={fullscreen}
			class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-panel hover:text-ink"
			onclick={ontogglefullscreen}
		>
			{#if fullscreen}<Shrink size={14} />{:else}<Maximize2 size={14} />{/if}
		</button>
		{#each tabs as item}
			<button
				type="button"
				class={`h-11 shrink-0 border-0 border-b-2 bg-transparent px-3 font-sans text-[12px] uppercase tracking-[.12em] ${
					tab === item.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
				}`}
				onclick={() => (tab = item.id)}
			>
				{item.label}
			</button>
		{/each}
		<div class="ml-auto flex shrink-0 flex-col items-end gap-1 py-1.5">
			{#if dirty}
				<button
					type="button"
					class="h-8 rounded-md border-0 bg-primary px-3 font-sans text-[12px] text-on-primary uppercase"
					onclick={() => void saveChanges()}
					disabled={savingChanges}
				>
					{savingChanges ? "Saving..." : "Save Settings"}
				</button>
			{:else}
				<button
					type="button"
					class="h-8 rounded-md border border-line bg-panel px-3 font-sans text-[12px] text-ink uppercase hover:border-line hover:text-ink"
					onclick={onclose}
				>
					Back
				</button>
			{/if}
			{#if saveNotice && !dirty}<span class="font-sans text-[11px] text-success">{saveNotice}</span>{/if}
			{#if saveError}<span role="alert" class="max-w-48 text-right font-sans text-[11px] leading-tight text-danger">{saveError}</span>{/if}
			{#if dirty}
				<button
					type="button"
					class="border-0 bg-transparent p-0 font-sans text-[11px] text-muted hover:text-ink"
					onclick={() => (confirmDiscardSettings = true)}
				>
					Discard changes
				</button>
			{/if}
		</div>
	</header>
	<div class="min-h-0 flex-1 overflow-y-auto px-7 py-6 narrow-720:px-4">
		{#if tab === "general"}
			<div class="mx-auto flex w-[min(420px,100%)] flex-col items-center gap-6 pt-10">
				<div class="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2.5">
					<div>
						<strong class="block text-[13px] text-ink">External harnesses</strong>
						<span class="mt-0.5 block font-sans text-[11px] text-muted">Enable Agent 2 and additional harness slots</span>
					</div>
					<button
						type="button"
						role="switch"
						aria-label="Toggle external harnesses"
						aria-checked={draftHarnessSlots.externalHarnessesEnabled}
						disabled={!codingHarnessSetup || savingChanges}
						class={`flex shrink-0 items-center gap-1.5 font-sans text-[11px] text-muted disabled:opacity-40 ${savingChanges ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"}`}
						onclick={() => void toggleExternalHarnesses()}
					>
						<span>{draftHarnessSlots.externalHarnessesEnabled ? "On" : "Off"}</span>
						<span class={`relative h-4 w-7 rounded-full transition-colors ${draftHarnessSlots.externalHarnessesEnabled ? "bg-warning-soft" : "bg-raised"}`} aria-hidden="true"><span class={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-primary transition-transform ${draftHarnessSlots.externalHarnessesEnabled ? "translate-x-3" : "translate-x-0"}`}></span></span>
					</button>
				</div>
				<p
					class={`m-0 w-full rounded-lg border px-3 py-2 font-sans text-[11px] leading-relaxed ${
						harnessReadiness.state === "ready"
							? "border-line bg-panel text-success"
							: harnessReadiness.state === "setup-required"
								? "border-warning bg-panel text-warning"
								: "border-line bg-bg text-muted"
					}`}
				>
					{draftHarnessSlots.externalHarnessesEnabled
						? harnessReadiness.detail
						: "External harnesses are disabled. Normal Klerm chat remains available."}
				</p>
				{#if codingHarnessError}
					<p class="m-0 w-full rounded-lg border border-line bg-panel px-3 py-2 font-sans text-[11px] leading-relaxed text-danger">
						{codingHarnessError}
					</p>
				{/if}
			{#if draftHarnessSlots.externalHarnessesEnabled}
				<div transition:slide={{ duration: 260 }} class="w-full pl-1">
					{#if codingHarnessLoading}
						<div class="flex items-center gap-2 py-1">
							<span class="relative flex h-2 w-2">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning-soft opacity-60"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-warning-soft"></span>
							</span>
							<p class="m-0 font-sans text-[12px] tracking-[.14em] text-warning uppercase">Auto search scanning...</p>
						</div>
					{:else if externalHarnessChoices.length > 0}
						<div class="flex items-center gap-2 pb-1.5">
							<span class="relative flex h-2 w-2">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
							</span>
							<p class="m-0 font-sans text-[12px] tracking-[.14em] text-success uppercase">Auto search found</p>
						</div>
						<div class="flex flex-col gap-0.5 border-l border-line pl-3">
							{#each externalHarnessChoices as harness (harness.kind)}
								<button
									type="button"
									disabled={savingChanges || codingHarnessLoading || draftHarnessSlots.agents.length >= 4}
									class="group flex items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
									onclick={() => void addExternalHarnessAgent(harness.kind)}
								>
									<span class="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line font-sans text-[12px] leading-none text-success transition-colors group-hover:border-success">+</span>
									<span class="font-sans text-[12px] text-ink group-hover:text-ink">Add {codingHarnessDisplayName(harness.kind)} agent</span>
									<span class="font-sans text-[11px] tracking-[.1em] text-muted uppercase">{harness.acp ? `ACP · ${harness.acp.agentName ?? harness.kind}` : harness.version ? harness.version : ""}</span>
								</button>
							{/each}
							{#if draftHarnessSlots.agents.length >= 4}
								<p class="m-0 px-2 font-sans text-[11px] text-warning">Agent limit reached (4) — remove an agent to add another harness.</p>
							{/if}
						</div>
					{:else}
						<div class="flex items-center gap-3 py-1 pl-3">
							<p class="m-0 font-sans text-[12px] text-muted">No external harnesses found yet.</p>
							<button type="button" disabled={savingChanges || codingHarnessLoading} class="cursor-pointer border-0 bg-transparent font-sans text-[12px] text-muted uppercase hover:text-accent disabled:cursor-not-allowed disabled:opacity-40" onclick={onrefreshharnesses}>Refresh</button>
						</div>
					{/if}
				</div>
			{/if}
				<p class="m-0 font-sans text-[12px] tracking-[.16em] text-dim uppercase">Appearance</p>
				<div class="grid w-full grid-cols-3 gap-2" role="group" aria-label="Appearance">
					{#each ["dark", "light", "system"] as option}
						<button
							type="button"
							aria-pressed={draftAppearance === option}
							class={`flex h-11 w-full items-center justify-center gap-2 rounded-md border text-[13px] font-medium capitalize ${draftAppearance === option ? "border-accent bg-accent-soft text-accent" : "border-line bg-panel text-muted hover:bg-raised"}`}
							onclick={() => (draftAppearance = option as DesktopAppearance)}
						>
							{#if draftAppearance === option}<Check size={14} aria-hidden="true" />{/if}{option}
						</button>
					{/each}
				</div>
				<p class="m-0 text-center text-[13px] text-muted">Light and Dark use independent palettes. System follows your operating system. Save Settings to apply.</p>
				<div class="w-full border-t border-line pt-6">
					<div class="mb-3 flex items-center justify-between gap-3">
						<span class="font-sans text-[12px] tracking-[.12em] text-dim uppercase">Max delegation cycles</span>
						<strong class="font-sans text-[12px] text-ink">{draftMaxDelegationCycles === 0 ? "Unlimited" : draftMaxDelegationCycles}</strong>
					</div>
					<input
						type="range"
						min="3"
						max="101"
						step="1"
						value={draftMaxDelegationCycles === 0 ? 101 : draftMaxDelegationCycles}
						aria-label="Maximum delegation cycles"
						class="w-full accent-warning"
						oninput={(event) => {
							const value = Number(event.currentTarget.value);
							draftMaxDelegationCycles = value === 101 ? 0 : value;
						}}
					/>
					<div class="mt-1 flex justify-between font-sans text-[11px] text-muted"><span>3</span><span>100</span><span>Unlimited</span></div>
					<p class="m-0 mt-3 text-center font-sans text-[12px] text-muted">Limits bidirectional Agent 1 / Agent 2 delegation cycles per task.</p>
				</div>
			</div>
		{:else if tab === "agents"}
			<div class="mx-auto w-[min(720px,100%)] space-y-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p class="m-0 font-sans text-[12px] tracking-[.16em] text-dim uppercase">Coding harness slots</p>
						<p class="m-0 mt-1 max-w-[560px] text-[13px]/[1.5] text-muted">Choose which installed coding harness occupies each desktop agent slot.</p>
					</div>
					<button type="button" class="h-8 rounded-md border border-line bg-bg px-3 font-sans text-[12px] text-ink disabled:opacity-50" onclick={onrefreshharnesses} disabled={codingHarnessLoading}>
						{codingHarnessLoading ? "Refreshing..." : "Refresh"}
					</button>
				</div>
				{#if codingHarnessError}
					<p class="m-0 rounded-lg border border-line bg-panel px-3 py-2 font-sans text-[12px] text-danger">{codingHarnessError}</p>
				{/if}
				{#if !codingHarnessSetup && !codingHarnessLoading && !codingHarnessError}
					<p class="m-0 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12px] text-muted">This backend does not advertise coding harness setup commands.</p>
				{/if}
				<div class="grid grid-cols-2 gap-3 narrow-720:grid-cols-1">
					{#each draftHarnessSlots.agents as value (value.id)}
						{@const models = harnessModels(value.kind)}
						<section class="rounded-xl border border-line bg-bg p-4">
							<div class="mb-4 flex flex-wrap items-center gap-2">
								<ProviderLogo id={value.kind ?? "custom"} label={value.kind ? codingHarnessDisplayName(value.kind) : `Agent ${agentNumber(value.id)}`} size={24} decorative />
								<strong class="mr-auto text-[13px] text-ink">Agent {agentNumber(value.id)}{value.kind ? ` · ${codingHarnessDisplayName(value.kind)}` : ""}</strong>
								<div class="flex items-center gap-1.5">
								{#if value.id !== "agent1" || draftHarnessSlots.agents.length >= 3}
										<button type="button" class="font-sans text-[11px] text-muted hover:text-danger" onclick={() => (draftHarnessSlots = removeCodingHarnessSlot(draftHarnessSlots, value.id))}>Remove</button>
									{/if}
									<button type="button" role="switch" aria-label={`Toggle Agent ${agentNumber(value.id)}`} aria-checked={value.enabled} disabled={savingChanges || (value.kind !== null && !harnessAvailable(value.kind))} class={`flex items-center gap-1.5 font-sans text-[11px] text-muted disabled:cursor-not-allowed disabled:opacity-35 ${savingChanges ? "cursor-wait" : "cursor-pointer"}`} onclick={() => void toggleAgentEnabled(value)}>
										<span>{value.enabled ? "On" : "Off"}</span>
										<span class={`relative h-4 w-7 rounded-full transition-colors ${value.enabled ? "bg-warning-soft" : "bg-raised"}`} aria-hidden="true"><span class={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-primary transition-transform ${value.enabled ? "translate-x-3" : "translate-x-0"}`}></span></span>
									</button>
								</div>
							</div>
							<label class="block font-sans text-[11px] tracking-[.12em] text-muted uppercase" for={`harness-${value.id}`}>Coding harness</label>
							<select
								id={`harness-${value.id}`}
								value={value.kind ?? ""}
								disabled={!codingHarnessSetup}
								class="mt-2 h-10 w-full rounded-md border border-line bg-bg px-3 font-sans text-[12px] text-ink outline-0  disabled:opacity-50"
								onchange={(event) => void selectHarness(value.id, event.currentTarget.value as CodingHarnessKind)}
							>
								{#if value.kind !== null && !harnessAvailable(value.kind)}
									<option value={value.kind} disabled>{codingHarnessDisplayName(value.kind)} · Not installed</option>
								{/if}
								{#each harnessOptions as option}
									<option value={option.kind}>{harnessOptionLabel(option)}</option>
								{/each}
							</select>
							<p class={`m-0 mt-3 break-words font-sans text-[12px] ${value.kind !== null && !harnessAvailable(value.kind) ? "text-danger" : "text-muted"}`}>{harnessStatus(value.kind)} · {value.enabled ? "On" : "Off"}</p>
							{#if value.kind && codingHarnessSetup?.harnesses.find((item) => item.kind === value.kind)?.error}
								<p class="m-0 mt-2 break-words font-sans text-[12px] text-danger">{codingHarnessSetup.harnesses.find((item) => item.kind === value.kind)?.error}</p>
							{/if}
							<label for={`personal-agent-${value.id}`} class="mt-4 block font-sans text-[11px] tracking-[.12em] text-muted uppercase">Personal Agent</label>
							<select id={`personal-agent-${value.id}`} class="mt-2 h-10 w-full rounded-md border border-line bg-bg px-3 font-sans text-[12px] text-ink" value={value.personalBotId ?? ""} onchange={(event) => { const bot = personalAgents.find((candidate) => candidate.id === event.currentTarget.value); updateAgent(value.id, { personalBotId: bot?.id, kind: bot ? "klerm" : value.kind, model: bot?.model, effort: bot?.effort ?? value.effort }); }}><option value="">Standalone harness configuration</option>{#each personalAgents as agent (agent.id)}<option value={agent.id} disabled={!agent.enabled}>{agent.name} · {agent.model || "No model"}</option>{/each}</select>
							<label class="mt-4 block font-sans text-[11px] tracking-[.12em] text-muted uppercase" for={`harness-model-${value.id}`}>Harness model</label>
							<div class="mt-2" id={`harness-model-${value.id}`}>
								<ModelSelect
									label={`Agent ${agentNumber(value.id)} model`}
									options={models.map((model) => ({ value: model, label: model }))}
									value={value.model ?? ""}
									disabled={models.length === 0 || (value.kind !== null && loadingHarnessModels.includes(value.kind))}
									placeholder={
										value.kind === "klerm"
											? "Use current Klerm model"
											: value.kind && loadingHarnessModels.includes(value.kind)
												? "Loading models..."
												: models.length > 0
													? "Select harness model"
													: "No models reported by this harness"
									}
									direction="down"
									allowEmpty
									emptyLabel={value.kind === "klerm" ? "Use current Klerm model" : "No model"}
									onchange={(next) => { if (value.personalBotId) void onpersonalagentmodel(value.personalBotId, next); else updateAgent(value.id, { model: next || undefined }); }}
								/>
							</div>
							<div class="mt-4 grid grid-cols-2 gap-2">
								<label class="font-sans text-[11px] tracking-[.12em] text-muted uppercase" for={`role-${value.id}`}>Role</label>
								<label class="font-sans text-[11px] tracking-[.12em] text-muted uppercase" for={`effort-${value.id}`}>Effort</label>
								<select id={`role-${value.id}`} value={value.role} class="h-9 rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink " onchange={(event) => updateAgent(value.id, { role: event.currentTarget.value as "planner" | "builder" })}><option value="planner">Plan</option><option value="builder">Build</option></select>
								<select id={`effort-${value.id}`} value={value.effort} disabled={!!value.personalBotId} class="h-9 rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink  disabled:opacity-50" onchange={(event) => updateAgent(value.id, { effort: event.currentTarget.value as ThinkingLevel })}>{#each ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as effort}<option value={effort}>{effort}</option>{/each}</select>
							</div>
							{#if value.personalBotId}<p class="mt-2 text-[12px] text-muted">Changing this model updates the linked Personal Agent. Reasoning is set there.</p>{/if}
							<label class="mt-4 block font-sans text-[11px] tracking-[.12em] text-muted uppercase" for={`tools-${value.id}`}>Tools</label>
							<input id={`tools-${value.id}`} value={value.tools.join(", ")} placeholder="default, or read, grep, bash" class="mt-2 h-9 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" onchange={(event) => updateAgent(value.id, { tools: event.currentTarget.value.split(/[\s,]+/).filter(Boolean) })} />
						</section>
					{/each}
				</div>
				<button type="button" disabled={draftHarnessSlots.agents.length >= 4} class="w-full rounded-lg border border-dashed border-line bg-bg py-3 font-sans text-[12px] text-ink hover:border-line hover:text-ink disabled:cursor-not-allowed disabled:opacity-40" onclick={addAgent}>+ Add agent</button>
			</div>
		{:else if tab === "models"}
			<div class="mx-auto w-[min(720px,100%)]">
				<input bind:value={modelSearch} placeholder="Search providers..." aria-label="Search providers" class="mb-3 h-9 w-full rounded-lg border border-line bg-bg px-3 font-sans text-[12px] text-ink outline-0 placeholder:text-dim focus:border-warning" />
				{#if filteredProviderCards.length === 0}
					<p class="m-0 rounded-lg border border-dashed border-line px-4 py-8 text-center font-sans text-[12px] text-muted">No providers match "{modelSearch.trim()}".</p>
				{/if}
				<div class="grid grid-cols-2 gap-3">
					{#each filteredProviderCards as card (card.id)}
						<button
							type="button"
							class={`flex min-h-[108px] flex-col items-start justify-between rounded-xl border bg-bg p-4 text-left hover:border-line ${card.members.some((member) => member.configured) ? "border-line" : "border-line"}`}
							onclick={() => openConnect(card.id)}
						>
							<ProviderLogo id={card.id} label={card.label} size={36} />
							<span>
								<strong class="block text-[14px] text-ink">{card.label}</strong>
								<small class="mt-1 block font-sans text-[12px] text-muted">{groupSubtitle(card.members)}</small>
							</span>
						</button>
					{/each}
					<button
						type="button"
						class="flex min-h-[108px] flex-col items-start justify-between rounded-xl border border-dashed border-line bg-bg p-4 text-left hover:border-line"
						onclick={() => (customOpen = true)}
					>
						<ProviderLogo id="custom" label="Add a custom model" size={36} />
						<span>
							<strong class="block text-[14px] text-ink">Add a custom model</strong>
							<small class="mt-1 block font-sans text-[12px] text-muted">Endpoint, API key, name</small>
						</span>
					</button>
				</div>
			</div>
		{:else if tab === "shortcuts"}
			<div class="mx-auto w-[min(860px,100%)]" data-shortcut-recorder={capturingIndex !== undefined ? "true" : "false"}>
				<div class="mb-3 flex flex-wrap gap-2"><button type="button" class="rounded border border-line px-3 py-2 text-[12px]" onclick={() => { bindingTab = "desktop"; capturingIndex = undefined; }}>Desktop</button><button type="button" class="rounded border border-line px-3 py-2 text-[12px]" onclick={() => { bindingTab = "cli"; capturingIndex = undefined; }}>CLI / TUI harness</button><input class="min-w-0 flex-1 rounded border border-line bg-bg px-3 py-2 text-[12px]" aria-label="Search shortcuts" placeholder="Search action, group or keys" bind:value={shortcutSearch} /></div>
				<p class="m-0 mb-3 font-sans text-[12px] text-muted">Desktop: click Record, press a chord, then Save changes. Ctrl/Cmd works on Windows/Linux and macOS. Conflicts are rejected; Clear disables an action. CLI bindings use their own native keybindings.json and apply on CLI restart/reload.</p>
				{#if bindingTab === "desktop"}
				<div class="grid grid-cols-2 gap-3">
					{#each draftShortcuts as shortcut, index}
						{#if !shortcutSearch || `${shortcut.action} ${shortcut.group} ${shortcut.keys}`.toLowerCase().includes(shortcutSearch.toLowerCase())}
						<div
							class={`rounded-xl border p-4 text-left ${
								conflicts.has(shortcut.id)
									? "border-warning bg-panel"
									: capturingIndex === index
										? "border-line bg-panel"
										: "border-line bg-bg"
							}`}
						>
							<p class="mb-1 text-[11px] uppercase text-muted">{shortcut.group}</p>
							<strong class="block text-[13px] text-ink">{shortcut.action}</strong>
							<code class={`mt-2 block font-mono text-[12px] ${conflicts.has(shortcut.id) ? "text-warning" : "text-info"}`}>
								{capturingIndex === index ? "Press a shortcut" : shortcut.keys || "Disabled"}
							</code>
							<p class="my-2 text-[12px] text-info">{shortcut.description}</p>
							<div class="flex gap-2 text-[12px]"><button type="button" class="rounded border border-line px-2 py-1" onclick={() => (capturingIndex = index)}>Record</button><button type="button" class="rounded border border-line px-2 py-1" onclick={() => { draftShortcuts = draftShortcuts.map((row, position) => position === index ? { ...row, keys: "" } : row); capturingIndex = undefined; }}>Clear</button><button type="button" class="rounded border border-line px-2 py-1" onclick={() => { draftShortcuts = draftShortcuts.map((row, position) => position === index ? { ...row, keys: row.defaultKeys } : row); capturingIndex = undefined; }}>Reset</button>{#if capturingIndex === index}<button type="button" onclick={() => (capturingIndex = undefined)}>Cancel</button>{/if}</div>
						</div>
						{/if}
					{/each}
				</div>
				{:else}
				<p class="mb-3 text-[12px] text-muted">Native CLI actions preserve existing editor/navigation semantics. One key chord per line, e.g. ctrl+alt+n. Empty disables. Reused CLI chords can be valid in different TUI contexts.</p>
				<div class="space-y-2">{#each draftCliBindings as row, index (row.id)}{#if !shortcutSearch || `${row.id} ${row.description} ${row.keys.join(" ")}`.toLowerCase().includes(shortcutSearch.toLowerCase())}<div class="grid grid-cols-[1fr_210px] gap-3 rounded-lg border border-line p-3"><div><strong class="block text-[12px]">{row.description}</strong><code class="text-[11px] text-info">{row.id}</code><p class="text-[12px] text-info">Default: {row.defaultKeys.join(" / ") || "Unbound"}</p></div><div><textarea aria-label={`CLI keys for ${row.id}`} class="w-full rounded border border-line bg-bg p-2 text-[12px]" rows="2" value={row.keys.join("\n")} oninput={(event) => { const keys = event.currentTarget.value.split("\n"); draftCliBindings = draftCliBindings.map((item, position) => position === index ? { ...item, keys } : item); }}></textarea><button type="button" class="text-[12px] text-info" onclick={() => (draftCliBindings = draftCliBindings.map((item, position) => position === index ? { ...item, keys: [...item.defaultKeys] } : item))}>Reset to defaults</button></div></div>{/if}{/each}</div>
				{/if}
			</div>
		{:else if tab === "mcp"}
			<div class="mx-auto w-[min(720px,100%)] space-y-3">
				<div class="flex gap-2">
					<button type="button" class="h-8 rounded-md border border-line bg-bg px-3 font-sans text-[12px] text-ink" onclick={onrefreshmcp} disabled={mcpBusy}>Refresh</button>
					{#if mcpStatus?.reloadRequired}
						<button type="button" class="h-8 rounded-md border border-line bg-bg px-3 font-sans text-[12px] text-ink" onclick={onreloadmcp} disabled={mcpBusy}>Reload</button>
					{/if}
				</div>
				{#each mcpServers as server (server.name)}
					<section class="rounded-lg border border-line bg-bg p-3">
						<div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full" style={`background:${mcpDot(server)}`}></span>
							<strong class="font-sans text-[13px] text-ink">{mcpDisplayName(server)}</strong>
						</div>
						<p class="m-0 mt-1 font-sans text-[11px] text-muted">{server.name} · {server.enabled ? server.state : "disabled"}</p>
						{#if server.error}
							<p class="m-0 mt-2 font-sans text-[12px] text-danger">{server.error}</p>
							{#if server.errorKind === "authentication"}
								<p class="m-0 mt-1 font-mono text-[11px] text-muted">Replace this server's credential with <code>/mcpset</code>, then reload. Klerm will not infer or display the secret.</p>
							{/if}
						{/if}
					</section>
				{/each}
				{#if addingMcp}
					<form
						class="space-y-2 rounded-xl border border-info bg-panel p-4 shadow-sm"
						onsubmit={(event) => { event.preventDefault(); void saveMcp(); }}
					>
						<div class="flex items-center gap-2">
							<span class="h-2 w-2 shrink-0 rounded-full" style={`background:${MCP_COLOR_CSS[mcpColor]}`}></span>
							<strong class="min-w-0 truncate font-sans text-[13px] text-ink">{mcpName.trim() || "New MCP server"}</strong>
							<span class="ml-auto shrink-0 rounded border border-warning bg-danger-soft px-1.5 py-0.5 font-sans text-[11px] tracking-[.08em] text-warning uppercase">Pending · not saved</span>
						</div>
						<p class="m-0 font-sans text-[11px] text-muted">
							{mcpTransport === "stdio" ? `${mcpCommand.trim() || "command"} ${mcpArgs.trim()}`.trim() || "stdio transport" : `${mcpTransport} · ${mcpUrl.trim() || "url"}`}
						</p>
						<input bind:value={mcpName} placeholder="name, e.g. Google Maps" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
						<div class="flex gap-1.5">
							{#each MCP_COLORS as color}
								<button type="button" aria-label={`${color} color`} class={`h-6 w-6 rounded-full border ${mcpColor === color ? "border-white" : "border-transparent"}`} style={`background:${MCP_COLOR_CSS[color]}`} onclick={() => (mcpColor = color)}></button>
							{/each}
						</div>
						<select bind:value={mcpTransport} class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0 ">
							<option value="stdio">stdio</option>
							<option value="http">http</option>
							<option value="sse">sse</option>
						</select>
						{#if mcpTransport === "stdio"}
							<input bind:value={mcpCommand} placeholder="command" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-ink outline-0" />
							<input bind:value={mcpArgs} placeholder="args" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
						{:else}
							<input bind:value={mcpUrl} placeholder="url" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
							<textarea bind:value={mcpHeaders} placeholder="non-secret headers, one Header-Name=value per line" class="min-h-16 w-full rounded-md border border-line bg-bg p-2 font-mono text-[12px] text-ink outline-0"></textarea>
						{/if}
						{#if mcpFormError}<p class="m-0 text-[12px] text-danger">{mcpFormError}</p>{/if}
						<div class="flex items-center gap-2 pt-1">
							<button type="submit" class="h-8 rounded-md bg-primary px-3 font-sans text-[12px] text-on-primary" disabled={mcpBusy}>Save</button>
							<button type="button" class="h-8 rounded-md border border-line bg-transparent px-3 font-sans text-[12px] text-danger hover:bg-panel" onclick={discardMcp}>Discard changes</button>
						</div>
					</form>
				{:else}
					<button type="button" class="h-9 w-full rounded-lg border border-line bg-bg font-sans text-[12px] text-ink" onclick={() => (addingMcp = true)}>Add more</button>
				{/if}
			</div>
		{:else}
			<div class="mx-auto w-[min(720px,100%)] space-y-4">
				<header>
					<p class="m-0 font-sans text-[11px] tracking-[.18em] text-muted uppercase">Team context</p>
					<h2 class="mt-1 mb-0 text-[18px] font-medium text-ink">Shared memory</h2>
					<p class="mt-1 mb-0 max-w-[560px] text-[12px] leading-[1.55] text-muted">Give every external agent the same project conventions and decisions. Klerm adds the current agent roster automatically when a task starts.</p>
				</header>
				<section class={`overflow-hidden rounded-2xl border ${settings.profiles.selectedSharedMemoryPresetId ? "border-line" : "border-warning"} bg-panel shadow-sm`}>
					<div class="flex items-start gap-3 border-b border-line-soft p-4">
						<span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-panel text-warning"><BookOpen size={17} stroke-width={1.6} /></span>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<strong class="text-[13px] text-ink">Default shared memory</strong>
								{#if !settings.profiles.selectedSharedMemoryPresetId}<span class="flex items-center gap-1 rounded-full border border-warning/60 bg-panel px-2 py-0.5 font-sans text-[11px] tracking-[.1em] text-warning uppercase"><Check size={9} /> Active</span>{/if}
							</div>
							<p class="m-0 mt-1 font-sans text-[11px] text-muted">Always kept separately, even while a saved memory is active.</p>
						</div>
					</div>
					<div class="p-4">
						<textarea bind:value={defaultSharedMemoryDraft} maxlength="8000" rows="6" aria-label="Default shared memory" placeholder="Project conventions, constraints, shared decisions..." class="w-full resize-y rounded-xl border border-line bg-bg/80 p-3 font-mono text-[12px] leading-[1.6] text-ink outline-0 transition-colors placeholder:text-dim focus:border-warning"></textarea>
						<div class="mt-3 flex flex-wrap items-center justify-between gap-2">
							<span class="font-sans text-[11px] text-dim">{defaultSharedMemoryDraft.length.toLocaleString()} / 8,000</span>
							<div class="flex gap-2">
								{#if settings.profiles.selectedSharedMemoryPresetId}<button type="button" class="h-8 rounded-lg border border-line px-3 font-sans text-[11px] text-ink hover:border-warning hover:text-ink" onclick={() => void onsharedmemorychange(settings.profiles.defaultSharedMemory)}>Use default</button>{/if}
								<button type="button" disabled={defaultSharedMemorySaving || defaultSharedMemoryDraft === settings.profiles.defaultSharedMemory} class="h-8 rounded-lg bg-primary px-3 font-sans text-[11px] text-on-primary disabled:cursor-not-allowed disabled:opacity-35" onclick={async () => { defaultSharedMemorySaving = true; await onsavedefaultsharedmemory(defaultSharedMemoryDraft); defaultSharedMemorySaving = false; }}>{defaultSharedMemorySaving ? "Saving..." : "Save default"}</button>
							</div>
						</div>
					</div>
				</section>
				<section class="overflow-hidden rounded-2xl border border-line bg-bg">
					<div class="flex items-start gap-3 border-b border-line bg-panel p-4">
						<span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-panel text-info"><Eye size={17} stroke-width={1.6} /></span>
						<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><strong class="text-[13px] text-ink">Prompt used by all agents</strong><span class="rounded-full border border-info bg-raised px-2 py-0.5 font-sans text-[11px] tracking-[.1em] text-info uppercase">{settings.profiles.sharedMemoryPresets.find((preset) => preset.id === settings.profiles.selectedSharedMemoryPresetId)?.name ?? "Default"}</span></div><p class="m-0 mt-1 font-sans text-[11px] leading-[1.5] text-muted">This exact shared block is added to every external agent prompt when the next task starts.</p></div>
					</div>
					<pre class="m-0 max-h-[280px] overflow-auto p-4 whitespace-pre-wrap font-mono text-[11px] leading-[1.65] text-ink [scrollbar-width:thin]">{codingHarnessSetup?.sharedContextPreview ?? "Shared prompt preview is unavailable until coding-harness setup is loaded."}</pre>
				</section>

				<button type="button" class="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-bg font-sans text-[12px] text-ink transition-colors hover:border-line hover:bg-panel hover:text-ink" onclick={() => (addMemoryOpen = !addMemoryOpen)}><Plus size={14} /> {addMemoryOpen ? "Close new memory" : "Add New Memory"}</button>
				{#if addMemoryOpen}
					<form class="space-y-3 rounded-2xl border border-line bg-bg p-4" onsubmit={async (event) => { event.preventDefault(); sharedMemorySaving = true; if (await onsavesharedmemory(sharedMemoryPresetName, sharedMemoryPresetText)) { sharedMemoryPresetName = ""; sharedMemoryPresetText = ""; addMemoryOpen = false; } sharedMemorySaving = false; }}>
						<div><strong class="text-[13px] text-ink">Create a saved memory</strong><p class="m-0 mt-1 font-sans text-[11px] text-muted">Saved memories are reusable contexts you can switch between without changing the default.</p></div>
						<input bind:value={sharedMemoryPresetName} maxlength="40" placeholder="Memory name" aria-label="Memory name" class="h-9 w-full rounded-lg border border-line bg-bg px-3 font-sans text-[12px] text-ink outline-0 focus:border-warning" />
						<textarea bind:value={sharedMemoryPresetText} maxlength="8000" rows="5" placeholder="Shared project conventions, constraints, and decisions" aria-label="New shared memory" class="w-full resize-y rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-[1.55] text-ink outline-0 focus:border-warning"></textarea>
						<div class="flex justify-end gap-2"><button type="button" class="h-8 rounded-lg px-3 font-sans text-[11px] text-muted" onclick={() => (addMemoryOpen = false)}>Cancel</button><button type="submit" disabled={!sharedMemoryPresetName.trim() || sharedMemorySaving} class="h-8 rounded-lg bg-primary px-3 font-sans text-[11px] text-on-primary disabled:opacity-40">{sharedMemorySaving ? "Saving..." : "Save memory"}</button></div>
					</form>
				{/if}

				<section>
					<div class="mb-2 flex items-end justify-between gap-2"><div><strong class="text-[13px] text-ink">Saved memories</strong><p class="m-0 mt-0.5 font-sans text-[11px] text-muted">{settings.profiles.sharedMemoryPresets.length} of 20</p></div></div>
					<div class="grid grid-cols-2 gap-3 narrow-720:grid-cols-1">
						{#each settings.profiles.sharedMemoryPresets as preset (preset.id)}
							<article class={`flex min-h-[132px] flex-col rounded-xl border p-3.5 transition-colors ${settings.profiles.selectedSharedMemoryPresetId === preset.id ? "border-warning bg-panel" : "border-line bg-bg hover:border-line"}`}>
								<div class="flex items-center gap-2"><strong class="min-w-0 flex-1 truncate text-[13px] text-ink">{preset.name}</strong>{#if settings.profiles.selectedSharedMemoryPresetId === preset.id}<span class="rounded-full bg-raised px-2 py-0.5 font-sans text-[11px] text-warning uppercase">Active</span>{/if}</div>
								<p class="mt-2 mb-3 line-clamp-3 whitespace-pre-wrap font-sans text-[11px] leading-[1.55] text-muted">{preset.memory || "Empty memory"}</p>
								<div class="mt-auto flex items-center justify-end gap-1"><button type="button" class="h-7 rounded-md px-2 font-sans text-[11px] text-info hover:bg-raised" onclick={() => void onsharedmemorychange(preset.memory, preset.id)}>{settings.profiles.selectedSharedMemoryPresetId === preset.id ? "Selected" : "Use memory"}</button><button type="button" aria-label={`Delete ${preset.name}`} class="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-panel hover:text-danger" onclick={() => void ondeletesharedmemory(preset.id)}><Trash2 size={12} /></button></div>
							</article>
						{/each}
					</div>
					{#if settings.profiles.sharedMemoryPresets.length === 0}<div class="rounded-xl border border-dashed border-line px-4 py-8 text-center font-sans text-[12px] text-muted">No saved memories yet.</div>{/if}
				</section>
			</div>
		{/if}
	</div>
	{#if connectGroup}
		<div class="absolute inset-0 z-20 grid place-items-center bg-black/70 p-4">
			<div class="max-h-full w-[min(420px,100%)] overflow-y-auto rounded-xl border border-line bg-bg p-4">
				<div class="flex items-center gap-2">
					<button type="button" aria-label="Back to providers" class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-panel hover:text-ink" onclick={() => (connectId = "")}>←</button>
					<ProviderLogo id={connectGroup.id} label={connectGroup.label} size={28} />
					<p class="m-0 font-sans text-[13px] text-ink">{connectGroup.label}</p>
					{#if connectGroup.members.some((member) => member.configured)}
						<span class="ml-auto rounded-full border border-line bg-panel px-2 py-0.5 font-sans text-[11px] text-success">connected</span>
					{/if}
				</div>
				{#each connectGroup.members as member (member.id)}
					{@const form = formFor(member.id)}
					<section class="mt-3 rounded-lg border border-line bg-bg p-3">
						<div class="flex items-center gap-2">
							<strong class="font-sans text-[12px] text-ink">{member.label}</strong>
							{#if member.configured}
								<span class="ml-auto font-sans text-[11px] text-success">connected{member.source ? ` · ${member.source}` : ""}</span>
							{:else}
								<span class="ml-auto font-sans text-[11px] text-muted">{member.local ? (member.detected ?? "not detected") : "not connected"}</span>
							{/if}
						</div>
						{#if member.local}
							<p class="m-0 mt-2 font-sans text-[12px] text-muted">Local runtime. No key needed.</p>
						{:else}
							{#if oauthStep?.provider === member.id}
								{@const step = oauthStep}
								<div class="mt-2 space-y-2 rounded-md border border-line bg-panel p-2.5">
									{#if step.message}<p class="m-0 font-sans text-[12px] text-warning">{step.message}</p>{/if}
									{#if step.url}
										<p class="m-0 font-sans text-[12px] text-muted">Complete login in your browser:</p>
										<div class="flex gap-1.5">
											<button type="button" class="min-w-0 flex-1 truncate rounded bg-bg px-2 py-1.5 text-left font-sans text-[12px] text-info underline hover:text-ink" onclick={() => openAuthUrl(step.url ?? "")}>{step.url}</button>
											<button type="button" class="h-7 shrink-0 rounded border border-line px-2 font-sans text-[12px] text-ink" onclick={() => {
												void navigator.clipboard.writeText(step.url ?? "");
												copiedUrl = member.id;
												setTimeout(() => {
													if (copiedUrl === member.id) copiedUrl = "";
												}, 1500);
											}}>
												{copiedUrl === member.id ? "Copied" : "Copy"}
											</button>
										</div>
										{#if step.instructions}<p class="m-0 font-sans text-[11px] text-muted">{step.instructions}</p>{/if}
									{/if}
										{#if step.userCode}
										<div class="flex items-center gap-2">
											<code class="rounded bg-bg px-2 py-1.5 font-mono text-[13px] font-bold tracking-[.2em] text-ink">{step.userCode}</code>
											{#if step.verificationUri}
												<button type="button" class="truncate font-sans text-[11px] text-info underline hover:text-ink" onclick={() => openAuthUrl(step.verificationUri ?? "")}>{step.verificationUri}</button>
											{/if}
										</div>
									{/if}
									{#if step.prompt}
										{#if step.prompt.options}
											<div class="space-y-1.5">
												{#each step.prompt.options as option (option.id)}
													<button type="button" class="block w-full rounded-md border border-line bg-bg px-2 py-2 text-left font-sans text-[12px] text-ink hover:border-line" onclick={() => onoauthsubmit(option.id)}>
														<strong class="block">{option.label}</strong>
														{#if option.description}<small class="mt-0.5 block text-[11px] text-muted">{option.description}</small>{/if}
													</button>
												{/each}
											</div>
										{:else}
											<form class="flex gap-1.5" onsubmit={(event) => { event.preventDefault(); onoauthsubmit(oauthInput); oauthInput = ""; }}>
												<input bind:value={oauthInput} placeholder={step.prompt.message} autocomplete="off" class="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
												<button type="submit" class="h-8 shrink-0 rounded-md bg-primary px-3 font-sans text-[12px] text-on-primary">Send</button>
											</form>
											<p class="m-0 font-sans text-[11px] text-muted">{step.prompt.message}</p>
										{/if}
									{/if}
									<button type="button" class="h-7 w-full rounded-md border border-line bg-transparent font-sans text-[12px] text-muted" onclick={oncanceloauth}>Cancel login</button>
								</div>
							{:else}
							<form data-provider-save={member.id} class="mt-2 space-y-2" onsubmit={(event) => { event.preventDefault(); void saveConnect(member.id); }}>
								<input value={form.key} oninput={(event) => setForm(member.id, { key: (event.currentTarget as HTMLInputElement).value })} type="password" placeholder={member.configured ? "new API key (optional)" : "API key"} autocomplete="off" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
								<input value={form.url} oninput={(event) => setForm(member.id, { url: (event.currentTarget as HTMLInputElement).value })} placeholder={member.defaultEndpoint ?? "endpoint override (optional)"} autocomplete="off" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
								{#if form.error}<p class="m-0 text-[12px] text-danger">{form.error}</p>{/if}
								<div class="flex gap-1.5">
									<button type="submit" class="h-8 flex-1 rounded-md bg-primary font-sans text-[12px] text-on-primary" disabled={providerBusy}>
										{providerBusy ? "Working..." : member.configured ? "Save" : "Connect"}
									</button>
									{#if member.supportsOauth}
										<button type="button" class="h-8 flex-1 rounded-md border border-line bg-panel font-sans text-[12px] text-success" disabled={providerBusy} onclick={() => void startOauth(member.id)}>OAuth</button>
									{/if}
								</div>
							</form>
							{/if}
							{#if member.configured}
								{#if form.confirmDiscard}
									<div class="mt-2 flex gap-2">
										<button type="button" class="h-8 flex-1 rounded-md border border-line bg-panel font-sans text-[12px] text-danger" onclick={() => void discardConnect(member.id)} disabled={providerBusy}>Confirm discard</button>
										<button type="button" class="h-8 flex-1 rounded-md border border-line bg-bg font-sans text-[12px] text-ink" onclick={() => setForm(member.id, { confirmDiscard: false })}>Keep</button>
									</div>
								{:else}
									<button type="button" class="mt-2 h-8 w-full rounded-md border border-line bg-bg font-sans text-[12px] text-danger" onclick={() => setForm(member.id, { confirmDiscard: true })}>Discard</button>
								{/if}
							{/if}
						{/if}
						<div class="mt-2 max-h-[140px] space-y-1 overflow-y-auto">
							{#each member.models as model}
								<p class="m-0 rounded-md bg-panel px-2 py-1.5 font-sans text-[12px] text-ink">{model}</p>
							{/each}
							{#if member.models.length === 0}
								<p class="m-0 font-sans text-[12px] text-muted">No models listed yet.</p>
							{/if}
						</div>
					</section>
				{/each}
			</div>
		</div>
	{/if}
	{#if confirmDiscardSettings}
		<div class="absolute inset-0 z-30 grid place-items-center bg-black/70 p-4">
			<div class="w-[min(360px,100%)] rounded-xl border border-line bg-bg p-4">
				<p class="m-0 font-sans text-[13px] text-ink">Are you sure you want to discard your changes?</p>
				<p class="mt-1 font-sans text-[12px] text-muted">Unsaved appearance, agent setup, and shortcut edits will be lost.</p>
				<div class="mt-3 flex gap-2">
					<button type="button" class="h-8 flex-1 rounded-md border border-line bg-panel font-sans text-[12px] text-danger" onclick={discardDrafts}>Discard</button>
					<button type="button" class="h-8 flex-1 rounded-md border border-line bg-bg font-sans text-[12px] text-ink" onclick={() => (confirmDiscardSettings = false)}>Keep</button>
				</div>
			</div>
		</div>
	{/if}
	{#if customOpen}
		<div class="absolute inset-0 z-20 grid place-items-center bg-black/70 p-4">
			<form class="w-[min(420px,100%)] space-y-2 rounded-xl border border-line bg-bg p-4" onsubmit={(event) => { event.preventDefault(); void saveCustomModel(); }}>
				<p class="m-0 mb-2 font-sans text-[13px] text-ink">Add a custom model</p>
				<input bind:value={provider} placeholder="provider id" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
				<input bind:value={modelId} placeholder="model id / name" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
				<input bind:value={modelName} placeholder="display name" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
				<input bind:value={modelUrl} placeholder="endpoint, e.g. http://127.0.0.1:1234/v1" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
				<select bind:value={modelApi} class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0 ">
					<option value="openai-completions">openai-completions</option>
					<option value="openai-responses">openai-responses</option>
					<option value="anthropic-messages">anthropic-messages</option>
				</select>
				<input bind:value={modelKey} type="password" placeholder="API key (optional)" class="h-8 w-full rounded-md border border-line bg-bg px-2 font-sans text-[12px] text-ink outline-0" />
				{#if modelError}<p class="m-0 text-[12px] text-danger">{modelError}</p>{/if}
				<div class="flex gap-2 pt-1">
					<button type="button" class="h-8 flex-1 rounded-md border border-line bg-bg font-sans text-[12px] text-ink" onclick={() => (customOpen = false)}>Cancel</button>
					<button type="submit" class="h-8 flex-1 rounded-md bg-primary font-sans text-[12px] text-on-primary">Save</button>
				</div>
			</form>
		</div>
	{/if}
</section>
