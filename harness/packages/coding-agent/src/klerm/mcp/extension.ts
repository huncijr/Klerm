import { registerSessionResourceCleanup } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { parseCommandArgs } from "../../core/prompt-templates.ts";
import type { SettingsManager, SettingsScope } from "../../core/settings-manager.ts";
import { McpRuntime } from "./runtime.ts";

const USAGE = [
	"Usage:",
	"/mcpset [--project] <name> stdio <command> [args...]",
	"/mcpset [--project] <name> remove|enable|disable|status",
].join("\n");

export function createMcpExtension(settingsManager: SettingsManager, cwd: string): ExtensionFactory {
	return (pi) => {
		let runtime = new McpRuntime(cwd, {});
		let unregisterSessionCleanup: (() => void) | undefined;

		pi.on("session_start", async (_event, ctx) => {
			await runtime.close();
			unregisterSessionCleanup?.();
			runtime = new McpRuntime(cwd, settingsManager.getMcpServers());
			const sessionId = ctx.sessionManager.getSessionId();
			unregisterSessionCleanup = registerSessionResourceCleanup((disposedSessionId) => {
				if (disposedSessionId !== sessionId) return;
				unregisterSessionCleanup?.();
				unregisterSessionCleanup = undefined;
				void runtime.close();
			});
			await runtime.start((tool) => pi.registerTool(tool));
			const failed = runtime.getStatus().filter((status) => status.state === "failed");
			if (failed.length > 0) {
				ctx.ui.notify(
					`${failed.length} MCP server${failed.length === 1 ? "" : "s"} failed. Use /mcp for details.`,
					"warning",
				);
			}
		});

		pi.on("session_shutdown", async () => {
			unregisterSessionCleanup?.();
			unregisterSessionCleanup = undefined;
			await runtime.close();
		});

		pi.registerCommand("mcp", {
			description: "List configured MCP servers and tools",
			handler: async (args, ctx) => {
				const name = args.trim() || undefined;
				ctx.ui.notify(runtime.describe(name));
			},
		});

		pi.registerCommand("mcpset", {
			description: "Configure stdio MCP servers",
			handler: async (args, ctx) => {
				const values = parseCommandArgs(args);
				const scope: SettingsScope = values[0] === "--project" ? "project" : "global";
				if (scope === "project") values.shift();
				const [name, action, ...actionArgs] = values;
				if (!name || !action) {
					ctx.ui.notify(USAGE, "error");
					return;
				}
				if (!/^[A-Za-z0-9_-]+$/.test(name)) {
					ctx.ui.notify("MCP server names may contain only letters, numbers, underscores, and hyphens.", "error");
					return;
				}
				if (scope === "project" && !ctx.isProjectTrusted()) {
					ctx.ui.notify("Project is not trusted; refusing to write project MCP settings.", "error");
					return;
				}
				if (action === "status") {
					ctx.ui.notify(runtime.describe(name));
					return;
				}

				let changed = false;
				if (action === "stdio") {
					const [command, ...serverArgs] = actionArgs;
					if (!command) {
						ctx.ui.notify(USAGE, "error");
						return;
					}
					settingsManager.setMcpServer(name, { command, args: serverArgs, enabled: true }, scope);
					changed = true;
				} else if (action === "remove") {
					changed = settingsManager.removeMcpServer(name, scope);
				} else if (action === "enable" || action === "disable") {
					changed = settingsManager.setMcpServerEnabled(name, action === "enable", scope);
				} else {
					ctx.ui.notify(USAGE, "error");
					return;
				}
				if (!changed) {
					ctx.ui.notify(`MCP server "${name}" is not configured in ${scope} settings.`, "error");
					return;
				}
				await settingsManager.flush();
				ctx.ui.notify(`MCP server "${name}" updated in ${scope} settings; reloading.`);
				await ctx.reload();
			},
		});
	};
}
