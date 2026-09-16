<script lang="ts">
	import { ChevronDown, MessageCircle, Pencil, Plus, RefreshCw, Settings, Trash2 } from "@lucide/svelte";
	import {
		MCP_COLOR_BG_CSS,
		MCP_COLOR_CSS,
		MCP_COLORS,
		mcpDisplayName,
		mcpServerIdFromName,
		parseStdioArgs,
	} from "../lib/mcp-mentions.ts";
	import type { DesktopProject, DesktopSession, McpColor, McpServerStatus, McpServerUpdate, McpStatus } from "../lib/model.ts";
	import { portal } from "../lib/portal.ts";
	import SessionRow from "./SessionRow.svelte";

	let {
		sessions,
		projects,
		defaultProjectId,
		activeSessionToken,
		mcpStatus,
		mcpBusy,
		open,
		collapsed,
		onnewsession,
		onrefresh,
		onswitch,
		onrename,
		ondelete,
		oncreateproject,
		onrenameproject,
		ondeleteproject,
		onmovesession,
		onrefreshproject,
		onaskproject,
		onexpand,
		onrefreshmcp,
		onreloadmcp,
		onaddmcpserver,
		settingsOpen,
		ontogglesettings,
	}: {
		sessions: DesktopSession[];
		projects: DesktopProject[];
		defaultProjectId: string;
		activeSessionToken: string;
		mcpStatus: McpStatus | undefined;
		mcpBusy: boolean;
		open: boolean;
		collapsed: boolean;
		onnewsession: () => void;
		onrefresh: () => void;
		onswitch: (session: DesktopSession) => void;
		onrename: (session: DesktopSession, name: string) => Promise<boolean>;
		ondelete: (session: DesktopSession) => void;
		oncreateproject: (name: string) => void;
		onrenameproject: (project: DesktopProject, name: string) => void;
		ondeleteproject: (project: DesktopProject) => void;
		onmovesession: (session: DesktopSession, projectId: string | undefined) => void;
		onrefreshproject: (project: DesktopProject) => void;
		onaskproject: (project: DesktopProject, question: string) => Promise<boolean>;
		onexpand: () => void;
		onrefreshmcp: () => void;
		onreloadmcp: () => void;
		onaddmcpserver: (server: McpServerUpdate) => Promise<boolean>;
		settingsOpen: boolean;
		ontogglesettings: () => void;
	} = $props();

	let creatingProject = $state(false);
	let newProjectName = $state("");
	let collapsedProjectIds = $state<Record<string, boolean>>({});
	let renamingProjectId = $state<string | undefined>();
	let renamingProjectValue = $state("");
	let projectMenuId = $state<string | undefined>();
	let projectMenuEl: HTMLDivElement | undefined = $state();
	let askingProjectId = $state<string | undefined>();
	let projectQuestion = $state("");
	let projectQuestionBusy = $state(false);

	const projectSessions = $derived.by(() => {
		const grouped = new Map<string, DesktopSession[]>();
		const unassigned: DesktopSession[] = [];
		for (const session of sessions) {
			const projectId = session.projectId;
			if (projectId && projects.some((project) => project.id === projectId)) {
				const list = grouped.get(projectId) ?? [];
				list.push(session);
				grouped.set(projectId, list);
			} else {
				unassigned.push(session);
			}
		}
		return { grouped, unassigned };
	});

	$effect(() => {
		if (!projectMenuId) return;
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && projectMenuEl?.contains(event.target)) return;
			projectMenuId = undefined;
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => document.removeEventListener("pointerdown", onPointerDown, true);
	});

	function commitNewProject(): void {
		const name = newProjectName;
		newProjectName = "";
		creatingProject = false;
		if (name.trim()) oncreateproject(name);
	}

	function cancelNewProject(): void {
		newProjectName = "";
		creatingProject = false;
	}

	function toggleProject(project: DesktopProject): void {
		collapsedProjectIds = { ...collapsedProjectIds, [project.id]: !collapsedProjectIds[project.id] };
	}

	function startProjectRename(project: DesktopProject): void {
		renamingProjectId = project.id;
		renamingProjectValue = project.name;
		projectMenuId = undefined;
	}

	function commitProjectRename(project: DesktopProject): void {
		const name = renamingProjectValue;
		renamingProjectId = undefined;
		renamingProjectValue = "";
		if (name.trim() && name.trim() !== project.name) onrenameproject(project, name);
	}

	function sessionsForPicker(project: DesktopProject): DesktopSession[] {
		return sessions.filter((session) => session.projectId !== project.id);
	}

	async function submitProjectQuestion(project: DesktopProject): Promise<void> {
		const question = projectQuestion.trim();
		if (!question || projectQuestionBusy) return;
		projectQuestionBusy = true;
		if (await onaskproject(project, question)) {
			projectQuestion = "";
			askingProjectId = undefined;
		}
		projectQuestionBusy = false;
	}

	let mcpPopoverOpen = $state(false);
	let addingMcp = $state(false);
	let editingMcp = $state<McpServerStatus>();
	let mcpName = $state("");
	let mcpLabel = $state("");
	let mcpColor = $state<McpColor>("base");
	let mcpTransport = $state<"stdio" | "http" | "sse">("stdio");
	let mcpCommand = $state("");
	let mcpArgs = $state("");
	let mcpUrl = $state("");
	let mcpHeaders = $state("");
	let mcpEnv = $state("");
	let mcpFormError = $state("");
	let mcpButtonEl = $state<HTMLButtonElement>();
	let mcpPopoverEl = $state<HTMLDivElement>();
	let mcpPopoverStyle = $state("");
	let transportMenuOpen = $state(false);
	let transportMenuEl = $state<HTMLDivElement>();

	$effect(() => {
		if (!mcpPopoverOpen || !mcpButtonEl) return;
		const buttonEl = mcpButtonEl;

		const updatePosition = () => {
			const rect = buttonEl.getBoundingClientRect();
			const panelWidth = Math.min(310, window.innerWidth - 16);
			const maxHeight = Math.min(540, Math.max(180, rect.top - 16));
			const left = Math.min(Math.max(8, rect.left + rect.width / 2 - panelWidth / 2), window.innerWidth - panelWidth - 8);
			const bottom = window.innerHeight - rect.top + 8;
			mcpPopoverStyle = `left: ${Math.max(8, left)}px; bottom: ${bottom}px; width: ${panelWidth}px; max-height: ${maxHeight}px;`;
		};

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target instanceof Node ? event.target : undefined;
			if (target && mcpButtonEl?.contains(target)) return;
			if (target && mcpPopoverEl?.contains(target)) {
				if (!transportMenuEl?.contains(target)) transportMenuOpen = false;
				return;
			}
			transportMenuOpen = false;
			mcpPopoverOpen = false;
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (transportMenuOpen) transportMenuOpen = false;
			else mcpPopoverOpen = false;
		};

		updatePosition();
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		document.addEventListener("pointerdown", handlePointerDown, true);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
			document.removeEventListener("pointerdown", handlePointerDown, true);
			document.removeEventListener("keydown", handleKeyDown);
		};
	});

	const mcpServers = $derived(mcpStatus?.servers ?? []);
	const mcpDotClass = $derived.by(() => {
		if (!mcpStatus || mcpServers.length === 0) return "bg-[#59646d]";
		if (mcpServers.some((server) => server.state === "failed")) return "bg-danger";
		if (mcpStatus.toolCount > 0) return "bg-accent shadow-[0_0_9px_rgba(214,255,63,.35)]";
		return "bg-[#d6a63f]";
	});
	function parseHeaders(value: string): Record<string, string> | undefined {
		const headers: Record<string, string> = {};
		for (const line of value.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const separator = trimmed.indexOf("=");
			const key = separator >= 0 ? trimmed.slice(0, separator).trim() : "";
			if (!key) return undefined;
			headers[key] = trimmed.slice(separator + 1).trim();
		}
		return headers;
	}

	function parseEnv(value: string): Record<string, string> | undefined {
		const env: Record<string, string> = {};
		for (const line of value.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const separator = trimmed.indexOf("=");
			const key = separator >= 0 ? trimmed.slice(0, separator).trim() : "";
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;
			env[key] = trimmed.slice(separator + 1);
		}
		return env;
	}

	function resetMcpForm(): void {
		addingMcp = false;
		editingMcp = undefined;
		mcpName = "";
		mcpLabel = "";
		mcpColor = "base";
		mcpTransport = "stdio";
		mcpCommand = "";
		mcpArgs = "";
		mcpUrl = "";
		mcpHeaders = "";
		mcpEnv = "";
		mcpFormError = "";
	}

	function startMcpEdit(server: McpServerStatus): void {
		addingMcp = true;
		editingMcp = server;
		mcpName = server.name;
		mcpLabel = server.label ?? server.name;
		mcpColor = server.color ?? "base";
		mcpTransport = server.transport;
		mcpCommand = server.command ?? "";
		mcpArgs = (server.args ?? []).join(" ");
		mcpUrl = server.url ?? "";
		mcpHeaders = "";
		mcpEnv = (server.envKeys ?? []).map((key) => `${key}=`).join("\n");
		mcpFormError = "";
	}

	function mcpDotStyle(server: McpServerStatus): string {
		if (server.state === "failed") return "background: #f09b93";
		if (server.state === "disabled") return "background: #59646d";
		if (server.color) return `background: ${MCP_COLOR_CSS[server.color]}`;
		return server.state === "connected" ? "background: #d6ff3f" : "background: #d6a63f";
	}

	function mcpBadgeStyle(server: McpServerStatus): string {
		const color = server.color ?? "base";
		return `border-color: ${MCP_COLOR_CSS[color]}; color: ${MCP_COLOR_CSS[color]}; background: ${MCP_COLOR_BG_CSS[color]}`;
	}

	function mcpColorStyle(color: McpColor): string {
		return `border-color: ${MCP_COLOR_CSS[color]}; color: ${MCP_COLOR_CSS[color]}; background: ${MCP_COLOR_BG_CSS[color]}`;
	}

	async function submitMcpServer(): Promise<void> {
		mcpFormError = "";
		const displayName = mcpLabel.trim() || mcpName.trim();
		const name = editingMcp?.name ?? mcpServerIdFromName(displayName);
		if (!name) {
			mcpFormError = "A name is required.";
			return;
		}
		const headers = parseHeaders(mcpHeaders);
		if (!headers) {
			mcpFormError = "Headers must use Header-Name=value lines.";
			return;
		}
		const env = parseEnv(mcpEnv);
		if (!env) {
			mcpFormError = "Environment must use NAME=value lines.";
			return;
		}
		const server: McpServerUpdate =
			mcpTransport === "stdio"
				? {
						name,
						label: displayName || undefined,
						color: mcpColor,
						transport: "stdio",
						command: mcpCommand.trim(),
						args: parseStdioArgs(mcpArgs),
						env,
						enabled: true,
					}
				: {
						name,
						label: displayName || undefined,
						color: mcpColor,
						transport: mcpTransport,
						url: mcpUrl.trim(),
						headers,
						enabled: true,
					};
		const saved = await onaddmcpserver(server);
		if (!saved) return;
		resetMcpForm();
	}
