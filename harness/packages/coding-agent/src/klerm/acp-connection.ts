import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { CodingHarnessProcessSpawner } from "./coding-harness-adapter.ts";

export function acpRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** A bounded JSON-RPC connection; protocol stdout is never treated as terminal prose. */
export class AcpConnection {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
	>();
	private nextId = 1;
	private failure?: Error;
	private readonly exited: Promise<void>;

	constructor(
		command: string,
		args: readonly string[],
		cwd: string,
		onMessage: (message: Record<string, unknown>) => void,
		spawnProcess: CodingHarnessProcessSpawner = spawn,
	) {
		this.child = spawnProcess(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
		let lineBytes = 0;
		this.child.stdout.on("data", (chunk: Buffer) => {
			for (const byte of chunk) {
				lineBytes = byte === 10 ? 0 : lineBytes + 1;
				if (lineBytes > 1_048_576) {
					this.fail(new Error("ACP frame exceeded 1 MiB."));
					this.child.kill("SIGTERM");
					break;
				}
			}
		});
		lines.on("line", (line) => {
			if (this.failure || !line.trim()) return;
			try {
				const message = acpRecord(JSON.parse(line));
				if (message.jsonrpc !== "2.0") throw new Error("Invalid ACP frame.");
				const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
				if (pending && !message.method) {
					this.pending.delete(message.id as number);
					clearTimeout(pending.timer);
					if (message.error)
						pending.reject(new Error(String(acpRecord(message.error).message ?? "ACP request failed.")));
					else pending.resolve(message.result);
				} else onMessage(message);
			} catch {
				this.fail(new Error("Invalid ACP JSON-RPC output."));
				this.child.kill("SIGTERM");
			}
		});
		// Drain diagnostics without copying native credentials into Klerm logs.
		this.child.stderr.resume();
		this.child.stdin.on("error", () => this.fail(new Error("ACP input closed.")));
		this.child.on("error", () => this.fail(new Error("Could not launch ACP worker.")));
		this.exited = new Promise((resolve) =>
			this.child.once("close", () => {
				lines.close();
				this.fail(new Error("ACP worker disconnected."));
				resolve();
			}),
		);
	}

	request(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure);
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`ACP ${method} timed out.`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	notify(method: string, params: Record<string, unknown>): void {
		this.send({ jsonrpc: "2.0", method, params });
	}

	reply(id: unknown, result: Record<string, unknown>): void {
		this.send({ jsonrpc: "2.0", id, result });
	}

	rejectRequest(id: unknown): void {
		this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unsupported client capability." } });
	}

	async close(): Promise<void> {
		if (!this.failure) this.child.stdin.end();
		this.fail(new Error("ACP connection closed."));
		this.child.kill("SIGTERM");
		const timer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
		try {
			await this.exited;
		} finally {
			clearTimeout(timer);
		}
	}

	private send(message: Record<string, unknown>): void {
		if (!this.failure) this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private fail(error: Error): void {
		this.failure ??= error;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(this.failure);
		}
		this.pending.clear();
	}
}
