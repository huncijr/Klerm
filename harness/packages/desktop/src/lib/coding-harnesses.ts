import type { CodingHarnessSetup, CodingHarnessSlotSettings } from "./model.ts";

type CodingHarnessSlots = CodingHarnessSetup["slots"];

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
	return { ...slots, agents: slots.agents.filter((agent) => agent.id !== id) };
}
