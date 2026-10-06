<script lang="ts">
	import { ArrowLeft, Bot, Layers3, Menu, MessageCircle, RefreshCw, Sparkles } from "@lucide/svelte";
	import type {
		CodingHarnessSetup,
		DesktopProject,
		DesktopSession,
		ThinkingLevel,
	} from "../lib/model.ts";
	import { codingHarnessDisplayName } from "../lib/coding-harnesses.ts";
	import SessionRow from "./SessionRow.svelte";
	import { onMount } from "svelte";
	import { useDesktopShortcuts } from "../lib/shortcuts.ts";
	type ProjectPromptAgent = Pick<
		CodingHarnessSetup["runnableAgents"][number],
		"agentId" | "harness" | "model" | "effort"
	>;

	let {
		project,
		sessions,
		projects,
		agents,
		activeSessionToken,
		busy,
		sidebarOpen,
		ontogglesidebar,
		onclose,
		onrefresh,
		onask,
		onswitch,
		onrename,
		ondelete,
		onmove,
	}: {
		project: DesktopProject;
		sessions: DesktopSession[];
		projects: DesktopProject[];
		agents: ProjectPromptAgent[];
		activeSessionToken: string;
		busy: boolean;
		sidebarOpen: boolean;
		ontogglesidebar: () => void;
		onclose: () => void;
		onrefresh: () => Promise<void>;
		onask: (question: string, agentId: string, effort: ThinkingLevel) => Promise<boolean>;
		onswitch: (session: DesktopSession) => void;
		onrename: (session: DesktopSession, name: string) => Promise<boolean>;
		ondelete: (session: DesktopSession) => void;
		onmove: (session: DesktopSession, projectId: string | undefined) => void;
	} = $props();

	const efforts: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	let question = $state("");
	const shortcuts = useDesktopShortcuts();
	onMount(() => {
		const remove = [shortcuts?.register("run", submit, () => !busy), shortcuts?.register("refresh", onrefresh, () => !busy), shortcuts?.register("close", onclose), shortcuts?.register("save", () => {}, () => false)];
		return () => { for (const cleanup of remove) cleanup?.(); };
	});
	let selectedAgentId = $state("");
	let effort = $state<ThinkingLevel>("medium");

	$effect(() => {
		if (agents.some((agent) => agent.agentId === selectedAgentId)) return;
		selectedAgentId = agents[0]?.agentId ?? "";
		effort = agents[0]?.effort ?? "medium";
	});

	function selectAgent(agentId: string): void {
		selectedAgentId = agentId;
		effort = agents.find((agent) => agent.agentId === agentId)?.effort ?? "medium";
	}

	async function submit(): Promise<void> {
		const value = question.trim();
		if (!value || !selectedAgentId || busy) return;
		if (await onask(value, selectedAgentId, effort)) question = "";
	}

	function agentLabel(agent: ProjectPromptAgent): string {
		return `${agent.agentId.replace("agent", "Agent ")} · ${codingHarnessDisplayName(agent.harness)} · ${agent.model}`;
	}
</script>

