export const KLERM_PROFILE_FACES = ["fox", "owl", "wolf", "cat", "bear", "otter"] as const;
export type KlermProfileFace = (typeof KLERM_PROFILE_FACES)[number];

export const KLERM_PROFILE_MEMORY_FORMATS = ["md", "html"] as const;
export type KlermProfileMemoryFormat = (typeof KLERM_PROFILE_MEMORY_FORMATS)[number];

export interface KlermProfile {
	id: string;
	name: string;
	face: KlermProfileFace;
	level: number;
	behaviour: string;
	workPlan: string;
	planMode: string;
	buildMode: string;
	memoryFormat: KlermProfileMemoryFormat;
	/** @deprecated Use behaviour instead. Kept for reading older settings. */
	memory: string;
	/** @deprecated Use workPlan instead. Kept for reading older settings. */
	readme: string;
}

export interface KlermProfileState {
	localProfileId?: string;
	frontierProfileId?: string;
	sharedMemory: string;
	profiles: KlermProfile[];
}

const SCOUT_BEHAVIOUR = [
	"You are Scout: calm, smart, and friendly. Be decisive: when the user asks for",
	"something, act instead of hedging, and always explain briefly what you did and",
	"why. Keep a relaxed tone, never rush, never lecture.",
	"When you delegate (delegate_frontier), write handoffs a teammate can act on:",
	"reason (one line, why Agent 2 is needed), summary (what you already completed",
	"and found), remainingWork (exactly what Agent 2 must do next, with files or",
	"acceptance criteria). Never claim Agent 2 answered unless the handoff actually",
	"happened and Agent 2 responded. If unsure, say so honestly and propose the next",
	"concrete step.",
].join("\n");

const SCOUT_WORK_PLAN = [
	"1. Assess the task against your strength band and the peer lookup before",
	"   committing to full implementation.",
	"2. Do focused Agent 1 work that fits the band; inspect only enough context to",
	"   stay precise.",
	"3. When the task exceeds your band, is unusually risky, or repeated attempts",
	"   fail, delegate via delegate_frontier with a structured handoff.",
	"4. After an Agent 2 return, verify the result and finalize on Agent 1 when",
	"   possible; delegate again only for a concrete unresolved issue.",
].join("\n");

const SCOUT_PLAN_MODE = [
	"Read-only: inspect relevant files, search results, directory structure, safe",
	"command output, read-only MCP data, and shared memory. Produce a high-level plan",
	"or a precise delegation handoff. Do not modify files or external state.",
].join("\n");

const SCOUT_BUILD_MODE = [
	"Inspect and modify the workspace to complete the task. Sensitive, broad,",
	"external, or destructive actions need user approval first. Narrate briefly as",
	"you go (what changed, what is next), then give a short closing summary with",
	"verification.",
].join("\n");

const SAGE_BEHAVIOUR = [
	"You are Sage: honest, compact, and work-first. Say only what is needed to move",
	"the task forward. No greetings, no filler, no hedging phrases. If something is",
	"wrong or unknown, state it in one line and propose the fix. Do the work, then",
	"stop.",
].join("\n");

const SAGE_WORK_PLAN = [
	"1. Own the final answer. Complete the assignment end to end.",
	"2. Delegate to Agent 1 (delegate_local) only for focused work that is clearly",
	"   better suited to it; review its return before finishing.",
	"3. On cross-model assignments, return with: summary, draft result, changed",
	"   files, verification, open issues, recommended next action. Nothing more.",
].join("\n");

const SAGE_PLAN_MODE = [
	"Read-only: inspect files, searches, safe command output, read-only MCP data, and",
	"shared memory. Give high-level direction, delegate, or return when appropriate.",
	"No modifications. Terse output.",
].join("\n");

const SAGE_BUILD_MODE = [
	"Execute with full tools. Approval-gated for risky actions. Report results as:",
	"done, changed files, verification. One line per item.",
].join("\n");

