import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { summarizeProjectExtracts } from "../src/klerm/projects.ts";

describe("persistent project registry", () => {
	const root = join(process.cwd(), "test-projects-tmp");
	const agentDir = join(root, "agent");
	const cwd = join(root, "workspace");

	afterEach(() => {
		if (existsSync(root)) rmSync(root, { recursive: true });
	});

	test("persists the deterministic default and stable session membership globally", async () => {
		mkdirSync(cwd, { recursive: true });
		const manager = SettingsManager.create(cwd, agentDir);
		expect(manager.getProjectRegistry()).toEqual({
			version: 1,
			defaultProjectId: "project-default",
			projects: [{ id: "project-default", name: "My New Project" }],
			sessionProjects: {},
		});
		manager.createProject("project-work", "Work");
		manager.moveSessionToProject("stable-session-id", "project-work");
		await manager.flush();

		const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>;
		expect(settings.projectRegistry).toMatchObject({
			version: 1,
			defaultProjectId: "project-default",
			sessionProjects: { "stable-session-id": "project-work" },
		});
		expect(SettingsManager.create(cwd, agentDir).getProjectRegistry().sessionProjects).toEqual({
			"stable-session-id": "project-work",
		});

		manager.deleteProject("project-work");
		await manager.flush();
		expect(manager.getProjectRegistry().sessionProjects).toEqual({});
	});

	test("imports legacy desktop assignments only once", () => {
		mkdirSync(cwd, { recursive: true });
		const manager = SettingsManager.create(cwd, agentDir);
		manager.importLegacyProjects([{ id: "legacy", name: "Legacy" }], { "session-1": "legacy" });
		manager.moveSessionToProject("session-1", "project-default");

		manager.importLegacyProjects([{ id: "legacy", name: "Legacy" }], { "session-1": "legacy" });

		expect(manager.getProjectRegistry()).toMatchObject({
			legacyDesktopImportCompleted: true,
			sessionProjects: { "session-1": "project-default" },
		});
	});

	test("builds a concise deterministic summary from recent labeled extracts", () => {
		const summary = summarizeProjectExtracts("Work", [
			{
				sessionId: "session-1",
				sessionName: "Architecture",
				role: "user",
				timestamp: "2026-01-01T00:00:00.000Z",
				label: "[Session: Architecture | session-1 | user]",
				text: "Use stable session IDs.",
			},
			{
				sessionId: "session-1",
				sessionName: "Architecture",
				role: "assistant",
				timestamp: "2026-01-01T00:01:00.000Z",
				label: "[Session: Architecture | session-1 | assistant]",
				text: "The registry now uses stable IDs.",
			},
		]);

		expect(summary).toBe(
			"Project: Work\nAssigned sessions: 1\n\nArchitecture\nuser: Use stable session IDs.\nassistant: The registry now uses stable IDs.",
		);
	});
});
