<script lang="ts">
	import { ArrowLeft, Boxes, Globe2, Menu, MessageSquareText, PanelRight, Plus, Search, Send, Settings, Square, X } from "@lucide/svelte";
	import type {
		CodingHarnessSetup,
		KlermProfile,
		PersonalBot,
		PersonalBotConversation,
		ThinkingLevel,
		BrowserRunState,
	} from "../lib/model.ts";
	import { KLERM_PROFILE_FACES } from "../lib/model.ts";
	import { profileIcon } from "../lib/profiles.ts";
	import MarkdownLite from "./MarkdownLite.svelte";
	import ModelSelect from "./ModelSelect.svelte";
	import PersonalBrowserPanel from "./PersonalBrowserPanel.svelte";
	import { tick, onMount } from "svelte";
	import { useDesktopShortcuts } from "../lib/shortcuts.ts";

	let {
		bots,
		profiles,
		harnessSetup,
		conversations,
		browserRuns,
		browserOpen,
		onopenbrowser,
		onclosebrowser,
		onbrowserattach,
		onbrowsercommand,
		busy = false,
		generationModel = "",
		focusBotId,
		onclose,
		onselect,
		onsave,
		onprofilesave,
		ongeneratememory,
		ondelete,
		onprompt,
		onabort,
	}: {
		bots: PersonalBot[];
		profiles: KlermProfile[];
		harnessSetup?: CodingHarnessSetup;
		conversations: Record<string, PersonalBotConversation | undefined>;
		browserRuns: Record<string, BrowserRunState>;
		browserOpen: Record<string, boolean>;
		onopenbrowser: (botId: string) => Promise<void>;
		onclosebrowser: (botId: string) => void;
		onbrowserattach: (botId: string, cdpUrl: string) => Promise<void>;
		onbrowsercommand: (command: string, input: Record<string, unknown>) => Promise<void>;
		busy?: boolean;
		generationModel?: string;
		focusBotId?: string;
		onclose: () => void;
		onselect: (botId: string) => void;
		onsave: (bot: PersonalBot) => Promise<boolean>;
		onprofilesave: (profile: KlermProfile) => Promise<boolean>;
		ongeneratememory: (model: string, brief: string) => Promise<string | undefined>;
		ondelete: (bot: PersonalBot) => Promise<void>;
		onprompt: (botId: string, message: string) => Promise<boolean>;
		onabort: (botId: string) => Promise<void>;
	} = $props();

	let selectedId = $state("");
	let botSearch = $state("");
	let detailsOpen = $state(false);
	let agentListOpen = $state(false);
	let composer: HTMLTextAreaElement | undefined = $state();
	const filteredBots = $derived(bots.filter((bot) => `${bot.name} ${profiles.find((profile) => profile.id === bot.profileId)?.name ?? ""}`.toLowerCase().includes(botSearch.trim().toLowerCase())));
	const settingsTabs: Array<{ id: "ai" | "model" | "reasoning"; label: string }> = [{ id: "ai", label: "Identity & access" }, { id: "model", label: "Model" }, { id: "reasoning", label: "Reasoning" }];
	const shortcuts = useDesktopShortcuts();
	onMount(() => {
		const remove = [shortcuts?.register("save", () => profileEditing ? saveProfile() : save(), () => !busy && (creating || configuring || profileEditing)), shortcuts?.register("close", () => { if (configuring || creating || profileEditing) closeConfiguration(); else if (agentListOpen) agentListOpen = false; else if (detailsOpen) detailsOpen = false; else onclose(); }), shortcuts?.register("newItem", beginCreate, () => !busy && !configuring), shortcuts?.register("run", send, () => !conversationBusy && !creating && !configuring), shortcuts?.register("stop", () => selected ? onabort(selected.id) : undefined, () => conversationBusy), shortcuts?.register("refresh", () => { if (selected) onselect(selected.id); }), shortcuts?.register("compose.focus", () => composer?.focus())];
		return () => { for (const cleanup of remove) cleanup?.(); };
	});
	let creating = $state(false);
	let configuring = $state(false);
	let settingsSection = $state<"ai" | "model" | "reasoning">("ai");
	let profileEditing = $state(false);
	let profileCreating = $state(false);
	let name = $state("");
	let face = $state<PersonalBot["face"]>("fox");
	let profileId = $state("");
	let model = $state("");
	let effort = $state<PersonalBot["effort"]>("medium");
	let browserEnabled = $state(false);
	let kanbanEnabled = $state(false);
	let botBrief = $state("");
	let personalMemory = $state("");
	let generatingMemory = $state(false);
	let memoryError = $state("");
	let chatDraft = $state("");
	let notice = $state("");
	let profileName = $state("");
	let profileFace = $state<KlermProfile["face"]>("fox");
	let profileLevel = $state(1);
	let profileBehaviour = $state("");
	let profileWorkPlan = $state("");
	let profilePlanMode = $state("");
	let profileBuildMode = $state("");
	let profileMemoryFormat = $state<KlermProfile["memoryFormat"]>("md");
	let profileMemory = $state("");
	let profileReadme = $state("");
	let chatScroll = $state<HTMLElement>();
	let lastChatPosition = "";
	$effect(() => {
		const position = `${selected?.id ?? ""}:${conversation?.messages.length ?? 0}`;
		if (!chatScroll || position === lastChatPosition) return;
		lastChatPosition = position;
		void tick().then(() => chatScroll?.scrollTo({ top: chatScroll.scrollHeight, behavior: "smooth" }));
	});

	const selected = $derived(bots.find((bot) => bot.id === selectedId) ?? bots[0]);
	const conversation = $derived(selected ? conversations[selected.id] : undefined);
	const conversationBusy = $derived(conversation?.status === "running");
	const selectedProfile = $derived(profiles.find((profile) => profile.id === selected?.profileId));
	const configuredProfile = $derived(profiles.find((profile) => profile.id === profileId));
	const harnesses = $derived(harnessSetup?.harnesses ?? []);
	const klermHarness = $derived(harnesses.find((item) => item.kind === "klerm"));
	const models = $derived(klermHarness?.models ?? []);
	const efforts: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	const latestReplyPreview = (bot: PersonalBot): string => {
		const text = [...(conversations[bot.id]?.messages ?? [])]
			.reverse()
			.find((message) => message.role === "assistant")
			?.text.trim();
		return text ? text.replace(/^#{1,6}\s+/gm, "").replace(/\*\*|`/g, "").replace(/\s+/g, " ").slice(0, 72) : "";
	};

	$effect(() => {
		if (!selectedId && bots[0]) {
			selectedId = bots[0].id;
			onselect(bots[0].id);
		}
	});

	$effect(() => {
		if (focusBotId && focusBotId !== selectedId && bots.some((bot) => bot.id === focusBotId)) {
			selectBot(focusBotId);
		}
	});

	$effect(() => {
		if (!selected || creating) return;
		name = selected.name;
		face = selected.face;
		profileId = selected.profileId;
		model = selected.harness === "klerm" ? selected.model ?? "" : "";
		effort = selected.effort;
		browserEnabled = selected.browserEnabled === true;
		kanbanEnabled = selected.kanbanEnabled === true;
		notice = "";
	});

	function isRunnable(bot: PersonalBot): boolean {
		return (
			bot.harness === "klerm" &&
			bot.enabled &&
			Boolean(bot.model) &&
			klermHarness?.available === true &&
			klermHarness.models.includes(bot.model ?? "")
		);
	}

	function selectBot(botId: string): void {
		agentListOpen = false;
		creating = false;
		configuring = false;
		selectedId = botId;
		onselect(botId);
	}

	function beginCreate(): void {
		botSearch = "";
		detailsOpen = false;
		agentListOpen = false;
		creating = true;
		configuring = true;
		settingsSection = "ai";
		name = "";
		face = "fox";
		profileId = "";
		model = models[0] ?? "";
		effort = "medium";
		browserEnabled = false;
		kanbanEnabled = false;
		botBrief = "";
		personalMemory = "";
		generatingMemory = false;
		memoryError = "";
		notice = "";
	}

	function botId(value: string): string {
		const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
		const base = `bot-${slug || Date.now()}`;
		let candidate = base;
		let suffix = 2;
		while (bots.some((bot) => bot.id === candidate)) candidate = `${base}-${suffix++}`;
		return candidate;
	}

	async function generateMemory(): Promise<void> {
		memoryError = "";
		if (!botBrief.trim() || !generationModel || generatingMemory || busy) return;
		generatingMemory = true;
		try {
			const text = await ongeneratememory(generationModel, botBrief.trim());
			if (text) personalMemory = text;
			else memoryError = "The AI returned no personal memory.";
		} finally {
			generatingMemory = false;
		}
	}

	async function save(): Promise<void> {
		if (!name.trim() || busy) return;
		const nextProfileId = creating ? uniqueProfileId(`${name}-personality`) : profileId;
		if (!nextProfileId) return;
		const nextModel = model;
		const nextEffort = effort;
		if (creating) {
			const profile: KlermProfile = {
				id: nextProfileId,
				name: `${name.trim()} personality`,
				face,
				level: 2,
				behaviour: botBrief.trim() || `Help the user as ${name.trim()} with direct, useful technical guidance.`,
				workPlan: "Review the available session context, identify decisions and risks, then suggest concrete next steps.",
				planMode: "Discuss and analyze only. Do not modify files or external state.",
				buildMode: "",
				memoryFormat: "md",
				memory: personalMemory.trim(),
				readme: "",
			};
			if (!(await onprofilesave(profile))) return;
			profileId = nextProfileId;
		}
		const value: PersonalBot = {
			browserEnabled,
			kanbanEnabled,
			id: creating ? botId(name) : selected?.id ?? botId(name),
			name: name.trim(),
			face,
			profileId: nextProfileId,
			harness: "klerm",
			...(nextModel ? { model: nextModel } : {}),
			role: "planner",
			effort: nextEffort,
			enabled:
				Boolean(nextModel) && klermHarness?.available === true && klermHarness.models.includes(nextModel),
			createdSequence: creating
				? Math.max(0, ...bots.map((bot) => bot.createdSequence)) + 1
				: selected?.createdSequence ?? 1,
		};
		if (await onsave(value)) {
			model = nextModel;
			effort = nextEffort;
			selectedId = value.id;
			creating = false;
			configuring = false;
			notice = "Bot saved";
			onselect(value.id);
		}
	}

	async function remove(): Promise<void> {
		if (!selected || creating || busy) return;
		await ondelete(selected);
		configuring = false;
		selectedId = bots.find((bot) => bot.id !== selected.id)?.id ?? "";
		notice = "";
	}

	async function send(): Promise<void> {
		const message = chatDraft.trim();
		if (
			!selected ||
			!message ||
			!isRunnable(selected) ||
			conversationBusy
		)
			return;
		if (await onprompt(selected.id, message)) chatDraft = "";
	}

	function openConfiguration(section: "ai" | "model" | "reasoning"): void {
		if (!selected || !conversation) return;
		name = selected.name;
		face = selected.face;
		profileId = selected.profileId;
		model = selected.harness === "klerm" ? selected.model ?? "" : "";
		effort = selected.effort;
		settingsSection = section;
		browserEnabled = selected.browserEnabled === true;
		kanbanEnabled = selected.kanbanEnabled === true;
		configuring = true;
		profileEditing = false;
	}

	function openProfileEditor(profile: KlermProfile): void {
		profileCreating = false;
		profileName = profile.name;
		profileFace = profile.face;
		profileLevel = profile.level;
		profileBehaviour = profile.behaviour;
		profileWorkPlan = profile.workPlan;
		profilePlanMode = profile.planMode;
		profileBuildMode = profile.buildMode;
		profileMemoryFormat = profile.memoryFormat;
		profileMemory = profile.memory;
		profileReadme = profile.readme;
		profileEditing = true;
		void tick().then(() => document.querySelector<HTMLInputElement>('input[aria-label="Profile name"]')?.focus());
	}

	function uniqueProfileId(value: string): string {
		const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
		const base = slug || `profile-${Date.now()}`;
		let candidate = base;
		let suffix = 2;
		while (profiles.some((profile) => profile.id === candidate)) candidate = `${base}-${suffix++}`;
		return candidate;
	}

	async function saveProfile(): Promise<void> {
		if (!profileName.trim() || busy) return;
		const existing = profileCreating ? undefined : profiles.find((profile) => profile.id === profileId);
		const value: KlermProfile = {
			id: existing?.id ?? uniqueProfileId(profileName),
			name: profileName.trim(),
			face: profileFace,
			level: profileLevel,
			behaviour: profileBehaviour,
			workPlan: profileWorkPlan,
			planMode: profilePlanMode,
			buildMode: profileBuildMode,
			memoryFormat: profileMemoryFormat,
			memory: profileMemory,
			readme: profileReadme,
		};
		if (await onprofilesave(value)) {
			profileId = value.id;
			profileEditing = false;
			notice = profileCreating ? "Profile created" : "Profile saved";
		}
	}

	function closeConfiguration(): void {
		configuring = false;
		profileEditing = false;
		if (creating) creating = false;
	}
	function preparePrompt(text: string): void {
		chatDraft = text;
		void tick().then(() => composer?.focus());
	}
	function navigateSettingsTabs(event: KeyboardEvent): void {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const current = settingsTabs.findIndex((tab) => tab.id === settingsSection);
		const index = event.key === "Home" ? 0 : event.key === "End" ? settingsTabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + settingsTabs.length) % settingsTabs.length;
		settingsSection = settingsTabs[index]!.id;
		(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
	}
	function focusDialog(node: HTMLElement): { destroy: () => void } {
		const previous = document.activeElement;
		node.querySelector<HTMLInputElement>('input[aria-label="Agent name"],input[aria-label="Profile name"]')?.focus();
		return { destroy: () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); } };
	}
	function keepDialogFocus(event: KeyboardEvent): void {
		if (event.key !== "Tab") return;
		const node = event.currentTarget as HTMLElement;
		const controls = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter((control) => control.offsetParent !== null && control.tabIndex >= 0);
		const first = controls[0], last = controls.at(-1);
		if (!first || !last) return;
		if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
		else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
	}

