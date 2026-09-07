import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	groupProviderAccounts,
	orderProviderAccounts,
	orderProviderGroups,
	providerLabel,
} from "../../desktop/src/lib/provider-cards.ts";
import { providerLogoSrc } from "../../desktop/src/lib/provider-logos.ts";
import { shortcutConflicts } from "../../desktop/src/lib/shortcuts.ts";

const logoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "Logo", "providers");

function account(id: string, configured: boolean) {
	return { id, label: providerLabel(id), models: ["a"], configured, local: false, supportsOauth: false };
}

describe("desktop settings helpers", () => {
	it("marks duplicate shortcut chords", () => {
		const conflicts = shortcutConflicts([
			{ action: "Send", keys: "Ctrl+Enter" },
			{ action: "Stop", keys: "Escape" },
			{ action: "Save", keys: "ctrl+enter" },
		]);
		expect(conflicts.has("ctrl+enter")).toBe(true);
		expect(conflicts.has("escape")).toBe(false);
	});

	it("orders curated providers first", () => {
		const ordered = orderProviderAccounts([
			account("zai", false),
			account("openai", true),
			account("anthropic", true),
		]);
		expect(ordered.map((item) => item.id)).toEqual(["anthropic", "openai", "zai"]);
		expect(providerLabel("openai-codex")).toBe("Codex");
	});

	it("merges OpenAI and Codex into one group", () => {
		const groups = orderProviderGroups(
			groupProviderAccounts([account("openai-codex", false), account("zai", false), account("openai", true)]),
		);
		expect(groups.map((group) => group.id)).toEqual(["openai", "zai"]);
		expect(groups[0]?.label).toBe("OpenAI");
		expect(groups[0]?.members.map((member) => member.id).sort()).toEqual(["openai", "openai-codex"]);
	});

	it("maps every logo file on disk", () => {
		for (const id of ["anthropic", "openai", "google", "ollama", "deepseek", "mistral"]) {
			const src = providerLogoSrc(id);
			expect(src).toBeDefined();
			expect(existsSync(join(logoDir, src!.replace("/providers/", "")))).toBe(true);
		}
		expect(providerLogoSrc("no-such-provider")).toBeUndefined();
	});
});
