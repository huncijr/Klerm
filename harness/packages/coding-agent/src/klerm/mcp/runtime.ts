import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { TSchema } from "typebox";
import { APP_NAME, VERSION } from "../../config.ts";
import type { ToolDefinition } from "../../core/extensions/types.ts";
import type { McpServerSettings } from "../../core/settings-manager.ts";

export type McpServerState = "disabled" | "connecting" | "connected" | "failed" | "closed";

export interface McpServerStatus {
	name: string;
	state: McpServerState;
	tools: string[];
	skippedTools: string[];
	error?: string;
}

interface McpConnection {
	client: Client;
	tools: Tool[];
}

const REQUEST_TIMEOUT_MS = 15_000;

function validateServer(name: string, settings: McpServerSettings): void {
	if (!/^[A-Za-z0-9_-]+$/.test(name)) {
		throw new Error("server names may contain only letters, numbers, underscores, and hyphens");
	}
	if (typeof settings !== "object" || settings === null) {
		throw new Error("server configuration must be an object");
	}
	const unknownKeys = Object.keys(settings).filter(
		(key) => key !== "command" && key !== "args" && key !== "env" && key !== "enabled",
	);
	if (unknownKeys.length > 0) {
		throw new Error(`unknown server setting${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`);
	}
	if (typeof settings.command !== "string" || !settings.command.trim()) {
		throw new Error("stdio command must be a non-empty string");
	}
	if (
		settings.args !== undefined &&
		(!Array.isArray(settings.args) || !settings.args.every((argument) => typeof argument === "string"))
	) {
		throw new Error("stdio args must be strings");
	}
	if (
		settings.env !== undefined &&
		(typeof settings.env !== "object" ||
			settings.env === null ||
			Array.isArray(settings.env) ||
			Object.values(settings.env).some((value) => typeof value !== "string"))
	) {
		throw new Error("stdio environment values must be strings");
	}
	if (settings.enabled !== undefined && typeof settings.enabled !== "boolean") {
		throw new Error("enabled must be a boolean");
	}
}

