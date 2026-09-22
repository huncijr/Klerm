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

<div class="flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_-10%,rgba(116,145,160,.13),transparent_38%)]">
	<header class="flex items-center gap-3 border-b border-line bg-[rgba(8,11,15,.76)] px-6 py-3.5 backdrop-blur-[20px] narrow-720:px-3">
		<button type="button" aria-label="Toggle navigation" aria-expanded={sidebarOpen} class="hidden h-9 w-9 place-items-center rounded-md border border-line bg-[#0e1317] narrow-720:grid" onclick={ontogglesidebar}><Menu size={15} /></button>
		<button type="button" class="grid h-9 w-9 place-items-center rounded-md border border-[#2b353d] bg-[#11171c] text-[#9aa6ad] hover:border-[#52616b] hover:text-white" aria-label="Back to conversation" onclick={onclose}><ArrowLeft size={16} /></button>
		<div class="min-w-0 border-l border-[#303a42] pl-3">
			<p class="m-0 font-mono text-[8px] tracking-[.16em] text-[#65717a] uppercase">Project workspace</p>
			<h1 class="mt-0.5 mb-0 truncate text-[16px] font-semibold tracking-[-.01em] text-[#edf1f3]">{project.name}</h1>
		</div>
		<span class="ml-auto flex items-center gap-1.5 rounded-full border border-[#34424b] bg-[#11181d] px-3 py-1.5 font-mono text-[8px] text-[#94a1a8]"><Layers3 size={10} class="text-accent" /> {sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto px-6 py-7 narrow-720:px-3 narrow-720:py-4">
		<div class="mx-auto w-full max-w-[940px] space-y-8">
			<section class="relative overflow-hidden rounded-[20px] border border-[#33414a] bg-[linear-gradient(145deg,rgba(23,32,38,.98),rgba(8,13,17,.98))] shadow-[0_28px_80px_rgba(0,0,0,.32)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(214,255,63,.5),transparent)]">
				<div class="border-b border-[#263139] bg-[linear-gradient(90deg,rgba(214,255,63,.045),transparent_48%)] px-6 py-5 narrow-520:px-4">
					<div class="flex items-center gap-3">
						<span class="grid h-8 w-8 place-items-center rounded-lg border border-[rgba(214,255,63,.22)] bg-[rgba(214,255,63,.07)] text-accent"><Bot size={16} /></span>
						<div>
							<p class="m-0 font-mono text-[8px] tracking-[.14em] text-[#79868e] uppercase">Project intelligence</p>
							<strong class="mt-0.5 block text-[13px] text-[#e8edef]">Ask across every session</strong>
						</div>
					</div>
					<p class="mt-3 mb-0 max-w-[660px] text-[10px]/[1.55] text-[#77858d]">The selected AI receives bounded, labeled extracts from this project's sessions and continues the answer inside the project.</p>
				</div>
				<form class="space-y-4 p-6 narrow-520:p-4" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
					<textarea bind:value={question} maxlength="2000" rows="4" aria-label={`Ask ${project.name}`} placeholder="Summarize the project, compare decisions, or ask what remains..." class="w-full resize-y rounded-[14px] border border-[#34414a] bg-[rgba(5,9,12,.78)] px-4 py-3.5 text-[13px]/[1.6] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.025)] outline-none placeholder:text-[#526069] focus:border-[#71838e] focus:ring-1 focus:ring-[rgba(143,163,176,.13)]"></textarea>
					<div class="flex flex-wrap items-end gap-2.5 rounded-xl border border-[#27323a] bg-[rgba(12,18,22,.72)] p-2.5">
						<label class="min-w-[240px] flex-1">
							<span class="mb-1.5 block px-1 font-mono text-[8px] tracking-[.12em] text-[#718089] uppercase">Ask with</span>
							<select value={selectedAgentId} onchange={(event) => selectAgent(event.currentTarget.value)} disabled={busy || agents.length === 0} class="h-10 w-full rounded-lg border border-[#34414a] bg-[#090e12] px-3 text-[11px] text-[#dbe2e5] outline-none hover:border-[#4c5b65] disabled:opacity-45">
								{#each agents as agent (agent.agentId)}<option value={agent.agentId}>{agentLabel(agent)}</option>{/each}
							</select>
						</label>
						<label class="w-[150px] narrow-520:flex-1">
							<span class="mb-1.5 block px-1 font-mono text-[8px] tracking-[.12em] text-[#718089] uppercase">Reasoning</span>
							<select bind:value={effort} disabled={busy || !selectedAgentId} class="h-10 w-full rounded-lg border border-[#34414a] bg-[#090e12] px-3 text-[11px] capitalize text-[#dbe2e5] outline-none hover:border-[#4c5b65] disabled:opacity-45">
								{#each efforts as level}<option value={level}>{level}</option>{/each}
							</select>
						</label>
						<button type="submit" disabled={busy || !question.trim() || !selectedAgentId || sessions.length === 0} class="flex h-10 items-center gap-2 rounded-lg bg-[#d7e7ff] px-5 font-mono text-[10px] font-semibold text-[#091019] shadow-[0_8px_24px_rgba(180,210,255,.08)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"><MessageCircle size={14} /> {busy ? "Starting..." : "Ask AI"}</button>
					</div>
					{#if agents.length === 0}<p class="m-0 text-[10px] text-[#f0a19a]">No runnable AI is configured. Enable and configure an agent in Settings.</p>{/if}
					{#if sessions.length === 0}<p class="m-0 text-[10px] text-[#d2a65e]">Add a session to this project before asking a project-wide question.</p>{/if}
				</form>
			</section>

			<section class="overflow-hidden rounded-2xl border border-[#2b363e] bg-[linear-gradient(135deg,rgba(17,24,29,.94),rgba(8,13,17,.94))]">
				<div class="flex items-center justify-between gap-4 border-b border-[#263139] px-5 py-4 narrow-520:items-start narrow-520:px-4">
					<div class="flex min-w-0 items-center gap-3">
						<span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#3b464e] bg-[#141b20] text-[#c7d4da]"><Sparkles size={15} /></span>
						<div>
							<p class="m-0 font-mono text-[8px] tracking-[.15em] text-[#6c7981] uppercase">Project memory</p>
							<h2 class="mt-1 mb-0 text-[13px] font-semibold text-[#e0e6e9]">Session summary</h2>
						</div>
					</div>
					<button type="button" disabled={busy || sessions.length === 0} class="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[#46545e] bg-[#172027] px-3.5 font-mono text-[8px] font-semibold text-[#dce5e9] shadow-[0_8px_20px_rgba(0,0,0,.18)] hover:border-[#74838d] hover:bg-[#1c272e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" onclick={() => void onrefresh()}><RefreshCw size={11} class={busy ? "animate-spin" : ""} /> {project.summary ? "Regenerate summary" : "Create summary"}</button>
				</div>
				<div class={`min-h-28 whitespace-pre-wrap px-5 py-4 font-mono text-[10px]/[1.7] narrow-520:px-4 ${project.summary ? "text-[#9ba7ad]" : "text-[#65727a]"}`}>{project.summary ?? "Create a concise overview from the latest messages across every session in this project."}</div>
			</section>

			<section>
				<div class="mb-3 flex items-end justify-between gap-3">
					<p class="m-0 font-mono text-[8px] tracking-[.15em] text-[#64717a] uppercase">Continue work</p>
					<span class="font-mono text-[8px] text-[#59666e]">Open a session to inspect or continue</span>
				</div>
				<h2 class="mb-3 text-[13px] font-semibold text-[#dce3e6]">Sessions</h2>
				<div class="grid grid-cols-2 gap-3.5 narrow-720:grid-cols-1">
					{#each sessions as session (session.sessionToken)}
						<div
							class="cursor-pointer rounded-[14px] border border-[#2b363e] bg-[linear-gradient(145deg,#0d1317,#090e12)] p-1.5 shadow-[0_12px_30px_rgba(0,0,0,.14)] transition-colors hover:border-[#4a5b65]"
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
						<p class="col-span-full rounded-xl border border-dashed border-[#303b43] px-5 py-8 text-center text-[11px] text-[#65717a]">No sessions in this project yet. Add one from the project menu in the sidebar.</p>
					{/each}
				</div>
			</section>
		</div>
	</div>
</div>
