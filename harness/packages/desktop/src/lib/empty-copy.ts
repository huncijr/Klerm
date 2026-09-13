export const EMPTY_HEADLINES: readonly string[] = [
	"What should we build?",
	"What are we shipping today?",
	"Point the swarm at something hard.",
	"Give them something worth delegating.",
	"Your orchestrator is standing by.",
	"Multiple agents, one mission — what's first?",
	"What's the mission?",
	"The roster is ready. What's the job?",
];

export const EMPTY_SUBTITLE =
	"Klerm orchestrates multiple coding agents on one mission: routing prompts, sharing progress, and coordinating work across harnesses.";

/** Pick a headline index different from the previous one. */
export function pickHeadline(previous: number | undefined): number {
	if (EMPTY_HEADLINES.length === 0) return 0;
	if (EMPTY_HEADLINES.length === 1) return 0;
	let next = Math.floor(Math.random() * EMPTY_HEADLINES.length);
	if (next === previous) next = (next + 1) % EMPTY_HEADLINES.length;
	return next;
}
