import {
	CODING_HARNESS_EFFORTS,
	CODING_HARNESS_KINDS,
	type CodingHarnessEffort,
	type CodingHarnessKind,
} from "./coding-harness-setup.ts";
import { isKlermProfileFace, type KlermProfileFace } from "./profiles.ts";

export const PERSONAL_BOT_REGISTRY_VERSION = 1;
export const MAX_PERSONAL_BOTS = 20;

export interface PersonalBot {
	id: string;
	name: string;
	face: KlermProfileFace;
	profileId: string;
	harness: CodingHarnessKind;
	model?: string;
	role: "planner";
	effort: CodingHarnessEffort;
	enabled: boolean;
	createdSequence: number;
}

export interface PersonalBotRegistry {
	version: typeof PERSONAL_BOT_REGISTRY_VERSION;
	defaultsInitialized: true;
	bots: PersonalBot[];
}

export const DEFAULT_PERSONAL_BOTS: PersonalBot[] = [
	{
		id: "bot-scout",
		name: "Scout",
		face: "fox",
		profileId: "scout",
		harness: "klerm",
		role: "planner",
		effort: "medium",
		enabled: false,
		createdSequence: 1,
	},
	{
		id: "bot-sage",
		name: "Sage",
		face: "owl",
		profileId: "sage",
		harness: "klerm",
		role: "planner",
		effort: "high",
		enabled: false,
		createdSequence: 2,
	},
	{
		id: "bot-builder",
		name: "Builder",
		face: "bear",
		profileId: "builder",
		harness: "klerm",
		role: "planner",
		effort: "high",
		enabled: false,
		createdSequence: 3,
	},
];

function normalizeBot(value: unknown): PersonalBot | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const bot = value as Record<string, unknown>;
	const id = typeof bot.id === "string" ? bot.id.trim() : "";
	const name = typeof bot.name === "string" ? bot.name.trim() : "";
	const profileId = typeof bot.profileId === "string" ? bot.profileId.trim() : "";
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !name || !/^[A-Za-z0-9_-]+$/.test(profileId)) return undefined;
	if (!CODING_HARNESS_KINDS.includes(bot.harness as CodingHarnessKind)) return undefined;
	if (bot.role !== "planner" && bot.role !== "builder") return undefined;
	if (!CODING_HARNESS_EFFORTS.includes(bot.effort as CodingHarnessEffort)) return undefined;
	if (typeof bot.enabled !== "boolean") return undefined;
	const createdSequence =
		typeof bot.createdSequence === "number" && Number.isSafeInteger(bot.createdSequence) && bot.createdSequence > 0
			? bot.createdSequence
			: 1;
	const model = typeof bot.model === "string" ? bot.model.trim().slice(0, 300) : "";
	return {
		id,
		name: name.slice(0, 40),
		face: isKlermProfileFace(bot.face) ? bot.face : "fox",
		profileId,
		harness: bot.harness as CodingHarnessKind,
		...(model ? { model } : {}),
		role: "planner",
		effort: bot.effort as CodingHarnessEffort,
		enabled: bot.enabled && Boolean(model),
		createdSequence,
	};
}

export function createDefaultPersonalBotRegistry(): PersonalBotRegistry {
	return {
		version: PERSONAL_BOT_REGISTRY_VERSION,
		defaultsInitialized: true,
		bots: DEFAULT_PERSONAL_BOTS.map((bot) => ({ ...bot })),
	};
}

export function normalizePersonalBotRegistry(value: unknown): PersonalBotRegistry {
	if (!value || typeof value !== "object" || Array.isArray(value)) return createDefaultPersonalBotRegistry();
	const registry = value as Record<string, unknown>;
	if (registry.defaultsInitialized !== true || !Array.isArray(registry.bots)) {
		return createDefaultPersonalBotRegistry();
	}
	const bots = registry.bots
		.map(normalizeBot)
		.filter((bot): bot is PersonalBot => bot !== undefined)
		.filter((bot, index, candidates) => candidates.findIndex((candidate) => candidate.id === bot.id) === index)
		.slice(0, MAX_PERSONAL_BOTS)
		.sort((left, right) => left.createdSequence - right.createdSequence || left.id.localeCompare(right.id));
	return { version: PERSONAL_BOT_REGISTRY_VERSION, defaultsInitialized: true, bots };
}

export function validatePersonalBot(value: unknown, profileIds: ReadonlySet<string>): PersonalBot | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || record.id.trim().length > 80) return undefined;
	if (typeof record.name !== "string" || record.name.trim().length > 40) return undefined;
	if (typeof record.profileId !== "string" || record.profileId.trim().length > 80) return undefined;
	if (typeof record.model === "string" && record.model.trim().length > 300) return undefined;
	const bot = normalizeBot(value);
	return bot && profileIds.has(bot.profileId) ? bot : undefined;
}
