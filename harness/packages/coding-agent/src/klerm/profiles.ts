export const KLERM_PROFILE_FACES = ["fox", "owl", "wolf", "cat", "bear", "otter"] as const;
export type KlermProfileFace = (typeof KLERM_PROFILE_FACES)[number];

export interface KlermProfile {
	id: string;
	name: string;
	face: KlermProfileFace;
	level: number;
	memory: string;
	readme: string;
}

export interface KlermProfileState {
	localProfileId?: string;
	frontierProfileId?: string;
	profiles: KlermProfile[];
}

export const DEFAULT_KLERM_PROFILES: KlermProfile[] = [
	{
		id: "scout",
		name: "Scout",
		face: "fox",
		level: 1,
		memory: "",
		readme: "Fast local helper. Keep notes short.",
	},
	{
		id: "sage",
		name: "Sage",
		face: "owl",
		level: 3,
		memory: "",
		readme: "Careful planner. Prefer high-level direction.",
	},
];

export function isKlermProfileFace(value: unknown): value is KlermProfileFace {
	return typeof value === "string" && (KLERM_PROFILE_FACES as readonly string[]).includes(value);
}

export function profileIdFromName(value: string): string | undefined {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : undefined;
}

export function normalizeProfile(value: unknown): KlermProfile | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id.trim() : "";
	const name = typeof record.name === "string" ? record.name.trim() : "";
	if (!/^[A-Za-z0-9_-]+$/.test(id) || name.length === 0) return undefined;
	const level = typeof record.level === "number" && Number.isSafeInteger(record.level) ? record.level : 1;
	return {
		id,
		name: name.slice(0, 40),
		face: isKlermProfileFace(record.face) ? record.face : "fox",
		level: Math.min(5, Math.max(1, level)),
		memory: typeof record.memory === "string" ? record.memory.slice(0, 8000) : "",
		readme: typeof record.readme === "string" ? record.readme.slice(0, 8000) : "",
	};
}

export function normalizeProfileState(value: unknown): KlermProfileState {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { profiles: DEFAULT_KLERM_PROFILES.map((profile) => ({ ...profile })) };
	}
	const record = value as Record<string, unknown>;
	const profiles = Array.isArray(record.profiles)
		? record.profiles.map(normalizeProfile).filter((profile): profile is KlermProfile => profile !== undefined)
		: [];
	const resolved = profiles.length > 0 ? profiles : DEFAULT_KLERM_PROFILES.map((profile) => ({ ...profile }));
	const ids = new Set(resolved.map((profile) => profile.id));
	const localProfileId =
		typeof record.localProfileId === "string" && ids.has(record.localProfileId) ? record.localProfileId : undefined;
	const frontierProfileId =
		typeof record.frontierProfileId === "string" && ids.has(record.frontierProfileId)
			? record.frontierProfileId
			: undefined;
	return { localProfileId, frontierProfileId, profiles: resolved };
}

export function assignedProfile(state: KlermProfileState, lane: "local" | "frontier"): KlermProfile | undefined {
	const id = lane === "local" ? state.localProfileId : state.frontierProfileId;
	return id ? state.profiles.find((profile) => profile.id === id) : undefined;
}

export function formatProfilePrompt(agent: "Agent 1" | "Agent 2", profile: KlermProfile): string {
	const lines = [
		`<klerm_profile>`,
		`${agent} is using profile ${profile.name} (face ${profile.face}, level ${profile.level}/5).`,
	];
	if (profile.readme.trim()) lines.push(`Profile README:\n${profile.readme.trim()}`);
	if (profile.memory.trim()) lines.push(`Profile memory:\n${profile.memory.trim()}`);
	lines.push(
		`Stay in this personality. Update memory only with update_klerm_profile when the user asks or when a lasting fact should be remembered.`,
	);
	lines.push(`</klerm_profile>`);
	return lines.join("\n");
}
