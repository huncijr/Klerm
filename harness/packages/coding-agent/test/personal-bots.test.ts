import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	appendPersonalBotConversationEvent,
	createPersonalBotConversation,
	loadPersonalBotConversation,
	savePersonalBotConversation,
} from "../src/klerm/personal-bot-conversations.ts";
import { normalizePersonalBotRegistry } from "../src/klerm/personal-bots.ts";

describe("Personal Bot registry", () => {
	const root = join(process.cwd(), "test-personal-bots-tmp");
	const agentDir = join(root, "agent");
	const cwd = join(root, "workspace");

	afterEach(() => {
		if (existsSync(root)) rmSync(root, { recursive: true });
	});

	test("ships three stable disabled defaults", () => {
		expect(normalizePersonalBotRegistry(undefined).bots).toMatchObject([
			{ id: "bot-scout", name: "Scout", profileId: "scout", enabled: false },
			{ id: "bot-sage", name: "Sage", profileId: "sage", enabled: false },
			{ id: "bot-builder", name: "Builder", profileId: "builder", enabled: false },
		]);
	});

	test("persists validated bot updates and preserves creation order", async () => {
		mkdirSync(cwd, { recursive: true });
		const manager = SettingsManager.create(cwd, agentDir);
		const scout = manager.getPersonalBots().bots[0]!;
		manager.upsertPersonalBot({ ...scout, model: "openai/gpt-5", enabled: true, effort: "high" });
		await manager.flush();

		const reloaded = SettingsManager.create(cwd, agentDir);
		expect(reloaded.getPersonalBots().bots[0]).toMatchObject({
			id: "bot-scout",
			model: "openai/gpt-5",
			enabled: true,
			effort: "high",
			createdSequence: 1,
		});
	});

	test("does not recreate a default after a persisted deletion", async () => {
		mkdirSync(cwd, { recursive: true });
		const manager = SettingsManager.create(cwd, agentDir);
		manager.deletePersonalBot("bot-scout");
		await manager.flush();

		expect(
			SettingsManager.create(cwd, agentDir)
				.getPersonalBots()
				.bots.map((bot) => bot.id),
		).toEqual(["bot-sage", "bot-builder"]);
	});

	test("rejects unknown personality profiles", () => {
		mkdirSync(cwd, { recursive: true });
		const manager = SettingsManager.create(cwd, agentDir);
		expect(() =>
			manager.upsertPersonalBot({
				...manager.getPersonalBots().bots[0]!,
				profileId: "missing-profile",
			}),
		).toThrow("Invalid Personal Bot");
	});

	test("rejects oversized fields instead of truncating typed updates", () => {
		mkdirSync(cwd, { recursive: true });
		const manager = SettingsManager.create(cwd, agentDir);
		expect(() =>
			manager.upsertPersonalBot({
				...manager.getPersonalBots().bots[0]!,
				name: "x".repeat(41),
			}),
		).toThrow("Invalid Personal Bot");
	});

	test("persists an independent conversation outside settings", async () => {
		mkdirSync(cwd, { recursive: true });
		const bot = SettingsManager.create(cwd, agentDir).getPersonalBots().bots[0]!;
		const conversation = createPersonalBotConversation(bot, cwd);
		conversation.messages.push({
			id: "message-1",
			role: "user",
			text: "Map the repository.",
			timestamp: "2026-09-17T00:00:00.000Z",
		});
		await savePersonalBotConversation(agentDir, conversation);

		await expect(loadPersonalBotConversation(agentDir, bot, cwd)).resolves.toMatchObject({
			id: conversation.id,
			botId: "bot-scout",
			messages: [{ role: "user", text: "Map the repository." }],
		});
		for (const sequence of [1, 2]) {
			await appendPersonalBotConversationEvent(cwd, {
				version: 1,
				timestamp: `2026-09-17T00:00:0${sequence}.000Z`,
				sequence,
				conversationId: conversation.id,
				botId: bot.id,
				event: sequence === 1 ? "PROMPT_ACCEPTED" : "PROMPT_COMPLETED",
				harness: bot.harness,
				model: bot.model ?? "",
				reason: "test",
			});
		}
		const events = readFileSync(join(cwd, ".klerm", "personal-bot-events.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { sequence: number });
		expect(events.map((event) => event.sequence)).toEqual([1, 2]);
	});
});
