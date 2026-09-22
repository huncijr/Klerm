import { describe, expect, test, vi } from "vitest";
import {
	contentImages,
	hasDistinctSecondKlermModel,
	imageDataUrl,
	latestCompletedPersonalBotReplyId,
	rpcImageAttachments,
	saveDesktopSettingsChanges,
	shouldReplaceSettingsDrafts,
	taskCompletionTitle,
} from "../src/lib/helpers.ts";
import { providerLogoSrc } from "../src/lib/provider-logos.ts";

describe("desktop image and task helpers", () => {
	test("extracts only safe display images", () => {
		const images = contentImages([
			{ type: "text", text: "hello" },
			{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
			{ type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" },
		]);
		expect(images).toEqual([{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }]);
		expect(imageDataUrl(images[0]!)).toBe("data:image/png;base64,aW1hZ2U=");
	});

	test("omits the RPC images field for a text-only prompt", () => {
		expect(rpcImageAttachments([])).toBeUndefined();
		expect(rpcImageAttachments([{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }])).toEqual([
			{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
		]);
	});

	test("manual stop always has the exact stopped title", () => {
		expect(taskCompletionTitle(true, true, "Task failed", true)).toBe("Task stopped");
		expect(taskCompletionTitle(false, false, undefined, true)).toBe("Task failed");
	});

	test("saves every changed desktop setting before reporting success", async () => {
		const order: string[] = [];
		const result = await saveDesktopSettingsChanges([
			{
				error: "agents failed",
				save: vi.fn(async () => {
					order.push("agents");
					return true;
				}),
			},
			{
				error: "appearance failed",
				save: vi.fn(async () => {
					order.push("appearance");
					return true;
				}),
			},
		]);
		expect(result).toBeUndefined();
		expect(order).toEqual(["agents", "appearance"]);
	});

	test("stops desktop settings persistence at the first failure", async () => {
		const later = vi.fn(async () => true);
		const result = await saveDesktopSettingsChanges([
			{ error: "agents failed", save: vi.fn(async () => false) },
			{ error: "appearance failed", save: later },
		]);
		expect(result).toBe("agents failed");
		expect(later).not.toHaveBeenCalled();
	});

	test("replaces settings drafts only when the source snapshot changes", () => {
		expect(
			shouldReplaceSettingsDrafts({
				appliedSource: "same",
				source: "same",
				initialized: true,
				saving: false,
				dirty: false,
			}),
		).toBe(false);
		expect(
			shouldReplaceSettingsDrafts({
				appliedSource: "old",
				source: "new",
				initialized: true,
				saving: false,
				dirty: true,
			}),
		).toBe(false);
		expect(
			shouldReplaceSettingsDrafts({
				appliedSource: "old",
				source: "new",
				initialized: true,
				saving: true,
				dirty: true,
			}),
		).toBe(true);
	});

	test("requires a distinct configured model before showing Agent 2 controls", () => {
		expect(hasDistinctSecondKlermModel("provider/one")).toBe(false);
		expect(hasDistinctSecondKlermModel("provider/one", "provider/one")).toBe(false);
		expect(hasDistinctSecondKlermModel("provider/one", "provider/two")).toBe(true);
	});

	test("selects only a completed Personal Bot assistant reply for notification", () => {
		const messages = [
			{ id: "user-1", role: "user" as const, text: "Question", timestamp: "2026-09-22T10:00:00.000Z" },
			{ id: "reply-1", role: "assistant" as const, text: "Answer", timestamp: "2026-09-22T10:00:01.000Z" },
		];
		expect(latestCompletedPersonalBotReplyId({ status: "idle", messages })).toBe("reply-1");
		expect(latestCompletedPersonalBotReplyId({ status: "running", messages })).toBeUndefined();
		expect(latestCompletedPersonalBotReplyId({ status: "failed", messages })).toBeUndefined();
		expect(
			latestCompletedPersonalBotReplyId({
				status: "idle",
				messages: [{ id: "empty", role: "assistant", text: "  ", timestamp: "2026-09-22T10:00:01.000Z" }],
			}),
		).toBeUndefined();
	});

	test("maps native coding harness logos", () => {
		expect(providerLogoSrc("klerm")).toBe("/K_Klerm_no_background.png");
		expect(providerLogoSrc("claude-code")).toBe("/providers/claude-code.webp");
		expect(providerLogoSrc("codex")).toBe("/providers/codex-mark.png");
		expect(providerLogoSrc("opencode")).toBe("/providers/opencode-logo.webp");
	});
});
