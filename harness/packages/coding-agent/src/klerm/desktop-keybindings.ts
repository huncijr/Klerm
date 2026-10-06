/** Shared browser-safe action/chord registry. No view checks hardcoded chords. */
export const DEFAULT_DESKTOP_KEYBINDINGS = {
	"compose.send": {
		label: "Send prompt from composer",
		group: "Composer",
		keys: "Enter",
		description:
			"Send from the focused chat/browser composer. Does not affect ordinary inputs or native browser pages.",
		editing: true,
	},
	"compose.newline": {
		label: "Composer new line",
		group: "Composer",
		keys: "Shift+Enter",
		description: "Insert a line break in the coding composer.",
		editing: true,
	},
	save: {
		label: "Save current view",
		group: "Context",
		keys: "Mod+S",
		description: "Save the visible graph, card, agent/settings or file editor.",
		editing: true,
	},
	close: {
		label: "Close / cancel",
		group: "Context",
		keys: "Escape",
		description: "Close the active drawer/menu/view; retain existing discard checks.",
		editing: true,
	},
	newItem: {
		label: "New item in current view",
		group: "Context",
		keys: "Mod+Alt+N",
		description: "New graph, card, Personal Agent or browser session.",
		editing: true,
	},
	refresh: {
		label: "Refresh current view",
		group: "Context",
		keys: "Mod+Shift+R",
		description: "Refresh graph sources, cards, workspace or agent discovery.",
		editing: true,
	},
	run: {
		label: "Run / send in current view",
		group: "Context",
		keys: "Mod+Shift+Enter",
		description: "Run the selected card or submit a chat/browser prompt. Does not enable graph execution.",
		editing: true,
	},
	stop: {
		label: "Stop current task",
		group: "Context",
		keys: "Mod+Shift+X",
		description: "Stop the task owned by the visible view.",
		editing: true,
	},
	"view.agents": {
		label: "Agents & Routing",
		group: "Navigation",
		keys: "Mod+Alt+A",
		description: "Open the coding workspace.",
		editing: true,
	},
	"view.personal": {
		label: "Personal Agents",
		group: "Navigation",
		keys: "Mod+Alt+P",
		description: "Open Personal Bots.",
		editing: true,
	},
	"view.kanban": {
		label: "Kanban",
		group: "Navigation",
		keys: "Mod+Alt+K",
		description: "Open Kanban boards.",
		editing: true,
	},
	"view.graph": {
		label: "Workflows / Graph",
		group: "Navigation",
		keys: "Mod+Alt+G",
		description: "Open the graph workspace.",
		editing: true,
	},
	"view.browser": {
		label: "Browser Agent",
		group: "Navigation",
		keys: "Mod+Alt+B",
		description: "Open Browser Agent.",
		editing: true,
	},
	settings: {
		label: "Open Settings",
		group: "Navigation",
		keys: "Mod+Comma",
		description: "Open application settings.",
		editing: true,
	},
	shortcuts: {
		label: "Open shortcut settings",
		group: "Navigation",
		keys: "Mod+Alt+S",
		description: "Open Settings → Shortcuts.",
		editing: true,
	},
	"session.new": {
		label: "New coding session",
		group: "Workspace",
		keys: "Mod+N",
		description: "Use the existing new-session action and active-task guards.",
		editing: true,
	},
	"compose.focus": {
		label: "Focus composer",
		group: "Workspace",
		keys: "Mod+Alt+F",
		description: "Focus the visible prompt composer.",
		editing: true,
	},
	"files.toggle": {
		label: "Toggle file changes",
		group: "Workspace",
		keys: "Mod+Shift+F",
		description: "Show/hide the workspace file panel.",
		editing: true,
	},
	"terminal.toggle": {
		label: "Toggle activity/terminal panel",
		group: "Workspace",
		keys: "Mod+Backquote",
		description: "Show/hide the lower workspace panel.",
		editing: true,
	},
	"graph.validate": {
		label: "Validate graph",
		group: "Graph",
		keys: "Mod+Alt+V",
		description: "Validate a graph draft without dispatching work.",
		editing: true,
	},
	"graph.fit": {
		label: "Fit graph",
		group: "Graph",
		keys: "Mod+0",
		description: "Fit all graph nodes into the viewport.",
		editing: false,
	},
	"graph.layout": {
		label: "Auto layout graph",
		group: "Graph",
		keys: "Mod+Alt+L",
		description: "Arrange graph nodes.",
		editing: false,
	},
	"graph.remove": {
		label: "Remove selected graph node/edge",
		group: "Graph",
		keys: "Delete",
		description: "Remove the selection from the graph only; never deletes its source.",
		editing: false,
	},
	"browser.continue": {
		label: "Continue browser task",
		group: "Browser",
		keys: "Mod+Alt+C",
		description: "Continue the visible browser run through its existing resume action.",
		editing: true,
	},
	"browser.takeover": {
		label: "Take browser control",
		group: "Browser",
		keys: "Mod+Alt+T",
		description: "Request explicit human control.",
		editing: true,
	},
} as const;
export type DesktopAction = keyof typeof DEFAULT_DESKTOP_KEYBINDINGS;
export interface DesktopBinding {
	id: DesktopAction;
	action: string;
	group: string;
	description: string;
	keys: string;
	defaultKeys: string;
}
export type DesktopKeybindingOverrides = Partial<Record<DesktopAction, string>>;

