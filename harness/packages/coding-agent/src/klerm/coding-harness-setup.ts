import { execFile } from "node:child_process";

export const CODING_HARNESS_KINDS = ["klerm", "pi", "claude-code", "codex", "opencode", "cline"] as const;
export const CODING_HARNESS_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type CodingHarnessKind = (typeof CODING_HARNESS_KINDS)[number];
export type CodingHarnessEffort = (typeof CODING_HARNESS_EFFORTS)[number];
export type CodingHarnessRole = "planner" | "builder";
export type CodingHarnessSlot = CodingHarnessKind | null;

export interface CodingHarnessAgentSettings {
	id: string;
	kind: CodingHarnessSlot;
	enabled: boolean;
	model?: string;
	memoryProfileId?: string;
	role: CodingHarnessRole;
	effort: CodingHarnessEffort;
	tools: string[];
}

export interface CodingHarnessSlots {
	externalHarnessesEnabled: boolean;
	workTogetherEnabled?: boolean;
	agents: CodingHarnessAgentSettings[];
}

export interface CodingHarnessDiscoveryResult {
	kind: CodingHarnessKind;
	available: boolean;
	builtin: boolean;
	version?: string;
	error?: string;
	models: string[];
}

export interface CodingHarnessSetup {
	slots: CodingHarnessSlots;
	harnesses: CodingHarnessDiscoveryResult[];
	effectiveRouting: "auto" | "none" | "disabled";
	externalPromptingAvailable: boolean;
	blockingReason?: string;
}

export interface CodingHarnessProbeOptions {
	args: readonly ["--version"];
	timeoutMs: number;
	maxOutputBytes: number;
	shell: false;
}

export interface CodingHarnessProbeResult {
	stdout?: string;
	stderr?: string;
}

export type CodingHarnessProbe = (
	command: "pi" | "claude" | "codex" | "opencode" | "cline",
	options: CodingHarnessProbeOptions,
) => Promise<CodingHarnessProbeResult>;

const DEFAULT_AGENT: CodingHarnessAgentSettings = {
	id: "agent1",
	kind: "klerm",
	enabled: true,
	role: "builder",
	effort: "off",
	tools: [],
};
const VERSION_PROBE_OPTIONS: CodingHarnessProbeOptions = {
	args: ["--version"],
	timeoutMs: 2000,
	maxOutputBytes: 4096,
	shell: false,
};
const MAX_VERSION_LENGTH = 256;
const MAX_MODEL_LENGTH = 256;
const MAX_AGENTS = 16;
const AGENT_ID_PATTERN = /^agent([1-9]\d*)$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/;

export function normalizeCodingHarnessKind(value: unknown): CodingHarnessKind | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, "-");
	return CODING_HARNESS_KINDS.find((kind) => kind === normalized);
}

