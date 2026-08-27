import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	RegisteredCommand,
	ToolDefinition,
} from "../src/core/extensions/types.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createMcpExtension } from "../src/klerm/mcp/extension.ts";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-mcp-stdio-server.mjs");

describe("MCP extension commands", () => {
	it("notifies the UI before an MCP tool call", async () => {
		const settingsManager = SettingsManager.inMemory();
		settingsManager.setMcpServer("fake", { command: process.execPath, args: [fixture] });
		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>();
		const tools: ToolDefinition[] = [];
		const pi = {
			on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => {
				handlers.set(event, handler);
			},
			registerCommand: vi.fn(),
			registerTool: (tool: ToolDefinition) => tools.push(tool),
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const notify = vi.fn();
		const context = {
			ui: { notify },
			sessionManager: { getSessionId: () => "session-1" },
		} as unknown as ExtensionContext;

		await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, context);
		await tools
			.find((tool) => tool.name === "mcp_fake_echo_text")
			?.execute("call-1", { text: "hello" }, undefined, undefined, undefined as never);

		expect(notify).toHaveBeenCalledWith("mcp: fake/echo-text used");
		await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, context);
	});

	it("lets the AI configure stdio, HTTP, and SSE MCP servers without credentials", async () => {
		const settingsManager = SettingsManager.inMemory();
		const tools: ToolDefinition[] = [];
		const pi = {
			on: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: (tool: ToolDefinition) => tools.push(tool),
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const notify = vi.fn();
		const context = {
			ui: { notify },
			isProjectTrusted: () => true,
		} as unknown as ExtensionContext;
		const tool = tools.find((candidate) => candidate.name === "configure_mcp_server");

		const stdioResult = await tool?.execute(
			"call-stdio",
			{ name: "filesystem", transport: "stdio", command: "npx", args: ["-y", "server"] },
			undefined,
			undefined,
			context,
		);
		await tool?.execute(
			"call-http",
			{ name: "remote", transport: "http", url: "https://example.com/mcp" },
			undefined,
			undefined,
			context,
		);
		await tool?.execute(
			"call-sse",
			{ name: "events", transport: "sse", url: "https://example.com/sse", enabled: false },
			undefined,
			undefined,
			context,
		);

		expect(settingsManager.getMcpServers()).toEqual({
			filesystem: { transport: "stdio", command: "npx", args: ["-y", "server"], enabled: true },
			remote: { transport: "http", url: "https://example.com/mcp", enabled: true },
			events: { transport: "sse", url: "https://example.com/sse", enabled: false },
		});
		expect(stdioResult?.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("Run /reload to load its tools"),
		});
		expect(notify).toHaveBeenCalledWith("mcp: filesystem configured");
		expect(notify).toHaveBeenCalledWith("mcp: remote configured");
		expect(notify).toHaveBeenCalledWith("mcp: events configured");
	});

	it("blocks untrusted AI project configuration", async () => {
		const settingsManager = SettingsManager.inMemory();
		const tools: ToolDefinition[] = [];
		const pi = {
			on: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: (tool: ToolDefinition) => tools.push(tool),
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const tool = tools.find((candidate) => candidate.name === "configure_mcp_server");
		const context = {
			ui: { notify: vi.fn() },
			isProjectTrusted: () => false,
		} as unknown as ExtensionContext;

		await expect(
			tool?.execute(
				"call-project",
				{ name: "blocked", transport: "stdio", scope: "project", command: "node" },
				undefined,
				undefined,
				context,
			),
		).rejects.toThrow("Project is not trusted");
		expect(settingsManager.getMcpServers()).toEqual({});
	});

	it("preserves compatible credentials without exposing them in the AI tool result", async () => {
		const settingsManager = SettingsManager.inMemory();
		settingsManager.setMcpServer("remote", {
			transport: "http",
			url: "https://old.example.com/mcp",
			headers: { Authorization: "Bearer secret-token" },
		});
		const tools: ToolDefinition[] = [];
		const pi = {
			on: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: (tool: ToolDefinition) => tools.push(tool),
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const tool = tools.find((candidate) => candidate.name === "configure_mcp_server");
		const notify = vi.fn();
		const context = {
			ui: { notify },
			isProjectTrusted: () => true,
		} as unknown as ExtensionContext;
		await expect(
			tool?.execute(
				"call-secret-url",
				{ name: "remote", transport: "http", url: "https://user:secret-token@example.com/mcp" },
				undefined,
				undefined,
				context,
			),
		).rejects.toThrow("URL cannot contain credentials");

		const result = await tool?.execute(
			"call-update",
			{ name: "remote", transport: "http", url: "https://new.example.com/mcp" },
			undefined,
			undefined,
			context,
		);

		expect(settingsManager.getMcpServers()).toEqual({
			remote: {
				transport: "http",
				url: "https://new.example.com/mcp",
				headers: { Authorization: "Bearer secret-token" },
				enabled: true,
			},
		});
		expect(JSON.stringify(result)).not.toContain("secret-token");
		expect(JSON.stringify(notify.mock.calls)).not.toContain("secret-token");
	});

	it("configures a stdio server and reloads the session", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const notify = vi.fn();
		const reload = vi.fn(async () => {});
		const context = {
			ui: { notify },
			isProjectTrusted: () => true,
			reload,
		} as unknown as ExtensionCommandContext;

		await commands.get("mcpset")?.handler('demo stdio node "server file.mjs"', context);

		expect(settingsManager.getMcpServers()).toEqual({
			demo: { transport: "stdio", command: "node", args: ["server file.mjs"], enabled: true },
		});
		expect(reload).toHaveBeenCalledOnce();
		expect(notify).toHaveBeenCalledWith('MCP server "demo" updated in global settings; reloading.');
	});

	it("configures HTTP and SSE servers with headers", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const notify = vi.fn();
		const reload = vi.fn(async () => {});
		const context = {
			ui: { notify },
			isProjectTrusted: () => true,
			reload,
		} as unknown as ExtensionCommandContext;

		await commands.get("mcpset")?.handler('remote http https://example.com/mcp Authorization="Bearer test"', context);
		await commands.get("mcpset")?.handler("events sse https://example.com/sse X-API-Key=secret", context);

		expect(settingsManager.getMcpServers()).toEqual({
			remote: {
				transport: "http",
				url: "https://example.com/mcp",
				headers: { Authorization: "Bearer test" },
				enabled: true,
			},
			events: {
				transport: "sse",
				url: "https://example.com/sse",
				headers: { "X-API-Key": "secret" },
				enabled: true,
			},
		});
		expect(reload).toHaveBeenCalledTimes(2);
	});

	it("lists empty status and rejects untrusted project writes", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const notify = vi.fn();
		const context = {
			ui: { notify },
			isProjectTrusted: () => false,
			reload: vi.fn(),
		} as unknown as ExtensionCommandContext;

		await commands.get("mcp")?.handler("", context);
		await commands.get("mcpset")?.handler("--project demo stdio node server.mjs", context);

		expect(notify).toHaveBeenNthCalledWith(1, "No MCP servers configured.");
		expect(notify).toHaveBeenNthCalledWith(
			2,
			"Project is not trusted; refusing to write project MCP settings.",
			"error",
		);
		expect(settingsManager.getMcpServers()).toEqual({});
	});

	it("walks through the interactive setup wizard with skipped optional fields", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const notify = vi.fn();
		const reload = vi.fn(async () => {});
		const selectValues = ["Add MCP server", "Global", "stdio", "yes", "Save and reload"];
		const inputValues = ["filesystem", "npx", "-y @modelcontextprotocol/server-filesystem /tmp/project", "", "", ""];
		const context = {
			ui: {
				notify,
				select: vi.fn(async () => selectValues.shift()),
				input: vi.fn(async () => inputValues.shift()),
			},
			isProjectTrusted: () => true,
			reload,
		} as unknown as ExtensionCommandContext;

		await commands.get("mcpset")?.handler("", context);

		expect(settingsManager.getMcpServers()).toEqual({
			filesystem: {
				transport: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/project"],
				env: {},
				enabled: true,
			},
		});
		expect(reload).toHaveBeenCalledOnce();
		expect(notify).toHaveBeenCalledWith('MCP server "filesystem" saved to global settings. Reloading MCP tools...');
	});

	it("stores endpoint and masked env values from the setup wizard", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const notify = vi.fn();
		const reload = vi.fn(async () => {});
		let reviewTitle = "";
		const selectValues = ["Add MCP server", "Project", "stdio", "no", "Save and reload"];
		const inputValues = [
			"github",
			"npx",
			"-y @modelcontextprotocol/server-github",
			"https://api.github.com",
			"GITHUB_TOKEN",
			"secret-token",
			"ORG_ID=klerm",
			"",
		];
		const context = {
			ui: {
				notify,
				select: vi.fn(async (title: string) => {
					if (title.startsWith("Review MCP server")) reviewTitle = title;
					return selectValues.shift();
				}),
				input: vi.fn(async () => inputValues.shift()),
			},
			isProjectTrusted: () => true,
			reload,
		} as unknown as ExtensionCommandContext;

		await commands.get("mcpset")?.handler("", context);

		expect(settingsManager.getMcpServers()).toEqual({
			github: {
				transport: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-github"],
				env: {
					ENDPOINT: "https://api.github.com",
					GITHUB_TOKEN: "secret-token",
					ORG_ID: "klerm",
				},
				enabled: false,
			},
		});
		expect(reviewTitle).toContain("GITHUB_TOKEN=********");
		expect(reviewTitle).not.toContain("secret-token");
		expect(reload).toHaveBeenCalledOnce();
	});

	it("walks through the interactive setup wizard for HTTP headers", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const notify = vi.fn();
		const reload = vi.fn(async () => {});
		let reviewTitle = "";
		const selectValues = ["Add MCP server", "Global", "http", "yes", "Save and reload"];
		const inputValues = ["remote", "https://example.com/mcp", "Authorization", "Bearer secret", "X-Trace=klerm", ""];
		const context = {
			ui: {
				notify,
				select: vi.fn(async (title: string) => {
					if (title.startsWith("Review MCP server")) reviewTitle = title;
					return selectValues.shift();
				}),
				input: vi.fn(async () => inputValues.shift()),
			},
			isProjectTrusted: () => true,
			reload,
		} as unknown as ExtensionCommandContext;

		await commands.get("mcpset")?.handler("add", context);

		expect(settingsManager.getMcpServers()).toEqual({
			remote: {
				transport: "http",
				url: "https://example.com/mcp",
				headers: { Authorization: "Bearer secret", "X-Trace": "klerm" },
				enabled: true,
			},
		});
		expect(reviewTitle).toContain("Authorization=********");
		expect(reviewTitle).not.toContain("Bearer secret");
		expect(reload).toHaveBeenCalledOnce();
	});

	it("returns from HTTP endpoint to transport selection when the wizard goes back", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const selectValues = ["Add MCP server", "Global", "http", "sse", "yes", "Save and reload"];
		const inputValues = ["remote", "back", "https://example.com/sse", "", ""];
		const context = {
			ui: {
				notify: vi.fn(),
				select: vi.fn(async () => selectValues.shift()),
				input: vi.fn(async () => inputValues.shift()),
			},
			isProjectTrusted: () => true,
			reload: vi.fn(async () => {}),
		} as unknown as ExtensionCommandContext;

		await commands.get("mcpset")?.handler("", context);

		expect(settingsManager.getMcpServers()).toEqual({
			remote: {
				transport: "sse",
				url: "https://example.com/sse",
				headers: {},
				enabled: true,
			},
		});
	});

	it("opens the setup wizard from the add alias", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
			registerTool: vi.fn(),
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
				commands.set(name, command);
			},
		} as unknown as ExtensionAPI;
		await createMcpExtension(settingsManager, "/tmp")(pi);
		const notify = vi.fn();
		const context = {
			ui: {
				notify,
				select: vi.fn(async () => "Cancel"),
				input: vi.fn(),
			},
			isProjectTrusted: () => true,
			reload: vi.fn(),
		} as unknown as ExtensionCommandContext;

		await commands.get("mcpset")?.handler("add", context);

		expect(notify).toHaveBeenCalledWith("MCP setup cancelled.");
	});
});
