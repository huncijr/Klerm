import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { McpRuntime } from "../src/klerm/mcp/runtime.ts";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-mcp-stdio-server.mjs");

describe("MCP stdio runtime", () => {
	let tempDir: string | undefined;

	afterEach(() => {
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	});

	it("discovers paginated tools, invokes them, and closes the server", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "klerm-mcp-"));
		const runtime = new McpRuntime(tempDir, {
			fake: { command: process.execPath, args: [fixture] },
			disabled: { command: process.execPath, args: [fixture], enabled: false },
		});
		const tools: ToolDefinition[] = [];
		const toolUseEvents: { serverName: string; remoteToolName: string; toolName: string }[] = [];

		await runtime.start(
			(tool) => tools.push(tool),
			(event) => toolUseEvents.push(event),
		);

		expect(tools.map((tool) => tool.name)).toEqual(["mcp_fake_echo_text"]);
		expect(runtime.getStatus("fake")).toEqual([
			expect.objectContaining({
				state: "connected",
				tools: ["mcp_fake_echo_text"],
				skippedTools: ["required-task (requires MCP tasks)"],
			}),
		]);
		expect(runtime.getStatus("disabled")[0]?.state).toBe("disabled");

		const result = await tools[0]?.execute("call-1", { text: "hello" }, undefined, undefined, undefined as never);
		expect(toolUseEvents).toEqual([
			{ serverName: "fake", remoteToolName: "echo-text", toolName: "mcp_fake_echo_text" },
		]);
		expect(result).toEqual({
			content: [{ type: "text", text: "echo:hello" }],
			details: { echoed: "hello" },
		});

		await runtime.close();
		expect(runtime.getStatus("fake")[0]?.state).toBe("closed");
	});

	it("isolates a failed server without disabling successful servers", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "klerm-mcp-"));
		const runtime = new McpRuntime(tempDir, {
			broken: { command: join(tempDir, "missing-command") },
			fake: { command: process.execPath, args: [fixture] },
			typo: { command: process.execPath, args: [fixture], enable: false } as never,
		});
		const tools: ToolDefinition[] = [];

		await runtime.start((tool) => tools.push(tool));

		expect(tools.map((tool) => tool.name)).toEqual(["mcp_fake_echo_text"]);
		expect(runtime.getStatus("broken")[0]?.state).toBe("failed");
		expect(runtime.getStatus("fake")[0]?.state).toBe("connected");
		expect(runtime.getStatus("typo")[0]).toMatchObject({ state: "failed", error: "unknown server setting: enable" });
		await runtime.close();
	});

	it("validates HTTP and SSE server configuration by transport", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "klerm-mcp-"));
		const runtime = new McpRuntime(tempDir, {
			badHttpUrl: { transport: "http", url: "file:///tmp/server" },
			badSseCommand: { transport: "sse", url: "https://example.com/sse", command: "node" },
			badHttpHeader: { transport: "http", url: "https://example.com/mcp", headers: { Authorization: 1 } } as never,
		});

		await runtime.start(() => {});

		expect(runtime.getStatus("badHttpUrl")[0]).toMatchObject({
			state: "failed",
			error: "http URL must be a valid http or https URL",
		});
		expect(runtime.getStatus("badSseCommand")[0]).toMatchObject({
			state: "failed",
			error: "sse servers cannot set command or args",
		});
		expect(runtime.getStatus("badHttpHeader")[0]).toMatchObject({
			state: "failed",
			error: "HTTP header values must be strings",
		});
		await runtime.close();
	});
});
