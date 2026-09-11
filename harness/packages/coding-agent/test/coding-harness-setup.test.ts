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
		expect(parseCodingHarnessSlots({ ...slots, extra: true })).toBeUndefined();
	});

	it("allocates stable increasing agent identifiers", () => {
		expect(nextCodingHarnessAgentId([agent("agent1", "klerm"), agent("agent3", null)])).toBe("agent4");
		expect(createCodingHarnessAgent("agent4")).toEqual(agent("agent4", null));
	});

	it("discovers builtin Klerm and probes only fixed external version commands", async () => {
		const probe = vi.fn(async (command: "pi" | "claude" | "codex" | "opencode" | "cline") => {
			if (command === "codex" || command === "cline") throw new Error("not installed");
			return { stdout: `${command} 2.0\n${"ignored".repeat(100)}` };
		});
		await expect(discoverCodingHarnesses(probe)).resolves.toEqual([
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
		const setup = await discoverCodingHarnesses(async () => ({ stdout: "x".repeat(400) }));
		expect(setup.slice(1).every((harness) => harness.version?.length === 256)).toBe(true);
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
			{ kind: "codex" as const, available: true, builtin: false, models: [] },
			{ kind: "claude-code" as const, available: false, builtin: false, models: [] },
		];
		expect(
			createCodingHarnessSetup(
				{ externalHarnessesEnabled: true, agents: [agent("agent1", "klerm"), agent("agent2", "codex")] },
				harnesses,
			),
		).toMatchObject({ effectiveRouting: "auto", externalPromptingAvailable: false });
		expect(
			createCodingHarnessSetup(
				{ externalHarnessesEnabled: true, agents: [agent("agent1", "klerm"), agent("agent2", "codex", false)] },
				harnesses,
			),
		).toMatchObject({ effectiveRouting: "none" });
	});
});
