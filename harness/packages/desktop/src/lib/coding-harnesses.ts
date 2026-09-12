import type { CodingHarnessSetup, CodingHarnessSlotSettings } from "./model.ts";

type CodingHarnessSlots = CodingHarnessSetup["slots"];

export function hasThreeEnabledCodingHarnessAgents(slots: CodingHarnessSlots): boolean {
	return slots.externalHarnessesEnabled && slots.agents.filter((agent) => agent.enabled).length >= 3;
}

export function resolvedCodingHarnessModel(
	agent: CodingHarnessSlotSettings,
	localModel?: string,
	frontierModel?: string,
): string | undefined {
	if (agent.model) return agent.model;
	if (agent.kind !== "klerm") return undefined;
	if (agent.id === "agent1") return localModel;
	if (agent.id === "agent2") return frontierModel;
	return undefined;
}

export function canEnableWorkTogether(slots: CodingHarnessSlots): boolean {
	return hasThreeEnabledCodingHarnessAgents(slots);
}

export function assignWorkTogetherModels(
	slots: CodingHarnessSlots,
	localModel?: string,
	frontierModel?: string,
	catalog: readonly string[] = [],
): CodingHarnessSlots {
	const used = new Set<string>();
	const unused = () => catalog.find((model) => model && !used.has(model));
	return {
		...slots,
		agents: slots.agents.map((agent) => {
			if (!agent.enabled || agent.kind !== "klerm") return agent;
			const model = resolvedCodingHarnessModel(agent, localModel, frontierModel) ?? unused();
			if (!model) return agent;
			used.add(model);
			return agent.model === model ? agent : { ...agent, model };
		}),
	};
}

export function updateCodingHarnessSlot(
	slots: CodingHarnessSlots,
	id: string,
	update: Partial<CodingHarnessSlotSettings>,
): CodingHarnessSlots {
	return {
		...slots,
		agents: slots.agents.map((agent) => (agent.id === id ? { ...agent, ...update } : agent)),
	};
}

export function addCodingHarnessSlot(slots: CodingHarnessSlots): CodingHarnessSlots {
	if (slots.agents.length >= 16) return slots;
	const highest = slots.agents.reduce((max, agent) => {
		const number = Number(agent.id.slice(5));
		return Number.isSafeInteger(number) ? Math.max(max, number) : max;
	}, 0);
	return {
		...slots,
		agents: [
			...slots.agents,
			{ id: `agent${highest + 1}`, kind: "klerm", enabled: true, role: "builder", effort: "off", tools: [] },
		],
	};
}

export function removeCodingHarnessSlot(slots: CodingHarnessSlots, id: string): CodingHarnessSlots {
	if (id === "agent1") return slots;
	const agents = slots.agents.filter((agent) => agent.id !== id);
	return {
		externalHarnessesEnabled: slots.externalHarnessesEnabled,
		agents,
		...(slots.workTogetherEnabled === true && agents.filter((agent) => agent.enabled).length >= 3
			? { workTogetherEnabled: true }
			: {}),
	};
}
