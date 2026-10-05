import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface HeadlessBackend {
	request(command: Record<string, unknown>): Promise<unknown>;
	subscribe(listener: (event: Record<string, unknown>) => void): () => void;
	close(): Promise<void>;
}

/** One persistent RPC process belongs to the server, never to a browser connection. */
export class RpcProcessBackend implements HeadlessBackend {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly listeners = new Set<(event: Record<string, unknown>) => void>();
	private readonly pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
	>();
	private failure?: Error;
	private readonly exited: Promise<void>;

	constructor(entry: string, cwd: string, args: string[] = []) {
		this.child = spawn(process.execPath, [entry, ...args], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
		lines.on("line", (line) => {
			let event: Record<string, unknown>;
			try {
				event = JSON.parse(line) as Record<string, unknown>;
			} catch {
				return;
			}
			if (!event || typeof event !== "object" || Array.isArray(event)) return;
			if (event.type === "response" && typeof event.id === "string") {
				const pending = this.pending.get(event.id);
				if (pending) {
					clearTimeout(pending.timer);
					this.pending.delete(event.id);
					pending.resolve(event);
				}
			}
			for (const listener of this.listeners) listener(event);
		});
		this.child.stderr.resume();
		this.child.stdin.on("error", () => this.fail());
		this.child.on("error", () => this.fail());
		this.exited = new Promise((resolve) =>
			this.child.once("close", () => {
				lines.close();
				this.fail();
				resolve();
			}),
		);
	}

	request(command: Record<string, unknown>): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure);
		if (command.type === "extension_ui_response") {
			this.child.stdin.write(`${JSON.stringify(command)}\n`);
			return Promise.resolve({ type: "response", id: command.id, command: command.type, success: true });
		}
		if (typeof command.id !== "string" || this.pending.has(command.id))
			return Promise.reject(new Error("Invalid or duplicate RPC request ID."));
		const id = command.id;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error("Backend request timed out; execution may still be active."));
			}, 120_000);
			this.pending.set(id, { resolve, reject, timer });
			this.child.stdin.write(`${JSON.stringify(command)}\n`);
		});
	}

	subscribe(listener: (event: Record<string, unknown>) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async close(): Promise<void> {
		this.child.stdin.end();
		const timer = setTimeout(() => this.child.kill("SIGTERM"), 3000);
		const force = setTimeout(() => this.child.kill("SIGKILL"), 6000);
		try {
			await this.exited;
		} finally {
			clearTimeout(timer);
			clearTimeout(force);
		}
	}

	private fail(): void {
		if (this.failure) return;
		this.failure = new Error("Klerm RPC backend is unavailable. Restart the service and review interrupted tasks.");
		for (const listener of this.listeners) listener({ type: "backend_unavailable", reason: this.failure.message });
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(this.failure);
		}
		this.pending.clear();
	}
}
