<script lang="ts">
	import { ArrowLeft, Bot, Check, MessageCircle, Plus, RotateCcw, Save, Send, Settings2, Square, Trash2, X } from "@lucide/svelte";
	import type {
		CodingHarnessKind,
		CodingHarnessSetup,
		KlermProfile,
		KlermProfileFace,
		PersonalBot,
		PersonalBotConversation,
		ThinkingLevel,
	} from "../lib/model.ts";
	import { KLERM_PROFILE_FACES } from "../lib/model.ts";
	import { profileIcon } from "../lib/profiles.ts";

	let {
		bots,
		profiles,
		harnessSetup,
		conversations,
		busy,
		onclose,
		onselect,
		onsave,
		ondelete,
		onprompt,
		onabort,
		onreset,
	}: {
		bots: PersonalBot[];
		profiles: KlermProfile[];
		harnessSetup?: CodingHarnessSetup;
		conversations: Record<string, PersonalBotConversation | undefined>;
		busy: boolean;
		onclose: () => void;
		onselect: (botId: string) => void;
		onsave: (bot: PersonalBot) => Promise<boolean>;
		ondelete: (bot: PersonalBot) => Promise<void>;
		onprompt: (botId: string, message: string) => Promise<boolean>;
		onabort: (botId: string) => Promise<void>;
		onreset: (botId: string) => Promise<void>;
	} = $props();

	const efforts: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	let selectedId = $state("");
	let editing = $state(false);
	let creating = $state(false);
	let chatDraft = $state("");
	let name = $state("");
	let face = $state<KlermProfileFace>("cat");
	let profileId = $state("");
	let harness = $state<CodingHarnessKind>("klerm");
	let model = $state("");
	let role = $state<"planner" | "builder">("builder");
	let effort = $state<ThinkingLevel>("medium");
	let enabled = $state(false);
	let notice = $state("");
	let loadedId = $state("");

	const selected = $derived(bots.find((bot) => bot.id === selectedId));
	const conversation = $derived(selectedId ? conversations[selectedId] : undefined);
	const configurationChanged = $derived(
		Boolean(
			selected &&
				conversation &&
				conversation.messages.length > 0 &&
				(conversation.harness !== selected.harness ||
					conversation.model !== (selected.model ?? "") ||
					conversation.role !== selected.role),
		),
	);
	const harnesses = $derived(harnessSetup?.harnesses.filter((item) => item.available) ?? []);
	const models = $derived(harnesses.find((item) => item.kind === harness)?.models ?? []);

	$effect(() => {
		if (!creating && !bots.some((bot) => bot.id === selectedId)) selectedId = bots[0]?.id ?? "";
	});

	$effect(() => {
		if (selectedId && selectedId !== loadedId) {
			loadedId = selectedId;
			onselect(selectedId);
		}
	});

	$effect(() => {
		if (!selected || creating) return;
		name = selected.name;
		face = selected.face;
		profileId = selected.profileId;
		harness = selected.harness;
		model = selected.model ?? "";
		role = selected.role;
		effort = selected.effort;
		enabled = selected.enabled;
		notice = "";
	});

	function isRunnable(bot: PersonalBot): boolean {
		const availableHarness = harnesses.find((item) => item.kind === bot.harness);
		return (
			bot.enabled &&
			Boolean(bot.model) &&
			availableHarness?.adapterConnected === true &&
			(bot.harness === "codex" || bot.harness === "opencode") &&
			availableHarness.models.includes(bot.model ?? "")
		);
	}

	function beginCreate(): void {
		creating = true;
		editing = true;
		name = "";
		face = "cat";
		profileId = profiles[0]?.id ?? "";
		harness = harnesses.find((item) => item.adapterConnected)?.kind ?? "klerm";
		model = "";
		role = "builder";
		effort = "medium";
		enabled = false;
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
		const availableHarness = harnesses.find((item) => item.kind === harness);
		const value: PersonalBot = {
			id: selected?.id ?? botId(name),
			name: name.trim(),
			face,
			profileId,
			harness,
			...(model ? { model } : {}),
			role,
			effort,
			enabled:
				enabled &&
				Boolean(model) &&
				availableHarness?.adapterConnected === true &&
				(harness === "codex" || harness === "opencode") &&
				models.includes(model),
			createdSequence: selected?.createdSequence ?? 1,
		};
		if (await onsave(value)) {
			selectedId = value.id;
			creating = false;
			editing = false;
			notice = "Bot saved";
		}
	}

	async function send(): Promise<void> {
		const message = chatDraft.trim();
		if (!selected || !message || conversation?.status === "running") return;
		if (await onprompt(selected.id, message)) chatDraft = "";
	}
