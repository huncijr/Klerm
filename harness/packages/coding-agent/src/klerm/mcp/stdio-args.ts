export function parseStdioArgString(value: string): string[] {
	const json = parseJsonStringArray(value);
	if (json) return json;
	return tokenizeStdioArgs(value).map(cleanStdioArg).filter(Boolean);
}

export function normalizeStdioArgs(args: readonly string[] | undefined): string[] {
	if (!args || args.length === 0) return [];
	if (args.length === 1) {
		const json = parseJsonStringArray(args[0] ?? "");
		if (json) return json;
		const tokens = parseStdioArgString(args[0] ?? "");
		if (tokens.length > 1) return tokens;
	}
	return args.flatMap((arg) => parseJsonStringArray(arg) ?? [cleanStdioArg(arg)]).filter(Boolean);
}

function parseJsonStringArray(value: string): string[] | undefined {
	const trimmed = value.trim();
	if (!trimmed.startsWith("[")) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return undefined;
		return parsed.map((item) => item.trim()).filter(Boolean);
	} catch {
		return undefined;
	}
}

function tokenizeStdioArgs(value: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;
	for (const char of value) {
		if (inQuote) {
			if (char === inQuote) inQuote = null;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			inQuote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) args.push(current);
	return args;
}

function cleanStdioArg(value: string): string {
	let arg = value.trim().replace(/^\[/, "").replace(/\]$/, "").replace(/,$/, "").trim();
	if (
		(arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2) ||
		(arg.startsWith("'") && arg.endsWith("'") && arg.length >= 2)
	) {
		arg = arg.slice(1, -1).trim();
	}
	return arg.replace(/,$/, "").trim();
}
