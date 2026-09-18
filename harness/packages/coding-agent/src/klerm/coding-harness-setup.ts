import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { type AcpAgentScan, type CodingHarnessScanKind, scanAcpHarness } from "./acp-discovery.ts";
import { describeModelProfile, type KlermStrengthBand } from "./model-profile.ts";

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
	personalBotId?: string;
	memoryProfileId?: string;
	role: CodingHarnessRole;
	effort: CodingHarnessEffort;
	tools: string[];
	specialties?: string[];
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
	adapterConnected?: boolean;
	version?: string;
	error?: string;
	models: string[];
	/** Present when the harness was identified through an ACP `initialize` handshake. */
	acp?: AcpAgentScan;
}

export interface RunnableCodingHarnessAgent {
	order: number;
	agentId: string;
	harness: CodingHarnessKind;
	model: string;
	role: CodingHarnessRole;
	effort: CodingHarnessEffort;
	tools: string[];
	specialties: string[];
	strengthBand: KlermStrengthBand;
	strengths: string[];
	limits: string[];
	capabilitySource: "model-profile-inference";
	adapterCapabilities: {
		prompt: true;
		abort: true;
		resumeSession: boolean;
		roleEnforcement: boolean;
		childTaskEvents: false;
	};
}

export interface ExcludedCodingHarnessAgent {
	agentId: string;
	reason: string;
}

export interface CodingHarnessSetup {
	slots: CodingHarnessSlots;
	harnesses: CodingHarnessDiscoveryResult[];
	effectiveRouting: "auto" | "none" | "disabled";
	externalPromptingAvailable: boolean;
	workTogetherAvailable: boolean;
	runnableAgents: RunnableCodingHarnessAgent[];
	excludedAgents: ExcludedCodingHarnessAgent[];
	sharedContextPreview?: string;
	blockingReason?: string;
}

