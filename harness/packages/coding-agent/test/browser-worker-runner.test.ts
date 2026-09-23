import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type BrowserWorkerEvent,
	BrowserWorkerRunner,
	getBrowserWorkerAvailability,
} from "../src/klerm/browser-worker-runner.ts";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fakeWorker(mode: string): Promise<{
	directory: string;
	env: NodeJS.ProcessEnv;
	capturePath: string;
	sentinelPath: string;
}> {
	const directory = await mkdtemp(join(tmpdir(), "klerm-browser-runner-"));
	tempDirectories.push(directory);
	const scriptPath = join(directory, "fake-worker.mjs");
	const capturePath = join(directory, "capture.json");
	const sentinelPath = join(directory, "descendant-finished");
	await writeFile(
		scriptPath,
		`import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const [mode, capturePath, sentinelPath, literalArgument] = process.argv.slice(2);
writeFileSync(capturePath, JSON.stringify({ env: process.env, literalArgument }));
let sequence = 0;
let run;
const emit = (event, status, fields = {}) => {
  sequence += 1;
  process.stdout.write(JSON.stringify({
    version: 1,
    sequence,
    event,
    status,
    timestamp: "2026-09-23T10:00:00.000Z",
    ...fields,
  }) + "\\n");
};
const runFields = () => ({
  run_id: run.run_id,
  task_id: run.task_id,
  correlation_id: run.correlation_id,
  agent_id: run.agent_id,
});

if (mode === "stderr-exit") {
  process.stderr.write("token=stderr-secret task body must not escape\\n");
  process.exit(2);
}

emit("ready", "ready", { protocol_version: 1, worker_version: "fake-1.0.0" });
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const command = JSON.parse(line);
  appendFileSync(capturePath + ".commands", JSON.stringify(command) + "\\n");
  if (command.command === "start") {
    run = command;
    if (mode === "malformed") {
      process.stdout.write("{not-json}\\n");
      return;
    }
    if (mode === "oversized") {
      process.stdout.write("x".repeat(300) + "\\n");
      return;
    }
    if (mode === "out-of-order") {
      sequence += 1;
    }
    emit("command_accepted", "accepted", {
      request_id: command.request_id,
      command: "start",
      ...runFields(),
    });
    if (mode === "timeout") {
      spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'leaked'), 500)", sentinelPath]);
      return;
    }
    emit("run_started", "running", runFields());
	if (mode === "crash-after-start") {
		setImmediate(() => process.exit(3));
		return;
	}
    emit("origin_approval_required", "paused", {
      ...runFields(),
      origin: "https://docs.example.com",
      choices: ["allow_once", "current_run"],
    });
    return;
  }
  if (command.command === "approve_origin") {
    emit("origin_approved", "accepted", {
      request_id: command.request_id,
      ...runFields(),
      origin: command.origin,
      scope: command.scope,
    });
    return;
  }
  if (command.command === "stop") {
    if (mode === "timeout") return;
    emit("command_accepted", "accepted", {
      request_id: command.request_id,
      command: "stop",
      ...runFields(),
    });
    emit("run_stopped", "stopped", runFields());
    return;
  }
  if (command.command === "shutdown") {
    emit("shutdown", "completed", { request_id: command.request_id });
    setImmediate(() => process.exit(0));
  }
});
`,
		"utf8",
	);
	return {
		directory,
		capturePath,
		sentinelPath,
		env: {
			...process.env,
			KLERM_BROWSER_WORKER_COMMAND: JSON.stringify([
				process.execPath,
				scriptPath,
				mode,
				capturePath,
				sentinelPath,
				"literal;not-a-shell-command",
			]),
			KLERM_TEST_SECRET: "must-not-reach-worker",
			XAUTHORITY: "/tmp/klerm-test-xauthority",
			XDG_SESSION_TYPE: "wayland",
		},
	};
}

function startRequest() {
	return {
		runId: "run-1",
		taskId: "task-1",
		correlationId: "correlation-1",
		agentId: "agent-1",
		prompt: "Read the public documentation.",
		model: "local-model",
		startUrl: "https://example.com/docs",
		baseUrl: "http://127.0.0.1:8080/v1",
		token: "local-token",
		allowedOrigins: ["https://example.com"],
		maxSteps: 10,
	} as const;
}

