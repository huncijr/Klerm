import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "../src/core/extensions/types.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createMcpExtension } from "../src/klerm/mcp/extension.ts";

describe("MCP extension commands", () => {
	it("configures a stdio server and reloads the session", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
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
			demo: { command: "node", args: ["server file.mjs"], enabled: true },
		});
		expect(reload).toHaveBeenCalledOnce();
		expect(notify).toHaveBeenCalledWith('MCP server "demo" updated in global settings; reloading.');
	});

	it("lists empty status and rejects untrusted project writes", async () => {
		const settingsManager = SettingsManager.inMemory();
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const pi = {
			on: vi.fn(),
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
});