const modifiers = ["mod", "ctrl", "meta", "alt", "shift"];
const aliases: Record<string, string> = {
	"ctrl/cmd": "mod",
	"cmd/ctrl": "mod",
	primary: "mod",
	control: "ctrl",
	cmd: "meta",
	command: "meta",
	option: "alt",
	esc: "escape",
	return: "enter",
	" ": "space",
	",": "comma",
	"`": "backquote",
	del: "delete",
	arrowup: "up",
	arrowdown: "down",
	arrowleft: "left",
	arrowright: "right",
};
const special = new Set([
	"escape",
	"enter",
	"tab",
	"space",
	"delete",
	"backspace",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	"comma",
	"backquote",
	"slash",
	"minus",
	"equal",
	...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
]);
export function canonicalChord(value: string): string {
	if (!value.trim()) return "";
	const parts = value
		.toLowerCase()
		.split("+")
		.map((part) => aliases[part.trim()] ?? part.trim());
	const key = parts.pop()!;
	if (
		!(/^[a-z0-9]$/.test(key) || special.has(key)) ||
		parts.some((part) => !modifiers.includes(part)) ||
		new Set(parts).size !== parts.length ||
		(parts.includes("mod") && (parts.includes("ctrl") || parts.includes("meta")))
	)
		throw new Error(`Invalid shortcut chord: ${value}`);
	return [...modifiers.filter((modifier) => parts.includes(modifier)), key].join("+");
}
export function formatChord(value: string): string {
	const canonical = canonicalChord(value);
	if (!canonical) return "";
	return canonical
		.split("+")
		.map(
			(part) =>
				({
					mod: "Ctrl/Cmd",
					ctrl: "Ctrl",
					meta: "Cmd",
					alt: "Alt",
					shift: "Shift",
					comma: ",",
					backquote: "`",
					slash: "/",
				})[part] ?? (part.length === 1 ? part.toUpperCase() : part[0]?.toUpperCase() + part.slice(1)),
		)
		.join("+");
}
function variants(value: string): string[] {
	const chord = canonicalChord(value);
	if (!chord) return [];
	return chord.startsWith("mod+")
		? [canonicalChord(chord.replace(/^mod/, "ctrl")), canonicalChord(chord.replace(/^mod/, "meta"))]
		: [chord];
}
export function bindingConflicts(rows: readonly { id: string; keys: string }[]): Set<string> {
	const taken = new Map<string, string>(),
		conflicts = new Set<string>();
	for (const row of rows) {
		for (const chord of variants(row.keys)) {
			const prior = taken.get(chord);
			if (prior) {
				conflicts.add(prior);
				conflicts.add(row.id);
			}
			taken.set(chord, row.id);
		}
	}
	return conflicts;
}
export function effectiveDesktopBindings(overrides: DesktopKeybindingOverrides = {}): DesktopBinding[] {
	return Object.entries(DEFAULT_DESKTOP_KEYBINDINGS).map(([id, definition]) => ({
		id: id as DesktopAction,
		action: definition.label,
		group: definition.group,
		description: definition.description,
		defaultKeys: formatChord(definition.keys),
		keys: formatChord(overrides[id as DesktopAction] ?? definition.keys),
	}));
}
export function parseDesktopKeybindings(value: unknown): DesktopKeybindingOverrides {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Shortcut overrides must be an object.");
	const overrides: DesktopKeybindingOverrides = {};
	for (const [id, chord] of Object.entries(value)) {
		if (!Object.hasOwn(DEFAULT_DESKTOP_KEYBINDINGS, id) || typeof chord !== "string" || chord.length > 100)
			throw new Error(`Unknown action or invalid shortcut: ${id}`);
		const normalized = canonicalChord(chord);
		if (
			normalized &&
			!normalized.includes("+") &&
			!(id === "compose.send" && normalized === "enter") &&
			!["escape", "delete"].includes(normalized) &&
			!/^f\d+$/.test(normalized)
		)
			throw new Error("Application shortcuts need a modifier; ordinary typing keys are reserved.");
		if (normalized !== canonicalChord(DEFAULT_DESKTOP_KEYBINDINGS[id as DesktopAction].keys))
			overrides[id as DesktopAction] = normalized;
	}
	const conflicts = bindingConflicts(effectiveDesktopBindings(overrides));
	if (conflicts.size) throw new Error(`Conflicting shortcuts: ${[...conflicts].join(", ")}`);
	return overrides;
}

export interface ShortcutKeyEvent {
	key: string;
	code?: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	isComposing?: boolean;
	repeat?: boolean;
	getModifierState?: (name: string) => boolean;
}
export function eventChord(event: ShortcutKeyEvent): string | undefined {
	if (
		event.isComposing ||
		event.getModifierState?.("AltGraph") ||
		["Control", "Alt", "Meta", "Shift"].includes(event.key)
	)
		return undefined;
	let key = aliases[event.key.toLowerCase()] ?? event.key.toLowerCase();
	if (event.altKey && event.code?.startsWith("Key")) key = event.code.slice(3).toLowerCase();
	if (event.altKey && event.code?.startsWith("Digit")) key = event.code.slice(5);
	try {
		return canonicalChord(
			[
				...(event.ctrlKey ? ["ctrl"] : []),
				...(event.metaKey ? ["meta"] : []),
				...(event.altKey ? ["alt"] : []),
				...(event.shiftKey ? ["shift"] : []),
				key,
			].join("+"),
		);
	} catch {
		return undefined;
	}
}
export function chordMatches(event: ShortcutKeyEvent, keys: string): boolean {
	const actual = eventChord(event);
	return actual !== undefined && variants(keys).includes(actual);
}