export interface CodingHarnessProbeOptions {
	args: readonly string[];
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

export type CodingHarnessModelDiscovery = (kind: CodingHarnessKind) => Promise<string[]>;
export type CodingHarnessCommandRunner = (
	command: string,
	args: readonly string[],
	timeoutMs: number,
	maxOutputBytes: number,
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
const MAX_MODEL_COUNT = 1000;
const MAX_AGENTS = 4;
const AGENT_ID_PATTERN = /^agent([1-9]\d*)$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const SPECIALTY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 +#./_-]{0,63}$/;

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
	const personalBotId =
		typeof candidate.personalBotId === "string" ? candidate.personalBotId.trim().slice(0, 128) : "";
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
	const specialties = Array.isArray(candidate.specialties)
		? [
				...new Set(
					candidate.specialties.flatMap((specialty) =>
						typeof specialty === "string" && SPECIALTY_PATTERN.test(specialty.trim()) ? [specialty.trim()] : [],
					),
				),
			].slice(0, 16)
		: fallback.specialties;
	return {
		id,
		kind,
		enabled: kind !== null && (typeof candidate.enabled === "boolean" ? candidate.enabled : fallback.enabled),
		...(model ? { model } : {}),
		...(personalBotId ? { personalBotId } : {}),
		...(memoryProfileId ? { memoryProfileId } : {}),
		role,
		effort,
		tools,
		...(specialties && specialties.length > 0 ? { specialties } : {}),
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
	return {
		externalHarnessesEnabled: stored.externalHarnessesEnabled === true,
		...(stored.externalHarnessesEnabled === true &&
		agents.filter((agent) => agent.enabled).length >= 2 &&
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
			(key) =>
				![
					"id",
					"kind",
					"enabled",
					"model",
					"personalBotId",
					"memoryProfileId",
					"role",
					"effort",
					"tools",
					"specialties",
				].includes(key),
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
		agent.personalBotId !== undefined &&
		(typeof agent.personalBotId !== "string" || !agent.personalBotId.trim() || agent.personalBotId.length > 128)
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
	if (
		agent.specialties !== undefined &&
		(!Array.isArray(agent.specialties) ||
			agent.specialties.some(
				(specialty) => typeof specialty !== "string" || !SPECIALTY_PATTERN.test(specialty.trim()),
			))
	) {
		return undefined;
	}
	return {
		id: agent.id,
		kind: agent.kind as CodingHarnessSlot,
		enabled: agent.enabled,
		...(typeof agent.model === "string" ? { model: agent.model.trim() } : {}),
		...(typeof agent.personalBotId === "string" ? { personalBotId: agent.personalBotId.trim() } : {}),
		...(typeof agent.memoryProfileId === "string" ? { memoryProfileId: agent.memoryProfileId.trim() } : {}),
		role: agent.role,
		effort: agent.effort as CodingHarnessEffort,
		tools: [...new Set(agent.tools as string[])],
		...(Array.isArray(agent.specialties)
			? { specialties: [...new Set((agent.specialties as string[]).map((specialty) => specialty.trim()))] }
			: {}),
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
	const workTogetherEnabled =
		setup.externalHarnessesEnabled &&
		setup.workTogetherEnabled === true &&
		parsedAgents.filter((agent) => agent.enabled).length >= 2;
	return {
		externalHarnessesEnabled: setup.externalHarnessesEnabled,
		...(workTogetherEnabled ? { workTogetherEnabled: true } : {}),
		agents: parsedAgents,
	};
}

export function nextCodingHarnessAgentId(agents: readonly CodingHarnessAgentSettings[]): string {
	const used = new Set(agents.map((agent) => Number(AGENT_ID_PATTERN.exec(agent.id)?.[1] ?? 0)));
	let number = 1;
	while (used.has(number)) number += 1;
	return `agent${number}`;
}

export function createCodingHarnessAgent(id: string, kind: CodingHarnessSlot = "klerm"): CodingHarnessAgentSettings {
	return { id, kind, enabled: kind !== null, role: "builder", effort: "off", tools: [] };
}

export function createCodingHarnessSetup(
	slots: CodingHarnessSlots,
	harnesses: CodingHarnessDiscoveryResult[],
	connectedAdapters: ReadonlySet<CodingHarnessKind> = new Set(),
): CodingHarnessSetup {
	const discovery = new Map(harnesses.map((harness) => [harness.kind, harness]));
	const byAgentId = (left: CodingHarnessAgentSettings, right: CodingHarnessAgentSettings) =>
		left.id.localeCompare(right.id, undefined, { numeric: true });
	const runnable = (
		agent: CodingHarnessAgentSettings,
	): agent is CodingHarnessAgentSettings & { kind: CodingHarnessKind; model: string } => {
		if (!slots.externalHarnessesEnabled) return false;
		if (!agent.enabled || !agent.kind || !agent.model || !discovery.get(agent.kind)?.available) return false;
		if (agent.kind === "klerm") return discovery.get("klerm")?.models.includes(agent.model) === true;
		return connectedAdapters.has(agent.kind);
	};
	const ordered = slots.agents.filter(runnable).sort(byAgentId);
	const runnableAgents = ordered.map((agent, index) => {
		const profile = describeModelProfile(agent.model);
		return {
			order: index + 1,
			agentId: agent.id,
			harness: agent.kind,
			model: agent.model,
			role: agent.role,
			effort: agent.effort,
			tools: [...agent.tools],
			specialties: [...(agent.specialties ?? [])],
			strengthBand: profile.band,
			strengths: profile.strengths,
			limits: profile.limits,
			capabilitySource: "model-profile-inference" as const,
			adapterCapabilities: {
				prompt: true as const,
				abort: true as const,
				resumeSession: agent.kind === "klerm" || agent.kind === "codex" || agent.kind === "opencode",
				roleEnforcement: agent.kind === "klerm" || agent.kind === "codex",
				childTaskEvents: false as const,
			},
		};
	});
	const activeCount = runnableAgents.length;
	const effectiveRouting =
		!slots.externalHarnessesEnabled || activeCount === 0 ? "disabled" : activeCount === 1 ? "none" : "auto";
	const harnessLabel = (kind: CodingHarnessKind) =>
		kind === "opencode"
			? "OpenCode"
			: kind === "claude-code"
				? "Claude Code"
				: kind.charAt(0).toUpperCase() + kind.slice(1);
	const excludedAgents: ExcludedCodingHarnessAgent[] = slots.agents
		.filter((agent) => agent.enabled)
		.sort(byAgentId)
		.flatMap((agent) => {
			const label = `Agent ${agent.id.slice(5)}${agent.kind ? ` (${harnessLabel(agent.kind)})` : ""}`;
			if (!agent.kind) return [{ agentId: agent.id, reason: `${label} has no configured harness.` }];
			if (!discovery.get(agent.kind)?.available)
				return [{ agentId: agent.id, reason: `${label} is not available.` }];
			if (!agent.model) return [{ agentId: agent.id, reason: `${label} has no configured model.` }];
			if (agent.kind === "klerm" && !discovery.get("klerm")?.models.includes(agent.model)) {
				return [{ agentId: agent.id, reason: `${label} model is not available.` }];
			}
			if (agent.kind !== "klerm" && !connectedAdapters.has(agent.kind)) {
				return [{ agentId: agent.id, reason: `${label} has no connected prompt adapter.` }];
			}
			return [];
		});
	const blockingReason =
		slots.externalHarnessesEnabled && activeCount === 0
			? (excludedAgents[0]?.reason ?? "Enable at least one runnable coding agent before sending a prompt.")
			: undefined;
	const externalPromptingAvailable = runnableAgents.some((agent) => agent.harness !== "klerm") && !blockingReason;
	return {
		slots,
		harnesses: harnesses.map((harness) => ({
			...harness,
			adapterConnected: harness.kind === "klerm" || connectedAdapters.has(harness.kind),
		})),
		effectiveRouting,
		externalPromptingAvailable,
		workTogetherAvailable: activeCount >= 2,
		runnableAgents,
		excludedAgents,
		...(blockingReason ? { blockingReason } : {}),
	};
}

async function resolveCodingHarnessExecutable(command: string): Promise<string> {
	const home = homedir();
	const directories = [
		...(process.env.PATH ?? "").split(delimiter),
		join(home, ".npm-global", "bin"),
		join(home, ".local", "bin"),
		join(home, ".bun", "bin"),
		join(home, ".cargo", "bin"),
	].filter(Boolean);
	for (const directory of new Set(directories)) {
		const candidate = join(directory, process.platform === "win32" ? `${command}.cmd` : command);
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Continue through known user-level executable locations.
		}
	}
	return command;
}

const runCodingHarnessCommand: CodingHarnessCommandRunner = async (
	command: string,
	args: readonly string[],
	timeoutMs: number,
	maxOutputBytes: number,
): Promise<CodingHarnessProbeResult> => {
	const executable = await resolveCodingHarnessExecutable(command);
	return new Promise((resolve, reject) => {
		execFile(
			executable,
			[...args],
			{
				encoding: "utf8",
				maxBuffer: maxOutputBytes,
				shell: false,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) reject(error);
				else resolve({ stdout, stderr });
			},
		);
	});
};

export const probeCodingHarnessVersion: CodingHarnessProbe = (command, options) =>
	runCodingHarnessCommand(command, options.args, options.timeoutMs, options.maxOutputBytes);

function parseModelLines(output: string): string[] {
	return [
		...new Set(
			output
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line.length > 0 && line.length <= MAX_MODEL_LENGTH && !/\s/.test(line)),
		),
	].slice(0, MAX_MODEL_COUNT);
}

function parsePiModels(output: string): string[] {
	return [
		...new Set(
			output
				.split(/\r?\n/)
				.slice(1)
				.map((line) => line.trim().split(/\s{2,}/))
				.filter((columns) => columns.length >= 2)
				.map(([provider, model]) => `${provider}/${model}`)
				.filter((model) => model.length <= MAX_MODEL_LENGTH && !/\s/.test(model)),
		),
	].slice(0, MAX_MODEL_COUNT);
}

async function discoverCodexModels(): Promise<string[]> {
	const executable = await resolveCodingHarnessExecutable("codex");
	return new Promise((resolve, reject) => {
		const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timer: ReturnType<typeof setTimeout>;

		const finish = (error?: Error, models?: string[]) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (!child.killed) child.kill();
			if (error) reject(error);
			else resolve(models ?? []);
		};
		const send = (message: Record<string, unknown>) => child.stdin.write(`${JSON.stringify(message)}\n`);
		timer = setTimeout(() => finish(new Error("Codex model discovery timed out.")), 15_000);

		child.on("error", (error) => finish(error));
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < 8192) stderr += chunk.toString("utf8");
		});
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			if (stdout.length > 1_048_576) return finish(new Error("Codex model discovery returned too much data."));
			let newline = stdout.indexOf("\n");
			while (newline >= 0) {
				const line = stdout.slice(0, newline).trim();
				stdout = stdout.slice(newline + 1);
				newline = stdout.indexOf("\n");
				if (!line) continue;
				let message: Record<string, unknown>;
				try {
					message = JSON.parse(line) as Record<string, unknown>;
				} catch {
					continue;
				}
				if (message.id === 1 && message.result) {
					send({ method: "initialized", params: {} });
					send({ method: "model/list", id: 2, params: { limit: 1000, includeHidden: false } });
				}
				if (message.id !== 2) continue;
				if (message.error)
					return finish(new Error(`Codex model discovery failed: ${JSON.stringify(message.error)}`));
				const result = message.result;
				if (!result || typeof result !== "object" || Array.isArray(result)) {
					return finish(new Error("Codex returned an invalid model list."));
				}
				const data = (result as Record<string, unknown>).data;
				if (!Array.isArray(data)) return finish(new Error("Codex returned an invalid model list."));
				const models = data
					.map((item) => {
						if (!item || typeof item !== "object" || Array.isArray(item)) return "";
						const record = item as Record<string, unknown>;
						return typeof record.model === "string"
							? record.model
							: typeof record.id === "string"
								? record.id
								: "";
					})
					.filter((model) => model.length > 0 && model.length <= MAX_MODEL_LENGTH);
				return finish(undefined, [...new Set(models)].slice(0, MAX_MODEL_COUNT));
			}
		});
		child.on("exit", (code) => {
			if (!settled)
				finish(new Error(stderr.trim() || `Codex model discovery exited with code ${code ?? "unknown"}.`));
		});
		send({
			method: "initialize",
			id: 1,
			params: { clientInfo: { name: "klerm", title: "Klerm", version: "0.0.3" } },
		});
	});
}

