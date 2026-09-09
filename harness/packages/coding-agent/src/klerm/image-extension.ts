import { generateImages, getImageModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import type { ExtensionFactory } from "../core/extensions/types.ts";

const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image" as const;

const generateImageSchema = Type.Object({
	prompt: Type.String({ minLength: 1, maxLength: 4000, description: "A precise visual description of the image" }),
});

export function createImageGenerationExtension(): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			name: "generate_image",
			label: "Generate image",
			description: "Generate an image from a text description using the configured OpenRouter image provider.",
			promptSnippet: "Generate an image when the user explicitly requests new visual artwork or an illustration.",
			promptGuidelines: [
				"Use generate_image only when the user explicitly asks to create an image, illustration, or visual asset.",
				"Do not use image generation for charts that can be produced deterministically from workspace data.",
			],
			klermCapability: "unknown",
			parameters: generateImageSchema,
			executionMode: "sequential",
			execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
				const auth = await ctx.modelRegistry.getProviderAuth("openrouter");
				const apiKey = auth?.auth.apiKey;
				if (!apiKey) throw new Error("OpenRouter authentication is required for image generation.");
				const model = getImageModel("openrouter", DEFAULT_IMAGE_MODEL);
				const requestModel = auth.auth.baseUrl ? { ...model, baseUrl: auth.auth.baseUrl } : model;
				const response = await generateImages(
					requestModel,
					{ input: [{ type: "text", text: params.prompt.trim() }] },
					{ apiKey, headers: auth.auth.headers, signal },
				);
				if (response.stopReason !== "stop") {
					throw new Error(response.errorMessage ?? "The image provider did not generate an image.");
				}
				if (!response.output.some((part) => part.type === "image")) {
					throw new Error("The image provider returned no image.");
				}
				return {
					content: response.output,
					details: { provider: response.provider, model: response.model, responseId: response.responseId },
					usage: response.usage,
				};
			},
		});
	};
}
