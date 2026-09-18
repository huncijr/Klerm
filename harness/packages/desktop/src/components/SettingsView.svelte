<script lang="ts">
	import { BookOpen, Check, Eye, Maximize2, Plus, Shrink, Trash2 } from "@lucide/svelte";
	import { slide } from "svelte/transition";
	import { untrack } from "svelte";
	import { MCP_COLOR_CSS, MCP_COLORS, mcpDisplayName, mcpServerIdFromName } from "../lib/mcp-mentions.ts";
	import { addCodingHarnessSlot, codingHarnessSlotsEqual, removeCodingHarnessSlot, updateCodingHarnessSlot } from "../lib/coding-harnesses.ts";
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
		PersonalBot,
		ProviderAccount,
		ProviderConnect,
		ProviderOauthStep,
		ThinkingLevel,
	} from "../lib/model.ts";
	import ModelSelect from "./ModelSelect.svelte";
	import { groupProviderAccounts, orderProviderGroups } from "../lib/provider-cards.ts";
	import ProviderLogo from "./ProviderLogo.svelte";
	import {
		saveDesktopSettingsChanges,
		shouldReplaceSettingsDrafts,
		type DesktopSettingsSaveOperation,
	} from "../lib/helpers.ts";
	import { normalizeShortcut, shortcutConflicts } from "../lib/shortcuts.ts";

	type SettingsTab = "general" | "agents" | "models" | "shortcuts" | "mcp" | "memory";

	let {
		settings,
		klermConfig,
		mcpStatus,
		mcpBusy,
		codingHarnessSetup,
		codingHarnessLoading,
		codingHarnessError,
		providers,
		providerBusy,
		personalBots,
		fullscreen,
		ontogglefullscreen,
		onclose,
		onappearance,
		onmaxdelegationcycles,
		onrefreshharnesses,
		onrefreshharnessmodels,
		onsaveharnesses,
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
	}: {
		settings: DesktopSettings;
		klermConfig: KlermConfig | undefined;
		mcpStatus: McpStatus | undefined;
		mcpBusy: boolean;
		codingHarnessSetup: CodingHarnessSetup | undefined;
		codingHarnessLoading: boolean;
		codingHarnessError: string;
		providers: ProviderAccount[];
		providerBusy: boolean;
		personalBots: PersonalBot[];
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
	} = $props();

	let tab = $state<SettingsTab>("general");
	let draftAppearance = $state<DesktopAppearance>("dark");
	let draftMaxDelegationCycles = $state(0);
	let draftShortcuts = $state<DesktopShortcut[]>([]);
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
			.map((harness) => ({ kind: harness.kind, label: codingHarnessLabel(harness.kind) })) ?? []),
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

	function codingHarnessLabel(kind: CodingHarnessKind): string {
		if (kind === "claude-code") return "Claude Code";
		if (kind === "opencode") return "OpenCode";
		if (kind === "cline") return "Cline";
		if (kind === "codex") return "Codex";
		if (kind === "pi") return "Pi";
		return "Klerm";
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
		updateAgent(id, { kind, enabled: harnessAvailable(kind), model: undefined });
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
		if (server.state === "failed") return "#f09b93";
		if (server.color) return MCP_COLOR_CSS[server.color];
		return server.state === "connected" ? "#d6ff3f" : "#59646d";
	}

	function captureShortcut(index: number, event: KeyboardEvent): void {
		event.preventDefault();
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
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
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
			draftShortcuts !== settings.shortcuts,
	);

	$effect(() => {
		const nextAppearance = settings.appearance;
		const nextCycles = klermConfig?.maxDelegationCycles ?? 0;
		const nextShortcuts = settings.shortcuts;
		const nextHarnessSlots = codingHarnessSetup?.slots;
		const source = `${nextAppearance}\0${nextCycles}\0${nextShortcuts.map((item) => item.keys).join(",")}\0${nextHarnessSlots?.externalHarnessesEnabled ?? false}\0${nextHarnessSlots?.workTogetherEnabled ?? false}\0${nextHarnessSlots?.agents.map((agent) => `${agent.id}:${agent.kind}:${agent.enabled}:${agent.model ?? ""}`).join(",")}`;
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
			if (nextHarnessSlots) draftHarnessSlots = nextHarnessSlots;
			draftsInitialized = true;
		});
	});

	async function saveChanges(): Promise<void> {
		if (savingChanges) return;
		savingChanges = true;
		saveNotice = "";
		saveError = "";
		try {
			const operations: DesktopSettingsSaveOperation[] = [];
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
			if (codingHarnessSetup) draftHarnessSlots = codingHarnessSetup.slots;
			saveNotice = "Changes saved";
		} finally {
			savingChanges = false;
		}
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
				saveError = "Could not save external harness settings.";
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
				saveError = "Could not save external agent settings.";
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
		if (codingHarnessSetup) draftHarnessSlots = structuredClone(codingHarnessSetup.slots);
		saveError = "";
		saveNotice = "";
		confirmDiscardSettings = false;
	}
</script>

