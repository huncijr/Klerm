import { registerSessionResourceCleanup } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, ExtensionFactory } from "../../core/extensions/types.ts";
import { parseCommandArgs } from "../../core/prompt-templates.ts";
import type { McpServerTransport, SettingsManager, SettingsScope } from "../../core/settings-manager.ts";
import { McpRuntime } from "./runtime.ts";

const USAGE = [
	"Usage:",
	"/mcpset [--project] <name> stdio <command> [args...]",
	"/mcpset [--project] <name> http <url> [Header=Value...]",
	"/mcpset [--project] <name> sse <url> [Header=Value...]",
	"/mcpset [--project] <name> remove|enable|disable|status",
].join("\n");

type WizardStep =
	| "action"
	| "scope"
	| "name"
	| "transport"
	| "command"
	| "args"
	| "endpoint"
	| "envName"
	| "envValue"
	| "extraEnv"
	| "enabled"
	| "review";

interface McpWizardState {
	scope: SettingsScope;
	transport: McpServerTransport;
	name?: string;
	command?: string;
	url?: string;
	args: string[];
	env: Record<string, string>;
	headers: Record<string, string>;
	pendingEnvName?: string;
	enabled: boolean;
}

function isControl(value: string): "back" | "cancel" | "help" | undefined {
	const normalized = value.trim().toLowerCase();
	if (normalized === "back" || normalized === "/back") return "back";
	if (normalized === "cancel" || normalized === "/cancel") return "cancel";
	if (normalized === "?" || normalized === "help" || normalized === "/help") return "help";
	return undefined;
}

function validEnvName(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function validHeaderName(value: string): boolean {
	return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value);
}

function maskEnv(env: Record<string, string>): string[] {
	return Object.keys(env)
		.sort()
		.map((key) => `  ${key}=********`);
}

function maskHeaders(headers: Record<string, string>): string[] {
	return Object.keys(headers)
		.sort()
		.map((key) => `  ${key}=********`);
}

function wizardHelp(step: WizardStep): string {
	return [
		`MCP setup step: ${step}`,
		"Press Enter to accept defaults or skip optional fields.",
		"Type back to return to the previous step, cancel to exit, or ? for this help.",
		"Supported transports: stdio, Streamable HTTP, and SSE.",
	].join("\n");
}

function previewMcpServer(state: McpWizardState): string {
	return [
		"Review MCP server:",
		"",
		`Scope: ${state.scope}`,
		`Name: ${state.name ?? ""}`,
		`Transport: ${state.transport}`,
		...(state.transport === "stdio"
			? [
					`Command: ${state.command ?? ""}`,
					`Args: ${state.args.length > 0 ? state.args.join(" ") : "none"}`,
					"Env:",
					...(Object.keys(state.env).length > 0 ? maskEnv(state.env) : ["  none"]),
				]
			: [
					`URL: ${state.url ?? ""}`,
					"Headers:",
					...(Object.keys(state.headers).length > 0 ? maskHeaders(state.headers) : ["  none"]),
				]),
		`Enabled: ${state.enabled ? "yes" : "no"}`,
	].join("\n");
}

function parseHeaderAssignments(values: string[]): Record<string, string> | undefined {
	const headers: Record<string, string> = {};
	for (const value of values) {
		const separator = value.indexOf("=");
		const key = separator >= 0 ? value.slice(0, separator).trim() : "";
		if (!validHeaderName(key)) return undefined;
		headers[key] = value.slice(separator + 1);
	}
	return headers;
}

async function wizardInput(
	ctx: ExtensionCommandContext,
	step: WizardStep,
	title: string,
	placeholder?: string,
): Promise<{ value?: string; control?: "back" | "cancel" }> {
	while (true) {
		const value = await ctx.ui.input(title, placeholder);
		if (value === undefined) return { control: "cancel" };
		const control = isControl(value);
		if (control === "help") {
			ctx.ui.notify(wizardHelp(step));
			continue;
		}
		if (control === "back" || control === "cancel") return { control };
		return { value };
	}
}

