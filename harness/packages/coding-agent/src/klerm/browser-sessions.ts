export interface BrowserSessionInfo {
	id: string;
	name: string;
}

export function normalizeBrowserSessions(value: unknown): BrowserSessionInfo[] {
	if (!Array.isArray(value)) return [];
	return value
		.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const entry = item as Record<string, unknown>;
			return typeof entry.id === "string" &&
				/^browser-[A-Za-z0-9-]{1,80}$/.test(entry.id) &&
				typeof entry.name === "string"
				? [{ id: entry.id, name: entry.name.slice(0, 80) || "Browser" }]
				: [];
		})
		.filter((entry, index, all) => all.findIndex((other) => other.id === entry.id) === index)
		.slice(0, 50);
}
