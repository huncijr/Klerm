import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { CodingHarnessAgentSettings, CodingHarnessKind, CodingHarnessRole } from "./coding-harness-setup.ts";

export const CONNECTED_CODING_HARNESS_ADAPTERS = ["opencode", "codex"] as const;
export type ConnectedCodingHarnessKind = (typeof CONNECTED_CODING_HARNESS_ADAPTERS)[number];

export interface CodingHarnessSessionRef {
	id: string;
	agentId: string;
	harness: ConnectedCodingHarnessKind;
	model: string;
	role: CodingHarnessRole;
	nativeSessionId?: string;
}

export type CodingHarnessAdapterEvent =
	| { type: "message"; agentId: string; text: string }
	| { type: "tool-start"; agentId: string; toolCallId: string; toolName: string; input: unknown }
	| {
			type: "tool-end";
			agentId: string;
			toolCallId: string;
			toolName: string;
			output: unknown;
			isError: boolean;
	  }
	| { type: "settled"; agentId: string; status: "completed" | "failed" | "aborted" }
	| { type: "error"; agentId: string; message: string };

export type CodingHarnessAdapterListener = (event: CodingHarnessAdapterEvent) => void;

export type CodingHarnessAdapterDebugEvent =
	| { type: "stdout"; agentId: string; line: string }
	| { type: "stderr"; agentId: string; text: string }
	| { type: "process-close"; agentId: string; code: number | null; signal: NodeJS.Signals | null };

export type CodingHarnessAdapterDebugListener = (event: CodingHarnessAdapterDebugEvent) => void;

export interface CodingHarnessAdapter {
	readonly kind: ConnectedCodingHarnessKind;
	startSession(
		agent: CodingHarnessAgentSettings,
		cwd: string,
		nativeSessionId?: string,
	): Promise<CodingHarnessSessionRef>;
	prompt(session: CodingHarnessSessionRef, message: string): Promise<void>;
	abort(session: CodingHarnessSessionRef): Promise<void>;
	closeSession(session: CodingHarnessSessionRef): Promise<void>;
	subscribe(listener: CodingHarnessAdapterListener): () => void;
	subscribeDebug?(listener: CodingHarnessAdapterDebugListener): () => void;
}

export interface CodingHarnessProcessOptions {
	cwd: string;
	stdio: ["pipe", "pipe", "pipe"];
	windowsHide: true;
}

export type CodingHarnessProcessSpawner = (
	command: string,
	args: readonly string[],
	options: CodingHarnessProcessOptions,
) => ChildProcessWithoutNullStreams;

interface AdapterSessionState {
	ref: CodingHarnessSessionRef;
	cwd: string;
	role: CodingHarnessRole;
	child?: ChildProcessWithoutNullStreams;
	childSettled?: Promise<void>;
	aborted: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function textValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorMessage(value: unknown): string | undefined {
	const error = record(value);
	return textValue(error?.message) ?? textValue(record(error?.data)?.message);
}

abstract class JsonlCodingHarnessAdapter implements CodingHarnessAdapter {
	abstract readonly kind: ConnectedCodingHarnessKind;
	private readonly listeners = new Set<CodingHarnessAdapterListener>();
	private readonly debugListeners = new Set<CodingHarnessAdapterDebugListener>();
	private readonly sessions = new Map<string, AdapterSessionState>();
	private readonly spawnProcess: CodingHarnessProcessSpawner;

	constructor(spawnProcess: CodingHarnessProcessSpawner = spawn) {
		this.spawnProcess = spawnProcess;
	}

	async startSession(
		agent: CodingHarnessAgentSettings,
		cwd: string,
		nativeSessionId?: string,
	): Promise<CodingHarnessSessionRef> {
		if (agent.kind !== this.kind || !agent.model) {
			throw new Error(`${agent.id} requires a ${this.kind} model before starting a session.`);
		}
		const ref: CodingHarnessSessionRef = {
			id: randomUUID(),
			agentId: agent.id,
			harness: this.kind,
			model: agent.model,
			role: agent.role,
			...(nativeSessionId ? { nativeSessionId } : {}),
		};
		this.sessions.set(ref.id, { ref, cwd, role: agent.role, aborted: false });
		return ref;
	}

