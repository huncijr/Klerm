/** Extract only explicit web-tool URLs; never treat shell commands or file contents as navigation. */
export function webToolUrl(toolName: string, args: unknown): string | undefined {
	if (
		!/(?:^|[_-])(?:webfetch|web_fetch|fetch|fetch_url|read_url|open_url|browse|web_search)(?:$|[_-])/i.test(toolName)
	)
		return undefined;
	if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
	const record = args as Record<string, unknown>;
	const candidate = record.url ?? record.link;
	if (typeof candidate !== "string" || candidate.length > 2048) return undefined;
	try {
		const url = new URL(candidate);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
		if (!url.hostname.includes(".") || /^(?:localhost|.*\.(?:localhost|local|internal|lan))$/i.test(url.hostname))
			return undefined;
		if (/^(?:\d+\.){3}\d+$/.test(url.hostname) || url.hostname.startsWith("[")) return undefined;
		return url.href;
	} catch {
		return undefined;
	}
}

/** Keep distinct observed URLs in last-observed order without mutating history. */
export function recordWebSource(history: readonly string[], url: string): string[] {
	const safeUrl = webToolUrl("webfetch", { url });
	if (!safeUrl) return [...history];
	return [...history.filter((previous) => previous !== safeUrl), safeUrl];
}

export function webSourceIdentity(url: string): { hostname: string; icon: string } {
	const safeUrl = webToolUrl("webfetch", { url });
	if (!safeUrl) return { hostname: "Website", icon: "" };
	const parsed = new URL(safeUrl);
	return { hostname: parsed.hostname, icon: `${parsed.origin}/favicon.ico` };
}
