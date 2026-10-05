import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodingHarnessSetup } from "../src/klerm/coding-harness-setup.ts";
import { type GraphCatalogContext, graphCatalog, graphSourceDetails } from "../src/klerm/graph-catalog.ts";

function context(root: string): GraphCatalogContext {
	return {
		agentDir: root,
		bots: [
			{
				id: "bot-first",
				name: "Builder",
				face: "bear",
				profileId: "builder",
				harness: "klerm",
				model: "provider/model",
				role: "planner",
				effort: "medium",
				enabled: true,
				createdSequence: 1,
				kanbanEnabled: true,
			},
		],
		harnesses: createCodingHarnessSetup(
			{
				externalHarnessesEnabled: false,
				agents: [{ id: "agent1", kind: "klerm", enabled: true, role: "builder", effort: "off", tools: [] }],
			},
			[],
		),
		kanban: {
			version: 1,
			boards: [
				{
					id: "board",
					name: "Shared",
					workspaceRoot: root,
					createdAt: "now",
					updatedAt: "now",
					createdSequence: 1,
					tasks: [
						{
							id: "task",
							title: "Existing work",
							prompt: "private task brief",
							workspaceRoot: root,
							kind: "build",
							reasoning: "off",
							status: "review",
							personalBotId: "bot-first",
							createdAt: "now",
							updatedAt: "now",
							createdSequence: 1,
							attempts: [
								{
									id: "attempt",
									sequence: 1,
									status: "succeeded",
									model: "original/model",
									reasoning: "medium",
									workspaceRoot: root,
									startedAt: "then",
									finishedAt: "later",
									result: "Original saved report",
									steps: [{ id: "verify", label: "Recorded check", status: "completed" }],
									activity: [
										{
											boardId: "board",
											taskId: "task",
											kind: "writing",
											text: "Writing src/a.ts",
											timestamp: "then",
										},
									],
									evidence: {
										mode: "build",
										workspaceRoot: root,
										changedFiles: ["src/a.ts"],
										verification: ["npm test"],
										outcome: "implemented-verified",
									},
								},
							],
						},
					],
				},
			],
		},
	};
}
describe("existing graph sources", () => {
	it("filters by actual assignment, paginates stable references, and preserves past model/evidence", async () => {
		const root = await mkdtemp(join(tmpdir(), "klerm-catalog-"));
		try {
			const value = context(root);
			const page = await graphCatalog(value, { category: "kanban", ownerBotId: "bot-first", limit: 1 });
			expect(page.items.map((item) => item.sourceRef.kind)).toEqual(["kanban-card"]);
			expect(page.items[0]).not.toHaveProperty("summary");
			const first = await graphCatalog(value, { limit: 1 });
			const next = await graphCatalog(value, { offset: first.nextOffset, limit: 1 });
			expect(first.items[0]?.key).not.toBe(next.items[0]?.key);
			const history = await graphCatalog(value, { category: "history" });
			expect(history.items[0]?.model).toBe("original/model");
			const detail = await graphSourceDetails(value, history.items[0]!.sourceRef);
			expect(detail).toMatchObject({
				summary: "Original saved report",
				changedFiles: ["src/a.ts"],
				verification: ["npm test"],
			});
			expect(detail.activity).toHaveLength(1);
			expect(value.kanban.boards[0]?.tasks[0]?.attempts).toHaveLength(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("reads only existing conversations and never manufactures a chat/history entry", async () => {
		const root = await mkdtemp(join(tmpdir(), "klerm-catalog-chat-"));
		try {
			const value = context(root);
			expect((await graphCatalog(value, { category: "history", search: "conversation" })).items).toEqual([]);
			const path = join(root, "personal-bots/bot-first");
			await mkdir(path, { recursive: true });
			await writeFile(
				join(path, "conversation.json"),
				JSON.stringify({
					version: 1,
					id: "chat",
					botId: "bot-first",
					cwd: root,
					model: "chat/model",
					status: "idle",
					messages: [{ role: "assistant", text: "Stored chat reply" }],
					updatedAt: "today",
				}),
			);
			const page = await graphCatalog(value, { category: "history", search: "conversation" });
			expect(page.items).toHaveLength(1);
			expect((await graphSourceDetails(value, page.items[0]!.sourceRef)).summary).toContain("Stored chat reply");
			await expect(
				graphSourceDetails(value, { kind: "personal-conversation", botId: "../../auth", conversationId: "chat" }),
			).rejects.toThrow("no longer exists");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
