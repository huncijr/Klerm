import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>" },
	{
		name: "agent1",
		description: "Configure Agent 1 to any available model or run one Agent 1 task",
		argumentHint: "<model [reference]|status|models|off|task <prompt>>",
	},
	{
		name: "agent2",
		description: "Configure Agent 2 to a different available model or run one Agent 2 task",
		argumentHint: "<model [reference]|status|off|task <prompt>>",
	},
	{
		name: "agent",
		description: "Configure Agent 1 or Agent 2",
		argumentHint: "<1|2> <model [reference]|status|off|task <prompt>>",
	},
	{
		name: "routing",
		description: "Configure Klerm routing, handback, and Agent 2 fallback",
		argumentHint: "<status|off|1|2|auto|fallback on|off|handback on|off|cycles <count|unlimited>>",
	},
	{
		name: "active",
		description: "Configure the Klerm starting agent",
		argumentHint: "<auto|1|2|agent 2 -> agent 1|status>",
	},
	{
		name: "mode",
		description: "Select or configure Agent 1/2 planner or builder roles",
		argumentHint: "<[agent 1|agent 2|1|2] [planner|builder]>",
	},
	{
		name: "activ",
		description: "Alias for /active",
		argumentHint: "<auto|1|2|agent 2 -> agent 1|status>",
	},
	{ name: "klerm", description: "Show Klerm A2A routing status" },
	{ name: "token", description: "Show or hide response token and cost usage", argumentHint: "<on|off>" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import and resume a session from a JSONL file" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous user message" },
	{ name: "clone", description: "Duplicate the current session at the current position" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "trust", description: "Save project trust decision for future sessions" },
	{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files" },
	{ name: "quit", description: `Quit ${APP_NAME}` },
];
