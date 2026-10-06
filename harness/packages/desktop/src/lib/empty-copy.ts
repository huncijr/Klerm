export const EMPTY_HEADLINES: readonly string[] = [
	"What would you like to work on?",
	"Where should we begin?",
	"Start with a task.",
	"Make room for the next idea.",
	"Your workspace is ready.",
	"One workspace for your next step.",
	"What needs your attention?",
	"Let's work through it.",
];

export const EMPTY_SUBTITLE =
	"Describe a task, inspect your project, or continue a conversation. Your agents and their progress stay together here.";

/** Pick a headline index different from the previous one. */
export function pickHeadline(previous: number | undefined): number {
	if (EMPTY_HEADLINES.length === 0) return 0;
	if (EMPTY_HEADLINES.length === 1) return 0;
	let next = Math.floor(Math.random() * EMPTY_HEADLINES.length);
	if (next === previous) next = (next + 1) % EMPTY_HEADLINES.length;
	return next;
}
