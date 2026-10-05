import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import type { WorkflowDefinition } from "../src/klerm/workflows.ts";
import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { createHarness } from "./suite/harness.ts";

const io = vi.hoisted(() => ({ lines: [] as string[], input: undefined as ((line: string) => void) | undefined }));
vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		io.lines.push(line);
	},
}));
vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));
vi.mock("../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		io.input = onLine;
		return () => {
			io.input = undefined;
		};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

async function send(value: Record<string, unknown>) {
	io.input?.(JSON.stringify(value));
	let result: Record<string, unknown> | undefined;
	await vi.waitFor(() => {
		result = io.lines
			.flatMap((line) => line.trim().split("\n"))
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.find((event) => event.type === "response" && event.id === value.id);
		expect(result).toBeDefined();
	});
	return result!;
}
describe("graph RPC without dispatch", () => {
	afterEach(() => {
		io.input = undefined;
		io.lines = [];
	});
	it("advertises metadata commands, persists and validates drafts, and never prompts a model", async () => {
		const previousEnd = process.stdin.listeners("end"),
			signals = new Map((["SIGTERM", "SIGHUP"] as const).map((signal) => [signal, process.listeners(signal)]));
		const harness = await createHarness();
		(harness.sessionManager as unknown as { cwd: string }).cwd = harness.tempDir;
		const runtime = {
			session: harness.session,
			setRebindSession: vi.fn(),
			dispose: vi.fn(async () => {}),
			newSession: vi.fn(async () => ({ cancelled: true })),
			switchSession: vi.fn(),
			fork: vi.fn(),
		} as unknown as AgentSessionRuntime;
		try {
			void runRpcMode(runtime, { personalBotStorageDir: harness.tempDir, discoverCodingHarnesses: async () => [] });
			await vi.waitFor(() => expect(io.input).toBeDefined());
			expect(await send({ id: "capabilities", type: "desktop_handshake" })).toMatchObject({
				success: true,
				data: {
					capabilities: {
						commands: expect.arrayContaining([
							"list_workflows",
							"save_workflow",
							"get_graph_catalog",
							"validate_workflow",
						]),
					},
				},
			});
			const value: WorkflowDefinition = {
				version: 1,
				id: "workflow",
				revision: 0,
				name: "Graph draft",
				workspaceRoot: harness.tempDir,
				createdAt: "",
				updatedAt: "",
				nodes: [
					{
						id: "start",
						kind: "start",
						title: "Start",
						createdSequence: 1,
						position: { x: 50, y: 60 },
						brief: "",
						note: "",
					},
				],
				edges: [],
				viewport: { x: 0, y: 0, zoom: 1 },
			};
			expect(await send({ id: "catalog", type: "get_graph_catalog", query: { category: "agents" } })).toMatchObject({
				success: true,
				data: {
					executionSupported: false,
					items: expect.arrayContaining([
						expect.objectContaining({ sourceRef: { kind: "personal-agent", botId: "bot-scout" } }),
					]),
				},
			});
			expect(await send({ id: "save", type: "save_workflow", workflow: value, expectedRevision: 0 })).toMatchObject({
				success: true,
				data: { revision: 1, name: "Graph draft" },
			});
			expect(await send({ id: "list", type: "list_workflows" })).toMatchObject({
				success: true,
				data: { executionSupported: false, workflows: [expect.objectContaining({ id: "workflow", revision: 1 })] },
			});
			expect(
				await send({ id: "stale-save", type: "save_workflow", workflow: value, expectedRevision: 0 }),
			).toMatchObject({ success: false, code: "WORKFLOW_REVISION_CONFLICT" });
			expect(await send({ id: "validate", type: "validate_workflow", workflow: value })).toMatchObject({
				success: true,
				data: { valid: true, executionSupported: false, order: ["start"] },
			});
			expect(
				await send({
					id: "missing-source",
					type: "get_graph_source_details",
					sourceRef: { kind: "personal-agent", botId: "../../auth" },
				}),
			).toMatchObject({ success: false });
			expect(
				await send({ id: "delete", type: "delete_workflow", workflowId: "workflow", expectedRevision: 1 }),
			).toMatchObject({ success: true, data: { workflows: [] } });
			expect(harness.faux.state.callCount).toBe(0);
			expect(harness.settingsManager.getKanbanRegistry().boards).toEqual([]);
		} finally {
			if (io.input) await send({ id: "cleanup", type: "new_session" });
			for (const listener of process.stdin.listeners("end"))
				if (!previousEnd.includes(listener)) process.stdin.off("end", listener as Parameters<typeof process.on>[1]);
			for (const [signal, previous] of signals)
				for (const listener of process.listeners(signal))
					if (!previous.includes(listener)) process.off(signal, listener as Parameters<typeof process.on>[1]);
			harness.cleanup();
		}
	});
});