<section class="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
	{#if connectNotice}
		<div class="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4">
			<p class="m-0 rounded-md border border-[#2c4a34] bg-[#0d1510] px-3 py-1.5 font-mono text-[10px] text-[#81c995] shadow-[0_8px_24px_rgba(0,0,0,.4)]">{connectNotice}</p>
		</div>
	{/if}
	<header class="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-line px-5">
		<button
			type="button"
			aria-label={fullscreen ? "Exit fullscreen settings" : "Fullscreen settings"}
			aria-pressed={fullscreen}
			class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#8b969e] hover:bg-[#141a1f] hover:text-white"
			onclick={ontogglefullscreen}
		>
			{#if fullscreen}<Shrink size={14} />{:else}<Maximize2 size={14} />{/if}
		</button>
		{#each tabs as item}
			<button
				type="button"
				class={`h-11 shrink-0 border-0 border-b-2 bg-transparent px-3 font-mono text-[10px] uppercase tracking-[.12em] ${
					tab === item.id ? "border-white text-white" : "border-transparent text-[#6d7a83] hover:text-[#d5dce0]"
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
					class="h-8 rounded-md border-0 bg-[#e8eef2] px-3 font-mono text-[10px] text-[#091019] uppercase"
					onclick={() => void saveChanges()}
					disabled={savingChanges}
				>
					{savingChanges ? "Saving..." : "Save Settings"}
				</button>
			{:else}
				<button
					type="button"
					class="h-8 rounded-md border border-[#303a42] bg-[#0d1217] px-3 font-mono text-[10px] text-[#aeb8be] uppercase hover:border-[#56636c] hover:text-white"
					onclick={onclose}
				>
					Back
				</button>
			{/if}
			{#if saveNotice && !dirty}<span class="font-mono text-[8px] text-[#81c995]">{saveNotice}</span>{/if}
			{#if saveError}<span role="alert" class="max-w-48 text-right font-mono text-[8px] leading-tight text-[#f3a49c]">{saveError}</span>{/if}
			{#if dirty}
				<button
					type="button"
					class="border-0 bg-transparent p-0 font-mono text-[8px] text-[#66747d] hover:text-[#d5dce0]"
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
				<div class="flex w-full items-center justify-between gap-3 rounded-lg border border-[#303a42] bg-[#0a0f13] px-3 py-2.5">
					<div>
						<strong class="block text-[11px] text-white">External harnesses</strong>
						<span class="mt-0.5 block font-mono text-[8px] text-[#66747d]">Enable Agent 2 and additional harness slots</span>
					</div>
					<button
						type="button"
						role="switch"
						aria-label="Toggle external harnesses"
						aria-checked={draftHarnessSlots.externalHarnessesEnabled}
						disabled={!codingHarnessSetup || savingChanges}
						class={`flex shrink-0 items-center gap-1.5 font-mono text-[8px] text-[#8b969e] disabled:opacity-40 ${savingChanges ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"}`}
						onclick={() => void toggleExternalHarnesses()}
					>
						<span>{draftHarnessSlots.externalHarnessesEnabled ? "On" : "Off"}</span>
						<span class={`relative h-4 w-7 rounded-full transition-colors ${draftHarnessSlots.externalHarnessesEnabled ? "bg-[#607f20]" : "bg-[#303840]"}`} aria-hidden="true"><span class={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform ${draftHarnessSlots.externalHarnessesEnabled ? "translate-x-3" : "translate-x-0"}`}></span></span>
					</button>
			</div>
			{#if draftHarnessSlots.externalHarnessesEnabled}
				<div transition:slide={{ duration: 260 }} class="w-full pl-1">
					{#if codingHarnessLoading}
						<div class="flex items-center gap-2 py-1">
							<span class="relative flex h-2 w-2">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d6a63f] opacity-60"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-[#d6a63f]"></span>
							</span>
							<p class="m-0 font-mono text-[9px] tracking-[.14em] text-[#d6a63f] uppercase">Auto search scanning...</p>
						</div>
					{:else if externalHarnessChoices.length > 0}
						<div class="flex items-center gap-2 pb-1.5">
							<span class="relative flex h-2 w-2">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#81c995] opacity-50"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-[#81c995]"></span>
							</span>
							<p class="m-0 font-mono text-[9px] tracking-[.14em] text-[#81c995] uppercase">Auto search found</p>
						</div>
						<div class="flex flex-col gap-0.5 border-l border-[#2c4a34] pl-3">
							{#each externalHarnessChoices as harness (harness.kind)}
								<button
									type="button"
									disabled={savingChanges || codingHarnessLoading || draftHarnessSlots.agents.length >= 4}
									class="group flex items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left transition-colors hover:bg-[rgba(38,77,48,.18)] disabled:cursor-not-allowed disabled:opacity-40"
									onclick={() => void addExternalHarnessAgent(harness.kind)}
								>
									<span class="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-[#3d4a54] font-mono text-[9px] leading-none text-[#81c995] transition-colors group-hover:border-[#81c995]">+</span>
									<span class="font-mono text-[10px] text-[#d7e7ff] group-hover:text-white">Add {codingHarnessLabel(harness.kind)} agent</span>
									<span class="font-mono text-[7px] tracking-[.1em] text-[#7b868e] uppercase">{harness.acp ? `ACP · ${harness.acp.agentName ?? harness.kind}` : harness.version ? harness.version : ""}</span>
								</button>
							{/each}
							{#if draftHarnessSlots.agents.length >= 4}
								<p class="m-0 px-2 font-mono text-[8px] text-[#d6a63f]">Agent limit reached (4) — remove an agent to add another harness.</p>
							{/if}
						</div>
					{:else}
						<div class="flex items-center gap-3 py-1 pl-3">
							<p class="m-0 font-mono text-[9px] text-[#66747d]">No external harnesses found yet.</p>
							<button type="button" disabled={savingChanges || codingHarnessLoading} class="cursor-pointer border-0 bg-transparent font-mono text-[9px] text-[#69757e] uppercase hover:text-accent disabled:cursor-not-allowed disabled:opacity-40" onclick={onrefreshharnesses}>Refresh</button>
						</div>
					{/if}
				</div>
			{/if}
				<p class="m-0 font-mono text-[9px] tracking-[.16em] text-[#536069] uppercase">Appearance</p>
				<div class="flex w-full flex-col gap-2">
					{#each ["dark", "light", "system"] as option}
						<button
							type="button"
							class={`h-11 w-full rounded-lg border font-mono text-[11px] capitalize ${draftAppearance === option ? "border-[#d7e7ff] bg-[#141a1f] text-white" : "border-[#303a42] bg-[#0a0f13] text-[#8b969e]"}`}
							onclick={() => (draftAppearance = option as DesktopAppearance)}
						>
							{option}
						</button>
					{/each}
				</div>
				<p class="m-0 text-center font-mono text-[9px] text-[#66747d]">Saved preference only. Light theme is not applied yet.</p>
				<div class="w-full border-t border-[#232c34] pt-6">
					<div class="mb-3 flex items-center justify-between gap-3">
						<span class="font-mono text-[9px] tracking-[.12em] text-[#536069] uppercase">Max delegation cycles</span>
						<strong class="font-mono text-[10px] text-[#d7e7ff]">{draftMaxDelegationCycles === 0 ? "Unlimited" : draftMaxDelegationCycles}</strong>
					</div>
					<input
						type="range"
						min="3"
						max="101"
						step="1"
						value={draftMaxDelegationCycles === 0 ? 101 : draftMaxDelegationCycles}
						aria-label="Maximum delegation cycles"
						class="w-full accent-[#d6ff3f]"
						oninput={(event) => {
							const value = Number(event.currentTarget.value);
							draftMaxDelegationCycles = value === 101 ? 0 : value;
						}}
					/>
					<div class="mt-1 flex justify-between font-mono text-[8px] text-[#66747d]"><span>3</span><span>100</span><span>Unlimited</span></div>
					<p class="m-0 mt-3 text-center font-mono text-[9px] text-[#66747d]">Limits bidirectional Agent 1 / Agent 2 delegation cycles per task.</p>
				</div>
			</div>
		{:else if tab === "agents"}
			<div class="mx-auto w-[min(720px,100%)] space-y-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p class="m-0 font-mono text-[9px] tracking-[.16em] text-[#536069] uppercase">Coding harness slots</p>
						<p class="m-0 mt-1 max-w-[560px] text-[11px]/[1.5] text-[#8b969e]">Choose which installed coding harness occupies each desktop agent slot.</p>
					</div>
					<button type="button" class="h-8 rounded-md border border-[#3d4a54] bg-[#05080b] px-3 font-mono text-[9px] text-[#d7e7ff] disabled:opacity-50" onclick={onrefreshharnesses} disabled={codingHarnessLoading}>
						{codingHarnessLoading ? "Refreshing..." : "Refresh"}
					</button>
				</div>
				{#if codingHarnessError}
					<p class="m-0 rounded-lg border border-[#5a3434] bg-[#170d0d] px-3 py-2 font-mono text-[9px] text-[#f3a49c]">{codingHarnessError}</p>
				{/if}
				{#if !codingHarnessSetup && !codingHarnessLoading && !codingHarnessError}
					<p class="m-0 rounded-lg border border-[#303a42] bg-[#0a0f13] px-3 py-2 font-mono text-[9px] text-[#8b969e]">This backend does not advertise coding harness setup commands.</p>
				{/if}
				<div class="grid grid-cols-2 gap-3 narrow-720:grid-cols-1">
					{#each draftHarnessSlots.agents as value (value.id)}
						{@const models = harnessModels(value.kind)}
						{@const personality = personalBots.find((bot) => bot.id === value.personalBotId)}
						<section class="rounded-xl border border-[#232c34] bg-[#0a0f13] p-4">
							<div class="mb-4 flex flex-wrap items-center gap-2">
								<ProviderLogo id={value.kind ?? "custom"} label={value.kind ? codingHarnessLabel(value.kind) : `Agent ${agentNumber(value.id)}`} size={24} decorative />
								<strong class="mr-auto text-[12px] text-white">Agent {agentNumber(value.id)}{value.kind ? ` · ${codingHarnessLabel(value.kind)}` : ""}</strong>
								<div class="flex items-center gap-1.5">
								{#if value.id !== "agent1" || draftHarnessSlots.agents.length >= 3}
										<button type="button" class="font-mono text-[8px] text-[#8b969e] hover:text-[#f3a49c]" onclick={() => (draftHarnessSlots = removeCodingHarnessSlot(draftHarnessSlots, value.id))}>Remove</button>
									{/if}
									<button type="button" role="switch" aria-label={`Toggle Agent ${agentNumber(value.id)}`} aria-checked={value.enabled} disabled={savingChanges || (value.kind !== null && !harnessAvailable(value.kind))} class={`flex items-center gap-1.5 font-mono text-[8px] text-[#8b969e] disabled:cursor-not-allowed disabled:opacity-35 ${savingChanges ? "cursor-wait" : "cursor-pointer"}`} onclick={() => void toggleAgentEnabled(value)}>
										<span>{value.enabled ? "On" : "Off"}</span>
										<span class={`relative h-4 w-7 rounded-full transition-colors ${value.enabled ? "bg-[#607f20]" : "bg-[#303840]"}`} aria-hidden="true"><span class={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform ${value.enabled ? "translate-x-3" : "translate-x-0"}`}></span></span>
									</button>
								</div>
							</div>
							<label class="block font-mono text-[8px] tracking-[.12em] text-[#66747d] uppercase" for={`harness-${value.id}`}>Coding harness</label>
							<select
								id={`harness-${value.id}`}
								value={value.kind ?? ""}
								disabled={!codingHarnessSetup}
								class="mt-2 h-10 w-full rounded-md border border-[#303a42] bg-[#05080b] px-3 font-mono text-[10px] text-white outline-0 [color-scheme:dark] disabled:opacity-50"
								onchange={(event) => void selectHarness(value.id, event.currentTarget.value as CodingHarnessKind)}
							>
								{#if value.kind !== null && !harnessAvailable(value.kind)}
									<option value={value.kind} disabled>{codingHarnessLabel(value.kind)} · Not installed</option>
								{/if}
								{#each harnessOptions as option}
									<option value={option.kind}>{harnessOptionLabel(option)}</option>
								{/each}
							</select>
							<p class={`m-0 mt-3 break-words font-mono text-[9px] ${value.kind !== null && !harnessAvailable(value.kind) ? "text-[#f3a49c]" : "text-[#7b868e]"}`}>{harnessStatus(value.kind)} · {value.enabled ? "On" : "Off"}</p>
							{#if value.kind && codingHarnessSetup?.harnesses.find((item) => item.kind === value.kind)?.error}
								<p class="m-0 mt-2 break-words font-mono text-[9px] text-[#f3a49c]">{codingHarnessSetup.harnesses.find((item) => item.kind === value.kind)?.error}</p>
							{/if}
							<label class="mt-4 block font-mono text-[8px] tracking-[.12em] text-[#66747d] uppercase" for={`harness-model-${value.id}`}>Harness model</label>
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
									memories={personalBots}
									selectedMemoryId={value.personalBotId}
									onchange={(next) => updateAgent(value.id, { model: next || undefined })}
									onmemory={(model, botId) => {
										const bot = personalBots.find((candidate) => candidate.id === botId);
										updateAgent(value.id, {
											...(model ? { model } : {}),
											...(bot
												? { personalBotId: bot.id, memoryProfileId: bot.profileId }
												: { personalBotId: undefined, memoryProfileId: undefined }),
										});
									}}
								/>
							</div>
							{#if personality}<p class="m-0 mt-1 font-mono text-[8px] text-[#81c995]">Memory: {personality.name}</p>{/if}
							<div class="mt-4 grid grid-cols-2 gap-2">
								<label class="font-mono text-[8px] tracking-[.12em] text-[#66747d] uppercase" for={`role-${value.id}`}>Role</label>
								<label class="font-mono text-[8px] tracking-[.12em] text-[#66747d] uppercase" for={`effort-${value.id}`}>Effort</label>
								<select id={`role-${value.id}`} value={value.role} class="h-9 rounded-md border border-[#303a42] bg-[#05080b] px-2 font-mono text-[9px] text-white [color-scheme:dark]" onchange={(event) => updateAgent(value.id, { role: event.currentTarget.value as "planner" | "builder" })}><option value="planner">Plan</option><option value="builder">Build</option></select>
								<select id={`effort-${value.id}`} value={value.effort} class="h-9 rounded-md border border-[#303a42] bg-[#05080b] px-2 font-mono text-[9px] text-white [color-scheme:dark]" onchange={(event) => updateAgent(value.id, { effort: event.currentTarget.value as ThinkingLevel })}>{#each ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as effort}<option value={effort}>{effort}</option>{/each}</select>
							</div>
							<label class="mt-4 block font-mono text-[8px] tracking-[.12em] text-[#66747d] uppercase" for={`tools-${value.id}`}>Tools</label>
							<input id={`tools-${value.id}`} value={value.tools.join(", ")} placeholder="default, or read, grep, bash" class="mt-2 h-9 w-full rounded-md border border-[#303a42] bg-[#05080b] px-2 font-mono text-[9px] text-white outline-0" onchange={(event) => updateAgent(value.id, { tools: event.currentTarget.value.split(/[\s,]+/).filter(Boolean) })} />
						</section>
					{/each}
				</div>
				<button type="button" disabled={draftHarnessSlots.agents.length >= 4} class="w-full rounded-lg border border-dashed border-[#3d4a54] bg-[#0a0f13] py-3 font-mono text-[9px] text-[#aeb8be] hover:border-[#61707a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" onclick={addAgent}>+ Add agent</button>
			</div>
		{:else if tab === "models"}
			<div class="mx-auto w-[min(720px,100%)]">
				<input bind:value={modelSearch} placeholder="Search providers..." aria-label="Search providers" class="mb-3 h-9 w-full rounded-lg border border-[#303a42] bg-[#0a0f13] px-3 font-mono text-[10px] text-white outline-0 placeholder:text-[#4e5a62] focus:border-[#607f20]" />
				{#if filteredProviderCards.length === 0}
					<p class="m-0 rounded-lg border border-dashed border-[#2c3740] px-4 py-8 text-center font-mono text-[9px] text-[#66747d]">No providers match "{modelSearch.trim()}".</p>
				{/if}
				<div class="grid grid-cols-2 gap-3">
					{#each filteredProviderCards as card (card.id)}
						<button
							type="button"
							class={`flex min-h-[108px] flex-col items-start justify-between rounded-xl border bg-[#0a0f13] p-4 text-left hover:border-[#4a5861] ${card.members.some((member) => member.configured) ? "border-[#2c4a34]" : "border-[#232c34]"}`}
							onclick={() => openConnect(card.id)}
						>
							<ProviderLogo id={card.id} label={card.label} size={36} />
							<span>
								<strong class="block text-[13px] text-white">{card.label}</strong>
								<small class="mt-1 block font-mono text-[9px] text-[#7b868e]">{groupSubtitle(card.members)}</small>
							</span>
						</button>
					{/each}
					<button
						type="button"
						class="flex min-h-[108px] flex-col items-start justify-between rounded-xl border border-dashed border-[#34414a] bg-[#0a0f13] p-4 text-left hover:border-[#4a5861]"
						onclick={() => (customOpen = true)}
					>
						<ProviderLogo id="custom" label="Add a custom model" size={36} />
						<span>
							<strong class="block text-[13px] text-white">Add a custom model</strong>
							<small class="mt-1 block font-mono text-[9px] text-[#7b868e]">Endpoint, API key, name</small>
						</span>
					</button>
				</div>
			</div>
		{:else if tab === "shortcuts"}
			<div class="mx-auto w-[min(720px,100%)]">
				<p class="m-0 mb-3 font-mono text-[9px] text-[#66747d]">Click a card to change the chord. Conflicts turn yellow. Bindings are not live yet.</p>
				<div class="grid grid-cols-2 gap-3">
					{#each draftShortcuts as shortcut, index}
						<button
							type="button"
							class={`rounded-xl border p-4 text-left ${
								conflicts.has(shortcut.keys.trim().toLowerCase())
									? "border-[#d6b16e] bg-[#1a160c]"
									: capturingIndex === index
										? "border-[#d7e7ff] bg-[#10161b]"
										: "border-[#232c34] bg-[#0a0f13]"
							}`}
							onkeydown={(event) => {
								if (capturingIndex === index) captureShortcut(index, event);
							}}
							onclick={() => (capturingIndex = index)}
						>
							<strong class="block text-[12px] text-white">{shortcut.action}</strong>
							<code class={`mt-2 block font-mono text-[10px] ${conflicts.has(shortcut.keys.trim().toLowerCase()) ? "text-[#d6b16e]" : "text-[#9cc0f2]"}`}>
								{capturingIndex === index ? "Press a shortcut" : shortcut.keys}
							</code>
						</button>
					{/each}
				</div>
			</div>
		{:else if tab === "mcp"}
			<div class="mx-auto w-[min(720px,100%)] space-y-3">
				<div class="flex gap-2">
					<button type="button" class="h-8 rounded-md border border-[#3d4a54] bg-[#05080b] px-3 font-mono text-[9px] text-[#d7e7ff]" onclick={onrefreshmcp} disabled={mcpBusy}>Refresh</button>
					{#if mcpStatus?.reloadRequired}
						<button type="button" class="h-8 rounded-md border border-[#3d4a54] bg-[#05080b] px-3 font-mono text-[9px] text-[#d7e7ff]" onclick={onreloadmcp} disabled={mcpBusy}>Reload</button>
					{/if}
				</div>
				{#each mcpServers as server (server.name)}
					<section class="rounded-lg border border-[#232c34] bg-[#0a0f13] p-3">
						<div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full" style={`background:${mcpDot(server)}`}></span>
							<strong class="font-mono text-[11px] text-white">{mcpDisplayName(server)}</strong>
						</div>
						<p class="m-0 mt-1 font-mono text-[8px] text-[#6e7a83]">{server.name} · {server.enabled ? server.state : "disabled"}</p>
						{#if server.error}
							<p class="m-0 mt-2 font-mono text-[9px] text-[#f3a49c]">{server.error}</p>
							{#if server.errorKind === "authentication"}
								<p class="m-0 mt-1 font-mono text-[8px] text-[#9aa6ae]">Replace this server's credential with <code>/mcpset</code>, then reload. Klerm will not infer or display the secret.</p>
							{/if}
						{/if}
					</section>
				{/each}
				{#if addingMcp}
					<form
						class="space-y-2 rounded-xl border border-[rgba(143,196,237,.4)] bg-[linear-gradient(160deg,rgba(38,70,96,.35),rgba(10,15,19,.96))] p-4 shadow-[0_14px_40px_rgba(0,0,0,.35)]"
						onsubmit={(event) => { event.preventDefault(); void saveMcp(); }}
					>
						<div class="flex items-center gap-2">
							<span class="h-2 w-2 shrink-0 rounded-full" style={`background:${MCP_COLOR_CSS[mcpColor]}`}></span>
							<strong class="min-w-0 truncate font-mono text-[11px] text-white">{mcpName.trim() || "New MCP server"}</strong>
							<span class="ml-auto shrink-0 rounded border border-[rgba(214,166,63,.4)] bg-[rgba(76,58,24,.3)] px-1.5 py-0.5 font-mono text-[7px] tracking-[.08em] text-[#d6b16e] uppercase">Pending · not saved</span>
						</div>
						<p class="m-0 font-mono text-[8px] text-[#7b868e]">
							{mcpTransport === "stdio" ? `${mcpCommand.trim() || "command"} ${mcpArgs.trim()}`.trim() || "stdio transport" : `${mcpTransport} · ${mcpUrl.trim() || "url"}`}
						</p>
						<input bind:value={mcpName} placeholder="name, e.g. Google Maps" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#05080b] px-2 font-mono text-[10px] text-white outline-0" />
						<div class="flex gap-1.5">
							{#each MCP_COLORS as color}
								<button type="button" aria-label={`${color} color`} class={`h-6 w-6 rounded-full border ${mcpColor === color ? "border-white" : "border-transparent"}`} style={`background:${MCP_COLOR_CSS[color]}`} onclick={() => (mcpColor = color)}></button>
							{/each}
						</div>
						<select bind:value={mcpTransport} class="h-8 w-full rounded-md border border-[#2d3740] bg-[#05080b] px-2 font-mono text-[10px] text-white outline-0 [color-scheme:dark]">
							<option value="stdio">stdio</option>
							<option value="http">http</option>
							<option value="sse">sse</option>
						</select>
						{#if mcpTransport === "stdio"}
							<input bind:value={mcpCommand} placeholder="command" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#05080b] px-2 font-mono text-[10px] text-white outline-0" />
							<input bind:value={mcpArgs} placeholder="args" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#05080b] px-2 font-mono text-[10px] text-white outline-0" />
						{:else}
							<input bind:value={mcpUrl} placeholder="url" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#05080b] px-2 font-mono text-[10px] text-white outline-0" />
							<textarea bind:value={mcpHeaders} placeholder="non-secret headers, one Header-Name=value per line" class="min-h-16 w-full rounded-md border border-[#2d3740] bg-[#05080b] p-2 font-mono text-[10px] text-white outline-0"></textarea>
						{/if}
						{#if mcpFormError}<p class="m-0 text-[9px] text-[#f3a49c]">{mcpFormError}</p>{/if}
						<div class="flex items-center gap-2 pt-1">
							<button type="submit" class="h-8 rounded-md bg-[#d7e7ff] px-3 font-mono text-[9px] text-[#091019]" disabled={mcpBusy}>Save</button>
							<button type="button" class="h-8 rounded-md border border-[#4a3a3a] bg-transparent px-3 font-mono text-[9px] text-[#f3a49c] hover:bg-[#1c1214]" onclick={discardMcp}>Discard changes</button>
						</div>
					</form>
				{:else}
					<button type="button" class="h-9 w-full rounded-lg border border-[#34414a] bg-[#05080b] font-mono text-[10px] text-[#d6dde1]" onclick={() => (addingMcp = true)}>Add more</button>
				{/if}
			</div>
		{:else}
			<div class="mx-auto w-[min(720px,100%)] space-y-4">
				<header>
					<p class="m-0 font-mono text-[8px] tracking-[.18em] text-[#8295a3] uppercase">Team context</p>
					<h2 class="mt-1 mb-0 text-[18px] font-medium text-white">Shared memory</h2>
					<p class="mt-1 mb-0 max-w-[560px] text-[10px] leading-[1.55] text-[#74818a]">Give every external agent the same project conventions and decisions. Klerm adds the current agent roster automatically when a task starts.</p>
				</header>
				<section class={`overflow-hidden rounded-2xl border ${settings.profiles.selectedSharedMemoryPresetId ? "border-[#2b3640]" : "border-[#6f8e2c]"} bg-[linear-gradient(145deg,#11191d,#090d11)] shadow-[0_18px_50px_rgba(0,0,0,.24)]`}>
					<div class="flex items-start gap-3 border-b border-white/[.06] p-4">
						<span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#3d4b35] bg-[#172012] text-[#a9c94d]"><BookOpen size={17} stroke-width={1.6} /></span>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<strong class="text-[12px] text-white">Default shared memory</strong>
								{#if !settings.profiles.selectedSharedMemoryPresetId}<span class="flex items-center gap-1 rounded-full border border-[#607f20]/60 bg-[#18220f] px-2 py-0.5 font-mono text-[7px] tracking-[.1em] text-[#b9d96a] uppercase"><Check size={9} /> Active</span>{/if}
							</div>
							<p class="m-0 mt-1 font-mono text-[8px] text-[#738089]">Always kept separately, even while a saved memory is active.</p>
						</div>
					</div>
					<div class="p-4">
						<textarea bind:value={defaultSharedMemoryDraft} maxlength="8000" rows="6" aria-label="Default shared memory" placeholder="Project conventions, constraints, shared decisions..." class="w-full resize-y rounded-xl border border-[#303a42] bg-[#05080b]/80 p-3 font-mono text-[9px] leading-[1.6] text-[#d7dfe2] outline-0 transition-colors placeholder:text-[#4e5a62] focus:border-[#607f20]"></textarea>
						<div class="mt-3 flex flex-wrap items-center justify-between gap-2">
							<span class="font-mono text-[8px] text-[#58656d]">{defaultSharedMemoryDraft.length.toLocaleString()} / 8,000</span>
							<div class="flex gap-2">
								{#if settings.profiles.selectedSharedMemoryPresetId}<button type="button" class="h-8 rounded-lg border border-[#3a464e] px-3 font-mono text-[8px] text-[#aab4bb] hover:border-[#607f20] hover:text-white" onclick={() => void onsharedmemorychange(settings.profiles.defaultSharedMemory)}>Use default</button>{/if}
								<button type="button" disabled={defaultSharedMemorySaving || defaultSharedMemoryDraft === settings.profiles.defaultSharedMemory} class="h-8 rounded-lg bg-[#d7e7ff] px-3 font-mono text-[8px] text-[#091019] disabled:cursor-not-allowed disabled:opacity-35" onclick={async () => { defaultSharedMemorySaving = true; await onsavedefaultsharedmemory(defaultSharedMemoryDraft); defaultSharedMemorySaving = false; }}>{defaultSharedMemorySaving ? "Saving..." : "Save default"}</button>
							</div>
						</div>
					</div>
				</section>
				<section class="overflow-hidden rounded-2xl border border-[#30404b] bg-[#080d11]">
					<div class="flex items-start gap-3 border-b border-[#253039] bg-[#0c1318] p-4">
						<span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#344956] bg-[#101d25] text-[#9cc0f2]"><Eye size={17} stroke-width={1.6} /></span>
						<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><strong class="text-[12px] text-white">Prompt used by all agents</strong><span class="rounded-full border border-[#36536a] bg-[#101d27] px-2 py-0.5 font-mono text-[7px] tracking-[.1em] text-[#9cc0f2] uppercase">{settings.profiles.sharedMemoryPresets.find((preset) => preset.id === settings.profiles.selectedSharedMemoryPresetId)?.name ?? "Default"}</span></div><p class="m-0 mt-1 font-mono text-[8px] leading-[1.5] text-[#738089]">This exact shared block is added to every external agent prompt when the next task starts.</p></div>
					</div>
					<pre class="m-0 max-h-[280px] overflow-auto p-4 whitespace-pre-wrap font-mono text-[8px] leading-[1.65] text-[#aebbc3] [scrollbar-width:thin]">{codingHarnessSetup?.sharedContextPreview ?? "Shared prompt preview is unavailable until coding-harness setup is loaded."}</pre>
				</section>

				<button type="button" class="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#40505a] bg-[#0a0f13] font-mono text-[9px] text-[#b8c3c9] transition-colors hover:border-[#738895] hover:bg-[#0d1419] hover:text-white" onclick={() => (addMemoryOpen = !addMemoryOpen)}><Plus size={14} /> {addMemoryOpen ? "Close new memory" : "Add New Memory"}</button>
				{#if addMemoryOpen}
					<form class="space-y-3 rounded-2xl border border-[#34414a] bg-[#0a0f13] p-4" onsubmit={async (event) => { event.preventDefault(); sharedMemorySaving = true; if (await onsavesharedmemory(sharedMemoryPresetName, sharedMemoryPresetText)) { sharedMemoryPresetName = ""; sharedMemoryPresetText = ""; addMemoryOpen = false; } sharedMemorySaving = false; }}>
						<div><strong class="text-[12px] text-white">Create a saved memory</strong><p class="m-0 mt-1 font-mono text-[8px] text-[#6e7a83]">Saved memories are reusable contexts you can switch between without changing the default.</p></div>
						<input bind:value={sharedMemoryPresetName} maxlength="40" placeholder="Memory name" aria-label="Memory name" class="h-9 w-full rounded-lg border border-[#303a42] bg-[#05080b] px-3 font-mono text-[9px] text-white outline-0 focus:border-[#607f20]" />
						<textarea bind:value={sharedMemoryPresetText} maxlength="8000" rows="5" placeholder="Shared project conventions, constraints, and decisions" aria-label="New shared memory" class="w-full resize-y rounded-lg border border-[#303a42] bg-[#05080b] p-3 font-mono text-[9px] leading-[1.55] text-white outline-0 focus:border-[#607f20]"></textarea>
						<div class="flex justify-end gap-2"><button type="button" class="h-8 rounded-lg px-3 font-mono text-[8px] text-[#8b969e]" onclick={() => (addMemoryOpen = false)}>Cancel</button><button type="submit" disabled={!sharedMemoryPresetName.trim() || sharedMemorySaving} class="h-8 rounded-lg bg-[#d7e7ff] px-3 font-mono text-[8px] text-[#091019] disabled:opacity-40">{sharedMemorySaving ? "Saving..." : "Save memory"}</button></div>
					</form>
				{/if}

				<section>
					<div class="mb-2 flex items-end justify-between gap-2"><div><strong class="text-[11px] text-white">Saved memories</strong><p class="m-0 mt-0.5 font-mono text-[8px] text-[#66747d]">{settings.profiles.sharedMemoryPresets.length} of 20</p></div></div>
					<div class="grid grid-cols-2 gap-3 narrow-720:grid-cols-1">
						{#each settings.profiles.sharedMemoryPresets as preset (preset.id)}
							<article class={`flex min-h-[132px] flex-col rounded-xl border p-3.5 transition-colors ${settings.profiles.selectedSharedMemoryPresetId === preset.id ? "border-[#607f20] bg-[#11190d]" : "border-[#263139] bg-[#090e12] hover:border-[#3d4a53]"}`}>
								<div class="flex items-center gap-2"><strong class="min-w-0 flex-1 truncate text-[11px] text-white">{preset.name}</strong>{#if settings.profiles.selectedSharedMemoryPresetId === preset.id}<span class="rounded-full bg-[#1b280f] px-2 py-0.5 font-mono text-[7px] text-[#b9d96a] uppercase">Active</span>{/if}</div>
								<p class="mt-2 mb-3 line-clamp-3 whitespace-pre-wrap font-mono text-[8px] leading-[1.55] text-[#78858d]">{preset.memory || "Empty memory"}</p>
								<div class="mt-auto flex items-center justify-end gap-1"><button type="button" class="h-7 rounded-md px-2 font-mono text-[8px] text-[#9cc0f2] hover:bg-[#14202a]" onclick={() => void onsharedmemorychange(preset.memory, preset.id)}>{settings.profiles.selectedSharedMemoryPresetId === preset.id ? "Selected" : "Use memory"}</button><button type="button" aria-label={`Delete ${preset.name}`} class="grid h-7 w-7 place-items-center rounded-md text-[#8b6767] hover:bg-[#211214] hover:text-[#f3a49c]" onclick={() => void ondeletesharedmemory(preset.id)}><Trash2 size={12} /></button></div>
							</article>
						{/each}
					</div>
					{#if settings.profiles.sharedMemoryPresets.length === 0}<div class="rounded-xl border border-dashed border-[#2c3740] px-4 py-8 text-center font-mono text-[9px] text-[#66747d]">No saved memories yet.</div>{/if}
				</section>
			</div>
		{/if}
	</div>
	{#if connectGroup}
		<div class="absolute inset-0 z-20 grid place-items-center bg-black/70 p-4">
			<div class="max-h-full w-[min(420px,100%)] overflow-y-auto rounded-xl border border-[#2a3239] bg-[#05080b] p-4">
				<div class="flex items-center gap-2">
					<button type="button" aria-label="Back to providers" class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#8b969e] hover:bg-[#141a1f] hover:text-white" onclick={() => (connectId = "")}>←</button>
					<ProviderLogo id={connectGroup.id} label={connectGroup.label} size={28} />
					<p class="m-0 font-mono text-[12px] text-white">{connectGroup.label}</p>
					{#if connectGroup.members.some((member) => member.configured)}
						<span class="ml-auto rounded-full border border-[#2c4a34] bg-[#0d1510] px-2 py-0.5 font-mono text-[8px] text-[#81c995]">connected</span>
					{/if}
				</div>
				{#each connectGroup.members as member (member.id)}
					{@const form = formFor(member.id)}
					<section class="mt-3 rounded-lg border border-[#232c34] bg-[#0a0f13] p-3">
						<div class="flex items-center gap-2">
							<strong class="font-mono text-[10px] text-white">{member.label}</strong>
							{#if member.configured}
								<span class="ml-auto font-mono text-[8px] text-[#81c995]">connected{member.source ? ` · ${member.source}` : ""}</span>
							{:else}
								<span class="ml-auto font-mono text-[8px] text-[#66747d]">{member.local ? (member.detected ?? "not detected") : "not connected"}</span>
							{/if}
						</div>
						{#if member.local}
							<p class="m-0 mt-2 font-mono text-[9px] text-[#7b868e]">Local runtime. No key needed.</p>
						{:else}
							{#if oauthStep?.provider === member.id}
								{@const step = oauthStep}
								<div class="mt-2 space-y-2 rounded-md border border-[#2c4a34] bg-[#0d1510] p-2.5">
									{#if step.message}<p class="m-0 font-mono text-[9px] text-[#a9c94d]">{step.message}</p>{/if}
									{#if step.url}
										<p class="m-0 font-mono text-[9px] text-[#7b868e]">Complete login in your browser:</p>
										<div class="flex gap-1.5">
											<button type="button" class="min-w-0 flex-1 truncate rounded bg-[#000] px-2 py-1.5 text-left font-mono text-[9px] text-[#9cc0f2] underline hover:text-white" onclick={() => openAuthUrl(step.url ?? "")}>{step.url}</button>
											<button type="button" class="h-7 shrink-0 rounded border border-[#34414a] px-2 font-mono text-[9px] text-[#d6dde1]" onclick={() => {
												void navigator.clipboard.writeText(step.url ?? "");
												copiedUrl = member.id;
												setTimeout(() => {
													if (copiedUrl === member.id) copiedUrl = "";
												}, 1500);
											}}>
												{copiedUrl === member.id ? "Copied" : "Copy"}
											</button>
										</div>
										{#if step.instructions}<p class="m-0 font-mono text-[8px] text-[#66747d]">{step.instructions}</p>{/if}
									{/if}
										{#if step.userCode}
										<div class="flex items-center gap-2">
											<code class="rounded bg-[#000] px-2 py-1.5 font-mono text-[12px] font-bold tracking-[.2em] text-[#e8eef2]">{step.userCode}</code>
											{#if step.verificationUri}
												<button type="button" class="truncate font-mono text-[8px] text-[#9cc0f2] underline hover:text-white" onclick={() => openAuthUrl(step.verificationUri ?? "")}>{step.verificationUri}</button>
											{/if}
										</div>
									{/if}
									{#if step.prompt}
										{#if step.prompt.options}
											<div class="space-y-1.5">
												{#each step.prompt.options as option (option.id)}
													<button type="button" class="block w-full rounded-md border border-[#34414a] bg-[#0a0f13] px-2 py-2 text-left font-mono text-[10px] text-[#d6dde1] hover:border-[#4a5861]" onclick={() => onoauthsubmit(option.id)}>
														<strong class="block">{option.label}</strong>
														{#if option.description}<small class="mt-0.5 block text-[8px] text-[#66747d]">{option.description}</small>{/if}
													</button>
												{/each}
											</div>
										{:else}
											<form class="flex gap-1.5" onsubmit={(event) => { event.preventDefault(); onoauthsubmit(oauthInput); oauthInput = ""; }}>
												<input bind:value={oauthInput} placeholder={step.prompt.message} autocomplete="off" class="h-8 min-w-0 flex-1 rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
												<button type="submit" class="h-8 shrink-0 rounded-md bg-[#e8eef2] px-3 font-mono text-[10px] text-[#091019]">Send</button>
											</form>
											<p class="m-0 font-mono text-[8px] text-[#66747d]">{step.prompt.message}</p>
										{/if}
									{/if}
									<button type="button" class="h-7 w-full rounded-md border border-[#34414a] bg-transparent font-mono text-[9px] text-[#8b969e]" onclick={oncanceloauth}>Cancel login</button>
								</div>
							{:else}
							<form class="mt-2 space-y-2" onsubmit={(event) => { event.preventDefault(); void saveConnect(member.id); }}>
								<input value={form.key} oninput={(event) => setForm(member.id, { key: (event.currentTarget as HTMLInputElement).value })} type="password" placeholder={member.configured ? "new API key (optional)" : "API key"} autocomplete="off" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
								<input value={form.url} oninput={(event) => setForm(member.id, { url: (event.currentTarget as HTMLInputElement).value })} placeholder={member.defaultEndpoint ?? "endpoint override (optional)"} autocomplete="off" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
								{#if form.error}<p class="m-0 text-[9px] text-[#f3a49c]">{form.error}</p>{/if}
								<div class="flex gap-1.5">
									<button type="submit" class="h-8 flex-1 rounded-md bg-[#e8eef2] font-mono text-[10px] text-[#091019]" disabled={providerBusy}>
										{providerBusy ? "Working..." : member.configured ? "Save" : "Connect"}
									</button>
									{#if member.supportsOauth}
										<button type="button" class="h-8 flex-1 rounded-md border border-[#2c4a34] bg-[#0d1510] font-mono text-[10px] text-[#81c995]" disabled={providerBusy} onclick={() => void startOauth(member.id)}>OAuth</button>
									{/if}
								</div>
							</form>
							{/if}
							{#if member.configured}
								{#if form.confirmDiscard}
									<div class="mt-2 flex gap-2">
										<button type="button" class="h-8 flex-1 rounded-md border border-[#5a3434] bg-[#170d0d] font-mono text-[10px] text-[#f3a49c]" onclick={() => void discardConnect(member.id)} disabled={providerBusy}>Confirm discard</button>
										<button type="button" class="h-8 flex-1 rounded-md border border-[#34414a] bg-[#0a0f13] font-mono text-[10px] text-[#d6dde1]" onclick={() => setForm(member.id, { confirmDiscard: false })}>Keep</button>
									</div>
								{:else}
									<button type="button" class="mt-2 h-8 w-full rounded-md border border-[#34414a] bg-[#0a0f13] font-mono text-[10px] text-[#f3a49c]" onclick={() => setForm(member.id, { confirmDiscard: true })}>Discard</button>
								{/if}
							{/if}
						{/if}
						<div class="mt-2 max-h-[140px] space-y-1 overflow-y-auto">
							{#each member.models as model}
								<p class="m-0 rounded-md bg-[#0d1217] px-2 py-1.5 font-mono text-[9px] text-[#d7dfe2]">{model}</p>
							{/each}
							{#if member.models.length === 0}
								<p class="m-0 font-mono text-[9px] text-[#66747d]">No models listed yet.</p>
							{/if}
						</div>
					</section>
				{/each}
			</div>
		</div>
	{/if}
	{#if confirmDiscardSettings}
		<div class="absolute inset-0 z-30 grid place-items-center bg-black/70 p-4">
			<div class="w-[min(360px,100%)] rounded-xl border border-[#2a3239] bg-[#05080b] p-4">
				<p class="m-0 font-mono text-[11px] text-white">Are you sure you want to discard your changes?</p>
				<p class="mt-1 font-mono text-[9px] text-[#7b868e]">Unsaved appearance, agent setup, and shortcut edits will be lost.</p>
				<div class="mt-3 flex gap-2">
					<button type="button" class="h-8 flex-1 rounded-md border border-[#5a3434] bg-[#170d0d] font-mono text-[10px] text-[#f3a49c]" onclick={discardDrafts}>Discard</button>
					<button type="button" class="h-8 flex-1 rounded-md border border-[#34414a] bg-[#0a0f13] font-mono text-[10px] text-[#d6dde1]" onclick={() => (confirmDiscardSettings = false)}>Keep</button>
				</div>
			</div>
		</div>
	{/if}
	{#if customOpen}
		<div class="absolute inset-0 z-20 grid place-items-center bg-black/70 p-4">
			<form class="w-[min(420px,100%)] space-y-2 rounded-xl border border-[#2a3239] bg-[#05080b] p-4" onsubmit={(event) => { event.preventDefault(); void saveCustomModel(); }}>
				<p class="m-0 mb-2 font-mono text-[12px] text-white">Add a custom model</p>
				<input bind:value={provider} placeholder="provider id" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
				<input bind:value={modelId} placeholder="model id / name" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
				<input bind:value={modelName} placeholder="display name" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
				<input bind:value={modelUrl} placeholder="endpoint, e.g. http://127.0.0.1:1234/v1" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
				<select bind:value={modelApi} class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0 [color-scheme:dark]">
					<option value="openai-completions">openai-completions</option>
					<option value="openai-responses">openai-responses</option>
					<option value="anthropic-messages">anthropic-messages</option>
				</select>
				<input bind:value={modelKey} type="password" placeholder="API key (optional)" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
				{#if modelError}<p class="m-0 text-[9px] text-[#f3a49c]">{modelError}</p>{/if}
				<div class="flex gap-2 pt-1">
					<button type="button" class="h-8 flex-1 rounded-md border border-[#34414a] bg-[#0a0f13] font-mono text-[10px] text-[#d6dde1]" onclick={() => (customOpen = false)}>Cancel</button>
					<button type="submit" class="h-8 flex-1 rounded-md bg-[#e8eef2] font-mono text-[10px] text-[#091019]">Save</button>
				</div>
			</form>
		</div>
	{/if}
</section>