	async prompt(session: CodingHarnessSessionRef, message: string): Promise<void> {
		const state = this.sessions.get(session.id);
		if (!state) throw new Error(`Unknown ${this.kind} session ${session.id}.`);
		if (state.child) throw new Error(`${session.agentId} is already working.`);
		state.aborted = false;
		const child = this.spawnProcess(this.command(), this.argumentsFor(state), {
			cwd: state.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		state.child = child;
		child.stdin.end(message);

		let stderr = "";
		let finalText = "";
		let protocolFailure: string | undefined;
		const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
		lines.on("line", (line) => {
			if (!line.trim()) return;
			this.emitDebug({ type: "stdout", agentId: session.agentId, line });
			let event: Record<string, unknown>;
			try {
				event = JSON.parse(line) as Record<string, unknown>;
			} catch {
				protocolFailure = `${this.kind} returned invalid JSONL output.`;
				return;
			}
			const parsed = this.parseEvent(state, event);
			if (parsed.sessionId) state.ref.nativeSessionId = parsed.sessionId;
			if (parsed.text) finalText += `${finalText ? "\n" : ""}${parsed.text}`;
			if (parsed.error) protocolFailure = parsed.error;
			for (const adapterEvent of parsed.events) this.emit(adapterEvent);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8");
			this.emitDebug({ type: "stderr", agentId: session.agentId, text });
			if (stderr.length < 8192) stderr += text;
		});

		const childSettled = new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => {
				this.emitDebug({ type: "process-close", agentId: session.agentId, code, signal });
				state.child = undefined;
				if (finalText) this.emit({ type: "message", agentId: session.agentId, text: finalText });
				if (state.aborted) {
					this.emit({ type: "settled", agentId: session.agentId, status: "aborted" });
					resolve();
					return;
				}
				const failure =
					protocolFailure ??
					(code === 0
						? undefined
						: stderr.trim() || `${this.kind} exited with code ${code ?? signal ?? "unknown"}.`);
				if (failure) this.emit({ type: "error", agentId: session.agentId, message: failure.slice(0, 1000) });
				this.emit({ type: "settled", agentId: session.agentId, status: failure ? "failed" : "completed" });
				resolve();
			});
		});
		state.childSettled = childSettled;
		try {
			await childSettled;
		} finally {
			state.childSettled = undefined;
		}
	}

	async abort(session: CodingHarnessSessionRef): Promise<void> {
		const state = this.sessions.get(session.id);
		if (!state?.child) return;
		state.aborted = true;
		state.child.kill("SIGTERM");
		await state.childSettled;
	}

	async closeSession(session: CodingHarnessSessionRef): Promise<void> {
		await this.abort(session);
		this.sessions.delete(session.id);
	}

