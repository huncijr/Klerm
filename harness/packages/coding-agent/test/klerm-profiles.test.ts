import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { formatProfilePrompt, normalizeProfileState, profileIdFromName } from "../src/klerm/profiles.ts";

const dirs: string[] = [];

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Klerm profiles", () => {
	it("slugs a display name", () => {
		expect(profileIdFromName("Scout Fox")).toBe("scout-fox");
		expect(profileIdFromName("  ")).toBeUndefined();
	});

	it("fills default profiles when empty", () => {
		const state = normalizeProfileState({});
		expect(state.profiles.map((profile) => profile.id)).toEqual(["scout", "sage"]);
	});

	it("persists profile memory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "klerm-profiles-"));
		dirs.push(dir);
		const manager = SettingsManager.create(dir, dir);
		manager.upsertKlermProfile({
			id: "scout",
			name: "Scout",
			face: "fox",
			level: 2,
			memory: "Prefer local-first routing.",
			readme: "",
		});
		expect(manager.getKlermProfiles().profiles.find((profile) => profile.id === "scout")?.memory).toBe(
			"Prefer local-first routing.",
		);
		expect(formatProfilePrompt("Agent 1", manager.getKlermProfiles().profiles[0]!).includes("Profile memory")).toBe(
			true,
		);
	});
});
