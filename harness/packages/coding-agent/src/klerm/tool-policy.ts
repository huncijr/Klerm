export type KlermToolApprovalCategory = "sensitive-file" | "bulk-edit" | "shell-mutation" | "external-tool";

export interface KlermToolApproval {
	category: KlermToolApprovalCategory;
	title: string;
	message: string;
}

const BUILTIN_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"edit",
	"write",
	"delegate_frontier",
	"delegate_local",
	"return_to_local",
	"return_to_frontier",
]);

const SAFE_SHELL_COMMAND =
	/^(?:pwd|ls(?:\s|$)|grep(?:\s|$)|rg(?:\s|$)|git\s+(?:status|diff|log|show)(?:\s|$)|npm\s+(?:test|run\s+(?:check|test|typecheck|build)(?::[\w-]+)?)(?:\s|$)|npx\s+(?:vitest|tsc|svelte-check)(?:\s|$)|cargo\s+(?:check|test|build)(?:\s|$)|node\s+[^;&|>`]*vitest[^;&|>`]*--run(?:\s|$))/;
const UNSAFE_SHELL_SYNTAX = /(?:&&|\|\||[;|>`]|\$\(|\n|\r)/;
const MUTATING_FIND = /(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/;
const SENSITIVE_PATH =
	/(?:^|[/\\])(?:\.env(?:\.|$)|\.ssh(?:[/\\]|$)|credentials?(?:\.|[/\\]|$)|secrets?(?:\.|[/\\]|$)|auth\.json$|id_(?:rsa|ed25519)$)/i;

function stringArgument(args: unknown, key: string): string | undefined {
	if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

export function toolPath(toolName: string, args: unknown): string | undefined {
	if (toolName === "read" || toolName === "write" || toolName === "edit") {
		return stringArgument(args, "path");
	}
	return undefined;
}

export function requiresBuilderApproval(
	toolName: string,
	args: unknown,
	changedFileCount: number,
): KlermToolApproval | undefined {
	const path = toolPath(toolName, args);
	if (path && SENSITIVE_PATH.test(path)) {
		return {
			category: "sensitive-file",
			title: "Allow sensitive file access?",
			message: `Builder wants to access a sensitive path: ${path}`,
		};
	}
	if ((toolName === "edit" || toolName === "write") && changedFileCount >= 5) {
		return {
			category: "bulk-edit",
			title: "Allow broad workspace changes?",
			message: `Builder is about to modify ${changedFileCount} or more files in this task.`,
		};
	}
	if (toolName === "bash") {
		const command = stringArgument(args, "command")?.trim() ?? "";
		const safe =
			command.length > 0 &&
			!UNSAFE_SHELL_SYNTAX.test(command) &&
			!MUTATING_FIND.test(command) &&
			SAFE_SHELL_COMMAND.test(command);
		if (!safe) {
			const executable = command.split(/\s+/, 1)[0];
			return {
				category: "shell-mutation",
				title: "Allow a modifying command?",
				message: executable
					? `Builder requested a shell command starting with "${executable}". Arguments are hidden.`
					: "Builder requested a shell command.",
			};
		}
	}
	if (toolName === "configure_mcp_server") {
		const name = stringArgument(args, "name") ?? "an MCP server";
		return {
			category: "external-tool",
			title: "Allow configuring an MCP server?",
			message: `Builder wants to configure MCP server ${name}.`,
		};
	}
	if (!BUILTIN_TOOLS.has(toolName)) {
		return {
			category: "external-tool",
			title: "Allow an external tool?",
			message: `Builder wants to run ${toolName}. Its side effects are not known to Klerm.`,
		};
	}
	return undefined;
}
