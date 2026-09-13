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
	it("migrates persisted fixed slots but strictly parses dynamic RPC payloads", () => {
		expect(normalizeCodingHarnessKind(" Claude Code ")).toBe("claude-code");
		expect(normalizeCodingHarnessSlots({ agent1: "CODEX", agent2: "unknown" })).toEqual({
			externalHarnessesEnabled: false,
			agents: [agent("agent1", "codex")],
		});
		expect(normalizeCodingHarnessSlots(undefined)).toEqual({
			externalHarnessesEnabled: false,
			agents: [agent("agent1", "klerm")],
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

	it("enables Work together only for three enabled modeled agents and preserves memory assignments", () => {
		const agents = [
			{ ...agent("agent1", "klerm"), model: "provider/one", memoryProfileId: "planner" },
			{ ...agent("agent2", "klerm"), model: "provider/two" },
			{ ...agent("agent3", "klerm"), model: "provider/three" },
		];
		expect(
			normalizeCodingHarnessSlots({ externalHarnessesEnabled: true, workTogetherEnabled: true, agents }),
		).toEqual({
			externalHarnessesEnabled: true,
			workTogetherEnabled: true,
			agents,
		});
		expect(
			normalizeCodingHarnessSlots({
				externalHarnessesEnabled: true,
				workTogetherEnabled: true,
				agents: agents.slice(0, 2),
			}),
		).toEqual({ externalHarnessesEnabled: true, agents: agents.slice(0, 2) });
		expect(
			normalizeCodingHarnessSlots({
				externalHarnessesEnabled: true,
				workTogetherEnabled: true,
				agents: [...agents.slice(0, 2), { ...agents[2], kind: "codex" }],
			}),
		).toMatchObject({ workTogetherEnabled: true });
		expect(parseCodingHarnessSlots({ externalHarnessesEnabled: true, workTogetherEnabled: true, agents })).toEqual({
			externalHarnessesEnabled: true,
			workTogetherEnabled: true,
			agents,
		});
	});

	it("discovers builtin Klerm and probes only fixed external version commands", async () => {
		const probe = vi.fn(async (command: "pi" | "claude" | "codex" | "opencode" | "cline") => {
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
		const probe = vi.fn(async (command: "pi" | "claude" | "codex" | "opencode" | "cline") => {
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
			agents: [agent("agent1", "klerm")],
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
		expect(setup.runnableAgents).toEqual([
			{ order: 1, agentId: "agent5", harness: "opencode", model: "openai/gpt-5.6-terra" },
			{ order: 2, agentId: "agent1", harness: "klerm", model: "ollama/qwen" },
			{ order: 3, agentId: "agent7", harness: "codex", model: "gpt-5" },
		]);
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
		).toMatchObject({ effectiveRouting: "none", blockingReason: "Agent 5 (Claude Code) is not available." });
	});
});