function sanitizeToolName(value: string): string {
	const sanitized = value
		.replace(/[^A-Za-z0-9_]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");
	return sanitized || "tool";
}

export function getMcpToolName(serverName: string, toolName: string): string {
	return `mcp_${sanitizeToolName(serverName)}_${sanitizeToolName(toolName)}`;
}

function stringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function formatMcpResult(result: Awaited<ReturnType<Client["callTool"]>>): {
	content: (TextContent | ImageContent)[];
	details: unknown;
} {
	if ("toolResult" in result) {
		return {
			content: [{ type: "text", text: stringify(result.toolResult) }],
			details: result.toolResult,
		};
	}

	const content: (TextContent | ImageContent)[] = [];
	for (const item of result.content) {
		if (item.type === "text") {
			content.push({ type: "text", text: item.text });
		} else if (item.type === "image") {
			content.push({ type: "image", data: item.data, mimeType: item.mimeType });
		} else if (item.type === "resource") {
			content.push({
				type: "text",
				text:
					"text" in item.resource
						? `[MCP resource ${item.resource.uri}]\n${item.resource.text}`
						: `[MCP binary resource ${item.resource.uri}; ${item.resource.mimeType ?? "unknown media type"}]`,
			});
		} else if (item.type === "resource_link") {
			content.push({
				type: "text",
				text: `[MCP resource link] ${item.name}: ${item.uri}${item.description ? `\n${item.description}` : ""}`,
			});
		} else {
			content.push({ type: "text", text: `[MCP audio result; ${item.mimeType}]` });
		}
	}
	if (content.length === 0 && result.structuredContent !== undefined) {
		content.push({ type: "text", text: stringify(result.structuredContent) });
	}
	if (content.length === 0) content.push({ type: "text", text: "MCP tool completed without content." });
	if (result.isError) {
		throw new Error(
			content
				.filter((item): item is TextContent => item.type === "text")
				.map((item) => item.text)
				.join("\n") || "MCP tool failed",
		);
	}
	return { content, details: result.structuredContent };
}

export class McpRuntime {
	private readonly cwd: string;
	private readonly configuredServers: Record<string, McpServerSettings>;
	private readonly clients = new Map<string, Client>();
	private readonly statuses = new Map<string, McpServerStatus>();
	private closed = false;

	constructor(cwd: string, configuredServers: Record<string, McpServerSettings>) {
		this.cwd = cwd;
		this.configuredServers = structuredClone(configuredServers);
		for (const name of Object.keys(this.configuredServers).sort()) {
			const disabled = this.configuredServers[name]?.enabled === false;
			this.statuses.set(name, {
				name,
				state: disabled ? "disabled" : "connecting",
				tools: [],
				skippedTools: [],
			});
		}
	}

	private async connect(name: string, settings: McpServerSettings): Promise<McpConnection> {
		validateServer(name, settings);
		const client = new Client({ name: APP_NAME, version: VERSION });
		const transport = new StdioClientTransport({
			command: settings.command,
			args: settings.args,
			env: { ...getDefaultEnvironment(), ...(settings.env ?? {}) },
			cwd: this.cwd,
			stderr: "pipe",
		});
		transport.onclose = () => {
			if (this.closed) return;
			const status = this.statuses.get(name);
			this.statuses.set(name, {
				name,
				state: "failed",
				tools: status?.tools ?? [],
				skippedTools: status?.skippedTools ?? [],
				error: "server process disconnected",
			});
		};
		transport.stderr?.on("data", () => {});
		try {
			await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
			const tools: Tool[] = [];
			const cursors = new Set<string>();
			let cursor: string | undefined;
			do {
				const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: REQUEST_TIMEOUT_MS });
				tools.push(...page.tools);
				cursor = page.nextCursor;
				if (cursor && cursors.has(cursor)) throw new Error("tools/list returned a repeated pagination cursor");
				if (cursor) cursors.add(cursor);
			} while (cursor);
			return { client, tools };
		} catch (error) {
			await client.close().catch(() => {});
			throw error;
		}
	}

	async start(registerTool: (tool: ToolDefinition) => void): Promise<void> {
		if (this.closed) throw new Error("MCP runtime is closed");
		const enabledServers = Object.entries(this.configuredServers)
			.filter(([, settings]) => settings?.enabled !== false)
			.sort(([left], [right]) => left.localeCompare(right));
		const results = await Promise.allSettled(
			enabledServers.map(async ([name, settings]) => ({ name, connection: await this.connect(name, settings) })),
		);
		const toolNames = new Set<string>();
		for (let index = 0; index < results.length; index++) {
			const name = enabledServers[index]?.[0];
			if (!name) continue;
			const result = results[index];
			if (result?.status === "rejected") {
				this.statuses.set(name, {
					name,
					state: "failed",
					tools: [],
					skippedTools: [],
					error: result.reason instanceof Error ? result.reason.message : String(result.reason),
				});
				continue;
			}
			if (!result) continue;
			const { client, tools } = result.value.connection;
			this.clients.set(name, client);
			const registered: string[] = [];
			const skipped: string[] = [];
			for (const remoteTool of [...tools].sort((left, right) => left.name.localeCompare(right.name))) {
				if (remoteTool.execution?.taskSupport === "required") {
					skipped.push(`${remoteTool.name} (requires MCP tasks)`);
					continue;
				}
				const toolName = getMcpToolName(name, remoteTool.name);
				if (toolNames.has(toolName)) {
					skipped.push(`${remoteTool.name} (name collision: ${toolName})`);
					continue;
				}
				toolNames.add(toolName);
				const definition: ToolDefinition = {
					name: toolName,
					label: remoteTool.title ?? remoteTool.name,
					description: remoteTool.description ?? `MCP tool ${remoteTool.name} from ${name}`,
					parameters: remoteTool.inputSchema as TSchema,
					execute: async (_toolCallId, params, signal) => {
						const argumentsValue =
							typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
						const callResult = await client.callTool(
							{ name: remoteTool.name, arguments: argumentsValue },
							undefined,
							{ signal },
						);
						return formatMcpResult(callResult);
					},
				};
				registerTool(definition);
				registered.push(toolName);
			}
			this.statuses.set(name, { name, state: "connected", tools: registered, skippedTools: skipped });
		}
	}

	getStatus(name?: string): McpServerStatus[] {
		const statuses = [...this.statuses.values()]
			.filter((status) => name === undefined || status.name === name)
			.sort((left, right) => left.name.localeCompare(right.name));
		return structuredClone(statuses);
	}

	describe(name?: string): string {
		const statuses = this.getStatus(name);
		if (statuses.length === 0) return name ? `MCP server "${name}" is not configured.` : "No MCP servers configured.";
		return statuses
			.flatMap((status) => {
				const lines = [`${status.name}: ${status.state}`];
				if (status.tools.length > 0) lines.push(`Tools: ${status.tools.join(", ")}`);
				if (status.skippedTools.length > 0) lines.push(`Skipped: ${status.skippedTools.join(", ")}`);
				if (status.error) lines.push(`Error: ${status.error}`);
				return lines;
			})
			.join("\n");
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await Promise.allSettled([...this.clients.values()].map((client) => client.close()));
		this.clients.clear();
		for (const [name, status] of this.statuses) {
			if (status.state === "connected" || status.state === "connecting") {
				this.statuses.set(name, { ...status, state: "closed" });
			}
		}
	}
}