describe("BrowserWorkerRunner", () => {
	it("reports handshake availability and sends a single typed run without a shell", async () => {
		const fake = await fakeWorker("normal");
		const runner = new BrowserWorkerRunner({ env: fake.env });
		const events: BrowserWorkerEvent[] = [];
		runner.subscribe((event) => events.push(event));

		await expect(runner.availability()).resolves.toEqual({
			available: true,
			runtime: "configured browser worker",
			version: "fake-1.0.0",
		});
		await runner.start(startRequest());
		await runner.approve({
			approvalId: "approval-1",
			runId: "run-1",
			decision: "approved",
			decidedBy: "user",
			origin: "https://docs.example.com",
			scope: "current_run",
		});
		await runner.stop("run-1");
		await expect(runner.start({ ...startRequest(), runId: "run-2" })).rejects.toThrow("only one run");
		await runner.shutdown();

		expect(events.map((event) => event.event)).toEqual([
			"ready",
			"command_accepted",
			"run_started",
			"origin_approval_required",
			"origin_approved",
			"command_accepted",
			"run_stopped",
			"shutdown",
		]);
		const capture = JSON.parse(await readFile(fake.capturePath, "utf8")) as {
			env: Record<string, string>;
			literalArgument: string;
		};
		expect(capture.literalArgument).toBe("literal;not-a-shell-command");
		expect(capture.env.KLERM_TEST_SECRET).toBeUndefined();
		expect(capture.env.BROWSER_USE_TELEMETRY).toBe("false");
		expect(capture.env.XAUTHORITY).toBe("/tmp/klerm-test-xauthority");
		expect(capture.env.XDG_SESSION_TYPE).toBe("wayland");
		const commands = (await readFile(`${fake.capturePath}.commands`, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(commands.map((command) => command.command)).toEqual(["start", "approve_origin", "stop", "shutdown"]);
		expect(commands[0]).toMatchObject({
			run_id: "run-1",
			task_id: "task-1",
			correlation_id: "correlation-1",
			agent_id: "agent-1",
			task: "Begin at this validated public URL: https://example.com/docs\n\nRequested task:\nRead the public documentation.",
			max_steps: 10,
		});
	});

	it.each(["malformed", "oversized", "out-of-order"])("rejects %s stdout", async (mode) => {
		const fake = await fakeWorker(mode);
		const runner = new BrowserWorkerRunner({ env: fake.env, maxLineBytes: 256, stopTimeoutMs: 100 });
		const events: BrowserWorkerEvent[] = [];
		runner.subscribe((event) => events.push(event));

		await expect(runner.start(startRequest())).rejects.toThrow("invalid protocol output");
		expect(events.map((event) => event.event)).toEqual(["ready"]);
	});

	it("does not expose ignored stderr in availability failures", async () => {
		const fake = await fakeWorker("stderr-exit");
		const availability = await getBrowserWorkerAvailability({ env: fake.env, startupTimeoutMs: 500 });

		expect(availability).toMatchObject({ available: false, runtime: "browser worker" });
		expect(availability.available && availability.runtime).not.toContain("stderr-secret");
		if (!availability.available) expect(availability.reason).not.toContain("stderr-secret");
	});

	it("reports a sanitized failure when the process exits after start", async () => {
		const fake = await fakeWorker("crash-after-start");
		const runner = new BrowserWorkerRunner({ env: fake.env });
		const failure = new Promise<{ reason: string; message: string }>((resolve) => {
			runner.subscribeFailure(resolve);
		});

		await runner.start(startRequest());
		await expect(failure).resolves.toEqual({
			reason: "process-exited",
			message: "The browser worker process exited unexpectedly.",
		});
	});

	it.skipIf(process.platform === "win32")("kills the detached process group when stop times out", async () => {
		const fake = await fakeWorker("timeout");
		const runner = new BrowserWorkerRunner({ env: fake.env, stopTimeoutMs: 50 });
		await runner.start(startRequest());

		await expect(runner.stop("run-1")).rejects.toThrow("stop timed out");
		await new Promise((resolve) => setTimeout(resolve, 650));
		await expect(readFile(fake.sentinelPath, "utf8")).rejects.toThrow();
	});
});
