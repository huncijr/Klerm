<script lang="ts">
	import { MCP_COLOR_CSS, MCP_COLORS, mcpDisplayName, mcpServerIdFromName } from "../lib/mcp-mentions.ts";
	import type {
		CustomModelEntry,
		DesktopAppearance,
		DesktopSettings,
		DesktopShortcut,
		KlermProfile,
		KlermProfileFace,
		McpServerStatus,
		McpServerUpdate,
		McpStatus,
		ProviderAccount,
		ProviderConnect,
	} from "../lib/model.ts";
	import { KLERM_PROFILE_FACES } from "../lib/model.ts";
	import { groupProviderAccounts, orderProviderGroups } from "../lib/provider-cards.ts";
	import ProviderLogo from "./ProviderLogo.svelte";
	import { profileIcon } from "../lib/profiles.ts";
	import { normalizeShortcut, shortcutConflicts } from "../lib/shortcuts.ts";

	type SettingsTab = "general" | "models" | "shortcuts" | "mcp" | "memory";

	let {
		settings,
		mcpStatus,
		mcpBusy,
		providers,
		providerBusy,
		onclose,
		onappearance,
		onaddmodel,
		onconnectprovider,
		ondisconnectprovider,
		onupsertprofile,
		ondeleteprofile,
		onrefreshmcp,
		onreloadmcp,
		onaddmcpserver,
	}: {
		settings: DesktopSettings;
		mcpStatus: McpStatus | undefined;
		mcpBusy: boolean;
		providers: ProviderAccount[];
		providerBusy: boolean;
		onclose: () => void;
		onappearance: (value: DesktopAppearance) => void;
		onaddmodel: (model: CustomModelEntry) => Promise<boolean>;
		onconnectprovider: (account: ProviderConnect) => Promise<boolean>;
		ondisconnectprovider: (provider: string) => Promise<boolean>;
		onupsertprofile: (profile: KlermProfile) => Promise<boolean>;
		ondeleteprofile: (id: string) => Promise<boolean>;
		onrefreshmcp: () => void;
		onreloadmcp: () => void;
		onaddmcpserver: (server: McpServerUpdate) => Promise<boolean>;
	} = $props();

	let tab = $state<SettingsTab>("general");
	let draftAppearance = $state<DesktopAppearance>("dark");
	let draftShortcuts = $state<DesktopShortcut[]>([]);
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
	let connectForms = $state<Record<string, { key: string; url: string; error: string; confirmDiscard: boolean }>>({});
	let profileName = $state("");
	let profileFace = $state<KlermProfileFace>("fox");
	let profileLevel = $state(1);
	let profileMemory = $state("");
	let profileReadme = $state("");
	let editingProfileId = $state("");
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
		{ id: "models", label: "Models" },
		{ id: "shortcuts", label: "Shortcuts" },
		{ id: "mcp", label: "MCP" },
		{ id: "memory", label: "Memory" },
	];
	const mcpServers = $derived(mcpStatus?.servers ?? []);
	const profiles = $derived(settings.profiles.profiles);
	const providerCards = $derived(orderProviderGroups(groupProviderAccounts(providers)));
	const conflicts = $derived(shortcutConflicts(draftShortcuts));
	const connectGroup = $derived(providerCards.find((group) => group.id === connectId));

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

	async function saveConnect(memberId: string): Promise<void> {
		const form = formFor(memberId);
		setForm(memberId, { error: "" });
		const saved = await onconnectprovider({
			provider: memberId,
			apiKey: form.key.trim() || undefined,
			baseUrl: form.url.trim() || undefined,
		});
		if (saved) setForm(memberId, { key: "", url: "" });
		else setForm(memberId, { error: "Could not connect this provider." });
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

	$effect(() => {
		draftAppearance = settings.appearance;
		draftShortcuts = settings.shortcuts.map((item) => ({ ...item }));
	});

	function editProfile(profile: KlermProfile): void {
		editingProfileId = profile.id;
		profileName = profile.name;
		profileFace = profile.face;
		profileLevel = profile.level;
		profileMemory = profile.memory;
		profileReadme = profile.readme;
	}

	async function saveProfile(): Promise<void> {
		const name = profileName.trim();
		if (!name) return;
		const id =
			editingProfileId ||
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "");
		if (!id) return;
		const saved = await onupsertprofile({
			id,
			name,
			face: profileFace,
			level: profileLevel,
			memory: profileMemory,
			readme: profileReadme,
		});
		if (saved) {
			editingProfileId = "";
			profileName = "";
			profileMemory = "";
			profileReadme = "";
			profileLevel = 1;
			profileFace = "fox";
		}
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

	function saveChanges(): void {
		if (draftAppearance !== settings.appearance) onappearance(draftAppearance);
		onclose();
	}
</script>

<section class="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
	<header class="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-line px-5">
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
		<button
			type="button"
			class="ml-auto h-8 shrink-0 rounded-md border-0 bg-[#e8eef2] px-3 font-mono text-[10px] text-[#091019] uppercase"
			onclick={saveChanges}
		>
			Save changes
		</button>
	</header>
	<div class="min-h-0 flex-1 overflow-y-auto px-7 py-6 narrow-720:px-4">
		{#if tab === "general"}
			<div class="mx-auto flex w-[min(420px,100%)] flex-col items-center gap-6 pt-10">
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
			</div>
		{:else if tab === "models"}
			<div class="mx-auto w-[min(720px,100%)]">
				<div class="grid grid-cols-2 gap-3">
					{#each providerCards as card (card.id)}
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
					</section>
				{/each}
				{#if addingMcp}
					<form class="space-y-2" onsubmit={(event) => { event.preventDefault(); void saveMcp(); }}>
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
						{/if}
						{#if mcpFormError}<p class="m-0 text-[9px] text-[#f3a49c]">{mcpFormError}</p>{/if}
						<button type="submit" class="h-8 rounded-md bg-[#d7e7ff] px-3 font-mono text-[9px] text-[#091019]" disabled={mcpBusy}>Save</button>
					</form>
				{:else}
					<button type="button" class="h-9 w-full rounded-lg border border-[#34414a] bg-[#05080b] font-mono text-[10px] text-[#d6dde1]" onclick={() => (addingMcp = true)}>Add more</button>
				{/if}
			</div>
		{:else}
			<div class="mx-auto w-[min(720px,100%)] space-y-4">
				{#each profiles as profile (profile.id)}
					<section class="rounded-lg border border-[#232c34] bg-[#0a0f13] p-3">
						<div class="flex items-center justify-between gap-2">
							<strong class="font-mono text-[11px] text-white">{profileIcon(profile.face)} {profile.name} · L{profile.level}</strong>
							<div class="flex gap-2">
								<button type="button" class="border-0 bg-transparent font-mono text-[9px] text-[#9cc0f2]" onclick={() => editProfile(profile)}>Edit</button>
								<button type="button" class="border-0 bg-transparent font-mono text-[9px] text-[#f3a49c]" onclick={() => void ondeleteprofile(profile.id)}>Delete</button>
							</div>
						</div>
						{#if profile.memory}<p class="m-0 mt-2 whitespace-pre-wrap font-mono text-[9px] text-[#8b969e]">{profile.memory}</p>{/if}
					</section>
				{/each}
				<form class="space-y-2" onsubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
					<input bind:value={profileName} placeholder="profile name" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#05080b] px-2 font-mono text-[10px] text-white outline-0" />
					<div class="flex flex-wrap gap-1.5">
						{#each KLERM_PROFILE_FACES as face}
							<button type="button" class={`h-8 rounded-md border bg-[#05080b] px-2 ${profileFace === face ? "border-white" : "border-[#303a42]"}`} onclick={() => (profileFace = face)}>{profileIcon(face)}</button>
						{/each}
					</div>
					<input type="number" min="1" max="5" bind:value={profileLevel} class="h-8 w-20 rounded-md border border-[#2d3740] bg-[#05080b] px-2 font-mono text-[10px] text-white outline-0" />
					<textarea bind:value={profileMemory} rows="4" placeholder="custom memory for this profile" class="w-full rounded-md border border-[#2d3740] bg-[#05080b] px-2 py-1.5 font-mono text-[10px] text-white outline-0"></textarea>
					<textarea bind:value={profileReadme} rows="3" placeholder="optional README" class="w-full rounded-md border border-[#2d3740] bg-[#05080b] px-2 py-1.5 font-mono text-[10px] text-white outline-0"></textarea>
					<button type="submit" class="h-8 rounded-md bg-[#d7e7ff] px-3 font-mono text-[9px] text-[#091019]">{editingProfileId ? "Save profile" : "Create profile"}</button>
				</form>
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
							<form class="mt-2 space-y-2" onsubmit={(event) => { event.preventDefault(); void saveConnect(member.id); }}>
								<input value={form.key} oninput={(event) => setForm(member.id, { key: (event.currentTarget as HTMLInputElement).value })} type="password" placeholder={member.configured ? "new API key (optional)" : "API key"} autocomplete="off" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
								<input value={form.url} oninput={(event) => setForm(member.id, { url: (event.currentTarget as HTMLInputElement).value })} placeholder="endpoint override (optional)" autocomplete="off" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#000] px-2 font-mono text-[10px] text-white outline-0" />
								{#if form.error}<p class="m-0 text-[9px] text-[#f3a49c]">{form.error}</p>{/if}
								<button type="submit" class="h-8 w-full rounded-md bg-[#e8eef2] font-mono text-[10px] text-[#091019]" disabled={providerBusy}>
									{providerBusy ? "Working..." : member.configured ? "Save" : "Connect"}
								</button>
							</form>
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