function normalizeAgent(value: unknown, fallback: CodingHarnessAgentSettings): CodingHarnessAgentSettings {
	if (value === null || typeof value === "string") {
		const kind = value === null ? fallback.kind : (normalizeCodingHarnessKind(value) ?? fallback.kind);
		return { ...fallback, kind, enabled: kind !== null };
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(fallback);
	const candidate = value as Record<string, unknown>;
	const id = typeof candidate.id === "string" && AGENT_ID_PATTERN.test(candidate.id) ? candidate.id : fallback.id;
	const kind = candidate.kind === null ? fallback.kind : (normalizeCodingHarnessKind(candidate.kind) ?? fallback.kind);
	const model = typeof candidate.model === "string" ? candidate.model.trim().slice(0, MAX_MODEL_LENGTH) : "";
	const memoryProfileId =
		typeof candidate.memoryProfileId === "string" ? candidate.memoryProfileId.trim().slice(0, 128) : "";
	const role = candidate.role === "planner" || candidate.role === "builder" ? candidate.role : fallback.role;
	const effort = CODING_HARNESS_EFFORTS.includes(candidate.effort as CodingHarnessEffort)
		? (candidate.effort as CodingHarnessEffort)
		: fallback.effort;
	const tools = Array.isArray(candidate.tools)
		? [
				...new Set(
					candidate.tools.filter(
						(tool): tool is string => typeof tool === "string" && TOOL_NAME_PATTERN.test(tool),
					),
				),
			].slice(0, 64)
		: [...fallback.tools];
	return {
		id,
		kind,
		enabled: kind !== null && (typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled),
		...(model ? { model } : {}),
		...(memoryProfileId ? { memoryProfileId } : {}),
		role,
		effort,
		tools,
	};
}

export function normalizeCodingHarnessSlots(value: unknown): CodingHarnessSlots {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { externalHarnessesEnabled: false, agents: [structuredClone(DEFAULT_AGENT)] };
	}
	const stored = value as Record<string, unknown>;
	let agents: CodingHarnessAgentSettings[];
	if (Array.isArray(stored.agents)) {
		agents = stored.agents.slice(0, MAX_AGENTS).map((agent, index) =>
			normalizeAgent(agent, {
				...DEFAULT_AGENT,
				id: `agent${index + 1}`,
				kind: "klerm",
				enabled: true,
			}),
		);
	} else {
		const first = normalizeAgent(stored.agent1, DEFAULT_AGENT);
		const second = normalizeAgent(stored.agent2, { ...DEFAULT_AGENT, id: "agent2" });
		agents = normalizeCodingHarnessKind(stored.agent2) === undefined ? [first] : [first, second];
	}
	const seen = new Set<string>();
	agents = agents.filter((agent) => !seen.has(agent.id) && seen.add(agent.id));
	if (agents.length === 0) agents = [structuredClone(DEFAULT_AGENT)];
	if (!agents.some((agent) => agent.id === "agent1")) agents.push(structuredClone(DEFAULT_AGENT));
	agents.sort((left, right) => Number(left.id.slice(5)) - Number(right.id.slice(5)));
	return {
		externalHarnessesEnabled: stored.externalHarnessesEnabled === true,
		...(stored.externalHarnessesEnabled === true &&
		new Set(
			agents.filter((agent) => agent.enabled && agent.kind === "klerm" && agent.model).map((agent) => agent.model),
		).size >= 3 &&
		stored.workTogetherEnabled === true
			? { workTogetherEnabled: true }
			: {}),
		agents,
	};
}

function parseAgent(value: unknown): CodingHarnessAgentSettings | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const agent = value as Record<string, unknown>;
	if (
		Object.keys(agent).some(
			(key) => !["id", "kind", "enabled", "model", "memoryProfileId", "role", "effort", "tools"].includes(key),
		)
	) {
		return undefined;
	}
	if (typeof agent.id !== "string" || !AGENT_ID_PATTERN.test(agent.id)) return undefined;
	if (agent.kind !== null && !CODING_HARNESS_KINDS.includes(agent.kind as CodingHarnessKind)) return undefined;
	if (typeof agent.enabled !== "boolean" || (agent.kind === null && agent.enabled)) return undefined;
	if (
		agent.model !== undefined &&
		(typeof agent.model !== "string" || !agent.model.trim() || agent.model.length > MAX_MODEL_LENGTH)
	) {
		return undefined;
	}
	if (
		agent.memoryProfileId !== undefined &&
		(typeof agent.memoryProfileId !== "string" || !agent.memoryProfileId.trim() || agent.memoryProfileId.length > 128)
	) {
		return undefined;
	}
	if (agent.role !== "planner" && agent.role !== "builder") return undefined;
	if (!CODING_HARNESS_EFFORTS.includes(agent.effort as CodingHarnessEffort)) return undefined;
	if (
		!Array.isArray(agent.tools) ||
		agent.tools.some((tool) => typeof tool !== "string" || !TOOL_NAME_PATTERN.test(tool))
	) {
		return undefined;
	}
	return {
		id: agent.id,
		kind: agent.kind as CodingHarnessSlot,
		enabled: agent.enabled,
		...(typeof agent.model === "string" ? { model: agent.model.trim() } : {}),
		...(typeof agent.memoryProfileId === "string" ? { memoryProfileId: agent.memoryProfileId.trim() } : {}),
		role: agent.role,
		effort: agent.effort as CodingHarnessEffort,
		tools: [...new Set(agent.tools as string[])],
	};
}

