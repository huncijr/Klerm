import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type KlermRoutingMode = "off" | "local" | "frontier" | "auto";

export interface KlermConfig {
	routing: KlermRoutingMode;
	localModel?: string;
	frontierModel?: string;
	allowFrontierFallback: boolean;
	localMaxTurns: number;
	localMaxToolErrors: number;
}

export const DEFAULT_KLERM_CONFIG: KlermConfig = {
	routing: "off",
	allowFrontierFallback: false,
	localMaxTurns: 8,
	localMaxToolErrors: 3,
};

export function getKlermConfigPath(agentDir: string): string {
	return join(agentDir, "klerm.json");
}

function isRoutingMode(value: unknown): value is KlermRoutingMode {
	return value === "off" || value === "local" || value === "frontier" || value === "auto";
}

function positiveInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
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
			localModel: overrides.localModel ?? stored.localModel,
			frontierModel: overrides.frontierModel ?? stored.frontierModel,
			allowFrontierFallback:
				overrides.allowFrontierFallback ??
				stored.allowFrontierFallback ??
				DEFAULT_KLERM_CONFIG.allowFrontierFallback,
			localMaxTurns: positiveInteger(
				overrides.localMaxTurns ?? stored.localMaxTurns,
				DEFAULT_KLERM_CONFIG.localMaxTurns,
			),
			localMaxToolErrors: positiveInteger(
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
