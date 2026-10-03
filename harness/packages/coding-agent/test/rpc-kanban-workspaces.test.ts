import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import type { KanbanTask, KanbanTaskKind } from "../src/klerm/kanban.ts";
import * as evidence from "../src/klerm/kanban-evidence.ts";
import type { KanbanRunEvent } from "../src/klerm/kanban-runs.ts";
import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const io = vi.hoisted(() => ({
	output: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));
vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		io.output.push(line);
	},
}));
vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));
vi.mock("../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, handler: (line: string) => void) => {
		io.lineHandler = handler;
		return () => {
			io.lineHandler = undefined;
		};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

async function send(command: Record<string, unknown>): Promise<Record<string, unknown>> {
	io.lineHandler?.(JSON.stringify(command));
	let response: Record<string, unknown> | undefined;
	await vi.waitFor(
		() => {
			response = io.output
				.flatMap((line) => line.trim().split("\n"))
				.map((line) => JSON.parse(line) as Record<string, unknown>)
				.find((event) => event.type === "response" && event.id === command.id);
			expect(response).toBeDefined();
		},
		{ timeout: 5000 },
	);
	return response!;
}

describe("Kanban workspace reservations through RPC", () => {
	let harness: Harness;
	let workspace: string;
	let scheduler: () => void;
	let modelCalls: number;
	let unblock: () => void;
	let stdinListeners: Array<Parameters<typeof process.on>[1]>;
	let signalListeners: Map<NodeJS.Signals, Array<Parameters<typeof process.on>[1]>>;
	const timers: NodeJS.Timeout[] = [];

	function task(id: string, kind: KanbanTaskKind = "build", root = workspace): KanbanTask {
		return {
			id,
			title: id,
			prompt: "Create code and check it.",
			workspaceRoot: root,
			kind,
			reasoning: "off",
			status: "ready",
			createdAt: "2026-10-03T00:00:00Z",
			updatedAt: "2026-10-03T00:00:00Z",
			createdSequence: 1,
		};
	}
	function tasks(): KanbanTask[] {
		return harness.settingsManager.getKanbanRegistry().boards[0]!.tasks;
	}
	function logs(): KanbanRunEvent[] {
		return readFileSync(join(harness.tempDir, ".klerm", "kanban-runs.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as KanbanRunEvent);
	}
	function holdModel(): void {
		harness.setResponses([
			async (_context, options) => {
				modelCalls += 1;
				await new Promise<void>((resolve) => {
					unblock = resolve;
					if (options?.signal?.aborted) resolve();
					else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return fauxAssistantMessage("Finished.");
			},
		]);
	}
	beforeEach(async () => {
		io.output = [];
		io.lineHandler = undefined;
		modelCalls = 0;
		unblock = () => {};
		stdinListeners = process.stdin.listeners("end") as typeof stdinListeners;
		signalListeners = new Map(
			(["SIGTERM", "SIGHUP"] as const).map((signal) => [signal, process.listeners(signal) as typeof stdinListeners]),
		);
		const realInterval = globalThis.setInterval;
		vi.spyOn(globalThis, "setInterval").mockImplementation((callback, ms, ...args) => {
			if (ms === 20_000) scheduler = callback as () => void;
			const timer = realInterval(() => {}, ms, ...args);
			timer.unref();
			timers.push(timer);
			return timer;
		});
		harness = await createHarness();
		workspace = join(harness.tempDir, "workspace");
		mkdirSync(workspace);
		(harness.sessionManager as unknown as { cwd: string }).cwd = harness.tempDir;
		harness.settingsManager.setKanbanRegistry({
			version: 1,
			boards: [
				{
					id: "board",
					name: "Board",
					workspaceRoot: harness.tempDir,
					createdAt: "now",
					updatedAt: "now",
					createdSequence: 1,
					tasks: [task("first"), task("second")],
				},
			],
		});
		const runtime = {
			session: harness.session,
			newSession: vi.fn(async () => ({ cancelled: true })),
			switchSession: vi.fn(async () => ({ cancelled: true })),
			fork: vi.fn(),
			dispose: vi.fn(async () => {}),
			setRebindSession: vi.fn(),
		} as unknown as AgentSessionRuntime;
		void runRpcMode(runtime, {
			personalBotStorageDir: join(harness.tempDir, ".klerm", "agent"),
			discoverCodingHarnesses: async () => [],
		});
		await vi.waitFor(() => expect(io.lineHandler).toBeDefined());
	});
	afterEach(async () => {
		unblock();
		if (io.lineHandler) await send({ id: "cleanup", type: "new_session" });
		vi.restoreAllMocks();
		for (const timer of timers.splice(0)) clearInterval(timer);
		for (const listener of process.stdin.listeners("end") as typeof stdinListeners)
			if (!stdinListeners.includes(listener)) process.stdin.off("end", listener);
		for (const [signal, previous] of signalListeners)
			for (const listener of process.listeners(signal) as typeof stdinListeners)
				if (!previous.includes(listener)) process.off(signal, listener);
		harness.cleanup();
	});

	it("rejects conflicting work before model execution and admits it after Stop drains the first run", async () => {
		holdModel();
		expect(await send({ id: "first", type: "run_kanban_task", boardId: "board", taskId: "first" })).toMatchObject({
			success: true,
		});
		await vi.waitFor(() => expect(modelCalls).toBe(1));
		expect(await send({ id: "busy", type: "run_kanban_task", boardId: "board", taskId: "second" })).toMatchObject({
			success: false,
			code: "KANBAN_WORKSPACE_BUSY",
		});
		expect(tasks()[1]).not.toHaveProperty("attempts");
		expect(tasks()[1]).not.toHaveProperty("runCount");
		expect(modelCalls).toBe(1);
		expect(logs()).toContainEqual(
			expect.objectContaining({
				event: "RUN_BLOCKED",
				taskId: "second",
				blockedBy: expect.objectContaining({ taskId: "first" }),
			}),
		);
		expect(await send({ id: "stop", type: "stop_kanban_task", boardId: "board", taskId: "first" })).toMatchObject({
			success: true,
		});
		expect(tasks()[0]?.runStatus).toBe("stopped");
		expect(
			logs()
				.filter((event) => event.taskId === "first")
				.at(-1)?.event,
		).toBe("WORKSPACE_RELEASED");
		harness.setResponses([fauxAssistantMessage("Analysis complete.")]);
		const registry = harness.settingsManager.getKanbanRegistry();
		registry.boards[0]!.tasks[1]!.kind = "review";
		harness.settingsManager.setKanbanRegistry(registry);
		expect(await send({ id: "retry", type: "run_kanban_task", boardId: "board", taskId: "second" })).toMatchObject({
			success: true,
		});
		await vi.waitFor(() => expect(tasks()[1]?.runStatus).toBe("succeeded"));
	});

	it("holds the reservation through the final evidence snapshot", async () => {
		const capture = evidence.captureKanbanFolder;
		let snapshots = 0;
		let finalSnapshot = false;
		const gate = new Promise<void>((resolve) => {
			unblock = resolve;
		});
		vi.spyOn(evidence, "captureKanbanFolder").mockImplementation(async (cwd) => {
			if (++snapshots === 2) {
				finalSnapshot = true;
				await gate;
			}
			return capture(cwd);
		});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "app.js", content: "console.log(1);" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxToolCall("bash", { command: "node --check app.js" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("Written and checked."),
		]);
		expect(await send({ id: "write", type: "run_kanban_task", boardId: "board", taskId: "first" })).toMatchObject({
			success: true,
		});
		await vi.waitFor(() => expect(finalSnapshot).toBe(true));
		expect(
			await send({ id: "during-settlement", type: "run_kanban_task", boardId: "board", taskId: "second" }),
		).toMatchObject({ success: false, code: "KANBAN_WORKSPACE_BUSY" });
		unblock();
		await vi.waitFor(() =>
			expect(logs()).toContainEqual(expect.objectContaining({ event: "WORKSPACE_RELEASED", taskId: "first" })),
		);
		expect(tasks()[0]?.runStatus).toBe("succeeded");
	});

	it("cleans up a failed startup and lets the next card use its folder", async () => {
		vi.spyOn(evidence, "captureKanbanFolder").mockRejectedValueOnce(new Error("Snapshot unavailable."));
		expect(await send({ id: "bad-start", type: "run_kanban_task", boardId: "board", taskId: "first" })).toMatchObject(
			{ success: false },
		);
		expect(tasks()[0]).not.toHaveProperty("attempts");
		expect(logs().map((event) => event.event)).toEqual(["WORKSPACE_RESERVED", "RUN_BLOCKED", "WORKSPACE_RELEASED"]);
		harness.setResponses([fauxAssistantMessage("No code changes.")]);
		expect(
			await send({ id: "after-failure", type: "run_kanban_task", boardId: "board", taskId: "second" }),
		).toMatchObject({ success: true });
	});

	it("allows concurrent read-only work but blocks a writer until the readers drain", async () => {
		const registry = harness.settingsManager.getKanbanRegistry();
		registry.boards[0]!.tasks[0]!.kind = "review";
		registry.boards[0]!.tasks[1]!.kind = "research";
		registry.boards[0]!.tasks.push(task("writer"));
		harness.settingsManager.setKanbanRegistry(registry);
		holdModel();
		expect(await send({ id: "reader1", type: "run_kanban_task", boardId: "board", taskId: "first" })).toMatchObject({
			success: true,
		});
		await vi.waitFor(() => expect(modelCalls).toBe(1));
		harness.appendResponses([fauxAssistantMessage("Research complete.")]);
		expect(await send({ id: "reader2", type: "run_kanban_task", boardId: "board", taskId: "second" })).toMatchObject({
			success: true,
		});
		await vi.waitFor(() => expect(tasks()[1]?.runStatus).toBe("succeeded"));
		expect(tasks()[0]?.runStatus).toBe("running");
		expect(
			await send({ id: "blocked-writer", type: "run_kanban_task", boardId: "board", taskId: "writer" }),
		).toMatchObject({ success: false, code: "KANBAN_WORKSPACE_BUSY" });
	});

	it("protects a scheduled startup from duplicate starts, edits and deletion, and cancels it before a model call", async () => {
		const capture = evidence.captureKanbanFolder;
		let capturing = false;
		const gate = new Promise<void>((resolve) => {
			unblock = resolve;
		});
		vi.spyOn(evidence, "captureKanbanFolder").mockImplementationOnce(async (cwd) => {
			capturing = true;
			await gate;
			return capture(cwd);
		});
		const registry = harness.settingsManager.getKanbanRegistry();
		registry.boards[0]!.tasks[0]!.scheduledAt = "2026-01-01T00:00:00Z";
		harness.settingsManager.setKanbanRegistry(registry);
		scheduler();
		await vi.waitFor(() => expect(capturing).toBe(true));
		expect(
			await send({ id: "duplicate-start", type: "run_kanban_task", boardId: "board", taskId: "first" }),
		).toMatchObject({ success: false, error: expect.stringContaining("already starting") });
		expect(await send({ id: "delete-starting", type: "delete_kanban_board", boardId: "board" })).toMatchObject({
			success: false,
		});
		const edited = harness.settingsManager.getKanbanRegistry();
		edited.boards[0]!.tasks[0]!.prompt = "Replace the pending brief";
		expect(await send({ id: "edit-starting", type: "set_kanban_registry", registry: edited })).toMatchObject({
			success: false,
		});
		const stop = send({ id: "stop-starting", type: "stop_kanban_task", boardId: "board", taskId: "first" });
		await Promise.resolve();
		await Promise.resolve();
		unblock();
		expect(await stop).toMatchObject({ success: true });
		expect(harness.faux.state.callCount).toBe(0);
		expect(tasks()[0]).not.toHaveProperty("attempts");
		await vi.waitFor(() =>
			expect(logs()).toContainEqual(expect.objectContaining({ event: "WORKSPACE_RELEASED", taskId: "first" })),
		);
	});

	it("does not starve an independent scheduled folder behind three blocked cards", async () => {
		holdModel();
		expect(
			await send({ id: "busy-writer", type: "run_kanban_task", boardId: "board", taskId: "first" }),
		).toMatchObject({ success: true });
		await vi.waitFor(() => expect(modelCalls).toBe(1));
		const independent = join(harness.tempDir, "independent");
		const registry = harness.settingsManager.getKanbanRegistry();
		mkdirSync(independent);
		registry.boards[0]!.tasks.push(
			...["blocked1", "blocked2", "blocked3"].map((id) => ({ ...task(id), scheduledAt: "2026-01-01T00:00:00Z" })),
			{ ...task("independent", "review", independent), scheduledAt: "2026-01-01T00:00:00Z" },
		);
		harness.settingsManager.setKanbanRegistry(registry);
		harness.appendResponses([fauxAssistantMessage("Independent analysis complete.")]);
		scheduler();
		await vi.waitFor(() => expect(tasks().find((item) => item.id === "independent")?.runStatus).toBe("succeeded"));
		expect(tasks().find((item) => item.id === "blocked1")?.scheduledAt).toBe("2026-01-01T00:00:00Z");
	});

	it("settles a recorded attempt stopped during session setup without calling the model", async () => {
		let loading = false;
		const gate = new Promise<void>((resolve) => {
			unblock = resolve;
		});
		vi.spyOn(DefaultResourceLoader.prototype, "reload").mockImplementationOnce(async () => {
			loading = true;
			await gate;
		});
		const registry = harness.settingsManager.getKanbanRegistry();
		registry.boards[0]!.tasks[0]!.scheduledAt = "2026-01-01T00:00:00Z";
		harness.settingsManager.setKanbanRegistry(registry);
		scheduler();
		await vi.waitFor(() => expect(loading).toBe(true));
		expect(tasks()[0]?.runStatus).toBe("running");
		const stop = send({ id: "stop-loading", type: "stop_kanban_task", boardId: "board", taskId: "first" });
		await Promise.resolve();
		await Promise.resolve();
		unblock();
		expect(await stop).toMatchObject({ success: true });
		expect(harness.faux.state.callCount).toBe(0);
		expect(tasks()[0]).toMatchObject({
			runCount: 1,
			runStatus: "stopped",
			attempts: [expect.objectContaining({ status: "stopped" })],
		});
		expect(
			logs()
				.filter((event) => event.taskId === "first")
				.at(-1)?.event,
		).toBe("WORKSPACE_RELEASED");
	});

	it("releases a recorded attempt's reservation when resource loading fails", async () => {
		vi.spyOn(DefaultResourceLoader.prototype, "reload").mockRejectedValueOnce(new Error("Resource loading failed."));
		expect(
			await send({ id: "failed-resources", type: "run_kanban_task", boardId: "board", taskId: "first" }),
		).toMatchObject({ success: true });
		expect(tasks()[0]).toMatchObject({ runStatus: "failed", runError: "Resource loading failed." });
		expect(harness.faux.state.callCount).toBe(0);
		harness.setResponses([fauxAssistantMessage("No changes requested.")]);
		expect(
			await send({ id: "after-resource-failure", type: "run_kanban_task", boardId: "board", taskId: "second" }),
		).toMatchObject({ success: true });
	});

	it("drains and settles Kanban work on a coding-session change and reopens admission", async () => {
		holdModel();
		expect(
			await send({ id: "run-before-session-change", type: "run_kanban_task", boardId: "board", taskId: "first" }),
		).toMatchObject({ success: true });
		await vi.waitFor(() => expect(modelCalls).toBe(1));
		expect(await send({ id: "change-session", type: "new_session" })).toMatchObject({ success: true });
		expect(tasks()[0]?.runStatus).toBe("stopped");
		expect(
			logs()
				.filter((event) => event.taskId === "first")
				.at(-1)?.event,
		).toBe("WORKSPACE_RELEASED");
		harness.setResponses([fauxAssistantMessage("Ready again.")]);
		expect(
			await send({ id: "run-after-session-change", type: "run_kanban_task", boardId: "board", taskId: "second" }),
		).toMatchObject({ success: true });
	});
});
