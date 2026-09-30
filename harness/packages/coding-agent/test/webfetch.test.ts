import { describe, expect, it, vi } from "vitest";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";
import { createWebFetchToolDefinition } from "../src/core/tools/webfetch.ts";

describe("Klerm webfetch", () => {
	it("reads public page text and returns the source for tool-event tracking", async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(
					"<h1>Cloudflare Tunnel</h1><script>privateScript()</script><p>cloudflared tunnel --url http://localhost:3000</p>",
					{ headers: { "content-type": "text/html" } },
				),
			);
		const tool = createWebFetchToolDefinition({ fetch: request, resolve: async () => ["93.184.216.34"] });
		const result = await wrapToolDefinition(tool).execute("fetch-1", {
			url: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
		});
		expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("cloudflared tunnel") });
		expect(JSON.stringify(result.content)).not.toContain("privateScript");
		expect(result.details).toMatchObject({
			url: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
		});
		expect(tool.klermCapability).toBe("read");
	});
	it("checks redirected destinations and blocks private DNS addresses", async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://localhost/private" } }));
		const tool = createWebFetchToolDefinition({ fetch: request, resolve: async () => ["93.184.216.34"] });
		await expect(wrapToolDefinition(tool).execute("fetch-1", { url: "https://example.org" })).rejects.toThrow(
			"localhost",
		);
		expect(request).toHaveBeenCalledOnce();
		const blocked = createWebFetchToolDefinition({ fetch: request, resolve: async () => ["10.1.2.3"] });
		await expect(wrapToolDefinition(blocked).execute("fetch-2", { url: "https://example.org" })).rejects.toThrow(
			"public network",
		);
		expect(request).toHaveBeenCalledOnce();
	});
	it("reports HTTP failures instead of claiming research succeeded", async () => {
		const tool = createWebFetchToolDefinition({
			fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })),
			resolve: async () => ["93.184.216.34"],
		});
		await expect(wrapToolDefinition(tool).execute("fetch-1", { url: "https://example.org" })).rejects.toThrow(
			"HTTP 403",
		);
	});
});
