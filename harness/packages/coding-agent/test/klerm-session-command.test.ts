import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionEntry, SessionHeader } from "../src/core/session-manager.ts";
import { runKlermSessionCommand } from "../src/klerm/cli/session-command.ts";

describe("Klerm session timeline command", () => {
	let originalExitCode: typeof process.exitCode;
	const header: SessionHeader = {
		type: "session",
		version: 3,
		id: "session-123",
		timestamp: "2026-08-27T17:00:00.000Z",
		cwd: "/project",
	};
	const entries = [
		{
			type: "model_change",
			id: "local-model",
			parentId: null,
			timestamp: "2026-08-27T17:00:01.000Z",
			provider: "ollama",
			modelId: "qwen3",
		},
		{
			type: "message",
			id: "delegate-result",
			parentId: "local-model",
			timestamp: "2026-08-27T17:00:02.000Z",
			message: {
				role: "toolResult",
				toolCallId: "delegate-call",
				toolName: "delegate_frontier",
				content: [{ type: "text", text: "large tool output that is hidden by default" }],
				details: { reason: "needs review" },
				isError: false,
				timestamp: 2,
			},
		},
		{
			type: "model_change",
			id: "frontier-model",
			parentId: "delegate-result",
			timestamp: "2026-08-27T17:00:03.000Z",
			provider: "openai-codex",
			modelId: "gpt-5.5",
		},
		{
			type: "message",
			id: "assistant",
			parentId: "frontier-model",
			timestamp: "2026-08-27T17:00:04.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Reviewed." }],
				api: "responses",
				provider: "openai-codex",
				model: "gpt-5.5",
				usage: {
					input: 10,
					output: 5,
					cacheRead: 0,
					cacheWrite: 0,
					reasoning: 0,
					totalTokens: 15,
					cost: { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.02 },
				},
				stopReason: "stop",
				timestamp: 4,
			},
		},
	] as SessionEntry[];
	const openSession = () => ({ getEntries: () => entries, getHeader: () => header, getSessionId: () => header.id });

	beforeEach(() => {
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
	});

	it("renders legacy transitions and hides tool output by default", async () => {
		const output: string[] = [];
		await runKlermSessionCommand(["session", "timeline", "session-123"], {
			listSessions: async () => [{ id: "session-123", path: "/session.jsonl" }] as never,
			openSession,
			stdout: (message) => output.push(message),
		});

		expect(output[0]).toContain("DELEGATE local -> frontier");
		expect(output[0]).toContain("Reviewed.");
		expect(output[0]).not.toContain("large tool output");
		expect(output[0]).not.toContain("TOOL delegate_frontier");
	});

	it("provides compact structured output with optional tools and cost", async () => {
		const output: string[] = [];
		await runKlermSessionCommand(
			["session", "timeline", "session-123", "--json", "--compact", "--with-tools", "--with-cost"],
			{
				listSessions: async () => [{ id: "session-123", path: "/session.jsonl" }] as never,
				openSession,
				stdout: (message) => output.push(message),
			},
		);

		const result = JSON.parse(output[0]);
		expect(result.sessionId).toBe("session-123");
		expect(result.events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "tool", tool: "delegate_frontier", isError: false }),
				expect.objectContaining({
					type: "transition",
					transition: expect.objectContaining({ kind: "delegate", toLane: "frontier" }),
				}),
			]),
		);
		expect(result.events.some((event: { type: string }) => event.type === "message")).toBe(false);
	});

	it("reports an unknown session", async () => {
		const errors: string[] = [];
		await runKlermSessionCommand(["session", "timeline", "missing"], {
			listSessions: async () => [],
			stderr: (message) => errors.push(message),
		});

		expect(process.exitCode).toBe(1);
		expect(errors[0]).toContain("was not found");
	});
});
