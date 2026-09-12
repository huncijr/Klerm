import { describe, expect, test, vi } from "vitest";
import { contentImages, imageDataUrl, saveDesktopSettingsChanges, taskCompletionTitle } from "../src/lib/helpers.ts";
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

	test("maps native coding harness logos", () => {
		expect(providerLogoSrc("claude-code")).toBe("/providers/claude-code.webp");
		expect(providerLogoSrc("codex")).toBe("/providers/codex-mark.png");
	});
});
