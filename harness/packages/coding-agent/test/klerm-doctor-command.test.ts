import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runKlermDoctorCommand } from "../src/klerm/cli/doctor-command.ts";
import type { LocalRuntimeDiscoveryResult, LocalRuntimeProbe } from "../src/klerm/local-runtime-discovery.ts";

describe("Klerm doctor command", () => {
	let tempDir: string;
	let agentDir: string;
	let sessionsDir: string;
	let originalExitCode: typeof process.exitCode;
	const probes: LocalRuntimeProbe[] = [
		{
			providerId: "ollama",
			name: "Ollama",
			serverUrl: "http://localhost:11434",
			detect: async () => ({ models: [] }),
		},
	];
	const localResults: LocalRuntimeDiscoveryResult[] = [
		{
			providerId: "ollama",
			name: "Ollama",
			serverUrl: "http://localhost:11434",
			models: [{ id: "qwen3" }],
		},
	];

	beforeEach(() => {
		tempDir = join(tmpdir(), `klerm-doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		sessionsDir = join(agentDir, "sessions");
		mkdirSync(sessionsDir, { recursive: true });
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("reports healthy diagnostics without exposing auth values", async () => {
		writeFileSync(join(agentDir, "klerm.json"), JSON.stringify({ routing: "auto" }));
		const output: string[] = [];
		const modelRuntime = {
			getProviders: () => [{ id: "anthropic", name: "Anthropic" }],
			getProviderAuthStatus: () => ({ configured: true as const, source: "environment" as const, label: "secret" }),
		};

		await expect(
			runKlermDoctorCommand(["doctor", "--json"], {
				cwd: tempDir,
				agentDir,
				sessionsDir,
				modelRuntime,
				probes,
				discoverLocal: async () => localResults,
				getMcpServers: () => ({ echo: {} }),
				stdout: (message) => output.push(message),
			}),
		).resolves.toBe(true);

		const result = JSON.parse(output[0]);
		expect(result).toMatchObject({ status: "pass", exitCode: 0 });
		expect(result.checks).toHaveLength(8);
		expect(result.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "mcp-servers", message: "1 MCP server(s) configured" }),
			]),
		);
		expect(output[0]).not.toContain("secret");
		expect(process.exitCode).toBe(0);
	});

	it("reports disabled MCP servers without failing", async () => {
		writeFileSync(join(agentDir, "klerm.json"), JSON.stringify({ routing: "auto" }));
		const output: string[] = [];

		await runKlermDoctorCommand(["doctor"], {
			cwd: tempDir,
			agentDir,
			sessionsDir,
			modelRuntime: {
				getProviders: () => [{ id: "anthropic", name: "Anthropic" }],
				getProviderAuthStatus: () => ({ configured: true }),
			},
			probes,
			discoverLocal: async () => localResults,
			getMcpServers: () => ({ echo: {}, legacy: { enabled: false } }),
			stdout: (message) => output.push(message),
		});

		expect(output[0]).toContain("PASS mcp-servers: 1 of 2 MCP server(s) enabled (disabled: legacy)");
		expect(process.exitCode).toBe(0);
	});

	it("uses exit code 2 when only warnings are present", async () => {
		const output: string[] = [];
		await runKlermDoctorCommand(["doctor"], {
			cwd: tempDir,
			agentDir,
			sessionsDir,
			modelRuntime: { getProviders: () => [], getProviderAuthStatus: () => ({ configured: false }) },
			probes,
			discoverLocal: async () => [{ ...localResults[0], models: [], error: "offline" }],
			stdout: (message) => output.push(message),
		});

		expect(process.exitCode).toBe(2);
		expect(output[0]).toContain("WARN local-runtime");
		expect(output[0]).toContain("WARN frontier-provider");
		expect(output[0]).toContain("WARN routing");
	});

	it("uses exit code 1 for invalid configuration or decision JSONL", async () => {
		writeFileSync(join(agentDir, "klerm.json"), "{");
		mkdirSync(join(tempDir, ".klerm"));
		writeFileSync(join(tempDir, ".klerm", "router-decisions.jsonl"), "not-json\n");
		const output: string[] = [];

		await runKlermDoctorCommand(["doctor", "--json"], {
			cwd: tempDir,
			agentDir,
			sessionsDir,
			modelRuntime: { getProviders: () => [], getProviderAuthStatus: () => ({ configured: false }) },
			probes,
			discoverLocal: async () => localResults,
			stdout: (message) => output.push(message),
		});

		const result = JSON.parse(output[0]);
		expect(result.status).toBe("fail");
		expect(result.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "config", status: "fail" }),
				expect.objectContaining({ id: "decision-log", status: "fail" }),
			]),
		);
		expect(process.exitCode).toBe(1);
	});
});
