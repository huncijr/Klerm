import { describe, expect, test } from "vitest";
import { contentImages, imageDataUrl, taskCompletionTitle } from "../src/lib/helpers.ts";

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
});
