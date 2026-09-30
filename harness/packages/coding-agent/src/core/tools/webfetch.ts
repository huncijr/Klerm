import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Type } from "typebox";
import { validateBrowserUrl } from "../../klerm/browser-agent.ts";
import type { ToolDefinition } from "../extensions/types.ts";

const schema = Type.Object({ url: Type.String({ description: "Public HTTP/HTTPS page to read" }) });
const blocked = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.168.0.0", 16],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const)
	blocked.addSubnet(network, prefix, "ipv6");

export interface WebFetchOptions {
	fetch?: typeof fetch;
	resolve?: (hostname: string) => Promise<string[]>;
}

export function createWebFetchToolDefinition(options: WebFetchOptions = {}): ToolDefinition<typeof schema> {
	return {
		name: "webfetch",
		label: "Web fetch",
		klermCapability: "read",
		description:
			"Read a public HTTP/HTTPS page. Use this for current online documentation and research. Returns bounded page text with its source URL. Does not log in or execute page scripts.",
		promptSnippet: "Read current public website content",
		promptGuidelines: [
			"When the user asks to research online, use webfetch on relevant public sources and cite the pages actually read. Do not claim to have browsed without a successful tool call.",
		],
		parameters: schema,
		async execute(_id, { url }, signal) {
			const requestSignal = signal
				? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
				: AbortSignal.timeout(30_000);
			let target = url;
			for (let redirects = 0; redirects <= 5; redirects++) {
				requestSignal.throwIfAborted();
				const decision = validateBrowserUrl(target);
				if (!decision.allowed) throw new Error(decision.reason);
				const addresses = await (
					options.resolve ??
					(async (hostname) => (await lookup(hostname, { all: true })).map((item) => item.address))
				)(new URL(decision.url).hostname);
				if (
					!addresses.length ||
					addresses.some(
						(address) => !isIP(address) || blocked.check(address, isIP(address) === 6 ? "ipv6" : "ipv4"),
					)
				)
					throw new Error("Web fetch requires a public network address.");
				const response = await (options.fetch ?? fetch)(decision.url, {
					redirect: "manual",
					signal: requestSignal,
					headers: { accept: "text/html,text/plain,application/json" },
				});
				if (response.status >= 300 && response.status < 400) {
					const location = response.headers.get("location");
					await response.body?.cancel();
					if (!location) throw new Error("Web redirect has no destination.");
					target = new URL(location, decision.url).href;
					continue;
				}
				if (!response.ok) {
					await response.body?.cancel();
					throw new Error(`Web fetch failed (HTTP ${response.status}).`);
				}
				const mime = response.headers.get("content-type") ?? "";
				if (!/text\/|application\/(?:json|xml|xhtml\+xml)/i.test(mime)) {
					await response.body?.cancel();
					throw new Error("Web fetch supports text pages only.");
				}
				const reader = response.body?.getReader();
				if (!reader) throw new Error("Web page returned no content.");
				const decoder = new TextDecoder();
				let bytes = 0;
				let text = "";
				try {
					while (true) {
						const chunk = await reader.read();
						if (chunk.done) break;
						bytes += chunk.value.byteLength;
						text += decoder.decode(chunk.value, { stream: true });
						if (bytes >= 512_000) break;
					}
					text += decoder.decode();
				} finally {
					await reader.cancel();
				}
				if (/html/i.test(mime))
					text = text
						.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
						.replace(/<[^>]+>/g, " ")
						.replace(/&nbsp;/g, " ")
						.replace(/&amp;/g, "&")
						.replace(/[ \t]+/g, " ");
				return {
					content: [{ type: "text", text: `Source: ${decision.url}\n\n${text.trim().slice(0, 32_000)}` }],
					details: { url: decision.url, truncated: bytes >= 512_000 || text.length > 32_000 },
				};
			}
			throw new Error("Web fetch exceeded the redirect limit.");
		},
	};
}