</script>

<div class="relative flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_70%_0%,rgba(117,146,162,.12),transparent_38%)]">
	<header class="flex items-center gap-3 border-b border-line bg-[rgba(8,11,15,.8)] px-6 py-3.5 backdrop-blur-[18px] narrow-720:px-3">
		<button type="button" aria-label="Back to Agents and Routing" class="grid h-9 w-9 place-items-center rounded-lg border border-[#303b43] bg-[#11171c] text-[#9ba7ae] hover:border-[#5b6a74] hover:text-white" onclick={onclose}><ArrowLeft size={15} /></button>
		<div><p class="m-0 font-mono text-[8px] tracking-[.15em] text-[#66737b] uppercase">Personal workspace</p><h1 class="mt-0.5 mb-0 text-[16px] font-semibold text-[#e8edef]">Personal Bots</h1></div>
		<button type="button" class="ml-auto flex h-9 items-center gap-2 rounded-lg border border-[#3b4851] bg-[#151d22] px-3 font-mono text-[9px] text-[#d9e1e4] hover:border-[#64747e]" onclick={beginCreate}><Plus size={13} /> New bot</button>
	</header>

	<nav class="flex shrink-0 gap-2 overflow-x-auto border-b border-[#263139] bg-[rgba(7,11,14,.72)] px-5 py-3 narrow-720:px-3">
		{#each bots as bot (bot.id)}
			<button type="button" class={`flex min-w-[150px] items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left ${selectedId === bot.id && !creating ? "border-[#5a6a74] bg-[#172127]" : "border-[#29343b] bg-[#0d1317] hover:border-[#46545d]"}`} onclick={() => { creating = false; editing = false; selectedId = bot.id; }}>
				<span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#37454e] bg-[#0a1014] text-[15px]">{profileIcon(bot.face)}</span>
				<span class="min-w-0 flex-1"><strong class="block truncate text-[10px] text-[#dce3e6]">{bot.name}</strong><small class="mt-0.5 block truncate font-mono text-[7px] text-[#66737b]">{bot.harness} · {bot.role}</small></span>
				<span class={`h-1.5 w-1.5 rounded-full ${isRunnable(bot) ? "bg-accent" : "bg-[#59656d]"}`}></span>
			</button>
		{/each}
	</nav>

	{#if selected && !creating}
		<div class="flex min-h-0 flex-1 flex-col">
			<button type="button" class="group flex shrink-0 items-center gap-3 border-b border-[#263139] bg-[rgba(12,18,22,.8)] px-6 py-3 text-left hover:bg-[#111a1f] narrow-720:px-3" onclick={() => (editing = true)}>
				<span class="grid h-10 w-10 place-items-center rounded-xl border border-[rgba(214,255,63,.2)] bg-[rgba(214,255,63,.06)] text-[18px]">{profileIcon(selected.face)}</span>
				<span><strong class="block text-[13px] text-[#e5eaed]">{selected.name}</strong><small class="mt-0.5 block font-mono text-[8px] text-[#6d7a82]">{selected.model ?? "Model not configured"} · {selected.role} · {selected.effort}</small></span>
				<span class="ml-auto flex items-center gap-1.5 font-mono text-[8px] text-[#75828a] group-hover:text-white"><Settings2 size={12} /> Configure</span>
			</button>

			<div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 narrow-720:px-3">
				<div class="mx-auto flex min-h-full max-w-[820px] flex-col gap-3">
					{#if !conversation || conversation.messages.length === 0}
						<div class="m-auto max-w-[440px] rounded-2xl border border-dashed border-[#34414a] bg-[rgba(9,14,18,.62)] px-6 py-8 text-center">
							<MessageCircle size={22} class="mx-auto text-[#89969e]" />
							<h2 class="mt-3 mb-1 text-[13px] text-[#dce3e6]">Chat with {selected.name}</h2>
							<p class="m-0 text-[10px]/[1.6] text-[#68767f]">This conversation has its own durable transcript and native Codex or OpenCode session. Configure a connected harness and model before sending.</p>
						</div>
					{:else}
						{#each conversation.messages as message (message.id)}
							<article class={`max-w-[82%] rounded-2xl border px-4 py-3 ${message.role === "user" ? "ml-auto border-[#46545e] bg-[#192229]" : "mr-auto border-[#2c3840] bg-[#0d1418]"}`}>
								<p class="m-0 mb-1 font-mono text-[7px] tracking-[.1em] text-[#68767f] uppercase">{message.role === "user" ? "You" : selected.name}</p>
								<p class="m-0 whitespace-pre-wrap text-[11px]/[1.65] text-[#d7dfe2]">{message.text}</p>
							</article>
						{/each}
					{/if}
				</div>
			</div>

			<div class="shrink-0 border-t border-[#263139] bg-[rgba(7,11,14,.9)] px-5 py-3 narrow-720:px-3">
				{#if configurationChanged}<p class="mx-auto mb-2 max-w-[820px] rounded-lg border border-[#66552d] bg-[#201b0e] px-3 py-2 font-mono text-[8px] text-[#dfc77b]">The bot configuration changed. Start a new chat before sending another message.</p>{/if}
				<div class="mx-auto flex max-w-[820px] items-end gap-2">
					<textarea bind:value={chatDraft} rows="2" maxlength="20000" placeholder={configurationChanged ? "Start a new chat to use this configuration" : isRunnable(selected) ? `Message ${selected.name}...` : "Configure Codex or OpenCode to enable chat"} disabled={!isRunnable(selected) || configurationChanged || conversation?.status === "running"} class="min-h-[48px] flex-1 resize-none rounded-xl border border-[#34414a] bg-[#080d11] px-3 py-2.5 text-[11px]/[1.5] text-white outline-none placeholder:text-[#536069] focus:border-[#667782] disabled:opacity-55" onkeydown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}></textarea>
					{#if conversation?.status === "running"}<button type="button" aria-label="Stop bot" class="grid h-10 w-10 place-items-center rounded-xl border border-[#654343] bg-[#241315] text-[#f0a19a]" onclick={() => void onabort(selected.id)}><Square size={13} /></button>{:else}<button type="button" aria-label="Send message" disabled={!chatDraft.trim() || !isRunnable(selected) || configurationChanged} class="grid h-10 w-10 place-items-center rounded-xl bg-[#d7e7ff] text-[#091019] disabled:opacity-35" onclick={() => void send()}><Send size={14} /></button>{/if}
					<button type="button" aria-label="Start new chat" disabled={conversation?.status === "running"} class="grid h-10 w-10 place-items-center rounded-xl border border-[#34414a] bg-[#11181d] text-[#89969e] disabled:opacity-35" onclick={() => void onreset(selected.id)}><RotateCcw size={14} /></button>
				</div>
			</div>
		</div>
	{:else if bots.length === 0 && !creating}
		<div class="grid min-h-0 flex-1 place-items-center"><p class="font-mono text-[10px] text-[#68767f]">Create a bot to begin.</p></div>
	{/if}

	{#if editing}
		<div class="absolute inset-0 z-30 flex justify-end bg-black/55 backdrop-blur-[2px]" role="presentation" onclick={(event) => { if (event.currentTarget === event.target) { editing = false; creating = false; } }}>
			<section class="h-full w-[min(430px,92vw)] overflow-y-auto border-l border-[#303b43] bg-[#0a0f13] p-5 shadow-[-24px_0_70px_rgba(0,0,0,.45)]">
				<header class="mb-5 flex items-start gap-3"><span class="grid h-10 w-10 place-items-center rounded-xl border border-[rgba(214,255,63,.2)] bg-[rgba(214,255,63,.06)] text-accent"><Bot size={17} /></span><div class="min-w-0 flex-1"><p class="m-0 font-mono text-[8px] tracking-[.14em] text-[#69767e] uppercase">Bot settings</p><h2 class="mt-1 mb-0 text-[14px] text-[#e5eaed]">{creating ? "Create a Personal Bot" : selected?.name}</h2></div><button type="button" class="grid h-8 w-8 place-items-center rounded-lg text-[#7d8991] hover:bg-[#151d22] hover:text-white" onclick={() => { editing = false; creating = false; }}><X size={15} /></button></header>
				<div class="space-y-3">
					<label><span class="mb-1 block font-mono text-[8px] text-[#6d7a82] uppercase">Name</span><input bind:value={name} maxlength="40" class="h-10 w-full rounded-lg border border-[#34414a] bg-[#05090c] px-3 text-[11px] text-white outline-none focus:border-[#667782]" /></label>
					<label><span class="mb-1 block font-mono text-[8px] text-[#6d7a82] uppercase">Personality</span><select bind:value={profileId} class="h-10 w-full rounded-lg border border-[#34414a] bg-[#05090c] px-3 text-[11px] text-white"><option value="" disabled>Select profile</option>{#each profiles as profile (profile.id)}<option value={profile.id}>{profile.name}</option>{/each}</select></label>
					<label><span class="mb-1 block font-mono text-[8px] text-[#6d7a82] uppercase">Icon</span><select bind:value={face} class="h-10 w-full rounded-lg border border-[#34414a] bg-[#05090c] px-3 text-[11px] capitalize text-white">{#each KLERM_PROFILE_FACES as item}<option value={item}>{profileIcon(item)} {item}</option>{/each}</select></label>
					<label><span class="mb-1 block font-mono text-[8px] text-[#6d7a82] uppercase">Harness</span><select bind:value={harness} onchange={() => { model = ""; enabled = false; }} class="h-10 w-full rounded-lg border border-[#34414a] bg-[#05090c] px-3 text-[11px] text-white">{#each harnesses as item (item.kind)}<option value={item.kind}>{item.kind}{item.adapterConnected ? "" : " (chat unavailable)"}</option>{/each}</select></label>
					<label><span class="mb-1 block font-mono text-[8px] text-[#6d7a82] uppercase">Model</span><select bind:value={model} onchange={() => (enabled = Boolean(model))} class="h-10 w-full rounded-lg border border-[#34414a] bg-[#05090c] px-3 text-[11px] text-white"><option value="">Choose a model</option>{#each models as item}<option value={item}>{item}</option>{/each}</select></label>
					<div class="grid grid-cols-2 gap-3"><label><span class="mb-1 block font-mono text-[8px] text-[#6d7a82] uppercase">Role</span><select bind:value={role} class="h-10 w-full rounded-lg border border-[#34414a] bg-[#05090c] px-3 text-[11px] text-white"><option value="planner">Plan</option><option value="builder">Build</option></select></label><label><span class="mb-1 block font-mono text-[8px] text-[#6d7a82] uppercase">Reasoning</span><select bind:value={effort} class="h-10 w-full rounded-lg border border-[#34414a] bg-[#05090c] px-3 text-[11px] capitalize text-white">{#each efforts as item}<option value={item}>{item}</option>{/each}</select></label></div>
				</div>
				<div class="mt-6 flex flex-wrap items-center gap-2"><button type="button" disabled={busy || !name.trim() || !profileId} class="flex h-9 items-center gap-2 rounded-lg bg-[#d7e7ff] px-4 font-mono text-[9px] font-semibold text-[#081018] disabled:opacity-40" onclick={() => void save()}><Save size={12} /> Save bot</button>{#if selected && !creating}<button type="button" disabled={busy || conversation?.status === "running"} class="flex h-9 items-center gap-2 rounded-lg border border-[#553b3b] bg-[rgba(102,39,39,.12)] px-3 font-mono text-[9px] text-[#e79a93] disabled:opacity-40" onclick={() => void ondelete(selected)}><Trash2 size={12} /> Delete</button>{/if}{#if notice}<span class="flex items-center gap-1 font-mono text-[8px] text-[#a7c85a]"><Check size={11} /> {notice}</span>{/if}</div>
			</section>
		</div>
	{/if}
</div>
