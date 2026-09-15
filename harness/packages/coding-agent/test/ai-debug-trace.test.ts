import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	createAiDebugTraceFromEnvironment,
	JsonlAiDebugTrace,
	KLERM_AI_DEBUG_LOG_ENV,
} from "../src/klerm/ai-debug-trace.ts";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("AI debug trace", () => {
	test("stays disabled without an explicit output path", () => {
		expect(createAiDebugTraceFromEnvironment({})).toBeUndefined();
	});

	test("appends ordered full-context JSONL records", async () => {
		const directory = await mkdtemp(join(tmpdir(), "klerm-ai-debug-"));
		tempDirs.push(directory);
		const filePath = join(directory, "nested", "trace.jsonl");
		const trace = createAiDebugTraceFromEnvironment({ [KLERM_AI_DEBUG_LOG_ENV]: filePath });
		expect(trace).toBeInstanceOf(JsonlAiDebugTrace);

		trace?.append({
			type: "ROSTER_SNAPSHOT",
			sessionId: "session-1",
			taskId: "task-1",
			data: { visibleAgents: [{ agentId: "agent1", model: "provider/model" }] },
		});
		trace?.append({
			type: "PROMPT_SENT",
			sessionId: "session-1",
			taskId: "task-1",
			agentId: "agent1",
			phase: "coordinator",
			data: { prompt: "full private debug prompt" },
		});
		await trace?.flush();

		const records = (await readFile(filePath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(records).toHaveLength(2);
		expect(records.map((record) => record.sequence)).toEqual([1, 2]);
		expect(records[1]).toMatchObject({
			version: 1,
			type: "PROMPT_SENT",
			sessionId: "session-1",
			taskId: "task-1",
			agentId: "agent1",
			phase: "coordinator",
			data: { prompt: "full private debug prompt" },
		});
	});
});
