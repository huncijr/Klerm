import { spawn } from "node:child_process";

/**
 * Agent Client Protocol (ACP) discovery, the same way Zed finds coding agents:
 * launch the agent's ACP adapter, run the JSON-RPC `initialize` handshake over
 * stdio (newline-delimited JSON), and learn the agent's identity and
 * capabilities from the response. A harness that completes the handshake is
 * available; one that does not falls back to the legacy version probe.
 */
export interface AcpAgentScan {
	command: string;
	protocolVersion: number;
	agentName?: string;
	agentTitle?: string;
	agentVersion?: string;
	loadSession?: boolean;
}

export type AcpScanRunner = (kind: CodingHarnessScanKind) => Promise<AcpAgentScan | undefined>;

export type CodingHarnessScanKind = "pi" | "claude-code" | "codex" | "opencode" | "cline";

/** Known ACP adapter commands per harness kind, mirroring the agents Zed connects to. */
export const ACP_AGENT_COMMANDS: Readonly<Record<CodingHarnessScanKind, readonly string[]>> = {
	pi: [],
	"claude-code": ["claude-code-acp"],
	codex: ["codex-acp"],
	opencode: ["opencode-acp"],
	cline: ["cline-acp"],
};

const ACP_INITIALIZE_TIMEOUT_MS = 5_000;
const ACP_MAX_OUTPUT_BYTES = 1_048_576;
const ACP_PROTOCOL_VERSION = 1;

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export async function probeAcpAgent(command: string, args: readonly string[] = []): Promise<AcpAgentScan | undefined> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		} catch {
			resolve(undefined);
			return;
		}
		const { stdout: out, stdin } = child;
		if (!out || !stdin) {
			child.kill();
			resolve(undefined);
			return;
		}
		let stdout = "";
		let settled = false;
		let timer: ReturnType<typeof setTimeout>;

		const finish = (scan?: AcpAgentScan) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.removeAllListeners();
			if (!child.killed) child.kill();
			resolve(scan);
		};

		timer = setTimeout(() => finish(), ACP_INITIALIZE_TIMEOUT_MS);
		child.on("error", () => finish());
		out.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			if (stdout.length > ACP_MAX_OUTPUT_BYTES) return finish();
			let newline = stdout.indexOf("\n");
			while (newline >= 0) {
				const line = stdout.slice(0, newline).trim();
				stdout = stdout.slice(newline + 1);
				newline = stdout.indexOf("\n");
				if (!line) continue;
				let message: unknown;
				try {
					message = JSON.parse(line);
				} catch {
					continue;
				}
				const record = asRecord(message);
				if (!record || record.id !== 0) continue;
				if (record.error) return finish();
				const result = asRecord(record.result);
				if (!result || typeof result.protocolVersion !== "number") return finish();
				const agentInfo = asRecord(result.agentInfo);
				const capabilities = asRecord(result.agentCapabilities);
				const scan: AcpAgentScan = {
					command,
					protocolVersion: result.protocolVersion,
					...(typeof agentInfo?.name === "string" ? { agentName: agentInfo.name } : {}),
					...(typeof agentInfo?.title === "string" ? { agentTitle: agentInfo.title } : {}),
					...(typeof agentInfo?.version === "string" ? { agentVersion: agentInfo.version } : {}),
					...(capabilities?.loadSession === true ? { loadSession: true } : {}),
				};
				return finish(scan);
			}
		});
		stdin.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 0,
				method: "initialize",
				params: {
					protocolVersion: ACP_PROTOCOL_VERSION,
					clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
					clientInfo: { name: "klerm", title: "Klerm", version: "0.0.3" },
				},
			})}\n`,
		);
	});
}

/** Try every known ACP adapter command for a harness kind; the first completed handshake wins. */
export async function scanAcpHarness(kind: CodingHarnessScanKind): Promise<AcpAgentScan | undefined> {
	for (const command of ACP_AGENT_COMMANDS[kind] ?? []) {
		const scan = await probeAcpAgent(command);
		if (scan) return scan;
	}
	return undefined;
}