export const DEFAULT_KLERM_PROFILES: KlermProfile[] = [
	{
		id: "scout",
		name: "Scout",
		face: "fox",
		level: 1,
		behaviour: SCOUT_BEHAVIOUR,
		workPlan: SCOUT_WORK_PLAN,
		planMode: SCOUT_PLAN_MODE,
		buildMode: SCOUT_BUILD_MODE,
		memoryFormat: "md",
		memory: "",
		readme: "",
	},
	{
		id: "sage",
		name: "Sage",
		face: "owl",
		level: 3,
		behaviour: SAGE_BEHAVIOUR,
		workPlan: SAGE_WORK_PLAN,
		planMode: SAGE_PLAN_MODE,
		buildMode: SAGE_BUILD_MODE,
		memoryFormat: "md",
		memory: "",
		readme: "",
	},
];

export function isKlermProfileFace(value: unknown): value is KlermProfileFace {
	return typeof value === "string" && (KLERM_PROFILE_FACES as readonly string[]).includes(value);
}

export function isKlermProfileMemoryFormat(value: unknown): value is KlermProfileMemoryFormat {
	return typeof value === "string" && (KLERM_PROFILE_MEMORY_FORMATS as readonly string[]).includes(value);
}

function defaultForId(id: string): KlermProfile | undefined {
	return DEFAULT_KLERM_PROFILES.find((profile) => profile.id === id);
}

export function profileIdFromName(value: string): string | undefined {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : undefined;
}

function textField(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value.slice(0, 8000) : fallback;
}

export function normalizeProfile(value: unknown): KlermProfile | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id.trim() : "";
	const name = typeof record.name === "string" ? record.name.trim() : "";
	if (!/^[A-Za-z0-9_-]+$/.test(id) || name.length === 0) return undefined;
	const level = typeof record.level === "number" && Number.isSafeInteger(record.level) ? record.level : 1;
	const defaults = defaultForId(id);
	// Migrate the legacy memory/readme fields onto behaviour/workPlan.
	const legacyMemory = textField(record.memory);
	const legacyReadme = textField(record.readme);
	const behaviour = textField(record.behaviour, legacyMemory || defaults?.behaviour || "");
	const workPlan = textField(record.workPlan, legacyReadme || defaults?.workPlan || "");
	return {
		id,
		name: name.slice(0, 40),
		face: isKlermProfileFace(record.face) ? record.face : "fox",
		level: Math.min(5, Math.max(1, level)),
		behaviour,
		workPlan,
		planMode: textField(record.planMode, defaults?.planMode || ""),
		buildMode: textField(record.buildMode, defaults?.buildMode || ""),
		memoryFormat: isKlermProfileMemoryFormat(record.memoryFormat) ? record.memoryFormat : "md",
		memory: legacyMemory,
		readme: legacyReadme,
	};
}

export function normalizeProfileState(value: unknown): KlermProfileState {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { sharedMemory: "", profiles: DEFAULT_KLERM_PROFILES.map((profile) => ({ ...profile })) };
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
	return { localProfileId, frontierProfileId, sharedMemory: textField(record.sharedMemory), profiles: resolved };
}

export function assignedProfile(state: KlermProfileState, lane: "local" | "frontier"): KlermProfile | undefined {
	const id = lane === "local" ? state.localProfileId : state.frontierProfileId;
	return id ? state.profiles.find((profile) => profile.id === id) : undefined;
}

export function formatProfilePrompt(
	agent: "Agent 1" | "Agent 2",
	profile: KlermProfile,
	role: "planner" | "builder" = "builder",
): string {
	const lines = [
		`<klerm_profile>`,
		`${agent} is using profile ${profile.name} (face ${profile.face}, level ${profile.level}/5).`,
	];
	if (profile.behaviour.trim()) lines.push(`Profile behaviour:\n${profile.behaviour.trim()}`);
	if (profile.workPlan.trim()) lines.push(`Profile work plan:\n${profile.workPlan.trim()}`);
	const modePrompt = role === "planner" ? profile.planMode : profile.buildMode;
	if (modePrompt.trim()) lines.push(`Profile ${role} mode:\n${modePrompt.trim()}`);
	// Legacy fields stay readable for older settings until they are migrated.
	if (!profile.behaviour.trim() && profile.memory.trim()) lines.push(`Profile memory:\n${profile.memory.trim()}`);
	if (!profile.workPlan.trim() && profile.readme.trim()) lines.push(`Profile README:\n${profile.readme.trim()}`);
	lines.push(
		`Stay in this personality. Update profile text only with update_klerm_profile when the user asks or when a lasting fact should be remembered.`,
	);
	lines.push(`</klerm_profile>`);
	return lines.join("\n");
}
