import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { CodingHarnessKind, CodingHarnessSlots } from "../src/klerm/coding-harness-setup.ts";
import { InteractiveMode, parseKlermLaneCommand } from "../src/modes/interactive/interactive-mode.ts";

const discoveredHarnesses = [
	{ kind: "klerm" as const, available: true, builtin: true, models: [] },
	{ kind: "claude-code" as const, available: true, builtin: false, models: [], version: "Claude Code 2.0" },
	{ kind: "codex" as const, available: false, builtin: false, models: [] },
	{ kind: "opencode" as const, available: true, builtin: false, models: [], version: "1.18.9" },
	{ kind: "pi" as const, available: false, builtin: false, models: [] },
	{ kind: "cline" as const, available: false, builtin: false, models: [] },
];

type HandlerContext = {
	options: { discoverCodingHarnesses: () => Promise<typeof discoveredHarnesses> };
	session: { klermRouting?: undefined };
	settingsManager: {
		getCodingHarnessSlots: () => CodingHarnessSlots;
		setCodingHarnessSlots: (slots: CodingHarnessSlots) => void;
		flush: () => Promise<void>;
	};
	showError: (message: string) => void;
	showStatus: (message: string) => void;
	updateKlermRoutingStatus: () => void;
};

const agent = (id: string, kind: CodingHarnessKind | null, enabled = kind !== null) => ({
	id,
	kind,
	enabled,
	role: "builder" as const,
	effort: "off" as const,
	tools: [],
});

const handleCommand = (
	InteractiveMode as unknown as {
		prototype: {
			handleKlermModelCommand(this: HandlerContext, lane: "local" | "frontier", argument: string): Promise<void>;
		};
	}
).prototype.handleKlermModelCommand;

type DynamicHandlerContext = HandlerContext & {
	viewCodingAgent: (agentNumber: number) => void;
};

const dynamicHandlers = (
	InteractiveMode as unknown as {
		prototype: {
			addCodingAgent(this: DynamicHandlerContext): Promise<void>;
			handleNumberedCodingAgentCommand(
				this: DynamicHandlerContext,
				agentNumber: number,
				argument: string,
			): Promise<void>;
			removeCodingAgent(this: DynamicHandlerContext, agentNumber: number): Promise<void>;
		};
	}
).prototype;

function createHandlerContext(
	initial: CodingHarnessSlots = {
		externalHarnessesEnabled: false,
		agents: [agent("agent1", "klerm")],
	},
) {
	let slots = structuredClone(initial);
	const context: HandlerContext = {
		options: { discoverCodingHarnesses: vi.fn(async () => discoveredHarnesses) },
		session: {},
		settingsManager: {
			getCodingHarnessSlots: () => structuredClone(slots),
			setCodingHarnessSlots: vi.fn((next) => {
				slots = structuredClone(next);
			}),
			flush: vi.fn(async () => {}),
		},
		showError: vi.fn(),
		showStatus: vi.fn(),
		updateKlermRoutingStatus: vi.fn(),
	};
	return { context, getSlots: () => slots };
}

