import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface BrowserDebugEntry {
	event: string;
	runId: string;
	model: string;
	details?: unknown;
}

/** Only pass normalized lifecycle metadata, never prompts or provider response bodies. */
export class BrowserDebugLog {
	private tail: Promise<void> = Promise.resolve();
	private sequence = 0;
	private readonly cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	write(entry: BrowserDebugEntry): Promise<void> {
		const line = `${JSON.stringify({ version: 1, timestamp: new Date().toISOString(), sequence: ++this.sequence, ...entry })}\n`;
		const pending = this.tail.then(async () => {
			await mkdir(join(this.cwd, ".klerm"), { recursive: true, mode: 0o700 });
			await appendFile(join(this.cwd, ".klerm", "browser-debug.jsonl"), line, { mode: 0o600 });
		});
		// Diagnostics must not stop an in-flight browser operation. The audit log
		// remains authoritative and has its own failure handling.
		this.tail = pending.catch(() => undefined);
		return this.tail;
	}
}
