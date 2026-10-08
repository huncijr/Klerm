import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	type CodingHarnessKind,
	createCodingHarnessAgent,
	createCodingHarnessSetup,
	discoverCodingHarnesses,
	discoverCodingHarnessModels,
	nextCodingHarnessAgentId,
	normalizeCodingHarnessKind,
	normalizeCodingHarnessSlots,
	parseCodingHarnessSlots,
} from "../src/klerm/coding-harness-setup.ts";

const tempDirs: string[] = [];
const agent = (id: string, kind: CodingHarnessKind | null, enabled = kind !== null) => ({
	id,
	kind,
	enabled,
	role: "builder" as const,
	effort: "off" as const,
	tools: [],
});

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("coding harness setup", () => {
	it("does not infer quality, privacy, strengths or limits from external model names", () => {
		const setup = createCodingHarnessSetup(
			{
				externalHarnessesEnabled: true,
				agents: [
					{ ...agent("agent1", "opencode"), model: "Local/Custom Mini 3b", specialties: ["review"] },
					{ ...agent("agent2", "codex"), model: "Vendor/Unknown Frontier Max" },
				],
			},
			[
				{ kind: "opencode", builtin: false, available: true, models: [] },
				{ kind: "codex", builtin: false, available: true, models: [] },
			],
			new Set(["opencode", "codex"]),
		);
		expect(setup.runnableAgents.map((agent) => agent.strengthBand)).toEqual([3, 3]);
		expect(setup.runnableAgents.map((agent) => agent.strengths)).toEqual([["review"], []]);
		expect(setup.runnableAgents.map((agent) => agent.model)).toEqual([
			"Local/Custom Mini 3b",
			"Vendor/Unknown Frontier Max",
		]);
		expect(setup.runnableAgents.every((agent) => agent.capabilitySource === "configuration")).toBe(true);
	});
	it("persists Hermes Full access and excludes unenforced Plan execution", () => {
		const slots = {
			externalHarnessesEnabled: true,
			agents: [{ ...agent("agent1", "hermes"), model: "native-default", executionProfile: "full-access" as const }],
		};
		expect(parseCodingHarnessSlots(slots)).toEqual(slots);
		expect(normalizeCodingHarnessSlots(slots).agents[0]?.executionProfile).toBe("full-access");
		const setup = createCodingHarnessSetup(
			{ ...slots, agents: [{ ...slots.agents[0]!, role: "planner" }] },
			[{ kind: "hermes", builtin: false, available: true, models: ["native-default"] }],
			new Set(["hermes"]),
		);
		expect(setup.runnableAgents).toHaveLength(0);
		expect(setup.excludedAgents[0]?.reason).toContain("read-only Plan");
	});

	it("migrates persisted fixed slots but strictly parses dynamic RPC payloads", () => {
		expect(normalizeCodingHarnessKind(" Claude Code ")).toBe("claude-code");
		expect(normalizeCodingHarnessSlots({ agent1: "CODEX", agent2: "unknown" })).toEqual({
			externalHarnessesEnabled: false,
			agents: [agent("agent1", "codex"), { ...agent("agent2", "klerm"), role: "planner" }],
		});
		expect(normalizeCodingHarnessSlots(undefined)).toEqual({
			externalHarnessesEnabled: false,
			agents: [agent("agent1", "klerm"), { ...agent("agent2", "klerm"), role: "planner" }],
		});
		expect(
			normalizeCodingHarnessSlots({
				externalHarnessesEnabled: true,
				agents: [agent("agent1", "klerm"), agent("agent2", null, false)],
			}),
		).toEqual({
			externalHarnessesEnabled: true,
			agents: [agent("agent1", "klerm"), agent("agent2", "klerm", false)],
		});

		const slots = {
			externalHarnessesEnabled: true,
			agents: [
				{
					...agent("agent1", "claude-code"),
					model: "sonnet",
					role: "planner" as const,
					effort: "high" as const,
					tools: ["read"],
				},
				agent("agent3", "codex", false),
			],
		};
		expect(parseCodingHarnessSlots(slots)).toEqual(slots);
		expect(parseCodingHarnessSlots({ agent1: "Claude Code", agent2: null })).toBeUndefined();
		expect(parseCodingHarnessSlots({ externalHarnessesEnabled: true, agents: [] })).toBeUndefined();
		expect(parseCodingHarnessSlots({ externalHarnessesEnabled: true, agents: [agent("agent2", "klerm")] })).toEqual({
			externalHarnessesEnabled: true,
			agents: [agent("agent2", "klerm")],
		});
		expect(parseCodingHarnessSlots({ ...slots, extra: true })).toBeUndefined();
		expect(
			normalizeCodingHarnessSlots({
				externalHarnessesEnabled: true,
				agents: [agent("agent3", "codex"), agent("agent1", "klerm")],
			}),
		).toMatchObject({ agents: [{ id: "agent3" }, { id: "agent1" }] });
		expect(
			normalizeCodingHarnessSlots({
				externalHarnessesEnabled: true,
				agents: [{ ...agent("agent1", "klerm"), specialties: [" review ", "review"] }],
			}),
		).toMatchObject({ agents: [{ specialties: ["review"] }, { id: "agent2" }] });
		expect(
			parseCodingHarnessSlots({
				externalHarnessesEnabled: true,
				agents: [1, 2, 3, 4, 5].map((number) => agent(`agent${number}`, "klerm")),
			}),
		).toBeUndefined();
	});

	it("reuses the smallest available agent identifier", () => {
		expect(nextCodingHarnessAgentId([agent("agent1", "klerm"), agent("agent3", null)])).toBe("agent2");
		expect(createCodingHarnessAgent("agent2")).toEqual(agent("agent2", "klerm"));
	});

	it("retains reusable Personal Agent references while dropping legacy profile assignments", () => {
		const agents = [
			{
				...agent("agent1", "klerm"),
				model: "provider/one",
				personalBotId: "bot-scout",
				memoryProfileId: "planner",
			},
			{ ...agent("agent2", "klerm"), model: "provider/two" },
			{ ...agent("agent3", "klerm"), model: "provider/three" },
		];
		const normalizedAgents = [
			{ ...agent("agent1", "klerm"), model: "provider/one", personalBotId: "bot-scout" },
			agents[1]!,
			agents[2]!,
		];
		expect(
			normalizeCodingHarnessSlots({ externalHarnessesEnabled: true, workTogetherEnabled: true, agents }),
		).toEqual({
			externalHarnessesEnabled: true,
			workTogetherEnabled: true,
			agents: normalizedAgents,
		});
		expect(
			normalizeCodingHarnessSlots({
				externalHarnessesEnabled: true,
				workTogetherEnabled: true,
				agents: agents.slice(0, 2),
			}),
		).toEqual({ externalHarnessesEnabled: true, workTogetherEnabled: true, agents: normalizedAgents.slice(0, 2) });
		expect(
			normalizeCodingHarnessSlots({
				externalHarnessesEnabled: true,
				workTogetherEnabled: true,
				agents: [...agents.slice(0, 2), { ...agents[2], kind: "codex" }],
			}),
		).toMatchObject({ workTogetherEnabled: true });
		expect(
			parseCodingHarnessSlots({ externalHarnessesEnabled: true, workTogetherEnabled: true, agents }),
		).toBeUndefined();
		expect(
			normalizeCodingHarnessSlots({
				externalHarnessesEnabled: false,
				agents: [{ ...agent("agent1", "klerm"), personalBotId: "bot-scout", memoryProfileId: "planner" }],
			}),
		).toEqual({
			externalHarnessesEnabled: false,
			agents: [
				{ ...agent("agent1", "klerm"), personalBotId: "bot-scout" },
				{ ...agent("agent2", "klerm"), role: "planner" },
			],
		});
	});

	it("discovers builtin Klerm and probes only fixed external version commands", async () => {
		const probe = vi.fn(async (command: "pi" | "claude" | "codex" | "opencode" | "cline" | "hermes") => {
			if (command === "codex" || command === "cline") throw new Error("not installed");
			return { stdout: `${command} 2.0\n${"ignored".repeat(100)}` };
		});
		const acpScan = vi.fn(async () => undefined);
		await expect(discoverCodingHarnesses(probe, acpScan)).resolves.toEqual([
			{ kind: "klerm", available: true, builtin: true, models: [] },
			{ kind: "pi", available: true, builtin: false, models: [], version: "pi 2.0" },
			{ kind: "claude-code", available: true, builtin: false, models: [], version: "claude 2.0" },
			{ kind: "codex", available: false, builtin: false, models: [] },
			{ kind: "opencode", available: true, builtin: false, models: [], version: "opencode 2.0" },
			{ kind: "cline", available: false, builtin: false, models: [] },
			{ kind: "hermes", available: true, builtin: false, models: ["native-default"], version: "hermes 2.0" },
		]);
		expect(probe).toHaveBeenNthCalledWith(1, "pi", {
			args: ["--version"],
			timeoutMs: 2000,
			maxOutputBytes: 4096,
			shell: false,
		});
		expect(probe).toHaveBeenNthCalledWith(
			2,
			"claude",
			expect.objectContaining({ args: ["--version"], shell: false }),
		);
		expect(probe).toHaveBeenNthCalledWith(3, "codex", expect.objectContaining({ args: ["--version"], shell: false }));
		expect(probe).toHaveBeenNthCalledWith(
			4,
			"opencode",
			expect.objectContaining({ args: ["--version"], shell: false }),
		);
		expect(probe).toHaveBeenNthCalledWith(5, "cline", expect.objectContaining({ args: ["--version"], shell: false }));
	});

	it("bounds version output to the first line", async () => {
		const setup = await discoverCodingHarnesses(
			async () => ({ stdout: "x".repeat(400) }),
			async () => undefined,
		);
		expect(setup.slice(1).every((harness) => harness.version?.length === 256)).toBe(true);
	});

	it("prefers an ACP initialize handshake over the version probe", async () => {
		const probe = vi.fn(async (command: "pi" | "claude" | "codex" | "opencode" | "cline" | "hermes") => {
			if (command === "opencode") throw new Error("should not be called when ACP succeeds");
			return { stdout: `${command} 2.0` };
		});
		const acpScan = vi.fn(async (kind: string) =>
			kind === "opencode"
				? {
						command: "opencode-acp",
						protocolVersion: 1,
						agentName: "opencode",
						agentTitle: "OpenCode",
						agentVersion: "1.2.3",
						loadSession: true,
					}
				: undefined,
		);
		await expect(discoverCodingHarnesses(probe, acpScan)).resolves.toEqual([
			{ kind: "klerm", available: true, builtin: true, models: [] },
			{ kind: "pi", available: true, builtin: false, models: [], version: "pi 2.0" },
			{ kind: "claude-code", available: true, builtin: false, models: [], version: "claude 2.0" },
			{ kind: "codex", available: true, builtin: false, models: [], version: "codex 2.0" },
			{
				kind: "opencode",
				available: true,
				builtin: false,
				models: [],
				version: "1.2.3",
				acp: {
					command: "opencode-acp",
					protocolVersion: 1,
					agentName: "opencode",
					agentTitle: "OpenCode",
					agentVersion: "1.2.3",
					loadSession: true,
				},
			},
			{ kind: "cline", available: true, builtin: false, models: [], version: "cline 2.0" },
			{ kind: "hermes", available: true, builtin: false, models: ["native-default"], version: "hermes 2.0" },
		]);
	});

	it("discovers models through each harness native interface", async () => {
		const run = vi.fn(async () => ({ stdout: "openai/gpt-5\nopenai/gpt-5\nxai/grok\ninvalid model\n" }));
		await expect(discoverCodingHarnessModels("opencode", run)).resolves.toEqual(["openai/gpt-5", "xai/grok"]);
		expect(run).toHaveBeenCalledWith("opencode", ["models"], 15_000, 1_048_576);

		run.mockResolvedValueOnce({
			stdout:
				"provider   model            context  max-out  thinking  images\n" +
				"anthropic  claude-sonnet    200K     64K      yes       yes\n" +
				"openai     gpt-5            272K     128K     yes       yes\n",
		});
		await expect(discoverCodingHarnessModels("pi", run)).resolves.toEqual([
			"anthropic/claude-sonnet",
			"openai/gpt-5",
		]);
		expect(run).toHaveBeenLastCalledWith("pi", ["--list-models"], 15_000, 1_048_576);

		const codexModels = vi.fn(async () => ["gpt-5-codex", "gpt-5"]);
		await expect(discoverCodingHarnessModels("codex", run, codexModels)).resolves.toEqual(["gpt-5-codex", "gpt-5"]);
		expect(codexModels).toHaveBeenCalledOnce();
		await expect(discoverCodingHarnessModels("claude-code", run, codexModels)).resolves.toEqual([]);
	});

	it("persists the dynamic registry while preserving unrelated settings", async () => {
		const dir = await mkdtemp(join(tmpdir(), "klerm-harness-setup-"));
		tempDirs.push(dir);
		const settingsPath = join(dir, "settings.json");
		await writeFile(settingsPath, JSON.stringify({ theme: "dark", customField: { keep: true } }));
		const manager = SettingsManager.create(dir, dir);
		expect(manager.getCodingHarnessSlots()).toEqual({
			externalHarnessesEnabled: false,
			agents: [agent("agent1", "klerm"), { ...agent("agent2", "klerm"), role: "planner" }],
		});
		const slots = {
			externalHarnessesEnabled: true,
			agents: [{ ...agent("agent1", "codex"), model: "gpt-5" }, agent("agent2", "claude-code", false)],
		};
		manager.setCodingHarnessSlots(slots);
		await manager.flush();
		const persisted = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
		expect(persisted).toMatchObject({ theme: "dark", customField: { keep: true }, codingHarnessSlots: slots });
		expect(SettingsManager.create(dir, dir).getCodingHarnessSlots()).toEqual(slots);
	});

	it("derives routing from all enabled and available agents", () => {
		const harnesses = [
			{ kind: "klerm" as const, available: true, builtin: true, models: ["ollama/qwen"] },
			{ kind: "codex" as const, available: true, builtin: false, models: ["gpt-5"] },
			{ kind: "opencode" as const, available: true, builtin: false, models: ["openai/gpt-5.6-terra"] },
			{ kind: "claude-code" as const, available: false, builtin: false, models: [] },
		];
		const setup = createCodingHarnessSetup(
			{
				externalHarnessesEnabled: true,
				agents: [
					{ ...agent("agent1", "klerm"), model: "ollama/qwen" },
					{ ...agent("agent7", "codex"), model: "gpt-5" },
					{ ...agent("agent5", "opencode"), model: "openai/gpt-5.6-terra" },
				],
			},
			harnesses,
			new Set(["opencode", "codex"]),
		);
		expect(setup).toMatchObject({
			effectiveRouting: "auto",
			externalPromptingAvailable: true,
			workTogetherAvailable: true,
		});
		expect(setup.runnableAgents).toMatchObject([
			{ order: 1, agentId: "agent1", harness: "klerm", model: "ollama/qwen" },
			{ order: 2, agentId: "agent5", harness: "opencode", model: "openai/gpt-5.6-terra" },
			{ order: 3, agentId: "agent7", harness: "codex", model: "gpt-5" },
		]);
		expect(setup.runnableAgents[0]).toMatchObject({
			role: "builder",
			effort: "off",
			tools: [],
			specialties: [],
			strengthBand: expect.any(Number),
			strengths: expect.any(Array),
			limits: expect.any(Array),
			capabilitySource: "configuration",
			adapterCapabilities: expect.objectContaining({ prompt: true, abort: true, childTaskEvents: false }),
		});
		expect(
			createCodingHarnessSetup(
				{
					externalHarnessesEnabled: true,
					agents: [
						{ ...agent("agent1", "klerm"), model: "ollama/qwen" },
						{ ...agent("agent5", "claude-code"), model: "sonnet" },
					],
				},
				harnesses,
			),
		).toMatchObject({
			effectiveRouting: "none",
			excludedAgents: [{ agentId: "agent5", reason: "Agent 5 (Claude Code) is not available." }],
		});
	});
});