describe("interactive harness slot commands", () => {
	it("parses setup actions and canonicalizable targets without changing model syntax", () => {
		expect(parseKlermLaneCommand("connect claude code")).toEqual({ action: "connect", target: "claude code" });
		expect(parseKlermLaneCommand("connect claude-code")).toEqual({ action: "connect", target: "claude-code" });
		expect(parseKlermLaneCommand("disconnect")).toEqual({ action: "disconnect" });
		expect(parseKlermLaneCommand("off")).toEqual({ action: "off" });
		expect(parseKlermLaneCommand("codex/gpt-5")).toEqual({ action: "model", reference: "codex/gpt-5" });
	});

	it("persists an available canonical harness and reports setup-only discovery", async () => {
		const { context, getSlots } = createHandlerContext();

		await handleCommand.call(context, "local", "connect Claude Code");

		expect(getSlots()).toEqual({
			externalHarnessesEnabled: true,
			agents: [agent("agent1", "claude-code")],
		});
		expect(context.settingsManager.flush).toHaveBeenCalledOnce();
		expect(context.showStatus).toHaveBeenCalledWith(
			expect.stringContaining(
				"Agent 1 harness setup\nHarness: claude-code\nEnabled: yes\nModel: not selected\nBuilt-in: no\nAvailable: yes\nVersion: Claude Code 2.0\nStatus: configured (setup only)",
			),
		);
		expect(context.showStatus).toHaveBeenCalledWith(
			expect.stringContaining(
				"External native session bridging is not started yet. Authentication and connection are not verified.",
			),
		);
	});

	it("rejects an unavailable external harness without changing or flushing settings", async () => {
		const { context, getSlots } = createHandlerContext();

		await handleCommand.call(context, "frontier", "connect codex");

		expect(getSlots()).toMatchObject({ agents: [{ id: "agent1", kind: "klerm" }] });
		expect(context.settingsManager.setCodingHarnessSlots).not.toHaveBeenCalled();
		expect(context.settingsManager.flush).not.toHaveBeenCalled();
		expect(context.showError).toHaveBeenCalledWith(expect.stringContaining("Harness setup was not changed"));
	});

	it("shows assigned setup before model status and disconnects independently", async () => {
		const { context, getSlots } = createHandlerContext({
			externalHarnessesEnabled: true,
			agents: [agent("agent1", "klerm"), agent("agent2", "claude-code")],
		});

		await handleCommand.call(context, "frontier", "status");
		expect(context.showStatus).toHaveBeenCalledWith(expect.stringContaining("Harness: claude-code"));

		await handleCommand.call(context, "frontier", "disconnect");
		expect(getSlots()).toMatchObject({ agents: [{ kind: "klerm" }, { kind: null, enabled: false }] });
		expect(context.settingsManager.flush).toHaveBeenCalledOnce();
		expect(context.showStatus).toHaveBeenLastCalledWith(expect.stringContaining("harness setup cleared"));
	});

	it("adds, configures, and removes stable numbered agents", async () => {
		const { context, getSlots } = createHandlerContext();
		const dynamicContext: DynamicHandlerContext = { ...context, viewCodingAgent: vi.fn() };

		await dynamicHandlers.addCodingAgent.call(dynamicContext);
		await dynamicHandlers.handleNumberedCodingAgentCommand.call(dynamicContext, 2, "role planner");
		await dynamicHandlers.handleNumberedCodingAgentCommand.call(dynamicContext, 2, "effort high");
		await dynamicHandlers.handleNumberedCodingAgentCommand.call(dynamicContext, 2, "tools read,grep,bash");

		expect(getSlots().agents[1]).toEqual({
			...agent("agent2", null, false),
			role: "planner",
			effort: "high",
			tools: ["read", "grep", "bash"],
		});

		await dynamicHandlers.removeCodingAgent.call(dynamicContext, 2);
		expect(getSlots().agents.map((configured) => configured.id)).toEqual(["agent1"]);
	});

	it("autocompletes setup actions and connect targets for both command forms", async () => {
		type FakeInteractiveMode = {
			options: { discoverCodingHarnesses: () => Promise<typeof discoveredHarnesses> };
			session: {
				scopedModels: [];
				modelRuntime: { getAvailableSnapshot: () => [] };
				promptTemplates: [];
				extensionRunner: { getRegisteredCommands: () => [] };
				resourceLoader: { getSkills: () => { skills: [] } };
				klermRouting: undefined;
			};
			settingsManager: {
				getEnableSkillCommands: () => boolean;
				getCodingHarnessSlots: () => CodingHarnessSlots;
			};
			codingAgentLabel: (kind: CodingHarnessKind | null) => string;
			skillCommands: Map<string, string>;
			sessionManager: { getCwd: () => string };
			fdPath: null;
		};
		const createProvider = (
			InteractiveMode as unknown as {
				prototype: { createBaseAutocompleteProvider(this: FakeInteractiveMode): AutocompleteProvider };
			}
		).prototype.createBaseAutocompleteProvider;
		const context: FakeInteractiveMode = {
			options: { discoverCodingHarnesses: vi.fn(async () => discoveredHarnesses) },
			session: {
				scopedModels: [],
				modelRuntime: { getAvailableSnapshot: () => [] },
				promptTemplates: [],
				extensionRunner: { getRegisteredCommands: () => [] },
				resourceLoader: { getSkills: () => ({ skills: [] }) },
				klermRouting: undefined,
			},
			settingsManager: {
				getEnableSkillCommands: () => false,
				getCodingHarnessSlots: () => ({
					externalHarnessesEnabled: true,
					agents: [agent("agent1", "klerm"), agent("agent2", "opencode")],
				}),
			},
			codingAgentLabel: (kind) => kind ?? "Unconfigured",
			skillCommands: new Map(),
			sessionManager: { getCwd: () => "/tmp" },
			fdPath: null,
		};
		const provider = createProvider.call(context);
		const signal = new AbortController().signal;
		const aliasLine = "/agent1 connect cla";
		const spacedLine = "/agent 2 dis";
		const installedLine = "/agent 2 harness open";
		const missingLine = "/agent 2 harness codex";
		const viewLine = "/view ";

		const targets = await provider.getSuggestions([aliasLine], 0, aliasLine.length, { signal });
		const actions = await provider.getSuggestions([spacedLine], 0, spacedLine.length, { signal });
		const installed = await provider.getSuggestions([installedLine], 0, installedLine.length, { signal });
		const missing = await provider.getSuggestions([missingLine], 0, missingLine.length, { signal });
		const agents = await provider.getSuggestions([viewLine], 0, viewLine.length, { signal });

		expect(targets?.items.map((item) => item.value)).toEqual(["connect claude-code"]);
		expect(actions?.items.map((item) => item.value)).toEqual(["2 disconnect"]);
		expect(installed?.items.map((item) => item.value)).toEqual(["2 harness opencode"]);
		expect(missing).toBeNull();
		expect(agents?.items.map((item) => item.value)).toEqual(["1", "2"]);
	});
});