<div class="flex min-h-0 flex-col overflow-hidden bg-panel">
	<header class="flex items-center gap-3 border-b border-line bg-bg px-6 py-3.5 backdrop-blur-[20px] narrow-720:px-3">
		<button type="button" aria-label="Toggle navigation" aria-expanded={sidebarOpen} class="hidden h-9 w-9 place-items-center rounded-md border border-line bg-panel narrow-720:grid" onclick={ontogglesidebar}><Menu size={15} /></button>
		<button type="button" class="grid h-9 w-9 place-items-center rounded-md border border-line bg-panel text-muted hover:border-line hover:text-ink" aria-label="Back to conversation" onclick={onclose}><ArrowLeft size={16} /></button>
		<div class="min-w-0 border-l border-line pl-3">
			<p class="m-0 font-sans text-[11px] tracking-[.16em] text-muted uppercase">Project workspace</p>
			<h1 class="mt-0.5 mb-0 truncate text-[16px] font-semibold tracking-[-.01em] text-ink">{project.name}</h1>
		</div>
		<span class="ml-auto flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 font-sans text-[11px] text-muted"><Layers3 size={10} class="text-accent" /> {sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-6 py-7 narrow-720:px-3 narrow-720:py-4">
		<div class="mx-auto w-full max-w-[940px] space-y-8">
			<section class="relative overflow-hidden rounded-[20px] border border-line bg-panel shadow-sm before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-panel">
				<div class="border-b border-line bg-panel px-6 py-5 narrow-520:px-4">
					<div class="flex items-center gap-3">
						<span class="grid h-8 w-8 place-items-center rounded-lg border border-warning bg-warning-soft text-accent"><Bot size={16} /></span>
						<div>
							<p class="m-0 font-sans text-[11px] tracking-[.14em] text-muted uppercase">Project intelligence</p>
							<strong class="mt-0.5 block text-[14px] text-ink">Ask across every session</strong>
						</div>
					</div>
					<p class="mt-3 mb-0 max-w-[660px] text-[12px]/[1.55] text-muted">The selected AI receives bounded, labeled extracts from this project's sessions and continues the answer inside the project.</p>
				</div>
				<form class="space-y-4 p-6 narrow-520:p-4" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
					<textarea bind:value={question} maxlength="2000" rows="4" aria-label={`Ask ${project.name}`} placeholder="Summarize the project, compare decisions, or ask what remains..." class="w-full resize-y rounded-[14px] border border-line bg-bg px-4 py-3.5 text-[14px]/[1.6] text-ink shadow-sm outline-none placeholder:text-dim focus:border-line focus:ring-1 focus:ring-line"></textarea>
					<div class="flex flex-wrap items-end gap-2.5 rounded-xl border border-line bg-panel p-2.5">
						<label class="min-w-[240px] flex-1">
							<span class="mb-1.5 block px-1 font-sans text-[11px] tracking-[.12em] text-muted uppercase">Ask with</span>
							<select value={selectedAgentId} onchange={(event) => selectAgent(event.currentTarget.value)} disabled={busy || agents.length === 0} class="h-10 w-full rounded-lg border border-line bg-bg px-3 text-[13px] text-ink outline-none hover:border-line disabled:opacity-45">
								{#each agents as agent (agent.agentId)}<option value={agent.agentId}>{agentLabel(agent)}</option>{/each}
							</select>
						</label>
						<label class="w-[150px] narrow-520:flex-1">
							<span class="mb-1.5 block px-1 font-sans text-[11px] tracking-[.12em] text-muted uppercase">Reasoning</span>
							<select bind:value={effort} disabled={busy || !selectedAgentId} class="h-10 w-full rounded-lg border border-line bg-bg px-3 text-[13px] capitalize text-ink outline-none hover:border-line disabled:opacity-45">
								{#each efforts as level}<option value={level}>{level}</option>{/each}
							</select>
						</label>
						<button type="submit" disabled={busy || !question.trim() || !selectedAgentId || sessions.length === 0} class="flex h-10 items-center gap-2 rounded-lg bg-primary px-5 font-sans text-[12px] font-semibold text-on-primary shadow-sm hover:bg-primary disabled:cursor-not-allowed disabled:opacity-35"><MessageCircle size={14} /> {busy ? "Starting..." : "Ask AI"}</button>
					</div>
					{#if agents.length === 0}<p class="m-0 text-[12px] text-danger">No runnable AI is configured. Enable and configure an agent in Settings.</p>{/if}
					{#if sessions.length === 0}<p class="m-0 text-[12px] text-warning">Add a session to this project before asking a project-wide question.</p>{/if}
				</form>
			</section>

			<section class="overflow-hidden rounded-2xl border border-line bg-panel">
				<div class="flex items-center justify-between gap-4 border-b border-line px-5 py-4 narrow-520:items-start narrow-520:px-4">
					<div class="flex min-w-0 items-center gap-3">
						<span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-panel text-ink"><Sparkles size={15} /></span>
						<div>
							<p class="m-0 font-sans text-[11px] tracking-[.15em] text-muted uppercase">Project memory</p>
							<h2 class="mt-1 mb-0 text-[14px] font-semibold text-ink">Session summary</h2>
						</div>
					</div>
					<button type="button" disabled={busy || sessions.length === 0} class="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line bg-raised px-3.5 font-sans text-[11px] font-semibold text-ink shadow-sm hover:border-line hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-40" onclick={() => void onrefresh()}><RefreshCw size={11} class={busy ? "animate-spin" : ""} /> {project.summary ? "Regenerate summary" : "Create summary"}</button>
				</div>
				<div class={`min-h-28 whitespace-pre-wrap px-5 py-4 font-sans text-[12px]/[1.7] narrow-520:px-4 ${project.summary ? "text-muted" : "text-muted"}`}>{project.summary ?? "Create a concise overview from the latest messages across every session in this project."}</div>
			</section>

			<section>
				<div class="mb-3 flex items-end justify-between gap-3">
					<p class="m-0 font-sans text-[11px] tracking-[.15em] text-muted uppercase">Continue work</p>
					<span class="font-sans text-[11px] text-dim">Open a session to inspect or continue</span>
				</div>
				<h2 class="mb-3 text-[14px] font-semibold text-ink">Sessions</h2>
				<div class="grid grid-cols-2 gap-3.5 narrow-720:grid-cols-1">
					{#each sessions as session (session.sessionToken)}
						<div
							class="cursor-pointer rounded-[14px] border border-line bg-panel p-1.5 shadow-sm transition-colors hover:border-line"
							role="button"
							tabindex="0"
							aria-label={`Open session ${session.name ?? session.firstMessage}`}
							onclick={(event) => {
								if ((event.target as HTMLElement | null)?.closest("button, input, a, select, textarea")) return;
								onswitch(session);
							}}
							onkeydown={(event) => {
								if (event.key !== "Enter" && event.key !== " ") return;
								if ((event.target as HTMLElement | null)?.closest("button, input, a, select, textarea")) return;
								event.preventDefault();
								onswitch(session);
							}}
						>
							<SessionRow {session} {projects} currentProjectId={project.id} active={session.sessionToken === activeSessionToken} onswitch={() => onswitch(session)} onrename={(name) => onrename(session, name)} ondelete={() => ondelete(session)} onmove={(projectId) => onmove(session, projectId)} onremove={() => onmove(session, undefined)} />
						</div>
					{:else}
						<p class="col-span-full rounded-xl border border-dashed border-line px-5 py-8 text-center text-[13px] text-muted">No sessions in this project yet. Add one from the project menu in the sidebar.</p>
					{/each}
				</div>
			</section>
		</div>
	</div>
</div>
