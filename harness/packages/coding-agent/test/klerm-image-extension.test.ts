import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "../src/core/extensions/types.ts";
import { createImageGenerationExtension } from "../src/klerm/image-extension.ts";

const imageApi = vi.hoisted(() => ({
	generateImages: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/compat", () => ({
	getImageModel: () => ({
		id: "google/gemini-2.5-flash-image",
		name: "image",
		api: "openrouter-images",
		provider: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1",
		input: ["text"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	}),
	generateImages: imageApi.generateImages,
}));

describe("Klerm image generation extension", () => {
	beforeEach(() => imageApi.generateImages.mockReset());

	test("registers a Builder-only tool", () => {
		const registerTool = vi.fn();
		createImageGenerationExtension()({ registerTool } as unknown as ExtensionAPI);
		expect(registerTool).toHaveBeenCalledWith(
			expect.objectContaining({ name: "generate_image", klermCapability: "unknown" }),
		);
	});

	test("returns generated images as tool content", async () => {
		let tool: ToolDefinition | undefined;
		createImageGenerationExtension()({
			registerTool: (definition: ToolDefinition) => {
				tool = definition;
			},
		} as unknown as ExtensionAPI);
		imageApi.generateImages.mockResolvedValue({
			provider: "openrouter",
			model: "google/gemini-2.5-flash-image",
			output: [{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }],
			stopReason: "stop",
			timestamp: 1,
		});
		const context = {
			modelRegistry: { getProviderAuth: vi.fn(async () => ({ auth: { apiKey: "secret" } })) },
		} as unknown as ExtensionContext;
		const result = await tool!.execute("call", { prompt: "A precise diagram" }, undefined, undefined, context);
		expect(result.content).toEqual([{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }]);
		expect(imageApi.generateImages).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "openrouter" }),
			{ input: [{ type: "text", text: "A precise diagram" }] },
			expect.objectContaining({ apiKey: "secret" }),
		);
	});
});
