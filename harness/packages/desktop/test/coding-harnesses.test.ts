import { describe, expect, test } from "vitest";
import {
	addCodingHarnessSlot,
	assignWorkTogetherModels,
	canEnableWorkTogether,
	hasThreeEnabledCodingHarnessAgents,
	removeCodingHarnessSlot,
	updateCodingHarnessSlot,
} from "../src/lib/coding-harnesses.ts";
import type { CodingHarnessSetup } from "../src/lib/model.ts";

const slots: CodingHarnessSetup["slots"] = {
	externalHarnessesEnabled: true,
	agents: [
		{ id: "agent1", kind: "klerm", enabled: true, model: "provider/one", role: "builder", effort: "off", tools: [] },
	],
};

describe("desktop coding harness slots", () => {
	test("shows team controls when at least three agents are enabled", () => {
		expect(hasThreeEnabledCodingHarnessAgents(slots)).toBe(false);
		const configured = addCodingHarnessSlot(addCodingHarnessSlot(slots));
		expect(hasThreeEnabledCodingHarnessAgents(configured)).toBe(true);
		expect(
			hasThreeEnabledCodingHarnessAgents(updateCodingHarnessSlot(configured, "agent3", { enabled: false })),
		).toBe(false);
	});

	test("can enable Work together when three agents are enabled", () => {
		const configured = addCodingHarnessSlot(addCodingHarnessSlot(slots));
		expect(canEnableWorkTogether(configured)).toBe(true);
		expect(
			assignWorkTogetherModels(configured, "provider/one", "provider/two", [
				"provider/one",
				"provider/two",
				"provider/three",
			]).agents.map((agent) => agent.model),
		).toEqual(["provider/one", "provider/two", "provider/three"]);
		expect(canEnableWorkTogether(updateCodingHarnessSlot(configured, "agent3", { enabled: false }))).toBe(false);
	});

	test("adds an enabled Klerm agent with a stable increasing id", () => {
		const withGap = { ...slots, agents: [...slots.agents, { ...slots.agents[0]!, id: "agent3" }] };
		expect(addCodingHarnessSlot(withGap).agents.at(-1)).toMatchObject({ id: "agent4", kind: "klerm", enabled: true });
	});

	test("updates one agent without changing its other settings", () => {
		expect(updateCodingHarnessSlot(slots, "agent1", { enabled: false }).agents[0]).toEqual({
			...slots.agents[0],
			enabled: false,
		});
	});

	test("keeps Agent 1 but removes later agents", () => {
		const withAgent2 = addCodingHarnessSlot(slots);
		expect(removeCodingHarnessSlot(withAgent2, "agent1")).toBe(withAgent2);
		expect(removeCodingHarnessSlot(withAgent2, "agent2").agents.map((agent) => agent.id)).toEqual(["agent1"]);
		const together = { ...addCodingHarnessSlot(addCodingHarnessSlot(slots)), workTogetherEnabled: true };
		expect(removeCodingHarnessSlot(together, "agent3")).not.toHaveProperty("workTogetherEnabled");
	});
});
