import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runKlermDebugCommand } from "../src/klerm/cli/route-command.ts";
import { getKlermDecisionLogPath } from "../src/klerm/router/decision-log.ts";
import { routeWithMock } from "../src/klerm/router/mock-router.ts";

describe("Klerm debug command", () => {
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
			taskId: "task-1f52bc88f803873c",
			event: "INITIAL_ROUTE",
			task: "fix auth",
			route: "SELF",
			selectedTarget: "mock/coding-agent",
			reason: "default mock route",
			registryProfileHash: "376cd46d34f56775bee31c8040bfad7e5eb23b9f52098aa964009cbdc6abed15",
			mode: "mock",
		});
	});

	it("prints and logs the route decision", async () => {
		const output: string[] = [];

		await expect(
			runKlermDebugCommand(["debug", "route", "fix", "auth"], {
				cwd: tempDir,
				now: () => new Date("2026-08-18T12:00:00.000Z"),
				stdout: (message) => output.push(message),
			}),
		).resolves.toBe(true);

		const decision = JSON.parse(output[0]);
		expect(decision).toMatchObject({
			task: "fix auth",
			route: "SELF",
			selectedTarget: "mock/coding-agent",
			mode: "mock",
		});
		const logLines = readFileSync(getKlermDecisionLogPath(tempDir), "utf8").trim().split("\n");
		expect(logLines).toHaveLength(1);
		expect(JSON.parse(logLines[0])).toEqual(decision);
	});

	it("prints route decisions", async () => {
		const output: string[] = [];
		await runKlermDebugCommand(["debug", "route", "fix", "auth"], {
			cwd: tempDir,
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			stdout: () => {},
		});

		await expect(
			runKlermDebugCommand(["debug", "decisions"], { cwd: tempDir, stdout: (message) => output.push(message) }),
		).resolves.toBe(true);
		expect(output).toHaveLength(1);
		expect(JSON.parse(output[0])).toMatchObject({ task: "fix auth", route: "SELF" });
	});

	it("reports when no route decisions exist", async () => {
		const output: string[] = [];
		await expect(
			runKlermDebugCommand(["debug", "decisions"], { cwd: tempDir, stdout: (message) => output.push(message) }),
		).resolves.toBe(true);
		expect(output[0]).toContain("No Klerm route decisions found");
	});

	it("filters and limits route decisions", async () => {
		await runKlermDebugCommand(["debug", "route", "first"], {
			cwd: tempDir,
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			stdout: () => {},
		});
		await runKlermDebugCommand(["debug", "route", "second"], {
			cwd: tempDir,
			now: () => new Date("2026-08-19T12:00:00.000Z"),
			stdout: () => {},
		});
		const output: string[] = [];

		await runKlermDebugCommand(["debug", "decisions", "--since", "2026-08-19", "--route", "self", "--limit", "1"], {
			cwd: tempDir,
			stdout: (message) => output.push(message),
		});

		expect(output).toHaveLength(1);
		expect(JSON.parse(output[0])).toMatchObject({ task: "second", route: "SELF" });
	});

	it("summarizes filtered route decisions", async () => {
		await runKlermDebugCommand(["debug", "route", "fix auth"], {
			cwd: tempDir,
			now: () => new Date("2026-08-18T12:00:00.000Z"),
			stdout: () => {},
		});
		const output: string[] = [];

		await runKlermDebugCommand(["debug", "decisions", "--event", "INITIAL_ROUTE", "--summary"], {
			cwd: tempDir,
			stdout: (message) => output.push(message),
		});

		expect(JSON.parse(output[0])).toEqual({
			total: 1,
			firstTimestamp: "2026-08-18T12:00:00.000Z",
			lastTimestamp: "2026-08-18T12:00:00.000Z",
			events: { INITIAL_ROUTE: 1 },
			routes: { SELF: 1 },
			totalTokens: 0,
			totalCostUsd: 0,
		});
	});

	it("rejects invalid decision filters", async () => {
		const errors: string[] = [];
		await runKlermDebugCommand(["debug", "decisions", "--limit", "zero"], {
			cwd: tempDir,
			stderr: (message) => errors.push(message),
		});

		expect(process.exitCode).toBe(1);
		expect(errors[0]).toContain("positive integer");
	});

	it("ignores non-Klerm commands", async () => {
		await expect(runKlermDebugCommand(["--help"], { cwd: tempDir })).resolves.toBe(false);
	});

	it("reports a missing task", async () => {
		const errors: string[] = [];
		await expect(
			runKlermDebugCommand(["debug", "route"], { cwd: tempDir, stderr: (message) => errors.push(message) }),
		).resolves.toBe(true);
		expect(process.exitCode).toBe(1);
		expect(errors[0]).toContain("requires a task");
	});
});
