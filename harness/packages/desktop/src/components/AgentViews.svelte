<script lang="ts">
	import { Eraser, X } from "@lucide/svelte";
	import { agentFeedItems } from "../lib/agent-workspace.ts";
	import type {
		CodingHarnessSlotSettings,
		FeedItem,
		McpServerStatus,
		ThinkingLevel,
	} from "../lib/model.ts";
	import Feed from "./Feed.svelte";

	let {
		agents,
		visibleIds,
		items,
		activeAgentId,
		taskActive,
		mcpServers,
		connectedHarnessKinds,
		clearThrough,
		onclose,
		oneffortchange,
		onrolechange,
		onclear,
		onrerun,
		ontoggle,
	}: {
		agents: CodingHarnessSlotSettings[];
		visibleIds: string[];
		items: FeedItem[];
		activeAgentId?: string;
		taskActive: boolean;
		mcpServers: McpServerStatus[];
		connectedHarnessKinds: CodingHarnessSlotSettings["kind"][];
		clearThrough: Record<string, number>;
		onclose: (id: string) => void;
		oneffortchange: (id: string, effort: ThinkingLevel) => void;
		onrolechange: (id: string, role: "planner" | "builder") => void;
		onclear: (id: string) => void;
		onrerun: (text: string) => void;
		ontoggle: (id: number) => void;
	} = $props();

	const visibleAgents = $derived(agents.filter((agent) => agent.enabled && visibleIds.includes(agent.id)).slice(0, 4));
	const efforts: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

	function agentItems(id: string): FeedItem[] {
		return agentFeedItems(items, id, clearThrough[id] ?? 0);
	}

	function status(agent: CodingHarnessSlotSettings, agentFeed: FeedItem[]): string {
		if (agent.kind !== "klerm" && !connectedHarnessKinds.includes(agent.kind)) return "Adapter unavailable";
		const bridgeStatus = [...agentFeed].reverse().find(
			(item) => item.type === "activity" && item.activity.kind === "bridge" && item.activity.bridgeStatus,
		);
		const lifecycle = bridgeStatus?.type === "activity" ? bridgeStatus.activity.bridgeStatus : undefined;
		if (lifecycle === "failed") return "Failed";
		if (lifecycle === "cancelled") return "Cancelled";
		if (lifecycle === "completed") return "Complete";
		if (lifecycle === "returned") return "Returned";
		if (lifecycle === "waiting") return "Waiting";
		if (taskActive) return activeAgentId === agent.id ? "Working" : lifecycle === "assigned" ? "Assigned" : "Ready";
		if (agentFeed.some((item) => item.type === "activity" && item.activity.status === "error")) return "Failed";
		return agentFeed.length > 0 ? "Complete" : "Ready";
	}

	function gridClass(count: number): string {
		if (count === 3) return "min-[1100px]:grid-cols-3";
		if (count === 4) return "min-[760px]:grid-cols-2 min-[760px]:grid-rows-2";
		if (count === 2) return "min-[760px]:grid-cols-2";
		return "grid-cols-1";
	}
</script>

{#if visibleAgents.length > 0}
	<section class={`grid h-full min-h-0 gap-3 overflow-y-auto ${gridClass(visibleAgents.length)}`} aria-label="Agent views">
		{#each visibleAgents as agent (agent.id)}
			{@const scopedItems = agentItems(agent.id)}
			<article class="flex min-h-[280px] min-w-0 flex-col overflow-hidden rounded-xl border border-[#303a42] bg-[#090e12] shadow-[0_14px_36px_rgba(0,0,0,.22)] min-[760px]:min-h-0">
				<header class="flex items-start gap-3 border-b border-[#273139] bg-[#0d1419] px-3 py-2.5">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class={`h-1.5 w-1.5 rounded-full ${taskActive && activeAgentId === agent.id ? "animate-pulse bg-[#a9ca55]" : "bg-[#58656d]"}`}></span>
							<strong class="font-mono text-[10px] text-[#e7ecef]">Agent {agent.id.slice(5)}</strong>
							<span class="font-mono text-[8px] text-[#75828a]">{status(agent, scopedItems)}</span>
						</div>
						<p class="mt-1 truncate font-mono text-[8px] text-[#8e9aa2]" title={agent.model ?? "Default model"}>{agent.model ?? "Default model"}</p>
					</div>
					<label class="font-mono text-[7px] tracking-[.08em] text-[#69767e] uppercase">
						Role{taskActive ? " · next task" : ""}
						<select value={agent.role} class="mt-1 block h-7 rounded border border-[#303a42] bg-[#070b0e] px-2 font-mono text-[8px] text-[#dbe1e4] [color-scheme:dark]" onchange={(event) => onrolechange(agent.id, event.currentTarget.value as "planner" | "builder")}>
							<option value="planner">Plan</option><option value="builder">Build</option>
						</select>
					</label>
					<label class="font-mono text-[7px] tracking-[.08em] text-[#69767e] uppercase">
						Thinking
						<select
							value={agent.effort}
							class="mt-1 block h-7 rounded border border-[#303a42] bg-[#070b0e] px-2 font-mono text-[8px] text-[#dbe1e4] [color-scheme:dark]"
							onchange={(event) => oneffortchange(agent.id, event.currentTarget.value as ThinkingLevel)}
						>
							{#each efforts as effort}<option value={effort}>{effort}</option>{/each}
						</select>
					</label>
					<button type="button" aria-label={`Clear Agent ${agent.id.slice(5)} terminal`} title="Clear terminal" class="flex h-7 items-center gap-1 rounded px-1.5 font-mono text-[7px] text-[#77838b] hover:bg-[#202930] hover:text-white" onclick={() => onclear(agent.id)}><Eraser size={11} /> Clear</button>
					<button type="button" aria-label={`Close Agent ${agent.id.slice(5)} view`} class="grid h-7 w-7 place-items-center rounded text-[#77838b] hover:bg-[#202930] hover:text-white" onclick={() => onclose(agent.id)}><X size={13} /></button>
				</header>
				<div class="min-h-0 flex-1 overflow-y-auto p-3">
					{#if scopedItems.length > 0}
						<Feed items={scopedItems} {taskActive} {mcpServers} {onrerun} {ontoggle} />
					{:else}
						<p class="m-0 font-mono text-[9px]/[1.6] text-[#69757d]">This agent has not produced activity in the current session.</p>
					{/if}
				</div>
			</article>
		{/each}
	</section>
{/if}
