import type { ImageContent } from "@earendil-works/pi-ai";
import { processImage } from "../../utils/image-process.ts";
import { detectSupportedImageMimeType } from "../../utils/mime.ts";

const MAX_IMAGE_COUNT = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type RpcImagesResult = { ok: true; images: ImageContent[] | undefined } | { ok: false; message: string };

function decodeBase64(value: string): Uint8Array | undefined {
	if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
	const bytes = Buffer.from(value, "base64");
	const normalizedInput = value.replace(/=+$/u, "");
	if (bytes.toString("base64").replace(/=+$/u, "") !== normalizedInput) return undefined;
	return bytes;
}

export async function normalizeRpcImages(value: unknown): Promise<RpcImagesResult> {
	if (value === undefined) return { ok: true, images: undefined };
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_IMAGE_COUNT) {
		return { ok: false, message: `Images must contain between 1 and ${MAX_IMAGE_COUNT} attachments.` };
	}

	let totalBytes = 0;
	const images: ImageContent[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			return { ok: false, message: "Each image attachment must be an object." };
		}
		const candidate = item as Record<string, unknown>;
		if (
			candidate.type !== "image" ||
			typeof candidate.data !== "string" ||
			typeof candidate.mimeType !== "string" ||
			!ALLOWED_IMAGE_MIME_TYPES.has(candidate.mimeType)
		) {
			return { ok: false, message: "Only PNG, JPEG, GIF, and WebP image attachments are supported." };
		}
		const bytes = decodeBase64(candidate.data);
		if (!bytes) return { ok: false, message: "An image attachment contains invalid base64 data." };
		if (bytes.byteLength > MAX_IMAGE_BYTES) {
			return { ok: false, message: "Each image attachment must be 10 MiB or smaller." };
		}
		totalBytes += bytes.byteLength;
		if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
			return { ok: false, message: "Image attachments must be 25 MiB or smaller in total." };
		}
		const detectedMimeType = detectSupportedImageMimeType(bytes);
		if (!detectedMimeType || detectedMimeType !== candidate.mimeType) {
			return { ok: false, message: "An image attachment does not match its declared MIME type." };
		}
		const processed = await processImage(bytes, detectedMimeType);
		if (!processed.ok) return { ok: false, message: processed.message };
		images.push({ type: "image", data: processed.data, mimeType: processed.mimeType });
	}

	return { ok: true, images };
}
