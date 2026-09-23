import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
	BrowserApprovalDecision,
	BrowserApprovalRequest,
	BrowserAvailability,
	BrowserRunRequest,
} from "../src/klerm/browser-agent.ts";
import {
	appendBrowserEvent,
	BROWSER_REDACTED_VALUE,
	BrowserEventSequencer,
	getBrowserLogPath,
	redactBrowserSecrets,
	redactBrowserSecretText,
	validateBrowserOrigin,
	validateBrowserUrl,
} from "../src/klerm/browser-agent.ts";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("browser agent protocol and security", () => {
	it("defines adapter-neutral availability, run, and approval contracts", () => {
		const availability: BrowserAvailability = { available: true, runtime: "browser-use", version: "1.0.0" };
		const run: BrowserRunRequest = {
			runId: "run-1",
			agentId: "browser-agent",
			prompt: "Compare the public documentation.",
			startUrl: "https://docs.example.com/start",
			allowedOrigins: ["https://docs.example.com"],
		};
		const approval: BrowserApprovalRequest = {
			approvalId: "approval-1",
			runId: run.runId,
			kind: "form-submission",
			title: "Submit this form?",
			message: "The browser is ready to submit public fields.",
		};
		const decision: BrowserApprovalDecision = {
			approvalId: approval.approvalId,
			runId: run.runId,
			decision: "approved",
			decidedBy: "user",
		};

		expect(availability.available).toBe(true);
		expect(decision).toMatchObject({ approvalId: "approval-1", decision: "approved" });
	});

	it("allows public HTTP origins and enforces an explicit origin allowlist", () => {
		expect(validateBrowserOrigin("https://EXAMPLE.com:443")).toEqual({
			allowed: true,
			origin: "https://example.com",
		});
		expect(
			validateBrowserUrl("https://example.com/docs?q=one", { allowedOrigins: ["https://example.com"] }),
		).toMatchObject({ allowed: true, origin: "https://example.com" });
		expect(
			validateBrowserUrl("https://other.example/docs", { allowedOrigins: ["https://example.com"] }),
		).toMatchObject({ allowed: false, code: "origin-not-allowed" });
		expect(validateBrowserOrigin("https://example.com/not-an-origin")).toMatchObject({
			allowed: false,
			code: "invalid-origin",
		});
	});

	it.each([
		["http://localhost", "blocked-host"],
		["http://api.localhost./health", "blocked-host"],
		["http://service.internal", "blocked-host"],
		["http://metadata.google.internal/computeMetadata/v1", "blocked-host"],
		["http://169.254.169.254/latest/meta-data", "blocked-ip"],
		["http://10.0.0.1", "blocked-ip"],
		["https://8.8.8.8", "blocked-ip"],
		["http://2130706433", "blocked-ip"],
		["http://[::1]", "blocked-ip"],
		["file:///etc/passwd", "unsupported-protocol"],
		["https://user:password@example.com", "embedded-credentials"],
	])("blocks unsafe browser URL %s", (url, code) => {
		expect(validateBrowserUrl(url)).toMatchObject({ allowed: false, code });
	});

	it("rejects malformed origin policy instead of silently widening access", () => {
		expect(
			validateBrowserUrl("https://example.com", { allowedOrigins: ["https://user:secret@example.com"] }),
		).toMatchObject({ allowed: false, code: "invalid-origin-policy" });
	});

	it("redacts credentials in text and nested event details without mutating input", () => {
		const input = {
			headers: { Authorization: "Bearer top-secret", "X-Api-Key": "secret-key" },
			url: "https://user:pass@example.com/path?token=query-secret&view=public",
			nested: { password: "password-secret", note: "Authorization: Basic abc123" },
		};
		const redacted = redactBrowserSecrets(input);
		const serialized = JSON.stringify(redacted);

		expect(serialized).not.toContain("top-secret");
		expect(serialized).not.toContain("secret-key");
		expect(serialized).not.toContain("query-secret");
		expect(serialized).not.toContain("password-secret");
		expect(serialized).not.toContain("abc123");
		expect(serialized).toContain(BROWSER_REDACTED_VALUE);
		expect(input.headers.Authorization).toBe("Bearer top-secret");
		expect(redactBrowserSecretText("token=abc; safe text")).toBe(`token=${BROWSER_REDACTED_VALUE}; safe text`);
	});

	it("builds deterministic ordered events and redacts before returning them", () => {
		const timestamps = ["2026-09-23T10:00:00.000Z", "2026-09-23T10:00:01.000Z"];
		const sequencer = new BrowserEventSequencer({
			initialSequence: 4,
			now: () => timestamps.shift() ?? "unexpected",
		});
		const first = sequencer.next({
			event: "RUN_STARTED",
			runId: "run-1",
			status: "running",
			details: { apiKey: "do-not-log" },
		});
		const second = sequencer.next({ event: "RUN_COMPLETED", runId: "run-1", status: "completed" });

		expect(first).toEqual({
			version: 1,
			timestamp: "2026-09-23T10:00:00.000Z",
			sequence: 5,
			event: "RUN_STARTED",
			runId: "run-1",
			status: "running",
			details: { apiKey: BROWSER_REDACTED_VALUE },
		});
		expect(second.sequence).toBe(6);
		expect(sequencer.currentSequence()).toBe(6);
	});

	it("appends credential-safe browser events to the project JSONL log", async () => {
		const directory = await mkdtemp(join(tmpdir(), "klerm-browser-agent-"));
		tempDirs.push(directory);
		const sequencer = new BrowserEventSequencer({ now: () => "2026-09-23T10:00:00.000Z" });
		const event = sequencer.next({
			event: "ACTION",
			runId: "run-1",
			details: { cookie: "session=secret" },
		});

		await appendBrowserEvent(directory, event);
		expect(getBrowserLogPath(directory)).toBe(join(directory, ".klerm", "browser-events.jsonl"));
		const log = await readFile(getBrowserLogPath(directory), "utf8");
		expect(log).toBe(`${JSON.stringify(event)}\n`);
		expect(log).not.toContain("session=secret");
	});
});
