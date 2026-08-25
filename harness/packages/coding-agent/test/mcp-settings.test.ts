import { describe, expect, it } from "vitest";
import { InMemorySettingsStorage, SettingsManager, type SettingsStorage } from "../src/core/settings-manager.ts";

function writeSettings(storage: SettingsStorage, scope: "global" | "project", settings: unknown): void {
	storage.withLock(scope, () => JSON.stringify(settings));
}

describe("MCP settings", () => {
	it("replaces global server entries with trusted project entries without merging secrets", () => {
		const storage = new InMemorySettingsStorage();
		writeSettings(storage, "global", {
			mcpServers: {
				work: { command: "trusted-server", args: ["global"], env: { SECRET: "hidden" } },
			},
		});
		writeSettings(storage, "project", {
			mcpServers: {
				work: { command: "project-server", args: ["project"] },
			},
		});

		const manager = SettingsManager.fromStorage(storage, { projectTrusted: true });

		expect(manager.getMcpServers()).toEqual({
			work: { command: "project-server", args: ["project"] },
		});
	});

	it("ignores untrusted project MCP settings and persists scoped updates", async () => {
		const storage = new InMemorySettingsStorage();
		writeSettings(storage, "global", { mcpServers: { global: { command: "global-server" } } });
		writeSettings(storage, "project", { mcpServers: { project: { command: "project-server" } } });
		const manager = SettingsManager.fromStorage(storage, { projectTrusted: false });

		expect(manager.getMcpServers()).toEqual({ global: { command: "global-server" } });
		expect(() => manager.setMcpServer("blocked", { command: "blocked" }, "project")).toThrow("not trusted");

		manager.setMcpServer("added", { command: "node", args: ["server.mjs"] });
		expect(manager.setMcpServerEnabled("added", false)).toBe(true);
		expect(manager.removeMcpServer("global")).toBe(true);
		await manager.flush();

		const reloaded = SettingsManager.fromStorage(storage, { projectTrusted: false });
		expect(reloaded.getMcpServers()).toEqual({
			added: { command: "node", args: ["server.mjs"], enabled: false },
		});
	});

	it("preserves server updates written by another settings manager", async () => {
		const storage = new InMemorySettingsStorage();
		const first = SettingsManager.fromStorage(storage);
		const second = SettingsManager.fromStorage(storage);

		first.setMcpServer("first", { command: "first-server" });
		second.setMcpServer("second", { command: "second-server" });
		await first.flush();
		await second.flush();

		const reloaded = SettingsManager.fromStorage(storage);
		expect(reloaded.getMcpServers()).toEqual({
			first: { command: "first-server" },
			second: { command: "second-server" },
		});
	});
});
