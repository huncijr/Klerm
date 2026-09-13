import { describe, expect, test } from "vitest";
import {
	addCodingHarnessSlot,
	assignWorkTogetherModels,
	canEnableWorkTogether,
	hasThreeEnabledCodingHarnessAgents,
	removeCodingHarnessSlot,
	setAllCodingHarnessAgentsEnabled,
	setExternalCodingHarnessesEnabled,
	shouldShowAgentContext,
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

	test("shows selected enabled agent context without requiring Work together", () => {
		const configured = { ...addCodingHarnessSlot(addCodingHarnessSlot(slots)), workTogetherEnabled: true };
		expect(shouldShowAgentContext(configured, [])).toBe(false);
		expect(shouldShowAgentContext(configured, ["agent2"])).toBe(true);
		expect(shouldShowAgentContext({ ...configured, workTogetherEnabled: undefined }, ["agent2"])).toBe(true);
		expect(
			shouldShowAgentContext(updateCodingHarnessSlot(configured, "agent2", { enabled: false }), ["agent2"]),
		).toBe(false);
		expect(shouldShowAgentContext({ ...configured, externalHarnessesEnabled: false }, ["agent2"])).toBe(false);
	});

	test("disables, restores, and turns off configured agents without losing their settings", () => {
		const configured = { ...addCodingHarnessSlot(addCodingHarnessSlot(slots)), workTogetherEnabled: true };
		const disabled = setAllCodingHarnessAgentsEnabled(configured, false);
		expect(disabled.agents.every((agent) => !agent.enabled)).toBe(true);
		expect(disabled).not.toHaveProperty("workTogetherEnabled");
		expect(setAllCodingHarnessAgentsEnabled(disabled, true).agents).toEqual(
			configured.agents.map((agent) => ({ ...agent, enabled: true })),
		);
		const turnedOff = setExternalCodingHarnessesEnabled(configured, false);
		expect(turnedOff.externalHarnessesEnabled).toBe(false);
		expect(turnedOff.agents).toBe(configured.agents);
		expect(turnedOff).not.toHaveProperty("workTogetherEnabled");
	});

	test("adds an enabled Klerm agent with the smallest free id", () => {
		const withGap = { ...slots, agents: [...slots.agents, { ...slots.agents[0]!, id: "agent3" }] };
		expect(addCodingHarnessSlot(withGap).agents.at(-1)).toMatchObject({ id: "agent2", kind: "klerm", enabled: true });
		const full = addCodingHarnessSlot(addCodingHarnessSlot(withGap));
		expect(addCodingHarnessSlot(full)).toBe(full);
	});

	test("updates one agent without changing its other settings", () => {
		expect(updateCodingHarnessSlot(slots, "agent1", { enabled: false }).agents[0]).toEqual({
			...slots.agents[0],
			enabled: false,
		});
	});

	test("removes Agent 1 only when at least three agents are configured", () => {
		const withAgent2 = addCodingHarnessSlot(slots);
		expect(removeCodingHarnessSlot(withAgent2, "agent1")).toBe(withAgent2);
		expect(removeCodingHarnessSlot(withAgent2, "agent2").agents.map((agent) => agent.id)).toEqual(["agent1"]);
		const together = { ...addCodingHarnessSlot(addCodingHarnessSlot(slots)), workTogetherEnabled: true };
		expect(removeCodingHarnessSlot(together, "agent1").agents.map((agent) => agent.id)).toEqual(["agent2", "agent3"]);
		expect(removeCodingHarnessSlot(together, "agent3")).not.toHaveProperty("workTogetherEnabled");
	});
});