</script>

<div class="relative flex min-h-0 flex-1 overflow-hidden bg-panel" aria-label="Personal Bots workspace">
	<aside aria-label="Personal agent list" class={`flex w-[228px] shrink-0 flex-col border-r border-line-soft bg-bg narrow-720:absolute narrow-720:inset-y-0 narrow-720:left-0 narrow-720:z-30 narrow-720:w-[min(280px,85%)] narrow-720:shadow-popover ${agentListOpen ? "" : "narrow-720:hidden"}`}>
		<header class="flex h-[76px] shrink-0 items-center gap-3 px-4">
			<MessageSquareText size={20} stroke-width={1.6} class="text-accent" />
			<div class="min-w-0 flex-1"><h1 class="m-0 text-[16px] font-semibold tracking-[-.025em] text-ink">Personal Bots</h1><p class="m-0 mt-0.5 text-[12px] text-muted">Private conversations</p></div>
			<button type="button" aria-label="Close agent list" class="hidden h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised narrow-720:grid" onclick={() => (agentListOpen = false)}><X size={16} /></button>
		</header>
		<label class="relative mx-3 mb-4 block"><Search size={14} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim" /><input aria-label="Search Personal Agents" placeholder="Search agents" bind:value={botSearch} class="h-9 w-full rounded-md border border-line bg-panel pr-3 pl-9 text-[13px] text-ink placeholder:text-dim" /></label>
		<div class="mb-2 flex items-center justify-between px-4 text-[11px] text-muted"><span class="font-medium">Your agents</span><span>{bots.length}</span></div>
		<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
			{#each filteredBots as bot (bot.id)}
				<button
					type="button"
					aria-pressed={selected?.id === bot.id && !creating}
					class={`mb-1 flex min-h-[68px] w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${selected?.id === bot.id && !creating ? "bg-raised text-ink" : "text-muted hover:bg-raised/60"}`}
					onclick={() => selectBot(bot.id)}
				>
					<span class="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line-soft bg-panel text-[20px]">{profileIcon(bot.face)}<span class={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg ${conversations[bot.id]?.status === "running" ? "animate-pulse bg-warning" : isRunnable(bot) ? "bg-success" : "bg-dim"}`}></span></span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-[13px] font-semibold">{bot.name}</span>
						<span class="mt-1 block truncate text-[12px] font-normal text-muted">{conversations[bot.id]?.status === "running" ? "Working on a reply…" : latestReplyPreview(bot) || profiles.find((profile) => profile.id === bot.profileId)?.name || "Choose a model to begin"}</span>
					</span>
				</button>
			{:else}
				<p class="px-3 py-6 text-[13px] text-muted">{botSearch.trim() ? "No agents match your search." : "Create an agent to start a private conversation."}</p>
			{/each}
		</div>
		<footer class="shrink-0 border-t border-line-soft p-3"><button type="button" disabled={busy} class="control w-full justify-start" onclick={beginCreate}><Plus size={16} /> New personal agent</button></footer>
	</aside>
	{#if agentListOpen}<button type="button" aria-label="Dismiss agent list" class="absolute inset-0 z-20 hidden bg-bg/80 narrow-720:block" onclick={() => (agentListOpen = false)}></button>{/if}

	<main class="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
		{#if selected && !creating}
			<header class="flex min-h-[76px] shrink-0 items-center gap-3 border-b border-line-soft px-5 py-3 narrow-520:px-3">
				<button type="button" aria-label="Back to workspace" title="Back to workspace" class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-raised" onclick={onclose}><ArrowLeft size={17} /></button>
				<button type="button" aria-label="Choose Personal Agent" aria-expanded={agentListOpen} class="hidden h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-raised narrow-720:grid" onclick={() => (agentListOpen = !agentListOpen)}><Menu size={17} /></button>
				<div class="min-w-0 flex-1">
					<h2 class="m-0 truncate text-[20px] font-semibold tracking-[-.035em] text-ink">{selected.name}</h2>
					<p class="m-0 mt-1 flex items-center gap-2 text-[12px] text-muted"><span class={`h-1.5 w-1.5 shrink-0 rounded-full ${conversationBusy ? "animate-pulse bg-warning" : conversation?.status === "failed" ? "bg-danger" : isRunnable(selected) ? "bg-success" : "bg-dim"}`}></span>{conversationBusy ? "Writing a reply" : conversation?.status === "failed" ? "Last reply failed" : isRunnable(selected) ? "Ready to chat" : "Model setup needed"}<span class="text-dim">·</span><span class="truncate" title={selected.model}>{selected.model || "Select a model"}</span></p>
				</div>
				{#if notice}<span role="status" class="text-[12px] text-success narrow-520:hidden">{notice}</span>{/if}
				<button type="button" aria-label="Agent settings" title="Agent settings" disabled={!conversation || busy} class="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line text-muted hover:bg-raised disabled:opacity-40" onclick={() => openConfiguration("ai")}><Settings size={16} /></button>
				<button type="button" aria-label="Toggle agent details" aria-expanded={detailsOpen} title="Agent details" class={`grid h-9 w-9 shrink-0 place-items-center rounded-md border ${detailsOpen ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-raised"}`} onclick={() => (detailsOpen = !detailsOpen)}><PanelRight size={16} /></button>
			</header>

			<div bind:this={chatScroll} class="min-h-0 flex-1 overflow-y-auto px-6 py-6 narrow-520:px-4" aria-label="Personal conversation">
				{#if conversation?.messages.length}
					<div class="mx-auto flex max-w-[860px] flex-col gap-7">
						{#each conversation.messages as message (message.id)}
							{@const date = new Date(message.timestamp)}
							<article class={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`} aria-label={`${message.role === "user" ? "You" : selected.name} message`}>
								<div class="mb-2 flex items-center gap-2 text-[11px] text-muted">{#if message.role === "assistant"}<span class="text-[14px]" aria-hidden="true">{profileIcon(selected.face)}</span>{/if}<span class="font-medium">{message.role === "user" ? "You" : selected.name}</span>{#if !Number.isNaN(date.getTime())}<time datetime={message.timestamp} class="text-dim">{date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>{/if}</div>
								{#if message.role === "user"}
									<div class="max-w-[85%] whitespace-pre-wrap rounded-xl bg-raised px-4 py-3 text-[14px] leading-[1.65] text-ink">{message.text}</div>
								{:else}
									<div class="w-full text-[14px] leading-[1.75] text-ink"><MarkdownLite text={message.text} /></div>
								{/if}
							</article>
						{/each}
						{#if conversationBusy}
							<div role="status" class="flex items-center gap-2 text-[13px] text-muted"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"></span>{selected.name} is working on a reply…</div>
						{/if}
					</div>
				{:else}
					<div class="mx-auto flex min-h-full max-w-[640px] flex-col justify-center py-8">
						<div class="mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-line-soft bg-bg text-[28px]">{profileIcon(selected.face)}</div>
						<h3 class="m-0 text-[26px] font-semibold tracking-[-.04em] text-ink">Talk it through with {selected.name}.</h3>
						<p class="mt-3 max-w-[500px] text-[14px] leading-[1.65] text-muted">{selectedProfile?.behaviour || "Discuss your project, explore an idea, or plan the next task. This conversation stays with this agent."}</p>
						<div class="mt-5 flex flex-wrap gap-2 text-[12px] text-muted"><span class="inline-flex items-center gap-1.5"><MessageSquareText size={14} /> Private conversation</span>{#if selected.browserEnabled}<span class="inline-flex items-center gap-1.5"><Globe2 size={14} /> Browser access</span>{/if}{#if selected.kanbanEnabled}<span class="inline-flex items-center gap-1.5"><Boxes size={14} /> Kanban access</span>{/if}</div>
						<div class="mt-6 grid gap-2 border-t border-line-soft pt-4">
							<button type="button" disabled={!isRunnable(selected)} class="flex items-center justify-between rounded-md px-2 py-2.5 text-left text-[13px] text-muted hover:bg-raised hover:text-ink disabled:opacity-40" onclick={() => preparePrompt("Help me understand this project's architecture and identify the next useful step.")}>Discuss this project's architecture<Plus size={14} /></button>
							<button type="button" disabled={!isRunnable(selected)} class="flex items-center justify-between rounded-md px-2 py-2.5 text-left text-[13px] text-muted hover:bg-raised hover:text-ink disabled:opacity-40" onclick={() => preparePrompt("Help me turn my idea into a clear task with acceptance criteria.")}>Plan a task together<Plus size={14} /></button>
						</div>
					</div>
				{/if}
				{#if selected.browserEnabled && (browserOpen[selected.id] || browserRuns[selected.id]?.status === "running" || browserRuns[selected.id]?.status === "waiting-approval")}
					<div class="mt-3"><button type="button" class="mb-1 text-[12px] text-info" onclick={() => onclosebrowser(selected.id)}>Hide browser</button>{#key selected.id}<PersonalBrowserPanel botId={selected.id} run={browserRuns[selected.id]} onattach={onbrowserattach} oncommand={onbrowsercommand} />{/key}</div>
				{:else if selected.browserEnabled}<button type="button" class="mt-3 rounded-md border border-line px-2 py-1 text-[12px] text-info" onclick={() => void onopenbrowser(selected.id)}>Open browser</button>{/if}
			</div>

			<div class="shrink-0 px-6 pt-3 pb-5 narrow-520:px-3 narrow-520:pb-3">
				{#if !isRunnable(selected)}
					<p class="mx-auto mb-2 max-w-3xl text-[12px] text-muted">Choose a model beside Send to start chatting.</p>
				{/if}
				<div class="mx-auto flex max-w-[860px] flex-col rounded-xl border border-line bg-bg shadow-sm focus-within:border-accent">
					<textarea
						bind:this={composer}
						data-personal-composer="true"
						aria-label={`Message ${selected.name}`}
						rows="3"
						class="max-h-64 min-h-[88px] w-full resize-y border-0 bg-transparent px-4 pt-4 pb-2 text-[14px] leading-[1.6] text-ink outline-none placeholder:text-dim"
						placeholder={`Message ${selected.name}`}
						bind:value={chatDraft}
						disabled={!isRunnable(selected) || conversationBusy}
						onkeydown={(event) => { if (!event.isComposing && (shortcuts?.matches(event, "compose.send") || shortcuts?.matches(event, "run"))) { event.preventDefault(); void send(); } }}
					></textarea>
					<div class="flex min-w-0 flex-wrap items-center gap-2 px-3 pb-3 pt-1">
						<div class="w-[min(240px,55%)] min-w-0" title="Model"><ModelSelect label="" value={model} options={models.map((value: string) => ({ value, label: value }))} disabled={busy || klermHarness?.available !== true || conversationBusy} placeholder="Choose model" onchange={(value: string) => { model = value; void save(); }} /></div>
						<label class="min-w-0 shrink-0"><span class="sr-only">Reasoning effort</span><select aria-label="Thinking" title="Reasoning effort" class="h-9 max-w-[120px] rounded-md border border-line bg-panel px-2 text-[12px] capitalize text-muted" value={effort} disabled={busy || conversationBusy} onchange={(event) => { effort = event.currentTarget.value as PersonalBot["effort"]; void save(); }}>{#each efforts as value}<option value={value}>{value}</option>{/each}</select></label>
					{#if conversationBusy}
						<button type="button" aria-label={`Stop ${selected.name}'s task`} class="ml-auto flex h-9 items-center gap-2 rounded-md border border-danger bg-danger-soft px-3 text-[12px] font-medium text-danger" onclick={() => onabort(selected.id)}><Square size={12} fill="currentColor" /> Stop</button>
					{:else}
						<button type="button" aria-label={`Send to ${selected.name}`} class="ml-auto flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-[12px] font-medium text-on-primary disabled:opacity-35" disabled={!chatDraft.trim() || !isRunnable(selected)} onclick={send}>Send<Send size={14} /></button>
					{/if}
					</div>
				</div>
				<p class="mx-auto mt-2 mb-0 max-w-[860px] text-center text-[11px] text-dim">{shortcuts?.label("compose.send") || "Send button"} to send · Shift+Enter for a new line · Changes to this agent apply to future tasks.</p>
			</div>
		{:else if creating}
			<div class="grid flex-1 place-items-center text-center">
				<div><p class="m-0 text-sm font-semibold text-ink">Configure your new bot</p><p class="mt-1 text-[12px] text-muted">Its private chat will appear here after saving.</p></div>
			</div>
		{:else}
			<header class="flex h-[76px] shrink-0 items-center gap-3 border-b border-line-soft px-5"><button type="button" aria-label="Back to workspace" class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised" onclick={onclose}><ArrowLeft size={17} /></button><h2 class="text-[18px] font-semibold text-ink">Personal Bots</h2></header>
			<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center"><MessageSquareText size={32} stroke-width={1.5} class="text-accent" /><h3 class="m-0 text-[22px] font-semibold tracking-[-.025em]">Create your first personal agent</h3><p class="max-w-sm text-[14px] text-muted">Give it a name and describe how it should help. Its private chat will appear here.</p><button type="button" class="control control-primary" onclick={beginCreate}><Plus size={16} /> New personal agent</button></div>
		{/if}
	</main>

	{#if detailsOpen && selected && !creating}
	<aside class="flex w-[280px] shrink-0 flex-col border-l border-line-soft bg-bg narrow-1200:absolute narrow-1200:inset-y-0 narrow-1200:right-0 narrow-1200:z-20 narrow-1200:max-w-full narrow-1200:shadow-popover" aria-label="Personal agent details">
		<header class="flex h-[76px] shrink-0 items-center justify-between border-b border-line-soft px-5"><h3 class="text-[14px] font-semibold text-ink">Agent details</h3><button type="button" aria-label="Close agent details" class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised" onclick={() => (detailsOpen = false)}><X size={16} /></button></header>
		<div class="min-h-0 flex-1 overflow-y-auto p-5">
			<p class="m-0 text-[13px] font-medium text-ink">{selectedProfile?.name ?? "Missing personality profile"}</p>
			<p class="mt-2 text-[13px] leading-[1.6] text-muted">{selectedProfile?.behaviour || "Edit this agent's personality to describe how it should help."}</p>
			<div class="mt-5 space-y-4 border-t border-line-soft pt-5 text-[12px]">
				<div><span class="block uppercase tracking-wider text-dim">Model</span><span class="mt-1 block break-words text-muted">{selected.model || "Not selected"}</span></div>
				<div><span class="block uppercase tracking-wider text-dim">Reasoning</span><span class="mt-1 block capitalize text-muted">{selected.effort}</span></div>
				<div class="grid grid-cols-2 gap-2"><div><span class="block uppercase tracking-wider text-dim">Messages</span><span class="mt-1 block text-muted">{conversation?.messages.length ?? 0}</span></div><div><span class="block uppercase tracking-wider text-dim">Status</span><span class="mt-1 block capitalize text-muted">{conversation?.status ?? "loading"}</span></div></div>
				<div><span class="block uppercase tracking-wider text-dim">Session</span><span class="mt-1 block text-muted">{conversation?.nativeSessionId ? "Persistent" : "Not started"}</span></div>
				<div><span class="block uppercase tracking-wider text-dim">Previous sessions</span><span class="mt-1 block text-muted">{conversation?.sessionContextDigest ? "Context synchronized" : "Added on first discussion"}</span></div>
				{#if conversation?.status === "failed"}<div><span class="block uppercase tracking-wider text-dim">Last reply</span><span class="mt-1 block text-danger">The last bot response failed.</span></div>{/if}
			</div>
			<div class="mt-5 space-y-2 border-t border-line-soft pt-5 text-[12px]"><p class="mb-3 font-medium text-muted">Tool access</p><div class="flex items-center gap-2"><Globe2 size={14} class="text-muted" /><span>Browser</span><span class={`ml-auto ${selected.browserEnabled ? "text-success" : "text-dim"}`}>{selected.browserEnabled ? "Enabled" : "Off"}</span></div><div class="flex items-center gap-2"><Boxes size={14} class="text-muted" /><span>Kanban</span><span class={`ml-auto ${selected.kanbanEnabled ? "text-success" : "text-dim"}`}>{selected.kanbanEnabled ? "Enabled" : "Off"}</span></div></div>
			<div class="mt-6 grid gap-2">
				<button type="button" class="control w-full" disabled={!conversation} onclick={() => openConfiguration("ai")}><Settings size={14} /> Edit agent</button>
			</div>
			{#if notice}<p class="mt-3 text-[12px] text-success">{notice}</p>{/if}
		</div>
	</aside>
	{/if}

	{#if configuring}
		<div class="absolute inset-0 z-40 grid place-items-center bg-bg/85 p-4 backdrop-blur-sm narrow-520:p-2" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) closeConfiguration(); }}>
			<div use:focusDialog role="dialog" aria-modal="true" aria-label={profileEditing ? "Personality profile editor" : creating ? "Create Personal Agent" : "Personal Agent settings"} tabindex="-1" onkeydown={keepDialogFocus} class="flex h-[min(680px,100%)] max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-line bg-panel p-6 shadow-popover narrow-520:p-4">
				{#if profileEditing}
					<header class="mb-5 flex shrink-0 items-start justify-between gap-3"><div><p class="section-label">Personality profile</p><h2 class="mt-1 mb-0 text-[22px] font-semibold tracking-[-.03em] text-ink">{profileCreating ? "New profile" : profileName}</h2><p class="mt-2 mb-0 text-[13px] text-muted">Set its behaviour, working preferences and personal memory.</p></div><button type="button" class="control" onclick={() => profileEditing = false}><ArrowLeft size={14} /> Back</button></header>
					<div class="grid min-h-0 flex-1 grid-cols-2 content-start items-start gap-4 overflow-y-auto pr-1 max-[680px]:grid-cols-1">
						<label class="block"><span class="mb-1 block text-[12px] font-medium text-muted">Profile name</span><input aria-label="Profile name" class="h-10 w-full rounded-md border border-line bg-bg px-3 text-[13px] text-ink" maxlength="40" bind:value={profileName} /></label>
						<div><span class="mb-1 block text-[12px] font-semibold uppercase tracking-wider text-muted">Profile icon</span><div class="grid grid-cols-6 gap-1">{#each KLERM_PROFILE_FACES as option}<button type="button" title={option} class={`rounded-md border py-2 text-[14px] ${profileFace === option ? "border-success bg-raised text-success" : "border-line bg-bg text-muted"}`} onclick={() => profileFace = option}>{profileIcon(option)}</button>{/each}</div></div>
						<label class="block"><span class="mb-1 block text-[12px] font-semibold uppercase tracking-wider text-muted">Profile level</span><select class="w-full rounded-md border border-line bg-bg px-2.5 py-2 text-[13px] text-ink" bind:value={profileLevel}>{#each [1, 2, 3, 4, 5] as value}<option value={value}>{value} / 5</option>{/each}</select><span class="mt-1 block text-[12px] text-muted">Profile hint in the AI instructions; it does not change model capability or reasoning.</span></label>
						<label class="block"><span class="mb-1 block text-[12px] font-medium text-muted">Memory format</span><select class="w-full rounded-md border border-line bg-bg px-2.5 py-2 text-[13px] text-ink" bind:value={profileMemoryFormat}><option value="md">Markdown</option><option value="html">HTML</option></select></label>
						<label class="block"><span class="mb-1 block text-[12px] font-medium text-muted">Behaviour</span><textarea aria-label="Profile behaviour" class="min-h-32 w-full resize-y rounded-md border border-line bg-bg p-3 text-[13px] leading-[1.65] text-ink" maxlength="8000" bind:value={profileBehaviour}></textarea></label>
						<label class="block"><span class="mb-1 block text-[12px] font-medium text-muted">Discussion workflow</span><textarea aria-label="Discussion workflow" class="min-h-32 w-full resize-y rounded-md border border-line bg-bg p-3 text-[13px] leading-[1.65] text-ink" maxlength="8000" bind:value={profileWorkPlan}></textarea></label>
						<label class="block"><span class="mb-1 block text-[12px] font-medium text-muted">Personal memory</span><textarea aria-label="Profile personal memory" class="min-h-32 w-full resize-y rounded-md border border-line bg-bg p-3 text-[13px] leading-[1.65] text-ink" maxlength="2000" bind:value={profileMemory}></textarea></label>
						<label class="block"><span class="mb-1 block text-[12px] font-medium text-muted">Read-only guidance</span><textarea aria-label="Read-only guidance" class="min-h-32 w-full resize-y rounded-md border border-line bg-bg p-3 text-[13px] leading-[1.65] text-ink" maxlength="8000" bind:value={profilePlanMode}></textarea></label>
						<label class="col-span-2 block max-[680px]:col-span-1"><span class="mb-1 block text-[12px] font-medium text-muted">Reusable build guidance</span><textarea aria-label="Reusable build guidance" class="min-h-32 w-full resize-y rounded-md border border-line bg-bg p-3 text-[13px] leading-[1.65] text-ink" maxlength="8000" bind:value={profileBuildMode}></textarea></label>
					</div>
					<div class="mt-5 flex shrink-0 justify-end gap-2 border-t border-line-soft pt-4"><button type="button" class="control" onclick={() => profileEditing = false}>Cancel</button><button type="button" class="control control-primary disabled:opacity-40" disabled={!profileName.trim() || busy} onclick={saveProfile}>{profileCreating ? "Create profile" : "Save profile"}</button></div>
				{:else}
					<header class="mb-5 flex shrink-0 items-start justify-between gap-3"><div><p class="section-label">Personal agent</p><h2 class="mt-1 mb-0 text-[22px] font-semibold tracking-[-.03em] text-ink">{creating ? "Create an assistant" : selected?.name}</h2><p class="mt-2 mb-0 text-[13px] text-muted">{creating ? "Give it a name, choose a model, and describe how it should help." : "Changes apply to future messages and assigned tasks."}</p></div><button type="button" aria-label="Close agent settings" class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised" onclick={closeConfiguration}><X size={18} /></button></header>
					<div role="tablist" tabindex="-1" aria-label="Personal agent settings sections" onkeydown={navigateSettingsTabs} class="mb-5 flex shrink-0 gap-1 border-b border-line-soft">{#each settingsTabs as tab}<button type="button" role="tab" aria-selected={settingsSection === tab.id} aria-controls="personal-agent-settings-panel" tabindex={settingsSection === tab.id ? 0 : -1} class={`border-b-2 px-3 py-2.5 text-[13px] font-medium ${settingsSection === tab.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`} onclick={() => (settingsSection = tab.id)}>{tab.label}</button>{/each}</div>
					{#if notice}<p role="status" class="mb-3 text-[12px] text-success">{notice}</p>{/if}
					{#if settingsSection === "ai"}
						<div id="personal-agent-settings-panel" role="tabpanel" aria-label="Identity and access" class="grid min-h-0 flex-1 grid-cols-2 content-start items-start gap-4 overflow-y-auto pr-1 max-[680px]:grid-cols-1">
							<label class={`flex items-start gap-3 rounded-lg border p-4 text-[13px] ${browserEnabled ? "border-accent bg-accent-soft" : "border-line-soft bg-bg"}`}><Globe2 size={18} class="mt-0.5 shrink-0 text-muted" /><span class="flex-1"><span class="block font-medium text-ink">Browser access</span><span class="mt-1 block text-[12px] leading-[1.5] text-muted">Let this agent read sites and use browser tasks.</span></span><input aria-label="Browser access" class="mt-1 accent-accent" type="checkbox" bind:checked={browserEnabled} /></label>
							<label class={`flex items-start gap-3 rounded-lg border p-4 text-[13px] ${kanbanEnabled ? "border-accent bg-accent-soft" : "border-line-soft bg-bg"}`}><Boxes size={18} class="mt-0.5 shrink-0 text-muted" /><span class="flex-1"><span class="block font-medium text-ink">Kanban access</span><span class="mt-1 block text-[12px] leading-[1.5] text-muted">Let it create cards and run its assigned tasks.</span></span><input aria-label="Kanban access" class="mt-1 accent-accent" type="checkbox" bind:checked={kanbanEnabled} /></label>
							<label class="block"><span class="mb-1 block text-[12px] font-medium text-muted">Name</span><input aria-label="Agent name" class="h-10 w-full rounded-md border border-line bg-bg px-3 text-[13px] text-ink" bind:value={name} /></label>
							<div><span class="mb-1 block text-[12px] font-semibold uppercase tracking-wider text-muted">Icon</span><div class="grid grid-cols-6 gap-1">{#each KLERM_PROFILE_FACES as option}<button type="button" title={option} class={`rounded-md border py-2 text-[14px] ${face === option ? "border-success bg-raised text-success" : "border-line bg-bg text-muted"}`} onclick={() => face = option}>{profileIcon(option)}</button>{/each}</div></div>
							{#if creating}
								<label class="block"><span class="mb-1 block text-[12px] font-medium text-muted">What should this agent help with?</span><textarea aria-label="Agent purpose" placeholder="For example: review code changes and explain trade-offs." class="min-h-32 w-full resize-y rounded-md border border-line bg-bg p-3 text-[13px] leading-[1.65] text-ink" maxlength="4000" bind:value={botBrief}></textarea></label>
								<div>
									<span class="mb-1 block text-[12px] font-semibold uppercase tracking-wider text-muted">Personal memory generator</span>
									<button type="button" class="w-full rounded-md border border-line bg-panel px-3 py-2 text-[12px] font-semibold text-ink hover:border-line hover:text-ink disabled:cursor-wait disabled:opacity-40" disabled={!botBrief.trim() || !generationModel || generatingMemory || busy} onclick={generateMemory}>{generatingMemory ? "Generating..." : "Generate personal memory"}</button>
									<p class="mt-1 text-[11px] leading-3 text-dim">{generationModel ? `Runs on ${generationModel}. Describe what you want above, then generate.` : "No configured Klerm model available for generation yet."}</p>
									{#if memoryError}<p class="mt-1 text-[11px] text-danger">{memoryError}</p>{/if}
								</div>
								<label class="block"><span class="mb-1 block text-[12px] font-medium text-muted">Personal memory</span><textarea aria-label="New agent memory" placeholder="Preferences or context this agent should keep." class="min-h-32 w-full resize-y rounded-md border border-line bg-bg p-3 text-[13px] leading-[1.65] text-ink" maxlength="2000" bind:value={personalMemory}></textarea></label>
							{:else}
								<div><span class="mb-1 block text-[12px] font-semibold uppercase tracking-wider text-muted">Personality</span><div class="flex gap-1.5"><span class="min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 py-2 text-[13px] text-muted">{configuredProfile?.name ?? "Missing profile"}</span><button type="button" class="rounded-md border border-line px-2 text-[12px] text-muted disabled:opacity-40" disabled={!configuredProfile} onclick={() => configuredProfile && openProfileEditor(configuredProfile)}>Edit</button></div></div>
							{/if}
						</div>
						<div class="mt-5 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line-soft pt-4">{#if !creating && selected}<button type="button" class="mr-auto px-2 py-2 text-[12px] text-danger disabled:opacity-40" disabled={busy} onclick={remove}>Delete agent</button>{/if}<button type="button" class="control" onclick={closeConfiguration}>Cancel</button><button type="button" class="control control-primary disabled:opacity-40" disabled={!name.trim() || busy} onclick={save}>{creating ? "Create agent" : "Save agent"}</button></div>
					{:else if settingsSection === "model"}
						<div id="personal-agent-settings-panel" role="tabpanel" aria-label="Model" class="min-h-0 flex-1 space-y-4 overflow-y-auto py-2"><p class="max-w-lg text-[14px] leading-[1.65] text-muted">Choose a configured Klerm model for this agent. Its conversation stays in place when you change models.</p><ModelSelect label="Klerm model" value={model} options={models.map((value: string) => ({ value, label: value }))} disabled={klermHarness?.available !== true} direction="down" placeholder="Select model" onchange={(value: string) => model = value} /></div>
						<div class="mt-5 flex shrink-0 justify-end gap-2 border-t border-line-soft pt-4"><button type="button" class="control" onclick={closeConfiguration}>Cancel</button><button type="button" class="control control-primary disabled:opacity-40" disabled={!model || !name.trim() || busy} onclick={save}>{creating ? "Create agent" : "Save model"}</button></div>
					{:else}
						<div id="personal-agent-settings-panel" role="tabpanel" aria-label="Reasoning" class="min-h-0 flex-1 space-y-4 overflow-y-auto py-2"><p class="max-w-lg text-[14px] leading-[1.65] text-muted">Set how much reasoning effort to request. This setting is separate from the personality profile.</p><label class="block"><span class="mb-2 block text-[12px] font-medium text-muted">Reasoning effort</span><select aria-label="Agent reasoning effort" class="h-11 w-full rounded-md border border-line bg-bg px-3 text-[14px] capitalize text-ink" bind:value={effort}>{#each efforts as value}<option value={value}>{value}</option>{/each}</select></label></div>
						<div class="mt-5 flex shrink-0 justify-end gap-2 border-t border-line-soft pt-4"><button type="button" class="control" onclick={closeConfiguration}>Cancel</button><button type="button" class="control control-primary disabled:opacity-40" disabled={!name.trim() || busy} onclick={save}>{creating ? "Create agent" : "Save reasoning"}</button></div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>
