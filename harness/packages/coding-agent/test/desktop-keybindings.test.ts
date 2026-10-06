import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCliKeybindings, saveCliKeybindings, validCliChord } from "../src/klerm/cli-keybinding-store.ts";
import { getDesktopKeybindings, saveDesktopKeybindings } from "../src/klerm/desktop-keybinding-store.ts";
import {
	bindingConflicts,
	canonicalChord,
	chordMatches,
	effectiveDesktopBindings,
	eventChord,
	parseDesktopKeybindings,
} from "../src/klerm/desktop-keybindings.ts";

describe("configurable application chords", () => {
	it("has conflict-free defaults and matches Ctrl/Cmd, physical Alt keys and exact modifiers", () => {
		expect(bindingConflicts(effectiveDesktopBindings()).size).toBe(0);
		const key = { key: "b", code: "KeyB", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false };
		expect(chordMatches(key, "Ctrl/Cmd+Alt+B")).toBe(true);
		expect(chordMatches({ ...key, ctrlKey: false, metaKey: true, key: "∫" }, "Mod+Alt+B")).toBe(true);
		expect(chordMatches({ ...key, shiftKey: true }, "Mod+Alt+B")).toBe(false);
		expect(eventChord({ ...key, getModifierState: () => true })).toBeUndefined();
		expect(eventChord({ ...key, isComposing: true })).toBeUndefined();
		expect(canonicalChord("Shift+Control+S")).toBe("ctrl+shift+s");
	});
	it("rejects cross-alias conflicts, unknown actions and ordinary typing-key hijacks", () => {
		expect(() => parseDesktopKeybindings({ save: "Ctrl+Alt+B" })).toThrow("Conflicting");
		expect(() => parseDesktopKeybindings({ unknown: "F9" })).toThrow("Unknown");
		expect(() => parseDesktopKeybindings({ settings: "s" })).toThrow("modifier");
		expect(parseDesktopKeybindings({ save: "", "compose.send": "Enter" })).toEqual({ save: "" });
	});
	it("persists overrides without pinning untouched defaults, and does not replace valid data on an invalid edit", async () => {
		const root = await mkdtemp(join(tmpdir(), "klerm-desktop-keys-"));
		try {
			await saveDesktopKeybindings(root, { save: "F9", close: "Escape" });
			expect((await getDesktopKeybindings(root)).find((row) => row.id === "save")?.keys).toBe("F9");
			const file = join(root, "desktop-keybindings.json");
			expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ save: "f9" });
			await expect(saveDesktopKeybindings(root, { save: "Mod+N" })).rejects.toThrow("Conflicting");
			expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ save: "f9" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("native CLI/TUI configuration", () => {
	it("exposes real session/editor actions, accepts native keys and preserves extension overrides", async () => {
		const root = await mkdtemp(join(tmpdir(), "klerm-cli-keys-"));
		try {
			const rows = getCliKeybindings(root);
			expect(rows.find((row) => row.id === "app.session.new")?.keys).toEqual(["ctrl+alt+n"]);
			expect(rows.find((row) => row.id === "app.models.save")?.keys).toEqual(["ctrl+s"]);
			await writeFile(join(root, "keybindings.json"), JSON.stringify({ "extension.custom": "ctrl+y" }));
			await saveCliKeybindings(root, { "app.session.new": ["ctrl+alt+m"] });
			expect(getCliKeybindings(root).find((row) => row.id === "app.session.new")?.keys).toEqual(["ctrl+alt+m"]);
			expect(JSON.parse(await readFile(join(root, "keybindings.json"), "utf8"))).toMatchObject({
				"extension.custom": "ctrl+y",
			});
			await expect(saveCliKeybindings(root, { "app.session.new": ["ctrl+ctrl+s"] })).rejects.toThrow("Invalid");
			expect(validCliChord("ctrl++")).toBe(true);
			expect(validCliChord("alt+pageUp")).toBe(true);
			expect(validCliChord("cmd+s")).toBe(false);
			await saveCliKeybindings(root, { "app.session.new": ["ctrl+alt+n"] });
			expect(JSON.parse(await readFile(join(root, "keybindings.json"), "utf8"))).not.toHaveProperty(
				"app.session.new",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
