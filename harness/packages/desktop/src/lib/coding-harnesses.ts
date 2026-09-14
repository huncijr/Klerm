import type { CodingHarnessSetup, CodingHarnessSlotSettings, WorkerRole } from "./model.ts";

type CodingHarnessSlots = CodingHarnessSetup["slots"];

export function hasTwoEnabledCodingHarnessAgents(slots: CodingHarnessSlots): boolean {
	return slots.externalHarnessesEnabled && slots.agents.filter((agent) => agent.enabled).length >= 2;
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
	return hasTwoEnabledCodingHarnessAgents(slots);
}

export function setAllCodingHarnessAgentRoles(slots: CodingHarnessSlots, role: WorkerRole): CodingHarnessSlots {
	return {
		...slots,
		agents: slots.agents.map((agent) => (agent.enabled ? { ...agent, role } : agent)),
	};
}

export function shouldShowAgentContext(slots: CodingHarnessSlots, visibleIds: readonly string[]): boolean {
	return (
		slots.externalHarnessesEnabled && slots.agents.some((agent) => agent.enabled && visibleIds.includes(agent.id))
	);
}

export function setAllCodingHarnessAgentsEnabled(slots: CodingHarnessSlots, enabled: boolean): CodingHarnessSlots {
	return {
		externalHarnessesEnabled: slots.externalHarnessesEnabled,
		agents: slots.agents.map((agent) => ({ ...agent, enabled })),
		...(enabled && slots.workTogetherEnabled === true ? { workTogetherEnabled: true } : {}),
	};
}

export function setExternalCodingHarnessesEnabled(slots: CodingHarnessSlots, enabled: boolean): CodingHarnessSlots {
	return {
		externalHarnessesEnabled: enabled,
		agents: slots.agents,
		...(enabled && slots.workTogetherEnabled === true ? { workTogetherEnabled: true } : {}),
	};
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

/** Deep compare for slot drafts, so saved-but-recreated objects do not look dirty. */
export function codingHarnessSlotsEqual(left: CodingHarnessSlots, right: CodingHarnessSlots): boolean {
	return (
		left.externalHarnessesEnabled === right.externalHarnessesEnabled &&
		(left.workTogetherEnabled ?? false) === (right.workTogetherEnabled ?? false) &&
		JSON.stringify(left.agents) === JSON.stringify(right.agents)
	);
}

export function addCodingHarnessSlot(slots: CodingHarnessSlots): CodingHarnessSlots {
	if (slots.agents.length >= 4) return slots;
	const used = new Set(slots.agents.map((agent) => Number(agent.id.slice(5))));
	let number = 1;
	while (used.has(number)) number += 1;
	return {
		...slots,
		agents: [
			...slots.agents,
			{ id: `agent${number}`, kind: "klerm", enabled: true, role: "builder", effort: "off", tools: [] },
		],
	};
}

export function removeCodingHarnessSlot(slots: CodingHarnessSlots, id: string): CodingHarnessSlots {
	if (slots.agents.length <= 1 || (id === "agent1" && slots.agents.length < 3)) return slots;
	const agents = slots.agents.filter((agent) => agent.id !== id);
	return {
		externalHarnessesEnabled: slots.externalHarnessesEnabled,
		agents,
		...(slots.workTogetherEnabled === true && agents.filter((agent) => agent.enabled).length >= 2
			? { workTogetherEnabled: true }
			: {}),
	};
}
