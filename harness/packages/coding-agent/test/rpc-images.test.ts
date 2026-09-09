import { describe, expect, test } from "vitest";
import { normalizeRpcImages } from "../src/modes/rpc/rpc-images.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("RPC image attachments", () => {
	test("accepts and normalizes a valid image", async () => {
		const result = await normalizeRpcImages([{ type: "image", data: PNG, mimeType: "image/png" }]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.images?.[0]).toMatchObject({ type: "image", mimeType: "image/png" });
	});

	test("rejects malformed base64 and mismatched MIME types", async () => {
		expect(await normalizeRpcImages([{ type: "image", data: "not-base64", mimeType: "image/png" }])).toEqual(
			expect.objectContaining({ ok: false }),
		);
		expect(await normalizeRpcImages([{ type: "image", data: PNG, mimeType: "image/jpeg" }])).toEqual(
			expect.objectContaining({ ok: false }),
		);
	});

	test("rejects unsupported and excessive attachments", async () => {
		expect(await normalizeRpcImages([{ type: "image", data: PNG, mimeType: "image/svg+xml" }])).toEqual(
			expect.objectContaining({ ok: false }),
		);
		expect(
			await normalizeRpcImages(
				Array.from({ length: 9 }, () => ({ type: "image", data: PNG, mimeType: "image/png" })),
			),
		).toEqual(expect.objectContaining({ ok: false }));
	});
});
