const MAX_SESSION_TITLE_LENGTH = 52;
const MAX_SESSION_TITLE_WORDS = 7;

export function createSessionTitle(prompt: string): string {
	const firstLine = prompt
		.replace(/\s+/g, " ")
		.replace(/^\s*(?:please|kérlek|can you|could you)\s+/i, "")
		.trim();
	if (!firstLine) return "New task";

	const title = firstLine
		.split(" ")
		.slice(0, MAX_SESSION_TITLE_WORDS)
		.join(" ")
		.replace(/[.?!,:;]+$/, "")
		.trim();
	if (title.length <= MAX_SESSION_TITLE_LENGTH) return title || "New task";
	return `${title.slice(0, MAX_SESSION_TITLE_LENGTH - 3).trimEnd()}...`;
}