	subscribe(listener: CodingHarnessAdapterListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	subscribeDebug(listener: CodingHarnessAdapterDebugListener): () => void {
		this.debugListeners.add(listener);
		return () => this.debugListeners.delete(listener);
	}

	protected emit(event: CodingHarnessAdapterEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	private emitDebug(event: CodingHarnessAdapterDebugEvent): void {
		for (const listener of this.debugListeners) listener(event);
	}

	protected abstract command(): string;
	protected abstract argumentsFor(state: AdapterSessionState): string[];
	protected abstract parseEvent(
		state: AdapterSessionState,
		event: Record<string, unknown>,
	): { sessionId?: string; text?: string; error?: string; events: CodingHarnessAdapterEvent[] };
}

export class OpenCodeAdapter extends JsonlCodingHarnessAdapter {
	readonly kind = "opencode" as const;

	protected command(): string {
		return "opencode";
	}

	protected argumentsFor(state: AdapterSessionState): string[] {
		return [
			"run",
			"--format",
			"json",
			"--model",
			state.ref.model,
			"--dir",
			state.cwd,
			...(state.ref.nativeSessionId ? ["--session", state.ref.nativeSessionId] : []),
			"-",
		];
	}

	protected parseEvent(
		state: AdapterSessionState,
		event: Record<string, unknown>,
	): { sessionId?: string; text?: string; error?: string; events: CodingHarnessAdapterEvent[] } {
		const part = record(event.part);
		const partState = record(part?.state);
		const sessionId = textValue(event.sessionID);
		if (event.type === "text") return { sessionId, text: textValue(part?.text), events: [] };
		if (event.type === "error") {
			return { sessionId, error: errorMessage(event.error) ?? "OpenCode session failed.", events: [] };
		}
		if (event.type !== "tool_use" || !part) return { sessionId, events: [] };
		const toolCallId = textValue(part.callID) ?? textValue(part.id) ?? randomUUID();
		const toolName = textValue(part.tool) ?? "unknown";
		const input = partState?.input ?? {};
		const isError = partState?.status === "error" || partState?.status === "failed";
		return {
			sessionId,
			events: [
				{ type: "tool-start", agentId: state.ref.agentId, toolCallId, toolName, input },
				{
					type: "tool-end",
					agentId: state.ref.agentId,
					toolCallId,
					toolName,
					output: partState?.output ?? partState?.metadata ?? "",
					isError,
				},
			],
		};
	}
}

export class CodexAdapter extends JsonlCodingHarnessAdapter {
	readonly kind = "codex" as const;

	protected command(): string {
		return "codex";
	}

	protected argumentsFor(state: AdapterSessionState): string[] {
		if (state.ref.nativeSessionId) {
			return ["exec", "resume", "--json", "--model", state.ref.model, state.ref.nativeSessionId, "-"];
		}
		return [
			"exec",
			"--json",
			"--model",
			state.ref.model,
			"--sandbox",
			state.role === "planner" ? "read-only" : "workspace-write",
			"--cd",
			state.cwd,
			"-",
		];
	}

	protected parseEvent(
		state: AdapterSessionState,
		event: Record<string, unknown>,
	): { sessionId?: string; text?: string; error?: string; events: CodingHarnessAdapterEvent[] } {
		const sessionId = event.type === "thread.started" ? textValue(event.thread_id) : undefined;
		if (event.type === "turn.failed") {
			return { sessionId, error: errorMessage(event.error) ?? "Codex turn failed.", events: [] };
		}
		if (event.type === "error")
			return { sessionId, error: textValue(event.message) ?? "Codex stream failed.", events: [] };
		const item = record(event.item);
		if (!item) return { sessionId, events: [] };
		if (event.type === "item.completed" && item.type === "agent_message") {
			return { sessionId, text: textValue(item.text), events: [] };
		}
		if (item.type !== "command_execution" && item.type !== "mcp_tool_call") return { sessionId, events: [] };
		const toolCallId = textValue(item.id) ?? randomUUID();
		const mcp = item.type === "mcp_tool_call";
		const toolName = mcp ? `${textValue(item.server) ?? "mcp"}/${textValue(item.tool) ?? "unknown"}` : "bash";
		if (event.type === "item.started") {
			return {
				sessionId,
				events: [
					{
						type: "tool-start",
						agentId: state.ref.agentId,
						toolCallId,
						toolName,
						input: mcp ? (item.arguments ?? {}) : { command: item.command ?? "" },
					},
				],
			};
		}
		if (event.type !== "item.completed") return { sessionId, events: [] };
		return {
			sessionId,
			events: [
				{
					type: "tool-end",
					agentId: state.ref.agentId,
					toolCallId,
					toolName,
					output: mcp ? (item.result ?? item.error ?? "") : (item.aggregated_output ?? ""),
					isError: item.status === "failed" || item.error != null,
				},
			],
		};
	}
}

export function createCodingHarnessAdapters(): Map<ConnectedCodingHarnessKind, CodingHarnessAdapter> {
	return new Map<ConnectedCodingHarnessKind, CodingHarnessAdapter>([
		["opencode", new OpenCodeAdapter()],
		["codex", new CodexAdapter()],
	]);
}

export function hasConnectedCodingHarnessAdapter(kind: CodingHarnessKind): kind is ConnectedCodingHarnessKind {
	return CONNECTED_CODING_HARNESS_ADAPTERS.includes(kind as ConnectedCodingHarnessKind);
}
