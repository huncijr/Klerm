import { getContext } from "svelte";
import {
	bindingConflicts,
	canonicalChord,
	chordMatches,
	DEFAULT_DESKTOP_KEYBINDINGS,
	type DesktopAction,
	type DesktopBinding,
	effectiveDesktopBindings,
	eventChord,
	formatChord,
	type ShortcutKeyEvent,
} from "../../../coding-agent/src/klerm/desktop-keybindings.ts";
export { DEFAULT_DESKTOP_KEYBINDINGS, effectiveDesktopBindings, formatChord };
export type { DesktopAction, DesktopBinding };
export const SHORTCUT_CONTEXT = Symbol("klerm-desktop-shortcuts");
export interface ShortcutDraft {
	id: string;
	action: string;
	keys: string;
}
export function normalizeShortcut(event: ShortcutKeyEvent): string | undefined {
	const chord = eventChord(event);
	return chord ? formatChord(chord) : undefined;
}
export function shortcutConflicts(shortcuts: readonly ShortcutDraft[]): Set<string> {
	return bindingConflicts(shortcuts);
}
export function shortcutsEqual(first: readonly ShortcutDraft[], second: readonly ShortcutDraft[]): boolean {
	return (
		first.length === second.length &&
		first.every(
			(row, index) =>
				row.id === second[index]?.id && canonicalChord(row.keys) === canonicalChord(second[index]!.keys),
		)
	);
}

type Handler = {
	action: DesktopAction;
	execute: () => unknown;
	enabled?: () => boolean;
	when?: () => boolean;
	priority: number;
	order: number;
};
export interface RoutedShortcutEvent extends ShortcutKeyEvent {
	defaultPrevented?: boolean;
	target?: unknown;
	preventDefault(): void;
	stopPropagation(): void;
}
export class DesktopShortcutManager {
	private readonly bindings: () => readonly DesktopBinding[];
	private readonly onerror: (error: unknown) => void;
	private readonly handlers = new Map<symbol, Handler>();
	private order = 0;
	constructor(bindings: () => readonly DesktopBinding[], onerror: (error: unknown) => void) {
		this.bindings = bindings;
		this.onerror = onerror;
	}
	register(
		action: DesktopAction,
		execute: Handler["execute"],
		enabled?: () => boolean,
		priority = 10,
		when?: () => boolean,
	): () => void {
		const token = Symbol();
		this.handlers.set(token, { action, execute, enabled, when, priority, order: ++this.order });
		return () => {
			this.handlers.delete(token);
		};
	}
	label(action: DesktopAction): string {
		return this.bindings().find((binding) => binding.id === action)?.keys ?? "";
	}
	matches(event: ShortcutKeyEvent, action: DesktopAction): boolean {
		return !event.repeat && !event.isComposing && chordMatches(event, this.label(action));
	}
	handle(event: RoutedShortcutEvent): boolean {
		if (event.defaultPrevented || event.repeat || event.isComposing) return false;
		const target =
			event.target &&
			typeof event.target === "object" &&
			"closest" in event.target &&
			typeof event.target.closest === "function"
				? (event.target as { closest: (selector: string) => unknown })
				: undefined;
		if (
			target?.closest(
				'[data-shortcut-recorder="true"],[data-native-keyboard="true"],[aria-label="Interactive Chromium page"],[aria-label="Personal Agent Chromium page"]',
			)
		)
			return false;
		const binding = this.bindings().find((row) => chordMatches(event, row.keys));
		if (!binding) return false;
		if (
			!DEFAULT_DESKTOP_KEYBINDINGS[binding.id].editing &&
			target?.closest("input,textarea,select,[contenteditable=true]")
		)
			return false;
		const handler = [...this.handlers.values()]
			.filter((entry) => entry.action === binding.id && (!entry.when || entry.when()))
			.sort((a, b) => b.priority - a.priority || b.order - a.order)[0];
		if (!handler) return false;
		// A disabled foreground action consumes its chord, rather than acting on
		// a different editor/task hidden behind the current view.
		event.preventDefault();
		event.stopPropagation();
		if (!handler.enabled || handler.enabled()) {
			try {
				void Promise.resolve(handler.execute()).catch(this.onerror);
			} catch (error) {
				this.onerror(error);
			}
		}
		return true;
	}
}
export function useDesktopShortcuts(): DesktopShortcutManager | undefined {
	return getContext(SHORTCUT_CONTEXT);
}
