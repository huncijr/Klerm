import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { BrowserDebugLog } from "../src/klerm/browser-debug.ts";
import { startOpenAICompatibleChatServer } from "../src/klerm/openai-compatible-chat.ts";

it("persists ordered diagnostics and records gateway rejection without request contents", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "browser-debug-"));
	const log = new BrowserDebugLog(cwd);
	const server = await startOpenAICompatibleChatServer({
		modelRuntime: {
			getAvailableSnapshot: () => [],
			completeSimple: async () => {
				throw new Error("must not call provider");
			},
		},
		onDiagnostic: (entry) => log.write({ event: entry.event, runId: "run-1", model: "test", details: entry }),
	});
	try {
		await Promise.all(
			["RUN_REQUESTED", "RUN_STARTED"].map((event) => log.write({ event, runId: "run-1", model: "test" })),
		);
		const response = await fetch(`${server.url}/chat/completions`, {
			method: "POST",
			headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
			body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "private-query" }], stream: true }),
		});
		expect(response.status).toBe(400);
		const text = await readFile(join(cwd, ".klerm/browser-debug.jsonl"), "utf8");
		const entries = text
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(entries.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
		expect(entries[2]).toMatchObject({ event: "GATEWAY_ERROR", details: { code: "unsupported_streaming" } });
		expect(text).not.toContain("private-query");
		expect(text).not.toContain(server.token);
	} finally {
		await server.close();
		await rm(cwd, { recursive: true, force: true });
	}
});
