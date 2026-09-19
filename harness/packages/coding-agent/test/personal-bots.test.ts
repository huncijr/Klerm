import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	appendPersonalBotConversationEvent,
	createPersonalBotConversation,
	createPersonalBotConversationSummary,
	createPersonalBotFallbackSummary,
	formatPersonalBotSummaryMarkdown,
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
			{ id: "bot-scout", name: "Scout", profileId: "scout", role: "planner", enabled: false },
			{ id: "bot-sage", name: "Sage", profileId: "sage", role: "planner", enabled: false },
			{ id: "bot-builder", name: "Builder", profileId: "builder", role: "planner", enabled: false },
		]);
	});

	test("migrates existing builder bots to discussion-only planner bots", () => {
		const registry = normalizePersonalBotRegistry({
			version: 1,
			defaultsInitialized: true,
			bots: [{ ...normalizePersonalBotRegistry(undefined).bots[0], role: "builder" }],
		});
		expect(registry.bots[0]?.role).toBe("planner");
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
		(conversation as unknown as { role: string }).role = "builder";
		conversation.status = "summarizing";
		await savePersonalBotConversation(agentDir, conversation);

		await expect(loadPersonalBotConversation(agentDir, bot, cwd)).resolves.toMatchObject({
			id: conversation.id,
			botId: "bot-scout",
			role: "planner",
			status: "failed",
			linkedSuccessfulPromptCount: 0,
			pendingSummarySources: [],
			summaries: [],
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

	test("migrates the legacy single summary into an immutable summary history", async () => {
		mkdirSync(join(agentDir, "personal-bots", "bot-scout"), { recursive: true });
		const bot = SettingsManager.create(cwd, agentDir).getPersonalBots().bots[0]!;
		const conversation = createPersonalBotConversation(bot, cwd);
		const legacy = {
			...conversation,
			summary: {
				text: "## Decisions\n\nKeep the stable link.",
				updatedAt: "2026-09-17T00:00:00.000Z",
				sourceMessageCount: 6,
				digest: "abcdef1234567890",
			},
		};
		delete (legacy as { summaries?: unknown }).summaries;
		delete (legacy as { linkedSuccessfulPromptCount?: unknown }).linkedSuccessfulPromptCount;
		delete (legacy as { pendingSummarySources?: unknown }).pendingSummarySources;
		await savePersonalBotConversation(
			agentDir,
			legacy as unknown as ReturnType<typeof createPersonalBotConversation>,
		);

		await expect(loadPersonalBotConversation(agentDir, bot, cwd)).resolves.toMatchObject({
			linkedSuccessfulPromptCount: 0,
			pendingSummarySources: [],
			summaries: [
				{
					id: "summary-migrated-abcdef1234567890",
					ordinal: 1,
					source: "legacy-conversation",
					linkedPromptRange: { start: 0, end: 0 },
					text: expect.stringMatching(
						/^# Personal Bot Summary\n\n## Linked Agent Task Range\n\n0-0\n\n## Summary\n\n## Decisions/,
					),
					timestamp: "2026-09-17T00:00:00.000Z",
				},
			],
		});
	});

	test("formats bounded Markdown summaries while preserving useful Markdown", () => {
		const markdown = formatPersonalBotSummaryMarkdown(
			"**Decision:** keep it.\n\n| Item | State |\n| --- | --- |\n| Link | stable |",
			{ start: 4, end: 6 },
			120,
		);
		expect(markdown).toMatch(/^# Personal Bot Summary\n\n## Linked Agent Task Range\n\n4-6\n\n## Summary\n\n/);
		expect(markdown).toContain("**Decision:**");
		expect(markdown.length).toBeLessThanOrEqual(120);
		const summary = createPersonalBotConversationSummary("## Decision\nKeep it.", 2, { start: 4, end: 6 }, 12, "now");
		expect(summary).toMatchObject({ ordinal: 2, linkedPromptRange: { start: 4, end: 6 }, timestamp: "now" });
		expect(summary.id).toBe("bot-summary-6");
	});

	test("creates a useful deterministic summary when model synthesis is unavailable", () => {
		const text = createPersonalBotFallbackSummary([
			{
				id: "task-1",
				agentId: "agent5",
				linkedPromptOrdinal: 1,
				userPrompt: "Plan the implementation",
				finalResponse: "Prepared the implementation plan and delegated the build.",
				timestamp: "2026-09-19T00:00:00.000Z",
			},
		]);
		expect(text).toContain("**agent5** - Prepared the implementation plan");
		expect(text).toContain("Request: Plan the implementation");
		expect(text).toContain("model synthesis was unavailable");
	});
});
