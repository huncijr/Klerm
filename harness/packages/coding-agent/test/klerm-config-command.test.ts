import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runKlermConfigCommand } from "../src/klerm/cli/config-command.ts";

describe("Klerm config commands", () => {
	let agentDir: string;
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		agentDir = join(tmpdir(), `klerm-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(agentDir, { recursive: true });
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("persists typed config values and reads them back", async () => {
		const output: string[] = [];
		await runKlermConfigCommand(["config", "set", "routing", "auto"], {
			agentDir,
			stdout: (message) => output.push(message),
		});
		await runKlermConfigCommand(["config", "set", "max-delegation-cycles", "5"], {
			agentDir,
			stdout: (message) => output.push(message),
		});
		await runKlermConfigCommand(["config", "get", "routing", "--json"], {
			agentDir,
			stdout: (message) => output.push(message),
		});

		expect(JSON.parse(readFileSync(join(agentDir, "klerm.json"), "utf8"))).toMatchObject({
			routing: "auto",
			maxDelegationCycles: 5,
		});
		expect(JSON.parse(output[2])).toEqual({ key: "routing", value: "auto" });
	});

	it("prints routing status as structured data", async () => {
		await runKlermConfigCommand(["config", "set", "local-model", "ollama/qwen3"], {
			agentDir,
			stdout: () => {},
		});
		const output: string[] = [];
		await runKlermConfigCommand(["routing", "status", "--json"], {
			agentDir,
			stdout: (message) => output.push(message),
		});

		expect(JSON.parse(output[0])).toMatchObject({ mode: "off", localModel: "ollama/qwen3", handbackEnabled: true });
	});

	it("persists and reports Agent 1/2 worker roles", async () => {
		const output: string[] = [];
		await runKlermConfigCommand(["mode", "agent", "1", "planner"], {
			agentDir,
			stdout: (message) => output.push(message),
		});
		await runKlermConfigCommand(["mode", "2", "builder", "--json"], {
			agentDir,
			stdout: (message) => output.push(message),
		});
		await runKlermConfigCommand(["mode", "--json"], {
			agentDir,
			stdout: (message) => output.push(message),
		});

		expect(JSON.parse(readFileSync(join(agentDir, "klerm.json"), "utf8"))).toMatchObject({
			localRole: "planner",
			frontierRole: "builder",
		});
		expect(output[0]).toContain("Updated Agent 1 role=planner");
		expect(JSON.parse(output[1])).toMatchObject({ agent: 2, role: "builder" });
		expect(JSON.parse(output[2])).toEqual({ agent1: "planner", agent2: "builder" });
	});

	it("keeps legacy local/frontier mode aliases", async () => {
		await runKlermConfigCommand(["mode", "local", "planner"], { agentDir, stdout: () => {} });
		await runKlermConfigCommand(["mode", "frontier", "planner"], { agentDir, stdout: () => {} });

		expect(JSON.parse(readFileSync(join(agentDir, "klerm.json"), "utf8"))).toMatchObject({
			localRole: "planner",
			frontierRole: "planner",
		});
	});

	it("rejects invalid values without modifying config", async () => {
		const errors: string[] = [];
		await runKlermConfigCommand(["config", "set", "local-max-turns", "0"], {
			agentDir,
			stderr: (message) => errors.push(message),
		});

		expect(process.exitCode).toBe(1);
		expect(errors[0]).toContain("Invalid value");
		expect(() => readFileSync(join(agentDir, "klerm.json"))).toThrow();
	});

	it("leaves bare config to the package-resources command", async () => {
		await expect(runKlermConfigCommand(["config"], { agentDir })).resolves.toBe(false);
		await expect(runKlermConfigCommand(["config", "-l"], { agentDir })).resolves.toBe(false);
		await expect(runKlermConfigCommand(["config", "--help"], { agentDir })).resolves.toBe(false);
	});
});
