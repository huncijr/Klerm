import { describe, expect, test } from "vitest";
import {
	addCodingHarnessSlot,
	assignWorkTogetherModels,
	canEnableWorkTogether,
	canPromptTogether,
	codingHarnessModelOptions,
	hasTwoEnabledCodingHarnessAgents,
	removeCodingHarnessSlot,
	setAllCodingHarnessAgentRoles,
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
	test("shows team controls when at least two agents are enabled", () => {
		expect(hasTwoEnabledCodingHarnessAgents(slots)).toBe(false);
		const configured = addCodingHarnessSlot(slots);
		expect(hasTwoEnabledCodingHarnessAgents(configured)).toBe(true);
		expect(hasTwoEnabledCodingHarnessAgents(updateCodingHarnessSlot(configured, "agent2", { enabled: false }))).toBe(
			false,
		);
	});

	test("can enable Work together when two agents are enabled", () => {
		const configured = addCodingHarnessSlot(slots);
		expect(canEnableWorkTogether(configured)).toBe(true);
		expect(
			assignWorkTogetherModels(configured, "provider/one", "provider/two", [
				"provider/one",
				"provider/two",
				"provider/three",
			]).agents.map((agent) => agent.model),
		).toEqual(["provider/one", "provider/two"]);
		expect(canEnableWorkTogether(updateCodingHarnessSlot(configured, "agent2", { enabled: false }))).toBe(false);
	});

	test("offers Prompt Together only for three runnable external agents", () => {
		const runnableAgent = (agentId: string, harness: "codex" | "opencode") => ({
			order: Number(agentId.slice(5)),
			agentId,
			harness,
			model: `${harness}/model`,
			role: "builder" as const,
			effort: "high" as const,
			tools: [],
			specialties: [],
			strengthBand: 3 as const,
			strengths: [],
			limits: [],
			capabilitySource: "model-profile-inference" as const,
			adapterCapabilities: {
				prompt: true as const,
				abort: true as const,
				resumeSession: true,
				roleEnforcement: true,
				childTaskEvents: false as const,
			},
		});
		const setup: CodingHarnessSetup = {
			slots,
			harnesses: [],
			effectiveRouting: "auto",
			externalPromptingAvailable: true,
			workTogetherAvailable: true,
			runnableAgents: [runnableAgent("agent1", "opencode"), runnableAgent("agent2", "codex")],
			excludedAgents: [],
		};
		expect(canPromptTogether(setup)).toBe(false);
		expect(
			canPromptTogether({ ...setup, runnableAgents: [...setup.runnableAgents, runnableAgent("agent3", "codex")] }),
		).toBe(true);
		expect(canPromptTogether({ ...setup, slots: { ...slots, externalHarnessesEnabled: false } })).toBe(false);
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

	test("resolves model options by stable slot id instead of array position", () => {
		const setup: CodingHarnessSetup = {
			slots: {
				externalHarnessesEnabled: true,
				agents: [slots.agents[0]!, { ...slots.agents[0]!, id: "agent5", model: "provider/five" }],
			},
			harnesses: [],
			effectiveRouting: "auto",
			externalPromptingAvailable: true,
			workTogetherAvailable: true,
			runnableAgents: [],
			excludedAgents: [],
		};
		expect(
			codingHarnessModelOptions(
				setup.slots.agents[1]!,
				setup,
				[{ value: "provider/local", label: "Local" }],
				[{ value: "provider/frontier", label: "Frontier" }],
			),
		).toEqual([
			{ value: "provider/local", label: "Local" },
			{ value: "provider/frontier", label: "Frontier" },
		]);
	});

	test("applies a team role only to enabled agents", () => {
		const configured = addCodingHarnessSlot(slots);
		const withDisabledPeer = updateCodingHarnessSlot(configured, "agent2", { enabled: false, role: "builder" });
		expect(setAllCodingHarnessAgentRoles(withDisabledPeer, "planner").agents).toMatchObject([
			{ id: "agent1", role: "planner" },
			{ id: "agent2", role: "builder" },
		]);
	});

	test("removes Agent 1 only when at least three agents are configured", () => {
		const withAgent2 = addCodingHarnessSlot(slots);
		expect(removeCodingHarnessSlot(withAgent2, "agent1")).toBe(withAgent2);
		expect(removeCodingHarnessSlot(withAgent2, "agent2").agents.map((agent) => agent.id)).toEqual(["agent1"]);
		const together = { ...addCodingHarnessSlot(addCodingHarnessSlot(slots)), workTogetherEnabled: true };
		expect(removeCodingHarnessSlot(together, "agent1").agents.map((agent) => agent.id)).toEqual(["agent2", "agent3"]);
		expect(removeCodingHarnessSlot(together, "agent3")).toHaveProperty("workTogetherEnabled", true);
	});
});
