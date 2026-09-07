export const EMPTY_HEADLINES: readonly string[] = [
	"What should we build?",
	"What are we shipping today?",
	"Point the swarm at something hard.",
	"What deserves two brains?",
	"Give them something worth delegating.",
	"Local hands, frontier mind — what's first?",
	"What's the mission?",
	"Two agents are waiting. What's the job?",
];

export const EMPTY_SUBTITLE =
	"More agents, one mission. Mix speed with intelligence, local privacy with frontier depth.";

/** Pick a headline index different from the previous one. */
export function pickHeadline(previous: number | undefined): number {
	if (EMPTY_HEADLINES.length === 0) return 0;
	if (EMPTY_HEADLINES.length === 1) return 0;
	let next = Math.floor(Math.random() * EMPTY_HEADLINES.length);
	if (next === previous) next = (next + 1) % EMPTY_HEADLINES.length;
	return next;
}