export function parseCodingHarnessSlots(value: unknown): CodingHarnessSlots | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const setup = value as Record<string, unknown>;
	if (
		Object.keys(setup).some((key) => !["externalHarnessesEnabled", "workTogetherEnabled", "agents"].includes(key)) ||
		!Object.hasOwn(setup, "externalHarnessesEnabled") ||
		!Object.hasOwn(setup, "agents") ||
		typeof setup.externalHarnessesEnabled !== "boolean" ||
		(setup.workTogetherEnabled !== undefined && typeof setup.workTogetherEnabled !== "boolean") ||
		!Array.isArray(setup.agents) ||
		setup.agents.length < 1 ||
		setup.agents.length > MAX_AGENTS
	)
		return undefined;
	const agents = setup.agents.map(parseAgent);
	if (agents.some((agent) => !agent)) return undefined;
	const parsedAgents = agents as CodingHarnessAgentSettings[];
	if (new Set(parsedAgents.map((agent) => agent.id)).size !== parsedAgents.length) return undefined;
	if (!parsedAgents.some((agent) => agent.id === "agent1")) return undefined;
	const workTogetherEnabled =
		setup.externalHarnessesEnabled &&
		setup.workTogetherEnabled === true &&
		new Set(
			parsedAgents
				.filter((agent) => agent.enabled && agent.kind === "klerm" && agent.model)
				.map((agent) => agent.model),
		).size >= 3;
	return {
		externalHarnessesEnabled: setup.externalHarnessesEnabled,
		...(workTogetherEnabled ? { workTogetherEnabled: true } : {}),
		agents: parsedAgents,
	};
}

export function nextCodingHarnessAgentId(agents: readonly CodingHarnessAgentSettings[]): string {
	const highest = agents.reduce((max, agent) => {
		const match = AGENT_ID_PATTERN.exec(agent.id);
		return Math.max(max, match ? Number(match[1]) : 0);
	}, 0);
	return `agent${highest + 1}`;
}

export function createCodingHarnessAgent(id: string, kind: CodingHarnessSlot = "klerm"): CodingHarnessAgentSettings {
	return { id, kind, enabled: kind !== null, role: "builder", effort: "off", tools: [] };
}

export function createCodingHarnessSetup(
	slots: CodingHarnessSlots,
	harnesses: CodingHarnessDiscoveryResult[],
	externalPromptingAvailable = false,
): CodingHarnessSetup {
	const available = new Set(harnesses.filter((harness) => harness.available).map((harness) => harness.kind));
	const activeCount = slots.agents.filter(
		(agent) => agent.enabled && agent.kind !== null && available.has(agent.kind),
	).length;
	const effectiveRouting =
		!slots.externalHarnessesEnabled || activeCount === 0 ? "disabled" : activeCount === 1 ? "none" : "auto";
	const blockingReason =
		slots.externalHarnessesEnabled && activeCount === 0
			? "Enable at least one available coding harness before sending a prompt."
			: slots.externalHarnessesEnabled && !externalPromptingAvailable
				? "External agent prompting is not available until a native harness adapter is connected."
				: undefined;
	return {
		slots,
		harnesses,
		effectiveRouting,
		externalPromptingAvailable,
		...(blockingReason ? { blockingReason } : {}),
	};
}

export const probeCodingHarnessVersion: CodingHarnessProbe = (command, options) =>
	new Promise((resolve, reject) => {
		execFile(
			command,
			[...options.args],
			{
				encoding: "utf8",
				maxBuffer: options.maxOutputBytes,
				shell: options.shell,
				timeout: options.timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) reject(error);
				else resolve({ stdout, stderr });
			},
		);
	});

function firstOutputLine(result: CodingHarnessProbeResult): string | undefined {
	const line = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
		.split(/\r?\n/)
		.map((candidate) => candidate.trim())
		.find(Boolean);
	return line?.slice(0, MAX_VERSION_LENGTH);
}

export async function discoverCodingHarnesses(
	probe: CodingHarnessProbe = probeCodingHarnessVersion,
): Promise<CodingHarnessDiscoveryResult[]> {
	const external = await Promise.all(
		(
			[
				["pi", "pi"],
				["claude-code", "claude"],
				["codex", "codex"],
				["opencode", "opencode"],
				["cline", "cline"],
			] as const
		).map(async ([kind, command]) => {
			try {
				const version = firstOutputLine(await probe(command, VERSION_PROBE_OPTIONS));
				return { kind, available: true, builtin: false, models: [], ...(version ? { version } : {}) };
			} catch {
				return { kind, available: false, builtin: false, models: [] };
			}
		}),
	);
	return [{ kind: "klerm", available: true, builtin: true, models: [] }, ...external];
}
