import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadCustomModels,
	removeCustomModel,
	updateModelsProviderFields,
	upsertCustomModel,
} from "../src/klerm/custom-models.ts";

const dirs: string[] = [];

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("custom models.json helpers", () => {
	it("adds and removes a credential-free custom model", async () => {
		const dir = await mkdtemp(join(tmpdir(), "klerm-models-"));
		dirs.push(dir);
		const path = join(dir, "models.json");
		await upsertCustomModel(path, {
			provider: "local-openai",
			id: "demo",
			name: "Demo",
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:1234/v1",
		});
		expect(await loadCustomModels(path)).toEqual([
			{
				provider: "local-openai",
				id: "demo",
				name: "Demo",
				api: "openai-completions",
				baseUrl: "http://127.0.0.1:1234/v1",
			},
		]);
		expect(await removeCustomModel(path, "local-openai", "demo")).toBe(true);
		expect(await loadCustomModels(path)).toEqual([]);
	});

	it("sets and clears provider fields without touching models", async () => {
		const dir = await mkdtemp(join(tmpdir(), "klerm-models-"));
		dirs.push(dir);
		const path = join(dir, "models.json");
		await upsertCustomModel(path, {
			provider: "local-openai",
			id: "demo",
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:1234/v1",
		});
		await updateModelsProviderFields(path, "local-openai", { baseUrl: "http://10.0.0.1:8080/v1" });
		expect(await loadCustomModels(path)).toHaveLength(1);
		await updateModelsProviderFields(path, "local-openai", { baseUrl: "" });
		expect(await loadCustomModels(path)).toHaveLength(1);
	});
});
