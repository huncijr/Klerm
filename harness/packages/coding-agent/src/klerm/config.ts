import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type KlermRoutingMode = "off" | "local" | "frontier" | "auto";
export type KlermActiveStartLane = "auto" | "local" | "frontier" | "frontier-local";

export interface KlermConfig {
	routing: KlermRoutingMode;
	activeStartLane: KlermActiveStartLane;
	localModel?: string;
	frontierModel?: string;
	localThinkingLevel?: ThinkingLevel;
	frontierThinkingLevel?: ThinkingLevel;
	allowFrontierFallback: boolean;
	handbackEnabled: boolean;
	maxDelegationCycles: number;
	localMaxTurns: number;
	localMaxToolErrors: number;
}

export const DEFAULT_KLERM_CONFIG: KlermConfig = {
	routing: "off",
	activeStartLane: "auto",
	allowFrontierFallback: false,
	handbackEnabled: true,
	maxDelegationCycles: 3,
	localMaxTurns: 8,
	localMaxToolErrors: 3,
};

export function getKlermConfigPath(agentDir: string): string {
	return join(agentDir, "klerm.json");
}

function isRoutingMode(value: unknown): value is KlermRoutingMode {
	return value === "off" || value === "local" || value === "frontier" || value === "auto";
}

function isActiveStartLane(value: unknown): value is KlermActiveStartLane {
	return value === "auto" || value === "local" || value === "frontier" || value === "frontier-local";
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return (
		value === "off" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max"
	);
}

function integerAtLeast(value: unknown, fallback: number, minimum = 1): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

export class KlermConfigStore {
	readonly path: string;
	private config: KlermConfig;

	private constructor(path: string, config: KlermConfig) {
		this.path = path;
		this.config = config;
	}

	static async load(agentDir: string, overrides: Partial<KlermConfig> = {}): Promise<KlermConfigStore> {
		const path = getKlermConfigPath(agentDir);
		let stored: Partial<KlermConfig> = {};
		try {
			stored = JSON.parse(await readFile(path, "utf8")) as Partial<KlermConfig>;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		const config: KlermConfig = {
			routing: isRoutingMode(overrides.routing ?? stored.routing) ? (overrides.routing ?? stored.routing)! : "off",
			activeStartLane: isActiveStartLane(overrides.activeStartLane ?? stored.activeStartLane)
				? (overrides.activeStartLane ?? stored.activeStartLane)!
				: DEFAULT_KLERM_CONFIG.activeStartLane,
			localModel: overrides.localModel ?? stored.localModel,
			frontierModel: overrides.frontierModel ?? stored.frontierModel,
			localThinkingLevel: isThinkingLevel(overrides.localThinkingLevel ?? stored.localThinkingLevel)
				? (overrides.localThinkingLevel ?? stored.localThinkingLevel)
				: undefined,
			frontierThinkingLevel: isThinkingLevel(overrides.frontierThinkingLevel ?? stored.frontierThinkingLevel)
				? (overrides.frontierThinkingLevel ?? stored.frontierThinkingLevel)
				: undefined,
			allowFrontierFallback:
				overrides.allowFrontierFallback ??
				stored.allowFrontierFallback ??
				DEFAULT_KLERM_CONFIG.allowFrontierFallback,
			handbackEnabled: overrides.handbackEnabled ?? stored.handbackEnabled ?? DEFAULT_KLERM_CONFIG.handbackEnabled,
			maxDelegationCycles: integerAtLeast(
				overrides.maxDelegationCycles ?? stored.maxDelegationCycles,
				DEFAULT_KLERM_CONFIG.maxDelegationCycles,
				0,
			),
			localMaxTurns: integerAtLeast(
				overrides.localMaxTurns ?? stored.localMaxTurns,
				DEFAULT_KLERM_CONFIG.localMaxTurns,
			),
			localMaxToolErrors: integerAtLeast(
				overrides.localMaxToolErrors ?? stored.localMaxToolErrors,
				DEFAULT_KLERM_CONFIG.localMaxToolErrors,
			),
		};
		return new KlermConfigStore(path, config);
	}

	get(): Readonly<KlermConfig> {
		return this.config;
	}

	async update(update: Partial<KlermConfig>): Promise<void> {
		this.config = { ...this.config, ...update };
		await mkdir(dirname(this.path), { recursive: true });
		const temporaryPath = `${this.path}.${process.pid}.tmp`;
		await writeFile(temporaryPath, `${JSON.stringify(this.config, null, 2)}\n`, "utf8");
		await rename(temporaryPath, this.path);
	}
}
