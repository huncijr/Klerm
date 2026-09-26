import { describe, expect, test } from "vitest";
import { webToolUrl } from "../src/lib/web-activity.ts";

describe("agent web activity URL extraction", () => {
	test("opens only explicit web tools with a public-looking HTTP URL", () => {
		expect(webToolUrl("webfetch", { url: "https://example.org/news" })).toBe("https://example.org/news");
		expect(webToolUrl("mcp_web_fetch", { url: "https://example.org/" })).toBe("https://example.org/");
		expect(webToolUrl("mcp_news_fetch", { url: "https://example.org/story" })).toBe("https://example.org/story");
		expect(webToolUrl("bash", { command: "curl https://example.org/", url: "https://example.org/" })).toBeUndefined();
	});

	test("rejects unsupported schemes, credentials, local addresses, and absent URLs", () => {
		for (const url of [
			"file:///etc/passwd",
			"https://name:password@example.org/",
			"http://localhost/",
			"http://127.0.0.1/",
			"https://service.internal/",
		]) {
			expect(webToolUrl("web_fetch", { url })).toBeUndefined();
		}
		expect(webToolUrl("web_search", { query: "news" })).toBeUndefined();
	});
});
