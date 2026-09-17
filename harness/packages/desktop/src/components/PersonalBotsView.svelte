<script lang="ts">
	import type {
		CodingHarnessSetup,
		KlermProfile,
		PersonalBot,
		PersonalBotConversation,
		ThinkingLevel,
	} from "../lib/model.ts";
	import { KLERM_PROFILE_FACES } from "../lib/model.ts";
	import { profileIcon } from "../lib/profiles.ts";
	import ModelSelect from "./ModelSelect.svelte";

	let {
		bots,
		profiles,
		harnessSetup,
		conversations,
		busy = false,
		onclose,
		onselect,
		onsave,
		onprofilesave,
		ondelete,
		onprompt,
		onabort,
	}: {
		bots: PersonalBot[];
		profiles: KlermProfile[];
		harnessSetup?: CodingHarnessSetup;
		conversations: Record<string, PersonalBotConversation | undefined>;
		busy?: boolean;
		onclose: () => void;
		onselect: (botId: string) => void;
		onsave: (bot: PersonalBot) => Promise<boolean>;
		onprofilesave: (profile: KlermProfile) => Promise<boolean>;
		ondelete: (bot: PersonalBot) => Promise<void>;
		onprompt: (botId: string, message: string) => Promise<boolean>;
		onabort: (botId: string) => Promise<void>;
	} = $props();

	let selectedId = $state("");
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

	const selected = $derived(bots.find((bot) => bot.id === selectedId) ?? bots[0]);
	const conversation = $derived(selected ? conversations[selected.id] : undefined);
	const conversationBusy = $derived(
		conversation?.status === "running" || conversation?.status === "summarizing",
	);
	const selectedProfile = $derived(profiles.find((profile) => profile.id === selected?.profileId));
	const configuredProfile = $derived(profiles.find((profile) => profile.id === profileId));
	const harnesses = $derived(harnessSetup?.harnesses ?? []);
	const klermHarness = $derived(harnesses.find((item) => item.kind === "klerm"));
	const models = $derived(klermHarness?.models ?? []);
	const efforts: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

	$effect(() => {
		if (!selectedId && bots[0]) {
			selectedId = bots[0].id;
			onselect(bots[0].id);
		}
	});

	$effect(() => {
		if (!selected || creating) return;
		name = selected.name;
		face = selected.face;
		profileId = selected.profileId;
		model = selected.harness === "klerm" ? selected.model ?? "" : "";
		effort = selected.effort;
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
		creating = false;
		configuring = false;
		selectedId = botId;
		onselect(botId);
	}

	function beginCreate(): void {
		creating = true;
		configuring = true;
		settingsSection = "ai";
		name = "";
		face = "fox";
		profileId = profiles[0]?.id ?? "";
		model = "";
		effort = "medium";
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

	async function save(): Promise<void> {
		if (!name.trim() || !profileId || busy) return;
		const value: PersonalBot = {
			id: creating ? botId(name) : selected?.id ?? botId(name),
			name: name.trim(),
			face,
			profileId,
			harness: "klerm",
			...(model ? { model } : {}),
			role: "planner",
			effort,
			enabled: Boolean(model) && klermHarness?.available === true && klermHarness.models.includes(model),
			createdSequence: creating
				? Math.max(0, ...bots.map((bot) => bot.createdSequence)) + 1
				: selected?.createdSequence ?? 1,
		};
		if (await onsave(value)) {
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
	}

	function beginProfileCreate(): void {
		profileCreating = true;
		profileName = "";
		profileFace = "fox";
		profileLevel = 1;
		profileBehaviour = "Be thoughtful, direct, and useful during technical discussions.";
		profileWorkPlan = "Review the available session context, identify decisions and risks, then suggest concrete next steps.";
		profilePlanMode = "Discuss and analyze only. Do not modify files or external state.";
		profileBuildMode = "";
		profileMemoryFormat = "md";
		profileMemory = "";
		profileReadme = "";
		profileEditing = true;
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

</script>

<div class="relative grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_220px] overflow-hidden bg-[#0b0e10] narrow-900:grid-cols-[180px_minmax(0,1fr)]">
	<aside class="flex min-h-0 flex-col border-r border-[#20262a] bg-[#0d1114]">
		<div class="flex items-start border-b border-[#20262a] px-4 py-4">
			<div class="min-w-0 flex-1"><p class="m-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#69747b]">Personal Bots</p><p class="mt-1 text-[10px] text-[#485158]">Continuous discussions</p></div>
			<button type="button" class="border-0 bg-transparent text-[14px] text-[#59646a] hover:text-white" title="Back to Agents & Routing" onclick={onclose}>x</button>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto p-2">
			{#each bots as bot (bot.id)}
				<button
					type="button"
					class={`mb-1 flex w-full items-center gap-2.5 rounded-lg border-0 px-2.5 py-2.5 text-left transition-colors ${selected?.id === bot.id && !creating ? "bg-[#1a2227] text-[#f0f4f5]" : "bg-transparent text-[#879198] hover:bg-[#13191d]"}`}
					onclick={() => selectBot(bot.id)}
				>
					<span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#252f35] text-[14px] text-[#d6e0e4]">{profileIcon(bot.face)}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-[12px] font-semibold">{bot.name}</span>
						<span class="block truncate text-[9px] uppercase tracking-[0.08em] text-[#5f6a70]">Private discussion</span>
					</span>
					<span class={`h-1.5 w-1.5 shrink-0 rounded-full ${isRunnable(bot) ? "bg-[#5cc08a]" : "bg-[#4a5257]"}`}></span>
				</button>
			{/each}
		</div>
		<button
			type="button"
			class={`m-2 rounded-lg border border-dashed px-3 py-2.5 text-left text-[11px] font-semibold ${creating ? "border-[#65d7ba] bg-[#10201c] text-[#8aead1]" : "border-[#303a40] bg-transparent text-[#89949a] hover:border-[#536168] hover:text-white"}`}
			onclick={beginCreate}
		>
			+ New bot
		</button>
	</aside>

	<main class="flex min-h-0 min-w-0 flex-col bg-[#0b0e10]">
		{#if selected && !creating}
			<header class="flex items-center gap-3 border-b border-[#20262a] px-5 py-3">
				<span class="grid h-9 w-9 place-items-center rounded-xl bg-[#1b252a] text-[15px] text-[#d9e3e6]">{profileIcon(selected.face)}</span>
				<div class="min-w-0">
					<h2 class="m-0 truncate text-[13px] font-semibold text-[#eef2f3]">{selected.name}</h2>
					<p class="m-0 truncate text-[10px] text-[#68747a]">{selected.model || "No model selected"}</p>
				</div>
				{#if conversationBusy}<span class="ml-auto rounded-full bg-[#382f18] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#e1c66b]">{conversation?.status === "summarizing" ? "Summarizing" : "Thinking"}</span>{/if}
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
				{#if conversation?.messages.length}
					<div class="mx-auto flex max-w-3xl flex-col gap-4">
						{#each conversation.messages as message (message.id)}
							<div class={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
								<div class={`max-w-[82%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-[12px] leading-5 ${message.role === "user" ? "bg-[#24473e] text-[#effaf6]" : "border border-[#242c31] bg-[#11171a] text-[#cbd3d6]"}`}>{message.text}</div>
							</div>
						{/each}
						{#if conversationBusy}
							<div class="text-[11px] text-[#7e8a90]">{selected.name} is {conversation.status === "summarizing" ? "updating the conversation summary" : "thinking"}...</div>
						{/if}
					</div>
				{:else}
					<div class="grid h-full place-items-center">
						<div class="max-w-xs text-center">
							<div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#151d21] text-[18px] text-[#bdc8cc]">{profileIcon(selected.face)}</div>
							<p class="m-0 text-[13px] font-semibold text-[#c9d1d4]">Start a private chat with {selected.name}</p>
							<p class="mt-1 text-[10px] leading-4 text-[#5f6b71]">One continuous conversation for discussing and analyzing previous coding sessions.</p>
						</div>
					</div>
				{/if}
			</div>

			<div class="border-t border-[#20262a] px-5 py-4">
				{#if !isRunnable(selected)}
					<p class="mx-auto mb-2 max-w-3xl text-[10px] text-[#7e8a90]">Select a Klerm model under Model settings to start chatting.</p>
				{/if}
				<div class="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-[#2a3439] bg-[#11171a] p-2 focus-within:border-[#4e6964]">
					<textarea
						class="max-h-32 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[12px] text-[#e5e9ea] outline-none placeholder:text-[#4f5a60]"
						placeholder={`Message ${selected.name}`}
						bind:value={chatDraft}
						disabled={!isRunnable(selected) || conversationBusy}
						onkeydown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
					></textarea>
					{#if conversationBusy}
						<button type="button" class="rounded-lg bg-[#4d2929] px-3 py-2 text-[10px] font-semibold text-[#f1b4b4]" onclick={() => onabort(selected.id)}>Stop</button>
					{:else}
						<button type="button" class="rounded-lg bg-[#dce8e4] px-3 py-2 text-[10px] font-semibold text-[#13201c] disabled:opacity-30" disabled={!chatDraft.trim() || !isRunnable(selected)} onclick={send}>Send</button>
					{/if}
				</div>
			</div>
		{:else if creating}
			<div class="grid flex-1 place-items-center text-center">
				<div><p class="m-0 text-sm font-semibold text-[#d7dfe1]">Configure your new bot</p><p class="mt-1 text-[10px] text-[#667178]">Its private chat will appear here after saving.</p></div>
			</div>
		{:else}
			<div class="grid flex-1 place-items-center text-[11px] text-[#667178]">Create a bot to begin.</div>
		{/if}
	</main>

	<aside class="min-h-0 overflow-y-auto border-l border-[#20262a] bg-[#0d1114] p-4 narrow-900:col-span-2 narrow-900:border-l-0 narrow-900:border-t">
		{#if selected && !creating}
			<p class="m-0 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#677279]">Conversation</p>
			<div class="mt-4 flex items-center gap-2.5">
				<span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#1b252a] text-[15px]">{profileIcon(selected.face)}</span>
				<div class="min-w-0"><p class="m-0 truncate text-[12px] font-semibold text-[#dce3e5]">{selected.name}</p><p class="mt-0.5 truncate text-[9px] text-[#647077]">{selectedProfile?.name ?? "Missing profile"}</p></div>
			</div>
			<div class="mt-5 space-y-3 text-[10px]">
				<div><span class="block uppercase tracking-wider text-[#4f5a60]">Model</span><span class="mt-1 block break-words text-[#9ba6ab]">{selected.model || "Not selected"}</span></div>
				<div><span class="block uppercase tracking-wider text-[#4f5a60]">Reasoning</span><span class="mt-1 block capitalize text-[#9ba6ab]">{selected.effort}</span></div>
				<div class="grid grid-cols-2 gap-2"><div><span class="block uppercase tracking-wider text-[#4f5a60]">Messages</span><span class="mt-1 block text-[#9ba6ab]">{conversation?.messages.length ?? 0}</span></div><div><span class="block uppercase tracking-wider text-[#4f5a60]">Status</span><span class="mt-1 block capitalize text-[#9ba6ab]">{conversation?.status ?? "loading"}</span></div></div>
				<div><span class="block uppercase tracking-wider text-[#4f5a60]">Session</span><span class="mt-1 block text-[#9ba6ab]">{conversation?.nativeSessionId ? "Persistent" : "Not started"}</span></div>
				<div><span class="block uppercase tracking-wider text-[#4f5a60]">Previous sessions</span><span class="mt-1 block text-[#9ba6ab]">{conversation?.sessionContextDigest ? "Context synchronized" : "Added on first discussion"}</span></div>
				<div><span class="block uppercase tracking-wider text-[#4f5a60]">Other bots</span><span class="mt-1 block text-[#9ba6ab]">{conversation?.peerSummaryDigest ? "Summary context synchronized" : "No new summaries"}</span></div>
				{#if conversation?.summary}<div><span class="block uppercase tracking-wider text-[#4f5a60]">Latest summary</span><p class="mt-1 max-h-28 overflow-hidden whitespace-pre-wrap text-[9px] leading-4 text-[#87939a]">{conversation.summary.text}</p></div>{/if}
			</div>
			<div class="mt-5 grid gap-2">
				<button type="button" class="rounded-md border border-[#303a40] bg-[#13191d] px-3 py-2 text-left text-[10px] font-semibold text-[#b8c1c5] hover:border-[#526168] hover:text-white disabled:cursor-wait disabled:opacity-40" disabled={!conversation} onclick={() => openConfiguration("ai")}><span class="block">AI settings</span><span class="mt-0.5 block text-[8px] font-normal text-[#5f6a70]">Name, icon and personality</span></button>
				<button type="button" class="rounded-md border border-[#303a40] bg-[#13191d] px-3 py-2 text-left text-[10px] font-semibold text-[#b8c1c5] hover:border-[#526168] hover:text-white disabled:cursor-wait disabled:opacity-40" disabled={!conversation} onclick={() => openConfiguration("model")}><span class="block">Model settings</span><span class="mt-0.5 block text-[8px] font-normal text-[#5f6a70]">Klerm model selection</span></button>
				<button type="button" class="rounded-md border border-[#303a40] bg-[#13191d] px-3 py-2 text-left text-[10px] font-semibold text-[#b8c1c5] hover:border-[#526168] hover:text-white disabled:cursor-wait disabled:opacity-40" disabled={!conversation} onclick={() => openConfiguration("reasoning")}><span class="block">Reasoning settings</span><span class="mt-0.5 block text-[8px] font-normal text-[#5f6a70]">Thinking effort for this AI</span></button>
			</div>
			{#if notice}<p class="mt-3 text-[10px] text-[#72cda8]">{notice}</p>{/if}
		{/if}
	</aside>

	{#if configuring}
		<div class="absolute inset-0 z-30 grid place-items-center bg-black/65 p-4 backdrop-blur-[2px]" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) closeConfiguration(); }}>
			<section class="max-h-[90%] w-full max-w-[440px] overflow-y-auto rounded-xl border border-[#303a40] bg-[#0d1317] p-5 shadow-2xl">
				{#if profileEditing}
					<header class="mb-5 flex items-start justify-between gap-3"><div><p class="m-0 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#68747a]">Personality profile</p><h2 class="mt-1 mb-0 text-[14px] text-[#e5eaed]">{profileCreating ? "New profile" : profileName}</h2></div><button type="button" class="border-0 bg-transparent text-[10px] text-[#829097] hover:text-white" onclick={() => profileEditing = false}>Back</button></header>
					<div class="space-y-3">
						<label class="block"><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Profile name</span><input class="w-full rounded-md border border-[#293238] bg-[#080d10] px-2.5 py-2 text-[11px] text-white outline-none focus:border-[#537269]" maxlength="40" bind:value={profileName} /></label>
						<div><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Profile icon</span><div class="grid grid-cols-6 gap-1">{#each KLERM_PROFILE_FACES as option}<button type="button" title={option} class={`rounded-md border py-2 text-[13px] ${profileFace === option ? "border-[#69cdb4] bg-[#163029] text-[#9ce5d2]" : "border-[#293238] bg-[#080d10] text-[#748087]"}`} onclick={() => profileFace = option}>{profileIcon(option)}</button>{/each}</div></div>
						<label class="block"><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Strength level</span><select class="w-full rounded-md border border-[#293238] bg-[#080d10] px-2.5 py-2 text-[11px] text-white" bind:value={profileLevel}>{#each [1, 2, 3, 4, 5] as value}<option value={value}>{value} / 5</option>{/each}</select></label>
						<label class="block"><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Behaviour</span><textarea class="min-h-24 w-full resize-y rounded-md border border-[#293238] bg-[#080d10] px-2.5 py-2 text-[10px] leading-4 text-white outline-none focus:border-[#537269]" maxlength="8000" bind:value={profileBehaviour}></textarea></label>
						<label class="block"><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Discussion workflow</span><textarea class="min-h-20 w-full resize-y rounded-md border border-[#293238] bg-[#080d10] px-2.5 py-2 text-[10px] leading-4 text-white outline-none focus:border-[#537269]" maxlength="8000" bind:value={profileWorkPlan}></textarea></label>
						<label class="block"><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Read-only guidance</span><textarea class="min-h-20 w-full resize-y rounded-md border border-[#293238] bg-[#080d10] px-2.5 py-2 text-[10px] leading-4 text-white outline-none focus:border-[#537269]" maxlength="8000" bind:value={profilePlanMode}></textarea></label>
						<label class="block"><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Reusable build guidance</span><textarea class="min-h-16 w-full resize-y rounded-md border border-[#293238] bg-[#080d10] px-2.5 py-2 text-[10px] leading-4 text-white outline-none focus:border-[#537269]" maxlength="8000" bind:value={profileBuildMode}></textarea></label>
						<label class="block"><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Memory format</span><select class="w-full rounded-md border border-[#293238] bg-[#080d10] px-2.5 py-2 text-[11px] text-white" bind:value={profileMemoryFormat}><option value="md">Markdown</option><option value="html">HTML</option></select></label>
					</div>
					<div class="mt-5 flex gap-2"><button type="button" class="flex-1 rounded-md border-0 bg-[#dce8e4] px-3 py-2 text-[10px] font-semibold text-[#15211e] disabled:opacity-40" disabled={!profileName.trim() || busy} onclick={saveProfile}>{profileCreating ? "Create profile" : "Save profile"}</button><button type="button" class="rounded-md border border-[#303a40] bg-transparent px-3 py-2 text-[10px] text-[#909a9f]" onclick={() => profileEditing = false}>Cancel</button></div>
				{:else}
					<header class="mb-5 flex items-start justify-between gap-3"><div><p class="m-0 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#68747a]">{settingsSection === "ai" ? "AI settings" : settingsSection === "model" ? "Model settings" : "Reasoning settings"}</p><h2 class="mt-1 mb-0 text-[14px] text-[#e5eaed]">{creating ? "New Personal Bot" : selected?.name}</h2></div><button type="button" class="border-0 bg-transparent text-[13px] text-[#68747a] hover:text-white" onclick={closeConfiguration}>x</button></header>
					{#if settingsSection === "ai"}
						<div class="space-y-3">
							<label class="block"><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Name</span><input class="w-full rounded-md border border-[#293238] bg-[#080d10] px-2.5 py-2 text-[11px] text-white outline-none focus:border-[#537269]" bind:value={name} /></label>
							<div><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Icon</span><div class="grid grid-cols-6 gap-1">{#each KLERM_PROFILE_FACES as option}<button type="button" title={option} class={`rounded-md border py-2 text-[13px] ${face === option ? "border-[#69cdb4] bg-[#163029] text-[#9ce5d2]" : "border-[#293238] bg-[#080d10] text-[#748087]"}`} onclick={() => face = option}>{profileIcon(option)}</button>{/each}</div></div>
							<div><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Personality profile</span><div class="flex gap-1.5"><select class="min-w-0 flex-1 rounded-md border border-[#293238] bg-[#080d10] px-2.5 py-2 text-[11px] text-white" bind:value={profileId}>{#each profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}</select><button type="button" class="rounded-md border border-[#303a40] px-2 text-[9px] text-[#9ba6ab] disabled:opacity-40" disabled={!configuredProfile} onclick={() => configuredProfile && openProfileEditor(configuredProfile)}>Edit</button><button type="button" class="rounded-md border border-[#303a40] px-2 text-[11px] text-[#9ba6ab]" title="Create profile" onclick={beginProfileCreate}>+</button></div></div>
						</div>
						<div class="mt-5 flex items-center gap-2"><button type="button" class="flex-1 rounded-md border-0 bg-[#dce8e4] px-3 py-2 text-[10px] font-semibold text-[#15211e] disabled:opacity-40" disabled={!name.trim() || !profileId || busy} onclick={save}>{creating ? "Create AI" : "Save AI"}</button><button type="button" class="rounded-md border border-[#303a40] bg-transparent px-3 py-2 text-[10px] text-[#909a9f]" onclick={closeConfiguration}>Cancel</button></div>
						{#if !creating && selected}<button type="button" class="mt-3 border-0 bg-transparent p-0 text-[9px] text-[#875d5d] hover:text-[#d58d8d]" onclick={remove}>Delete bot</button>{/if}
					{:else if settingsSection === "model"}
						<p class="mb-4 text-[10px] leading-4 text-[#748087]">Personal Bots always run inside Klerm. Choose which configured Klerm model powers this AI.</p>
						<div><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Klerm model</span><div class="rounded-md border border-[#293238] bg-[#080d10] px-2 py-1.5"><ModelSelect label="" value={model} options={models.map((value: string) => ({ value, label: value }))} disabled={klermHarness?.available !== true} placeholder="Select model" onchange={(value: string) => model = value} /></div></div>
						<div class="mt-5 flex items-center gap-2"><button type="button" class="flex-1 rounded-md border-0 bg-[#dce8e4] px-3 py-2 text-[10px] font-semibold text-[#15211e] disabled:opacity-40" disabled={!model || busy} onclick={save}>Save model</button><button type="button" class="rounded-md border border-[#303a40] bg-transparent px-3 py-2 text-[10px] text-[#909a9f]" onclick={closeConfiguration}>Cancel</button></div>
					{:else}
						<p class="mb-4 text-[10px] leading-4 text-[#748087]">Reasoning is independent from the selected model and AI personality. Change it without starting a new conversation.</p>
						<label class="block"><span class="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-[#68747a]">Reasoning effort</span><select class="w-full rounded-md border border-[#293238] bg-[#080d10] px-2 py-2 text-[10px] text-white" bind:value={effort}>{#each efforts as value}<option value={value}>{value}</option>{/each}</select></label>
						<div class="mt-5 flex items-center gap-2"><button type="button" class="flex-1 rounded-md border-0 bg-[#dce8e4] px-3 py-2 text-[10px] font-semibold text-[#15211e] disabled:opacity-40" disabled={busy} onclick={save}>Save reasoning</button><button type="button" class="rounded-md border border-[#303a40] bg-transparent px-3 py-2 text-[10px] text-[#909a9f]" onclick={closeConfiguration}>Cancel</button></div>
					{/if}
				{/if}
			</section>
		</div>
	{/if}
</div>
