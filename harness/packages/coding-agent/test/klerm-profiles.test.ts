import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	formatProfilePrompt,
	normalizeProfile,
	normalizeProfileState,
	profileIdFromName,
} from "../src/klerm/profiles.ts";

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
		expect(state.defaultSharedMemory).toBe("");
	});

	it("migrates legacy custom shared memory to the persistent default", () => {
		const state = normalizeProfileState({ sharedMemory: "Keep changes focused." });
		expect(state.sharedMemory).toBe("Keep changes focused.");
		expect(state.defaultSharedMemory).toBe("Keep changes focused.");
	});

	it("ships default Scout and Sage prompts with levels", () => {
		const state = normalizeProfileState({});
		const scout = state.profiles.find((profile) => profile.id === "scout")!;
		const sage = state.profiles.find((profile) => profile.id === "sage")!;
		expect(scout.level).toBe(1);
		expect(sage.level).toBe(3);
		expect(scout.memoryFormat).toBe("md");
		expect(sage.memoryFormat).toBe("md");
		for (const profile of [scout, sage]) {
			expect(profile.behaviour.length).toBeGreaterThan(0);
			expect(profile.workPlan.length).toBeGreaterThan(0);
			expect(profile.planMode.length).toBeGreaterThan(0);
			expect(profile.buildMode.length).toBeGreaterThan(0);
		}
		expect(scout.behaviour).toContain("Scout");
		expect(scout.behaviour).toContain("delegate_frontier");
		expect(sage.behaviour).toContain("Sage");
	});

	it("injects the role-specific mode prompt", () => {
		const state = normalizeProfileState({});
		const scout = state.profiles.find((profile) => profile.id === "scout")!;
		const planPrompt = formatProfilePrompt("Agent 1", scout, "planner");
		const buildPrompt = formatProfilePrompt("Agent 1", scout, "builder");
		expect(planPrompt).toContain("Profile behaviour:");
		expect(planPrompt).toContain("Profile work plan:");
		expect(planPrompt).toContain("Profile planner mode:");
		expect(planPrompt).not.toContain("Profile builder mode:");
		expect(buildPrompt).toContain("Profile builder mode:");
		expect(buildPrompt).not.toContain("Profile planner mode:");
	});

	it("migrates legacy memory and readme fields", () => {
		const profile = normalizeProfile({ id: "scout", name: "Scout", memory: "Old memory", readme: "Old readme" });
		expect(profile?.behaviour).toBe("Old memory");
		expect(profile?.workPlan).toBe("Old readme");
		expect(profile?.planMode.length).toBeGreaterThan(0);
	});

	it("persists profile behaviour", async () => {
		const dir = await mkdtemp(join(tmpdir(), "klerm-profiles-"));
		dirs.push(dir);
		const manager = SettingsManager.create(dir, dir);
		manager.upsertKlermProfile({
			id: "scout",
			name: "Scout",
			face: "fox",
			level: 1,
			behaviour: "Prefer local-first routing.",
			workPlan: "",
			planMode: "",
			buildMode: "",
			memoryFormat: "md",
			memory: "",
			readme: "",
		});
		manager.assignKlermProfile("local", "scout");
		await manager.flush();
		const reloaded = SettingsManager.create(dir, dir);
		expect(reloaded.getKlermProfiles().profiles.find((profile) => profile.id === "scout")?.behaviour).toBe(
			"Prefer local-first routing.",
		);
		expect(reloaded.getKlermProfiles().localProfileId).toBe("scout");
		expect(formatProfilePrompt("Agent 1", reloaded.getKlermProfiles().profiles[0]!, "builder")).toContain(
			"Profile behaviour:",
		);
	});

	it("persists, selects, and deletes shared-memory presets", async () => {
		const dir = await mkdtemp(join(tmpdir(), "klerm-shared-memory-"));
		dirs.push(dir);
		const manager = SettingsManager.create(dir, dir);
		manager.setKlermSharedMemory("Default project rules.");
		manager.saveKlermSharedMemoryPreset("Project Rules", "Run focused verification.");
		await manager.flush();

		const reloaded = SettingsManager.create(dir, dir);
		expect(reloaded.getKlermProfiles()).toMatchObject({
			sharedMemory: "Run focused verification.",
			defaultSharedMemory: "Default project rules.",
			selectedSharedMemoryPresetId: "project-rules",
			sharedMemoryPresets: [{ id: "project-rules", name: "Project Rules", memory: "Run focused verification." }],
		});
		reloaded.setKlermDefaultSharedMemory("Updated default rules.");
		expect(reloaded.getKlermProfiles()).toMatchObject({
			sharedMemory: "Run focused verification.",
			defaultSharedMemory: "Updated default rules.",
			selectedSharedMemoryPresetId: "project-rules",
		});
		reloaded.deleteKlermSharedMemoryPreset("project-rules");
		expect(reloaded.getKlermProfiles()).toMatchObject({
			sharedMemory: "Updated default rules.",
			defaultSharedMemory: "Updated default rules.",
			sharedMemoryPresets: [],
		});
		expect(reloaded.getKlermProfiles().selectedSharedMemoryPresetId).toBeUndefined();
	});
});
