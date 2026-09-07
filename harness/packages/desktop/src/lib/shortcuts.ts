export interface ShortcutDraft {
	action: string;
	keys: string;
}

export function normalizeShortcut(event: {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}): string | undefined {
	if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta")
		return undefined;
	const parts: string[] = [];
	if (event.metaKey || event.ctrlKey)
		parts.push(event.metaKey && event.ctrlKey ? "Ctrl/Cmd" : event.metaKey ? "Cmd" : "Ctrl");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
	parts.push(key === " " ? "Space" : key);
	return parts.join("+");
}

export function shortcutConflicts(shortcuts: readonly ShortcutDraft[]): Set<string> {
	const counts = new Map<string, number>();
	for (const shortcut of shortcuts) {
		const key = shortcut.keys.trim().toLowerCase();
		if (!key) continue;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}
