import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getAgentDir, getSessionsDir } from "../../config.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { KlermConfigStore } from "../config.ts";
import {
	discoverLocalRuntimes,
	getLocalRuntimeProbes,
	type LocalRuntimeDiscoveryResult,
	type LocalRuntimeProbe,
} from "../local-runtime-discovery.ts";
import { getKlermDecisionLogPath } from "../router/decision-log.ts";

export type KlermDoctorStatus = "pass" | "warning" | "fail";

export interface KlermDoctorCheck {
	id: string;
	status: KlermDoctorStatus;
	message: string;
}

interface DoctorModelRuntime {
	getProviders(): readonly { id: string; name: string }[];
	getProviderAuthStatus(providerId: string): { configured: boolean };
}

export interface RunKlermDoctorCommandOptions {
	cwd?: string;
	agentDir?: string;
	sessionsDir?: string;
	modelRuntime: DoctorModelRuntime;
	probes?: readonly LocalRuntimeProbe[];
	discoverLocal?: (
		probes: readonly LocalRuntimeProbe[],
		signal: AbortSignal,
	) => Promise<LocalRuntimeDiscoveryResult[]>;
	getMcpServers?: () => Record<string, { enabled?: boolean }>;
	stdout?: (message: string) => void;
	stderr?: (message: string) => void;
}

async function checkExistingPath(id: string, label: string, path: string): Promise<KlermDoctorCheck> {
	try {
		await access(path, constants.R_OK | constants.W_OK);
		return { id, status: "pass", message: `${label} is readable and writable` };
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			try {
				await access(dirname(path), constants.W_OK);
				return { id, status: "pass", message: `${label} can be created when needed` };
			} catch {
				return { id, status: "fail", message: `${label} cannot be created` };
			}
		}
		return { id, status: "fail", message: `${label} is not readable and writable` };
	}
}

async function checkDecisionLog(cwd: string): Promise<KlermDoctorCheck> {
	try {
		const contents = await readFile(getKlermDecisionLogPath(cwd), "utf8");
		const lines = contents.split("\n").filter((line) => line.trim().length > 0);
		for (const line of lines) JSON.parse(line);
		return {
			id: "decision-log",
			status: "pass",
			message: lines.length === 0 ? "Decision log is empty" : `Decision log contains ${lines.length} valid events`,
		};
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { id: "decision-log", status: "pass", message: "Decision log will be created on first route" };
		}
		return { id: "decision-log", status: "fail", message: "Decision log is unreadable or contains invalid JSONL" };
	}
}

function checkMcpServers(servers: Record<string, { enabled?: boolean }>): KlermDoctorCheck {
	const names = Object.keys(servers);
	if (names.length === 0) {
		return { id: "mcp-servers", status: "pass", message: "No MCP servers configured" };
	}
	const disabled = names.filter((name) => servers[name]?.enabled === false);
	const enabledCount = names.length - disabled.length;
	const message =
		disabled.length === 0
			? `${names.length} MCP server(s) configured`
			: `${enabledCount} of ${names.length} MCP server(s) enabled (disabled: ${disabled.join(", ")})`;
	return { id: "mcp-servers", status: "pass", message };
}

function statusExitCode(checks: readonly KlermDoctorCheck[]): number {
	if (checks.some((check) => check.status === "fail")) return 1;
	if (checks.some((check) => check.status === "warning")) return 2;
	return 0;
}

export async function runKlermDoctorCommand(args: string[], options: RunKlermDoctorCommandOptions): Promise<boolean> {
	if (args[0] !== "doctor") return false;
	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	if (args.includes("--help") || args.includes("-h")) {
		stdout("Usage: klerm doctor [--json]");
		return true;
	}
	if (args.some((arg, index) => index > 0 && arg !== "--json")) {
		stderr("Error: klerm doctor only accepts --json");
		process.exitCode = 1;
		return true;
	}

	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	const sessionsDir = options.sessionsDir ?? getSessionsDir();
	const checks: KlermDoctorCheck[] = [];
	let config: Awaited<ReturnType<typeof KlermConfigStore.load>> | undefined;
	try {
		config = await KlermConfigStore.load(agentDir);
		checks.push({ id: "config", status: "pass", message: "Klerm configuration is valid" });
	} catch {
		checks.push({ id: "config", status: "fail", message: "Klerm configuration is unreadable or invalid" });
	}

	checks.push(await checkExistingPath("agent-storage", "Agent storage", agentDir));
	checks.push(await checkExistingPath("session-storage", "Session storage", sessionsDir));
	checks.push(await checkDecisionLog(cwd));

	const getMcpServers =
		options.getMcpServers ?? (() => SettingsManager.create(cwd, agentDir, { projectTrusted: false }).getMcpServers());
	checks.push(checkMcpServers(getMcpServers()));

	const probes = options.probes ?? getLocalRuntimeProbes();
	const discover = options.discoverLocal ?? discoverLocalRuntimes;
	const localResults = await discover(probes, AbortSignal.timeout(5000));
	const localModels = localResults.flatMap((result) => (result.error ? [] : result.models));
	checks.push(
		localModels.length > 0
			? { id: "local-runtime", status: "pass", message: `${localModels.length} local model(s) available` }
			: {
					id: "local-runtime",
					status: "warning",
					message: localResults.some((result) => !result.error)
						? "Local runtime is reachable but reports no models"
						: "No local model runtime is reachable",
				},
	);

	const localProviderIds = new Set(probes.map((probe) => probe.providerId));
	const configuredFrontier = options.modelRuntime
		.getProviders()
		.filter((provider) => !localProviderIds.has(provider.id))
		.filter((provider) => options.modelRuntime.getProviderAuthStatus(provider.id).configured);
	checks.push(
		configuredFrontier.length > 0
			? {
					id: "frontier-provider",
					status: "pass",
					message: `${configuredFrontier.length} frontier provider(s) configured`,
				}
			: { id: "frontier-provider", status: "warning", message: "No frontier provider is configured" },
	);

	const routing = config?.get().routing;
	checks.push(
		routing === undefined
			? { id: "routing", status: "fail", message: "Routing configuration is unavailable" }
			: routing === "off"
				? { id: "routing", status: "warning", message: "Klerm routing is disabled" }
				: { id: "routing", status: "pass", message: `Klerm routing mode is ${routing}` },
	);

	const exitCode = statusExitCode(checks);
	process.exitCode = exitCode;
	if (args.includes("--json")) {
		stdout(
			JSON.stringify(
				{ status: exitCode === 0 ? "pass" : exitCode === 1 ? "fail" : "warning", exitCode, checks },
				null,
				2,
			),
		);
	} else {
		const labels: Record<KlermDoctorStatus, string> = { pass: "PASS", warning: "WARN", fail: "FAIL" };
		stdout(checks.map((check) => `${labels[check.status].padEnd(4)} ${check.id}: ${check.message}`).join("\n"));
	}
	return true;
}
