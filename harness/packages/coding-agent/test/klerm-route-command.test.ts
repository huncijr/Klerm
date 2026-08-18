import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runKlermCommand } from "../src/klerm/cli/route-command.ts";
import { getKlermDecisionLogPath } from "../src/klerm/router/decision-log.ts";
import { routeWithMock } from "../src/klerm/router/mock-router.ts";

describe("Klerm route command", () => {
	let tempDir: string;
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		tempDir = join(tmpdir(), `klerm-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("creates a deterministic mock decision", () => {
		expect(routeWithMock({ task: "fix auth" }, { now: () => new Date("2026-08-18T12:00:00.000Z") })).toEqual({
			timestamp: "2026-08-18T12:00:00.000Z",
			task: "fix auth",
			selectedAgent: "coding",
			selectedModel: "mock/coding-agent",
			reason: "default mock route",
			mode: "mock",
		});
	});

	it("prints and logs the route decision", async () => {
		const output: string[] = [];

		await expect(
			runKlermCommand(["klerm", "route", "fix", "auth"], {
				cwd: tempDir,
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				stdout: (message) => output.push(message),
			}),
		).resolves.toBe(true);

		const decision = JSON.parse(output[0]);
		expect(decision).toMatchObject({ task: "fix auth", selectedAgent: "coding", mode: "mock" });
		const logLines = readFileSync(getKlermDecisionLogPath(tempDir), "utf8").trim().split("\n");
		expect(logLines).toHaveLength(1);
		expect(JSON.parse(logLines[0])).toEqual(decision);
	});

	it("ignores non-Klerm commands", async () => {
		await expect(runKlermCommand(["--help"], { cwd: tempDir })).resolves.toBe(false);
	});

	it("reports a missing task", async () => {
		const errors: string[] = [];
		await expect(
			runKlermCommand(["klerm", "route"], { cwd: tempDir, stderr: (message) => errors.push(message) }),
		).resolves.toBe(true);
		expect(process.exitCode).toBe(1);
		expect(errors[0]).toContain("requires a task");
	});
});
