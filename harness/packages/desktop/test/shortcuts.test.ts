import { describe, expect, test, vi } from "vitest";
import { DesktopShortcutManager, effectiveDesktopBindings, type RoutedShortcutEvent } from "../src/lib/shortcuts.ts";

function event(key = "s", extra: Partial<RoutedShortcutEvent> = {}): RoutedShortcutEvent {
	return {
		key,
		code: `Key${key.toUpperCase()}`,
		ctrlKey: true,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		defaultPrevented: false,
		repeat: false,
		isComposing: false,
		target: null,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
		...extra,
	};
}
describe("context-owned shortcut routing", () => {
	test("foreground save wins, disabled save does not act on hidden editor, and unmount restores previous owner", () => {
		const manager = new DesktopShortcutManager(
			() => effectiveDesktopBindings(),
			() => {},
		);
		const file = vi.fn(),
			graph = vi.fn();
		manager.register("save", file, undefined, 5);
		let enabled = true;
		const remove = manager.register("save", graph, () => enabled, 10);
		expect(manager.handle(event())).toBe(true);
		expect(graph).toHaveBeenCalledTimes(1);
		expect(file).not.toHaveBeenCalled();
		enabled = false;
		manager.handle(event());
		expect(file).not.toHaveBeenCalled();
		remove();
		manager.handle(event());
		expect(file).toHaveBeenCalledTimes(1);
	});
	test("new bindings become live without rebuilding or closing the view", () => {
		let rows = effectiveDesktopBindings();
		const manager = new DesktopShortcutManager(
				() => rows,
				() => {},
			),
			save = vi.fn();
		manager.register("save", save);
		rows = effectiveDesktopBindings({ save: "F9" });
		expect(manager.handle(event())).toBe(false);
		expect(manager.handle(event("F9", { ctrlKey: false, code: "F9" }))).toBe(true);
		expect(save).toHaveBeenCalledTimes(1);
	});
	test("repeat, IME, prevented events and inactive menus do not trigger app operations", () => {
		const manager = new DesktopShortcutManager(
				() => effectiveDesktopBindings(),
				() => {},
			),
			execute = vi.fn();
		manager.register("save", execute);
		expect(manager.handle(event("s", { repeat: true }))).toBe(false);
		expect(manager.handle(event("s", { isComposing: true }))).toBe(false);
		expect(manager.handle(event("s", { defaultPrevented: true }))).toBe(false);
		expect(manager.matches(event("Enter", { ctrlKey: false, repeat: true }), "compose.send")).toBe(false);
		expect(manager.matches(event("Enter", { ctrlKey: false, isComposing: true }), "compose.send")).toBe(false);
		expect(execute).not.toHaveBeenCalled();
		const close = vi.fn(),
			menu = vi.fn();
		manager.register("close", close, undefined, 0);
		manager.register("close", menu, undefined, 40, () => false);
		manager.handle(event("Escape", { ctrlKey: false, code: "Escape" }));
		expect(close).toHaveBeenCalledOnce();
		expect(menu).not.toHaveBeenCalled();
	});
	test("shortcut recorder/native browser boundaries and text Delete keep their own keyboard", () => {
		const manager = new DesktopShortcutManager(
				() => effectiveDesktopBindings(),
				() => {},
			),
			save = vi.fn(),
			remove = vi.fn();
		manager.register("save", save);
		manager.register("graph.remove", remove);
		const native = { closest: (query: string) => (query.includes("data-native-keyboard") ? {} : null) };
		expect(manager.handle({ ...event(), target: native })).toBe(false);
		const recorder = { closest: (query: string) => (query.includes("data-shortcut-recorder") ? {} : null) };
		expect(manager.handle({ ...event(), target: recorder })).toBe(false);
		const input = { closest: (query: string) => (query.includes("textarea") ? {} : null) };
		expect(manager.handle({ ...event("Delete", { ctrlKey: false, code: "Delete" }), target: input })).toBe(false);
		expect(save).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
	});
	test("focused run ownership and async failures do not fall through to another task", async () => {
		const onerror = vi.fn();
		const manager = new DesktopShortcutManager(() => effectiveDesktopBindings(), onerror);
		const sharedRun = vi.fn();
		const failure = new Error("Focused agent rejected the prompt");
		let focused = true;
		manager.register("run", sharedRun, undefined, 10);
		manager.register(
			"run",
			async () => {
				throw failure;
			},
			undefined,
			20,
			() => focused,
		);
		manager.handle(event("Enter", { shiftKey: true }));
		await vi.waitFor(() => expect(onerror).toHaveBeenCalledWith(failure));
		expect(sharedRun).not.toHaveBeenCalled();
		focused = false;
		manager.handle(event("Enter", { shiftKey: true }));
		expect(sharedRun).toHaveBeenCalledOnce();
	});
});