export async function discoverCodingHarnessModels(
	kind: CodingHarnessKind,
	run: CodingHarnessCommandRunner = runCodingHarnessCommand,
	codexModels: () => Promise<string[]> = discoverCodexModels,
): Promise<string[]> {
	if (kind === "opencode") {
		const result = await run("opencode", ["models"], 15_000, 1_048_576);
		return parseModelLines(result.stdout ?? "");
	}
	if (kind === "codex") return codexModels();
	if (kind === "pi") {
		const result = await run("pi", ["--list-models"], 15_000, 1_048_576);
		return parsePiModels(result.stdout ?? "");
	}
	return [];
}

function firstOutputLine(result: CodingHarnessProbeResult): string | undefined {
	const line = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
		.split(/\r?\n/)
		.map((candidate) => candidate.trim())
		.find(Boolean);
	return line?.slice(0, MAX_VERSION_LENGTH);
}

export async function discoverCodingHarnesses(
	probe: CodingHarnessProbe = probeCodingHarnessVersion,
	acpScan: (kind: CodingHarnessScanKind) => Promise<AcpAgentScan | undefined> = scanAcpHarness,
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
			// ACP-first discovery (Zed style): a completed `initialize` handshake
			// identifies the agent, its version, and its capabilities.
			const acp = await acpScan(kind);
			if (acp) {
				return {
					kind,
					available: true,
					builtin: false,
					models: [],
					...(acp.agentVersion ? { version: acp.agentVersion.slice(0, MAX_VERSION_LENGTH) } : {}),
					acp,
				};
			}
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
