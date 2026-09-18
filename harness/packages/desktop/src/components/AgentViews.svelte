<script lang="ts">
	import { Eraser, ImagePlus, Send, X } from "@lucide/svelte";
	import { agentFeedItems } from "../lib/agent-workspace.ts";
	import { imageDataUrl } from "../lib/helpers.ts";
	import type {
		CodingHarnessSlotSettings,
		FeedItem,
		ImageAttachment,
		McpServerStatus,
		PersonalBot,
		ThinkingLevel,
	} from "../lib/model.ts";
	import { profileIcon } from "../lib/profiles.ts";
	import Feed from "./Feed.svelte";

	let {
		agents,
		visibleIds,
		items,
		activeAgentId,
		taskActive,
		sendDisabled,
		personalBots,
		mcpServers,
		connectedHarnessKinds,
		clearThrough,
		onclose,
		oneffortchange,
		onrolechange,
		onclear,
		onrerun,
		ontoggle,
		onsend,
	}: {
		agents: CodingHarnessSlotSettings[];
		visibleIds: string[];
		items: FeedItem[];
		activeAgentId?: string;
		taskActive: boolean;
		sendDisabled: boolean;
		personalBots: PersonalBot[];
		mcpServers: McpServerStatus[];
		connectedHarnessKinds: CodingHarnessSlotSettings["kind"][];
		clearThrough: Record<string, number>;
		onclose: (id: string) => void;
		oneffortchange: (id: string, effort: ThinkingLevel) => void;
		onrolechange: (id: string, role: "planner" | "builder") => void;
		onclear: (id: string) => void;
		onrerun: (text: string) => void;
		ontoggle: (id: number) => void;
		onsend: (agentId: string, text: string, images: ImageAttachment[]) => void;
	} = $props();

	const visibleAgents = $derived(agents.filter((agent) => agent.enabled && visibleIds.includes(agent.id)).slice(0, 4));
	const efforts: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	let drafts = $state<Record<string, { text: string; images: ImageAttachment[] }>>({});
	let fileInputs = $state<Record<string, HTMLInputElement | undefined>>({});

	function agentItems(id: string): FeedItem[] {
		return agentFeedItems(items, id, clearThrough[id] ?? 0);
	}

	function draftFor(id: string): { text: string; images: ImageAttachment[] } {
		return drafts[id] ?? { text: "", images: [] };
	}

	function canAttach(agent: CodingHarnessSlotSettings): boolean {
		return agent.kind === "klerm" && (agent.id === "agent1" || agent.id === "agent2");
	}

	function adapterUnavailable(agent: CodingHarnessSlotSettings): boolean {
		return agent.kind !== "klerm" && !connectedHarnessKinds.includes(agent.kind);
	}

	function submit(agent: CodingHarnessSlotSettings): void {
		const draft = draftFor(agent.id);
		const text = draft.text.trim();
		if ((!text && draft.images.length === 0) || sendDisabled || taskActive || adapterUnavailable(agent)) return;
		onsend(agent.id, text, draft.images);
		drafts = { ...drafts, [agent.id]: { text: "", images: [] } };
	}

	async function attachImages(agent: CodingHarnessSlotSettings, event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = "";
		const draft = draftFor(agent.id);
		const available = Math.max(0, 8 - draft.images.length);
		for (const file of files.slice(0, available)) {
			if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) continue;
			if (file.size > 10 * 1024 * 1024) continue;
			let dataUrl = "";
			try {
				dataUrl = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(String(reader.result ?? ""));
					reader.onerror = () => reject(reader.error ?? new Error("read failed"));
					reader.readAsDataURL(file);
				});
			} catch {
				continue;
			}
			const marker = ";base64,";
			const markerIndex = dataUrl.indexOf(marker);
			if (markerIndex < 0) continue;
			drafts = {
				...drafts,
				[agent.id]: {
					text: draftFor(agent.id).text,
					images: [
						...draftFor(agent.id).images,
						{ type: "image", mimeType: file.type, data: dataUrl.slice(markerIndex + marker.length), name: file.name },
					],
				},
			};
		}
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
			{@const draft = draftFor(agent.id)}
			{@const attachable = canAttach(agent)}
			{@const unavailable = adapterUnavailable(agent)}
			{@const personality = personalBots.find((bot) => bot.id === agent.personalBotId)}
			<article class="flex min-h-[280px] min-w-0 flex-col overflow-hidden rounded-xl border border-[#303a42] bg-[#090e12] shadow-[0_14px_36px_rgba(0,0,0,.22)] min-[760px]:min-h-0">
				<header class="flex items-start gap-3 border-b border-[#273139] bg-[#0d1419] px-3 py-2.5">
					{#if personality}
						<span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#252f35] text-[14px] text-[#d6e0e4]" title={personality.name}>{profileIcon(personality.face)}</span>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class={`h-1.5 w-1.5 rounded-full ${taskActive && activeAgentId === agent.id ? "animate-pulse bg-[#a9ca55]" : "bg-[#58656d]"}`}></span>
							<strong class="font-mono text-[10px] text-[#e7ecef]">Agent {agent.id.slice(5)}{personality ? ` · ${personality.name}` : ""}</strong>
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
				<div class="border-t border-[#273139] bg-[#0b1116] p-2">
					{#if draft.images.length > 0}
						<div class="mb-1.5 flex gap-1.5 overflow-x-auto">
							{#each draft.images as image, index (`${image.name ?? index}-${image.data.length}`)}
								{@const src = imageDataUrl(image)}
								{#if src}
									<div class="group relative h-10 w-10 shrink-0 overflow-hidden rounded border border-[#364149] bg-[#080b0e]">
										<img src={src} alt={image.name ?? `Attachment ${index + 1}`} class="h-full w-full object-cover" />
										<button type="button" aria-label="Remove attachment" class="absolute top-0 right-0 grid h-4 w-4 place-items-center rounded-bl bg-black/80 text-white opacity-80 hover:opacity-100" onclick={() => (drafts = { ...drafts, [agent.id]: { text: draft.text, images: draft.images.filter((_, candidate) => candidate !== index) } })}><X size={9} /></button>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
					<div class="flex items-end gap-1.5">
						{#if attachable}
							<input
								bind:this={fileInputs[agent.id]}
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								multiple
								class="hidden"
								onchange={(event) => void attachImages(agent, event)}
							/>
							<button
								type="button"
								aria-label="Attach images"
								title="Attach images (this Klerm agent only)"
								disabled={sendDisabled || taskActive || unavailable || draft.images.length >= 8}
								class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#293239] bg-[#11171c] text-[#9ba5ac] hover:border-[#46515a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
								onclick={() => fileInputs[agent.id]?.click()}
							>
								<ImagePlus size={14} stroke-width={1.7} />
							</button>
						{/if}
						<textarea
							rows="1"
							placeholder={unavailable ? "Adapter unavailable" : `Message Agent ${agent.id.slice(5)}...`}
							aria-label={`Message Agent ${agent.id.slice(5)}`}
							disabled={sendDisabled || taskActive || unavailable}
							class="max-h-24 min-h-8 flex-1 resize-none rounded-md border border-[#293239] bg-[#0d1316] px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-[#4f5a60] focus:border-[#46515a] disabled:opacity-40"
							value={draft.text}
							oninput={(event) => (drafts = { ...drafts, [agent.id]: { text: event.currentTarget.value, images: draft.images } })}
							onkeydown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									submit(agent);
								}
							}}
						></textarea>
						<button
							type="button"
							aria-label={`Send to Agent ${agent.id.slice(5)}`}
							disabled={sendDisabled || taskActive || unavailable || (!draft.text.trim() && draft.images.length === 0)}
							class="grid h-8 w-8 shrink-0 place-items-center rounded-md border-0 bg-[#e1e6e9] text-[#0b0e10] enabled:hover:bg-white disabled:cursor-not-allowed disabled:bg-[#20272c] disabled:text-[#51585d]"
							onclick={() => submit(agent)}
						>
							<Send size={14} stroke-width={1.7} />
						</button>
					</div>
					{#if !attachable && !unavailable}
						<p class="m-0 mt-1 font-mono text-[7px] text-[#59656d]">Text only — image forwarding is not available for external harnesses yet.</p>
					{/if}
				</div>
			</article>
		{/each}
	</section>
{/if}