</script>

{#snippet mcpControl(collapsedMode: boolean)}
	<div class="relative">
		<button
			bind:this={mcpButtonEl}
			type="button"
			aria-label="MCP status"
			aria-expanded={mcpPopoverOpen}
			class={`flex cursor-pointer items-center gap-2 rounded-lg border border-[#27313a] bg-[#10161b] font-mono text-[9px] text-[#a9b3ba] hover:border-[#4b5964] hover:bg-[#151d23] ${collapsedMode ? "h-8 w-8 justify-center px-0" : "h-9 px-2.5"}`}
			onclick={() => {
				mcpPopoverOpen = !mcpPopoverOpen;
				if (mcpPopoverOpen) onrefreshmcp();
			}}
		>
			<span class={`h-1.75 w-1.75 shrink-0 rounded-full ${mcpDotClass}`}></span>
			{#if !collapsedMode}<span>MCP {mcpServers.length}</span>{/if}
		</button>
		{#if mcpPopoverOpen}
			<div bind:this={mcpPopoverEl} use:portal class="fixed z-30 flex flex-col overflow-hidden rounded-xl border border-[#303a42] bg-[#0d1217] shadow-[0_18px_46px_rgba(0,0,0,.52)]" style={mcpPopoverStyle}>
				<div class="flex shrink-0 items-start justify-between gap-2 border-b border-[#242d35] bg-[#0d1217] p-3">
					<strong class="block text-[11px] text-[#d8e0e4]">MCP</strong>
					<div class="flex shrink-0 gap-2">
						<button type="button" class="border-0 bg-transparent font-mono text-[8px] text-[#7c8992] hover:text-white" onclick={onreloadmcp} disabled={mcpBusy}>{mcpBusy ? "..." : "Reload"}</button>
						<button type="button" class="border-0 bg-transparent font-mono text-[8px] text-[#7c8992] hover:text-white" onclick={onrefreshmcp} disabled={mcpBusy}>{mcpBusy ? "..." : "Refresh"}</button>
					</div>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto p-3 pr-2 [scrollbar-color:#46525b_#0a0f13] [scrollbar-gutter:stable] [scrollbar-width:thin]">
					{#if mcpServers.length === 0}
						<p class="m-0 rounded-lg border border-[#242d35] bg-[#10161b] p-2 text-[10px]/[1.45] text-[#87929a]">No MCP servers configured yet.</p>
					{:else}
						<div class="space-y-2">
							{#each mcpServers as server (server.name)}
								<section class="rounded-lg border p-2" style={mcpBadgeStyle(server)}>
								<div class="flex items-center gap-2">
									<span class="h-1.75 w-1.75 shrink-0 rounded-full" style={mcpDotStyle(server)}></span>
									<div class="min-w-0 flex-1">
										<strong class="block truncate font-mono text-[10px] text-[#d7dfe3]">{mcpDisplayName(server)}</strong>
									</div>
									<span class="rounded border border-[#2f3941] px-1.5 py-0.5 font-mono text-[7px] text-[#75828b] uppercase">{server.transport}</span>
									<button type="button" aria-label={`Edit ${mcpDisplayName(server)}`} class="grid h-5 w-5 place-items-center rounded border border-[#2f3941] text-[#9aa7ae] hover:border-[#65727b] hover:text-white" onclick={() => startMcpEdit(server)}><Pencil size={10} /></button>
								</div>
								<p class="m-0 mt-1 font-mono text-[8px] text-[#6e7a83]">{server.enabled ? server.state : "disabled"}</p>
								{#if server.tools.length > 0}
									<div class="mt-2 flex flex-wrap gap-1">
										{#each server.tools.slice(0, 12) as tool (tool.name)}
											<span class="max-w-full truncate rounded border bg-[rgba(18,30,48,.45)] px-1.5 py-0.5 font-mono text-[8px]" style={mcpBadgeStyle(server)}>{tool.remoteName}</span>
										{/each}
									</div>
								{/if}
								{#if server.error}<p class="m-0 mt-2 text-[9px]/[1.35] break-words text-[#f3a49c]">{server.error}</p>{/if}
								</section>
							{/each}
						</div>
					{/if}
				</div>
				<div class="shrink-0 border-t border-[#242d35] bg-[#0d1217] p-3">
					{#if addingMcp}
						<form class="space-y-2" onsubmit={(event) => { event.preventDefault(); void submitMcpServer(); }}>
							<input bind:value={mcpLabel} placeholder="MCP name, e.g. Notion" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#0a0f13] px-2 font-mono text-[10px] text-white outline-0" />
							<div class="grid grid-cols-4 gap-1">
								{#each MCP_COLORS as color}
									<button
										type="button"
										aria-label={`Use ${color} MCP color`}
										class={`h-7 rounded-md border font-mono text-[7px] capitalize ${mcpColor === color ? "ring-1 ring-white" : ""}`}
										style={mcpColorStyle(color)}
										onclick={() => (mcpColor = color)}
									>
										{color}
									</button>
								{/each}
							</div>
							<div bind:this={transportMenuEl} class="relative">
								<button
									type="button"
									aria-label="MCP transport"
									aria-expanded={transportMenuOpen}
									class="flex h-8 w-full items-center justify-between rounded-md border border-[#2d3740] bg-[#05080b] px-2 font-mono text-[10px] text-white"
									onclick={() => (transportMenuOpen = !transportMenuOpen)}
								>
									<span>{mcpTransport}</span><span class="text-[#77838b]">⌄</span>
								</button>
								{#if transportMenuOpen}
									<div class="absolute right-0 bottom-[36px] left-0 z-40 overflow-hidden rounded-md border border-[#303a42] bg-[#05080b] p-1 shadow-[0_12px_28px_rgba(0,0,0,.65)]">
										{#each ["stdio", "http", "sse"] as transport}
											<button
												type="button"
												class={`block h-8 w-full rounded px-2 text-left font-mono text-[10px] ${mcpTransport === transport ? "bg-[#202a31] text-white" : "bg-[#05080b] text-[#aab4ba] hover:bg-[#151d23] hover:text-white"}`}
												onclick={() => {
													mcpTransport = transport as "stdio" | "http" | "sse";
													transportMenuOpen = false;
												}}
											>
												{transport}
											</button>
										{/each}
									</div>
								{/if}
							</div>
							{#if mcpTransport === "stdio"}
								<input bind:value={mcpCommand} placeholder="command, e.g. npx" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#0a0f13] px-2 font-mono text-[10px] text-white outline-0" />
								<textarea bind:value={mcpArgs} rows="3" placeholder='-y @modelcontextprotocol/server-postgres postgresql://user:pass@host/db' class="w-full resize-none rounded-md border border-[#2d3740] bg-[#0a0f13] px-2 py-1.5 font-mono text-[10px] text-white outline-0"></textarea>
								<textarea bind:value={mcpEnv} rows="2" placeholder="NOTION_TOKEN=..." class="w-full resize-none rounded-md border border-[#2d3740] bg-[#0a0f13] px-2 py-1.5 font-mono text-[10px] text-white outline-0"></textarea>
							{:else}
								<input bind:value={mcpUrl} placeholder="https://example.com/mcp" class="h-8 w-full rounded-md border border-[#2d3740] bg-[#0a0f13] px-2 font-mono text-[10px] text-white outline-0" />
								<textarea bind:value={mcpHeaders} rows="2" placeholder="optional non-secret Header=value" class="w-full resize-none rounded-md border border-[#2d3740] bg-[#0a0f13] px-2 py-1.5 font-mono text-[10px] text-white outline-0"></textarea>
							{/if}
							{#if mcpFormError}<p class="m-0 text-[9px] text-[#f3a49c]">{mcpFormError}</p>{/if}
							<p class="m-0 text-[8px]/[1.35] text-[#65717a]">STDIO environment values are saved in your local Klerm settings and are never shown after saving. HTTP/SSE secret URLs or headers are rejected here.</p>
							<div class="flex gap-2">
								<button type="button" class="h-8 flex-1 rounded-md border border-[#303a42] bg-transparent font-mono text-[9px] text-[#8c98a0]" onclick={resetMcpForm}>Cancel</button>
								<button type="submit" class="h-8 flex-1 rounded-md border-0 bg-[#d7e7ff] font-mono text-[9px] text-[#091019]" disabled={mcpBusy}>{editingMcp ? "Save and reload" : "Save"}</button>
							</div>
						</form>
					{:else}
						<button type="button" class="h-9 w-full rounded-lg border border-[#34414a] bg-[#141b21] font-mono text-[10px] text-[#d6dde1] hover:border-[#56646e]" onclick={() => { resetMcpForm(); addingMcp = true; }}>Add more</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<aside
	id="sidebar"
	class={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-line bg-[#090d11] narrow-720:fixed narrow-720:inset-y-0 narrow-720:left-0 narrow-720:z-20 narrow-720:w-[min(280px,84vw)] narrow-720:shadow-[24px_0_70px_rgba(0,0,0,.55)] narrow-720:transition-transform narrow-720:duration-200 ${
		open ? "narrow-720:translate-x-0" : "narrow-720:-translate-x-[102%]"
	}`}
>
	{#if collapsed}
		<div class="flex h-full min-h-0 flex-col items-center py-2.5">
			<button
				type="button"
				aria-label="Open settings"
				aria-pressed={settingsOpen}
				class={`mt-1 grid h-9 w-9 place-items-center rounded-lg border ${settingsOpen ? "border-[#d7e7ff] bg-[#171e24] text-white" : "border-[#313a41] bg-[#12171c] text-[#c5ced3] hover:border-[#58636b] hover:bg-[#171d22]"}`}
				onclick={ontogglesettings}
			>
				<Settings size={15} stroke-width={1.7} />
			</button>
			<button
				type="button"
				aria-label="Expand sessions"
				class="relative mt-3 grid h-11 w-11 place-items-center rounded-[13px] border border-[#33424c] bg-[#12181d] shadow-[0_10px_24px_rgba(0,0,0,.35)] hover:border-[#5a6a74] hover:bg-[#171e24]"
				onclick={onexpand}
			>
				<img src="/K_Klerm_no_background.png" alt="" class="h-7 w-7 object-contain" />
			</button>
			<button
				type="button"
				aria-label="New session"
				class="mt-3 grid h-9 w-9 place-items-center rounded-lg border border-[#313a41] bg-[#12171c] text-[#c5ced3] hover:border-[#58636b] hover:bg-[#171d22]"
				onclick={onnewsession}
			>
				<Plus size={16} stroke-width={1.7} />
			</button>
			<div class="relative mt-auto mb-2">
				{@render mcpControl(true)}
			</div>
		</div>
	{:else}
		<header
			class="relative flex min-h-[112px] items-center border-b border-line-soft px-[13px] py-3.5 short-650:min-h-[76px] short-650:py-2"
		>
			<button
				type="button"
				aria-label="Open settings"
				aria-pressed={settingsOpen}
				class={`absolute top-2.5 left-2 z-[1] grid h-8 w-8 place-items-center rounded-md ${settingsOpen ? "bg-[#1a2228] text-white" : "text-[#66747d] hover:bg-[#151c21] hover:text-[#d5dce0]"}`}
				onclick={ontogglesettings}
			>
				<Settings size={15} stroke-width={1.7} />
			</button>
			<img src="/Klerm_logo_no_background.png" alt="Klerm" class="mx-auto block h-auto w-full max-h-[84px] object-contain short-650:max-h-[58px]" />
		</header>

		<button
			type="button"
			class="mx-4 mt-[18px] mb-3 flex h-[42px] cursor-pointer items-center justify-center gap-[9px] rounded-lg border border-[#313a41] bg-[#12171c] font-semibold transition-colors hover:border-[#58636b] hover:bg-[#171d22] short-650:mx-3 short-650:mt-2.5 short-650:mb-[7px] short-650:h-9 short-650:text-[11px]"
			onclick={onnewsession}
		>
			<Plus size={18} stroke-width={1.7} />
			New session
		</button>

		<section class="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5">
			<div class="min-h-0 flex-1 overflow-y-auto [overscroll-behavior:contain]">
				<div class="px-[11px] pt-[17px] pb-1">
					<div class="flex items-center justify-between pb-2">
						<p class="m-0 font-mono text-[9px] tracking-[.15em] text-[#59646d] uppercase">Projects</p>
						{#if !creatingProject}
							<button type="button" aria-label="New project" class="cursor-pointer border-0 bg-transparent font-mono text-[9px] text-[#69757e] uppercase hover:text-accent" onclick={() => (creatingProject = true)}>
								New
							</button>
						{/if}
					</div>
					{#if creatingProject}
						<input
							bind:value={newProjectName}
							placeholder="Project name — Enter to save"
							aria-label="New project name"
							class="mb-1.5 w-full rounded border border-[#3b464e] bg-[#0a0f13] px-2 py-1.5 text-[10px] text-[#dce2e5] outline-none focus:border-[#66747d]"
							onkeydown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									commitNewProject();
								} else if (event.key === "Escape") {
									cancelNewProject();
								}
							}}
							onblur={commitNewProject}
						/>
					{/if}
					{#each projects as project (project.id)}
						<div class="group mb-0.5">
							<div class="flex items-center gap-1">
								<button
									type="button"
									aria-label={collapsedProjectIds[project.id] ? `Expand ${project.name}` : `Collapse ${project.name}`}
									class="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent text-[#66747d] hover:text-white"
									onclick={() => toggleProject(project)}
								>
									<ChevronDown size={11} stroke-width={1.7} class={`transition-transform ${collapsedProjectIds[project.id] ? "-rotate-90" : ""}`} />
								</button>
								{#if renamingProjectId === project.id}
									<input
										bind:value={renamingProjectValue}
										aria-label="Project name"
										class="min-w-0 flex-1 rounded border border-[#3b464e] bg-[#0a0f13] px-2 py-1 text-[10px] text-[#dce2e5] outline-none focus:border-[#66747d]"
										onkeydown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												commitProjectRename(project);
											} else if (event.key === "Escape") {
												renamingProjectId = undefined;
											}
										}}
										onblur={() => commitProjectRename(project)}
									/>
								{:else}
									<button type="button" class="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[11px] font-semibold text-[#c5ced3] hover:text-white" onclick={() => toggleProject(project)}>
										{project.name}
									</button>
								{/if}
								<span class="shrink-0 font-mono text-[8px] text-[#55616a]">{projectSessions.grouped.get(project.id)?.length ?? 0}</span>
								<div class="relative shrink-0">
									<button
										type="button"
										aria-label={`Add session to ${project.name}`}
										aria-expanded={projectMenuId === project.id}
										class="grid h-5 w-5 cursor-pointer place-items-center rounded border-0 bg-transparent text-[#66747d] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-white"
										onclick={() => (projectMenuId = projectMenuId === project.id ? undefined : project.id)}
									>
										<Plus size={12} stroke-width={1.7} />
									</button>
									{#if projectMenuId === project.id}
										<div bind:this={projectMenuEl} class="absolute top-[24px] right-0 z-[8] w-[190px] rounded-md border border-[#303941] bg-[#0b0f13] p-[5px] shadow-[0_14px_36px_rgba(0,0,0,.48)]">
											{#if sessionsForPicker(project).length === 0}
												<p class="m-0 px-2 py-1.5 text-[10px] text-[#66747d]">No sessions to add.</p>
											{:else}
												{#each sessionsForPicker(project).slice(0, 15) as session (session.sessionToken)}
													<button
														type="button"
														class="flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded border-0 bg-transparent px-[9px] py-1.5 text-left text-[10px] text-ellipsis whitespace-nowrap text-[#aab4bb] hover:bg-[#171e23] hover:text-white"
														onclick={() => {
															onmovesession(session, project.id);
															projectMenuId = undefined;
														}}
													>
														<Plus size={10} class="shrink-0" /> {session.name ?? session.firstMessage}
													</button>
												{/each}
											{/if}
										</div>
									{/if}
								</div>
								<button type="button" aria-label={`Rename ${project.name}`} class="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent text-[#66747d] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-white" onclick={() => startProjectRename(project)}>
									<Pencil size={11} stroke-width={1.7} />
								</button>
								{#if project.id !== defaultProjectId}
									<button type="button" aria-label={`Delete ${project.name}`} class="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded border-0 bg-transparent text-[#66747d] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-[#ffada6]" onclick={() => { projectMenuId = undefined; ondeleteproject(project); }}>
										<Trash2 size={11} stroke-width={1.7} />
									</button>
								{/if}
							</div>
							{#if !collapsedProjectIds[project.id]}
								<div class="mt-0.5 mb-1 ml-2.5 border-l border-[#1c242b] pl-1">
									<div class="mb-1 flex items-center gap-1 px-2">
										<button type="button" class="flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[7px] text-[#7d8991] hover:bg-[#151d23] hover:text-white" onclick={() => onrefreshproject(project)}><RefreshCw size={9} /> Refresh summary</button>
										<button type="button" class="flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[7px] text-[#7d8991] hover:bg-[#151d23] hover:text-white" onclick={() => { askingProjectId = askingProjectId === project.id ? undefined : project.id; projectQuestion = ""; }}><MessageCircle size={9} /> Ask</button>
									</div>
									{#if project.summary}<p class="mx-2 mb-1 max-h-24 overflow-y-auto whitespace-pre-wrap rounded border border-[#202a31] bg-[#0a0f13] px-2 py-1.5 font-mono text-[8px] leading-[1.45] text-[#77858e] [scrollbar-width:thin]">{project.summary}</p>{/if}
									{#if askingProjectId === project.id}
										<form class="mx-2 mb-1 flex gap-1" onsubmit={(event) => { event.preventDefault(); void submitProjectQuestion(project); }}>
											<input bind:value={projectQuestion} maxlength="2000" aria-label={`Ask ${project.name}`} placeholder="Ask across project sessions" class="h-7 min-w-0 flex-1 rounded border border-[#303a42] bg-[#05080b] px-2 font-mono text-[8px] text-white outline-0" />
											<button type="submit" disabled={!projectQuestion.trim() || projectQuestionBusy} class="h-7 rounded bg-[#d7e7ff] px-2 font-mono text-[8px] text-[#091019] disabled:opacity-40">{projectQuestionBusy ? "..." : "Ask"}</button>
										</form>
									{/if}
									{#each projectSessions.grouped.get(project.id) ?? [] as session (session.sessionToken)}
										<SessionRow
											{session}
											{projects}
											currentProjectId={project.id}
											active={session.sessionToken === activeSessionToken}
											onswitch={() => onswitch(session)}
											onrename={(name) => onrename(session, name)}
											ondelete={() => ondelete(session)}
											onmove={(projectId) => onmovesession(session, projectId)}
											onremove={() => onmovesession(session, undefined)}
										/>
									{:else}
										<p class="m-0 px-2 py-1 text-[10px] text-[#55616a]">No sessions in this project yet — use + to add one.</p>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<div class="flex items-center justify-between px-[11px] pt-2 pb-2.5">
					<p class="m-0 font-mono text-[9px] tracking-[.15em] text-[#59646d] uppercase">Sessions</p>
					<button
						type="button"
						aria-label="Refresh sessions"
						class="cursor-pointer border-0 bg-transparent font-mono text-[9px] text-[#69757e] uppercase hover:text-accent"
						onclick={onrefresh}
					>
						Refresh
					</button>
				</div>
				{#if sessions.length === 0}
					<p class="px-[11px] py-2 text-[11px] text-muted">No saved sessions yet.</p>
				{:else}
					{#each projectSessions.unassigned.slice(0, 30) as session (session.sessionToken)}
						<SessionRow
							{session}
							{projects}
							active={session.sessionToken === activeSessionToken}
							onswitch={() => onswitch(session)}
							onrename={(name) => onrename(session, name)}
							ondelete={() => ondelete(session)}
							onmove={(projectId) => onmovesession(session, projectId)}
						/>
					{/each}
				{/if}
			</div>
		</section>

		<footer class="border-t border-line-soft px-4 py-3 short-650:py-2">
			{@render mcpControl(false)}
		</footer>
	{/if}
</aside>