async function runMcpSetupWizard(settingsManager: SettingsManager, ctx: ExtensionCommandContext): Promise<void> {
	const state: McpWizardState = { scope: "global", transport: "stdio", args: [], env: {}, headers: {}, enabled: true };
	const steps: WizardStep[] = [
		"action",
		"scope",
		"name",
		"transport",
		"command",
		"args",
		"endpoint",
		"envName",
		"extraEnv",
		"enabled",
		"review",
	];
	let index = 0;

	while (index < steps.length) {
		const step = steps[index] ?? "review";
		if (step === "action") {
			const value = await ctx.ui.select("MCP setup", ["Add MCP server", "Cancel"]);
			if (value === undefined || value === "Cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			index++;
			continue;
		}

		if (step === "scope") {
			const value = await ctx.ui.select("Save this MCP server where?", ["Global", "Project", "Back", "Cancel"]);
			if (value === undefined || value === "Cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (value === "Back") {
				index = Math.max(0, index - 1);
				continue;
			}
			state.scope = value === "Project" ? "project" : "global";
			if (state.scope === "project" && !ctx.isProjectTrusted()) {
				ctx.ui.notify("Project is not trusted; refusing to write project MCP settings.", "error");
				continue;
			}
			index++;
			continue;
		}

		if (step === "name") {
			const result = await wizardInput(ctx, step, "MCP server name", "filesystem, github, linear, postgres");
			if (result.control === "cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (result.control === "back") {
				index--;
				continue;
			}
			const name = result.value?.trim() ?? "";
			if (!/^[A-Za-z0-9_-]+$/.test(name)) {
				ctx.ui.notify("MCP server names may contain only letters, numbers, underscores, and hyphens.", "error");
				continue;
			}
			state.name = name;
			index++;
			continue;
		}

		if (step === "transport") {
			const value = await ctx.ui.select("Transport type", ["stdio", "http", "sse", "Back", "Cancel"]);
			if (value === undefined || value === "Cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (value === "Back") {
				index--;
				continue;
			}
			state.transport = value as McpServerTransport;
			index++;
			continue;
		}

		if (step === "command") {
			if (state.transport !== "stdio") {
				index = steps.indexOf("endpoint");
				continue;
			}
			const result = await wizardInput(ctx, step, "Command", "npx, node, uvx, docker");
			if (result.control === "cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (result.control === "back") {
				index--;
				continue;
			}
			const command = result.value?.trim() ?? "";
			if (!command) {
				ctx.ui.notify("Command is required for stdio MCP servers.", "error");
				continue;
			}
			state.command = command;
			index++;
			continue;
		}

		if (step === "args") {
			if (state.transport !== "stdio") {
				index = steps.indexOf("endpoint");
				continue;
			}
			const result = await wizardInput(ctx, step, "Arguments", "-y @modelcontextprotocol/server-filesystem /path");
			if (result.control === "cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (result.control === "back") {
				index--;
				continue;
			}
			state.args = result.value?.trim() ? parseCommandArgs(result.value) : [];
			index++;
			continue;
		}

		if (step === "endpoint") {
			const result = await wizardInput(
				ctx,
				step,
				state.transport === "stdio" ? "Endpoint URL" : "MCP endpoint URL",
				state.transport === "stdio" ? "optional; Enter to skip" : "https://example.com/mcp",
			);
			if (result.control === "cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (result.control === "back") {
				index = state.transport === "stdio" ? index - 1 : steps.indexOf("transport");
				continue;
			}
			const endpoint = result.value?.trim() ?? "";
			if (state.transport === "stdio") {
				if (endpoint) state.env.ENDPOINT = endpoint;
			} else {
				try {
					const url = new URL(endpoint);
					if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
					state.url = url.toString();
				} catch {
					ctx.ui.notify("MCP endpoint URL must be a valid http or https URL.", "error");
					continue;
				}
			}
			index++;
			continue;
		}

		if (step === "envName") {
			const result = await wizardInput(
				ctx,
				step,
				state.transport === "stdio" ? "API key environment variable name" : "HTTP header name",
				state.transport === "stdio"
					? "optional; GITHUB_TOKEN, LINEAR_API_KEY"
					: "optional; Authorization, X-API-Key",
			);
			if (result.control === "cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (result.control === "back") {
				index--;
				continue;
			}
			const envName = result.value?.trim() ?? "";
			if (!envName) {
				index = steps.indexOf("extraEnv");
				continue;
			}
			if (state.transport === "stdio" && !validEnvName(envName)) {
				ctx.ui.notify(
					"Environment variable names must match A-Z, a-z, 0-9, and underscore, and cannot start with a number.",
					"error",
				);
				continue;
			}
			if (state.transport !== "stdio" && !validHeaderName(envName)) {
				ctx.ui.notify(
					"HTTP header names must be valid token names, for example Authorization or X-API-Key.",
					"error",
				);
				continue;
			}
			state.pendingEnvName = envName;
			const pendingValueIndex = steps.indexOf("envValue");
			if (pendingValueIndex >= 0) steps.splice(pendingValueIndex, 1);
			steps.splice(index + 1, 0, "envValue");
			index++;
			continue;
		}

		if (step === "envValue") {
			const name = state.pendingEnvName;
			const result = await wizardInput(ctx, step, `Value for ${name}`, "Enter to store an empty value");
			if (result.control === "cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (result.control === "back") {
				index--;
				continue;
			}
			if (name && state.transport === "stdio") state.env[name] = result.value ?? "";
			if (name && state.transport !== "stdio") state.headers[name] = result.value ?? "";
			state.pendingEnvName = undefined;
			steps.splice(index, 1);
			index = steps.indexOf("extraEnv");
			continue;
		}

		if (step === "extraEnv") {
			const result = await wizardInput(
				ctx,
				step,
				state.transport === "stdio"
					? "Add another env variable as key=value"
					: "Add another HTTP header as key=value",
				"optional; Enter when done",
			);
			if (result.control === "cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (result.control === "back") {
				index = steps.indexOf("envName");
				continue;
			}
			const value = result.value?.trim() ?? "";
			if (!value) {
				index++;
				continue;
			}
			const separator = value.indexOf("=");
			const key = separator >= 0 ? value.slice(0, separator).trim() : "";
			if (state.transport === "stdio" && !validEnvName(key)) {
				ctx.ui.notify("Enter env variables as KEY=value with a valid KEY name.", "error");
				continue;
			}
			if (state.transport !== "stdio" && !validHeaderName(key)) {
				ctx.ui.notify("Enter HTTP headers as Header-Name=value with a valid header name.", "error");
				continue;
			}
			if (state.transport === "stdio") state.env[key] = value.slice(separator + 1);
			else state.headers[key] = value.slice(separator + 1);
			continue;
		}

		if (step === "enabled") {
			const value = await ctx.ui.select("Enable server now?", ["yes", "no", "Back", "Cancel"]);
			if (value === undefined || value === "Cancel") {
				ctx.ui.notify("MCP setup cancelled.");
				return;
			}
			if (value === "Back") {
				index--;
				continue;
			}
			state.enabled = value !== "no";
			index++;
			continue;
		}

		const value = await ctx.ui.select(previewMcpServer(state), ["Save and reload", "Back", "Cancel"]);
		if (value === undefined || value === "Cancel") {
			ctx.ui.notify("MCP setup cancelled.");
			return;
		}
		if (value === "Back") {
			index--;
			continue;
		}
		if (!state.name || (state.transport === "stdio" ? !state.command : !state.url)) {
			ctx.ui.notify("MCP setup is incomplete; required fields are missing.", "error");
			index = state.name
				? steps.indexOf(state.transport === "stdio" ? "command" : "endpoint")
				: steps.indexOf("name");
			continue;
		}
		settingsManager.setMcpServer(
			state.name,
			state.transport === "stdio"
				? {
						transport: "stdio",
						command: state.command,
						args: state.args,
						env: state.env,
						enabled: state.enabled,
					}
				: {
						transport: state.transport,
						url: state.url,
						headers: state.headers,
						enabled: state.enabled,
					},
			state.scope,
		);
		await settingsManager.flush();
		ctx.ui.notify(`MCP server "${state.name}" saved to ${state.scope} settings. Reloading MCP tools...`);
		await ctx.reload();
		return;
	}
}

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
			description: "Configure MCP servers",
			handler: async (args, ctx) => {
				if (!args.trim() || args.trim() === "add") {
					await runMcpSetupWizard(settingsManager, ctx);
					return;
				}

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
					settingsManager.setMcpServer(
						name,
						{ transport: "stdio", command, args: serverArgs, enabled: true },
						scope,
					);
					changed = true;
				} else if (action === "http" || action === "sse") {
					const [url, ...headerArgs] = actionArgs;
					if (!url) {
						ctx.ui.notify(USAGE, "error");
						return;
					}
					try {
						const parsedUrl = new URL(url);
						if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")
							throw new Error("unsupported protocol");
						const headers = parseHeaderAssignments(headerArgs);
						if (!headers) {
							ctx.ui.notify("HTTP headers must be passed as Header-Name=value.", "error");
							return;
						}
						settingsManager.setMcpServer(
							name,
							{ transport: action, url: parsedUrl.toString(), headers, enabled: true },
							scope,
						);
					} catch {
						ctx.ui.notify("MCP endpoint URL must be a valid http or https URL.", "error");
						return;
					}
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
