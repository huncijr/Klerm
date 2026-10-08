import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Harness identity and native model references are independent, opaque strings. */
export interface AgentDescriptor {
	id: string;
	harness: { id: string; name: string; version?: string };
	capabilities: AgentCapability;
}

export interface AgentCapability {
	resumeSession: boolean;
	interrupt: boolean;
	tools: readonly string[];
	/** Only advertise roles the runtime actually enforces. */
	enforcedRoles: readonly string[];
}

export interface AgentSessionRef {
	id: string;
	agentId: string;
	adapterId: string;
	harnessId: string;
	nativeSessionId: string;
	/** Native identifier, never inferred from the harness name. */
	model?: string;
}

export interface AgentStartRequest {
	agentId: string;
	cwd: string;
	model?: string;
	nativeSessionId?: string;
	role?: string;
}

export interface AgentTask {
	taskId: string;
	correlationId: string;
}

export interface AgentPrompt extends AgentTask {
	version: 1;
	messageId: string;
	sender: string;
	recipient: string;
	sequence: number;
	replyTo?: string;
	timestamp: string;
	reason: string;
	text: string;
}

export interface AgentArtifact {
	kind: string;
	reference: string;
	digest?: string;
}

export interface AgentReply extends AgentTask {
	version: 1;
	messageId: string;
	sequence: number;
	timestamp: string;
	replyTo: string;
	sender: string;
	recipient: string;
	status: "completed" | "failed" | "aborted";
	text: string;
	artifacts: AgentArtifact[];
	session: AgentSessionRef;
}

export type AgentStatus = "idle" | "running" | "stopped";

/** Credential-safe decisions; transcript/tool payloads belong to the native runtime. */
export interface AgentEvent {
	version: 1;
	sequence: number;
	timestamp: string;
	type:
		| "SESSION_STARTED"
		| "PROMPT_ACCEPTED"
		| "PROMPT_REJECTED"
		| "REPLY_RETURNED"
		| "INTERRUPT_REQUESTED"
		| "SESSION_STOPPED";
	session: AgentSessionRef;
	sender: string;
	recipient: string;
	reason: string;
	taskId?: string;
	correlationId?: string;
	messageId?: string;
	replyTo?: string;
	status?: AgentReply["status"];
	contentHash?: string;
}

export interface AgentAdapter {
	readonly descriptor: AgentDescriptor;
	discover(): Promise<AgentDescriptor>;
	start(request: AgentStartRequest): Promise<AgentSessionRef>;
	prompt(session: AgentSessionRef, prompt: AgentPrompt): Promise<AgentReply>;
	interrupt(session: AgentSessionRef): Promise<void>;
	stop(session: AgentSessionRef): Promise<void>;
	status(session: AgentSessionRef): AgentStatus;
	dispose(): Promise<void>;
}

export class AgentAdapterRegistry {
	private readonly adapters = new Map<string, AgentAdapter>();

	register(adapter: AgentAdapter): void {
		const { descriptor } = adapter;
		if (!descriptor.id.trim() || !descriptor.harness.id.trim() || !descriptor.harness.name.trim())
			throw new Error("Adapter and harness identities must be explicit.");
		if (this.adapters.has(descriptor.id)) throw new Error(`Adapter already registered: ${descriptor.id}`);
		this.adapters.set(descriptor.id, adapter);
	}

	get(id: string): AgentAdapter {
		const adapter = this.adapters.get(id);
		if (!adapter) throw new Error(`No registered adapter: ${id}`);
		return adapter;
	}

	async discover(): Promise<AgentDescriptor[]> {
		return Promise.all([...this.adapters.keys()].sort().map((id) => this.get(id).discover()));
	}
}

export const AGENT_ADAPTER_LOG_FILE = "agent-adapter-events.jsonl";

export function agentAdapterEventSink(cwd: string): (event: AgentEvent) => Promise<void> {
	return async (event) => {
		await mkdir(join(cwd, ".klerm"), { recursive: true });
		await appendFile(join(cwd, ".klerm", AGENT_ADAPTER_LOG_FILE), `${JSON.stringify(event)}\n`, "utf8");
	};
}

/** Share one journal across adapters so persisted decision order is authoritative. */
export class AgentAdapterJournal {
	private sequence = 0;
	private tail = Promise.resolve();
	private readonly events: AgentEvent[] = [];
	private readonly listeners = new Set<(event: AgentEvent) => void>();
	private readonly sink: (event: AgentEvent) => Promise<void>;
	private readonly now: () => string;

	constructor(sink: (event: AgentEvent) => Promise<void>, now = () => new Date().toISOString()) {
		this.sink = sink;
		this.now = now;
	}

	async record(event: Omit<AgentEvent, "version" | "sequence" | "timestamp">): Promise<AgentEvent> {
		const entry: AgentEvent = {
			...structuredClone(event),
			version: 1,
			sequence: ++this.sequence,
			timestamp: this.now(),
		};
		// A failed audit write blocks subsequent execution instead of silently losing decisions.
		this.tail = this.tail.then(async () => {
			await this.sink(structuredClone(entry));
			this.events.push(entry);
			for (const listener of this.listeners) {
				try {
					listener(structuredClone(entry));
				} catch {
					/* Observers cannot change execution. */
				}
			}
		});
		await this.tail;
		return structuredClone(entry);
	}

	subscribe(listener: (event: AgentEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	replay(): AgentEvent[] {
		return structuredClone(this.events);
	}
}

export interface AgentRuntime {
	readonly nativeSessionId: string;
	readonly model?: string;
	prompt(text: string, signal: AbortSignal): Promise<{ text: string; failed?: boolean; artifacts?: AgentArtifact[] }>;
	interrupt(): Promise<void>;
	dispose(): Promise<void>;
}

export type AgentRuntimeFactory = (request: AgentStartRequest) => Promise<AgentRuntime>;

interface RuntimeState {
	ref: AgentSessionRef;
	runtime: AgentRuntime;
	status: AgentStatus;
	lastSequence: number;
	messageIds: Set<string>;
	controller?: AbortController;
	active?: Promise<AgentReply>;
	closing: boolean;
}

/** Common lifecycle validation around a runtime, independent of brand or model family. */
export class RuntimeAgentAdapter implements AgentAdapter {
	readonly descriptor: AgentDescriptor;
	private readonly sessions = new Map<string, RuntimeState>();
	private readonly factory: AgentRuntimeFactory;
	private readonly journal: AgentAdapterJournal;
	private disposed = false;
	private starting = 0;

	constructor(descriptor: AgentDescriptor, factory: AgentRuntimeFactory, journal: AgentAdapterJournal) {
		this.descriptor = structuredClone(descriptor);
		this.factory = factory;
		this.journal = journal;
	}

	async discover(): Promise<AgentDescriptor> {
		return structuredClone(this.descriptor);
	}

	async start(request: AgentStartRequest): Promise<AgentSessionRef> {
		if (this.disposed) throw new Error("Adapter disposed.");
		if (!request.agentId.trim() || !request.cwd.trim()) throw new Error("Agent identity and workspace are required.");
		if (request.nativeSessionId && !this.descriptor.capabilities.resumeSession)
			throw new Error("Native resume unsupported.");
		if (request.role && !this.descriptor.capabilities.enforcedRoles.includes(request.role))
			throw new Error("Role enforcement unsupported.");
		this.starting++;
		try {
			const runtime = await this.factory(structuredClone(request));
			try {
				if (
					!runtime.nativeSessionId ||
					(request.nativeSessionId && runtime.nativeSessionId !== request.nativeSessionId)
				)
					throw new Error("Runtime did not preserve the requested native session.");
				if (request.model !== undefined && runtime.model !== request.model)
					throw new Error("Runtime did not preserve the requested native model.");
				const ref: AgentSessionRef = {
					id: randomUUID(),
					agentId: request.agentId,
					adapterId: this.descriptor.id,
					harnessId: this.descriptor.harness.id,
					nativeSessionId: runtime.nativeSessionId,
					...(runtime.model !== undefined ? { model: runtime.model } : {}),
				};
				await this.journal.record({
					type: "SESSION_STARTED",
					session: ref,
					sender: "klerm",
					recipient: ref.agentId,
					reason: "Native session started or resumed.",
				});
				this.sessions.set(ref.id, {
					ref,
					runtime,
					status: "idle",
					lastSequence: 0,
					messageIds: new Set(),
					closing: false,
				});
				return structuredClone(ref);
			} catch (error) {
				await runtime.dispose();
				throw error;
			}
		} finally {
			this.starting--;
		}
	}

	private state(session: AgentSessionRef): RuntimeState {
		const state = this.sessions.get(session.id);
		if (
			!state ||
			session.agentId !== state.ref.agentId ||
			session.adapterId !== state.ref.adapterId ||
			session.harnessId !== state.ref.harnessId ||
			session.nativeSessionId !== state.ref.nativeSessionId ||
			session.model !== state.ref.model
		)
			throw new Error("Unknown or mismatched adapter session.");
		return state;
	}

	status(session: AgentSessionRef): AgentStatus {
		return this.state(session).status;
	}

	async prompt(session: AgentSessionRef, prompt: AgentPrompt): Promise<AgentReply> {
		const state = this.state(session);
		if (this.disposed || state.closing || state.status !== "idle") {
			await this.journal.record({
				type: "PROMPT_REJECTED",
				session: state.ref,
				sender: "klerm",
				recipient: state.ref.agentId,
				reason: "Session is not idle.",
			});
			throw new Error("Session is not idle.");
		}
		if (
			prompt.version !== 1 ||
			prompt.recipient !== state.ref.agentId ||
			![prompt.messageId, prompt.sender, prompt.taskId, prompt.correlationId, prompt.reason, prompt.text].every(
				(value) => typeof value === "string" && value.trim(),
			) ||
			!Number.isSafeInteger(prompt.sequence) ||
			prompt.sequence <= state.lastSequence ||
			typeof prompt.timestamp !== "string" ||
			!Number.isFinite(Date.parse(prompt.timestamp)) ||
			state.messageIds.has(prompt.messageId)
		) {
			await this.journal.record({
				type: "PROMPT_REJECTED",
				session: state.ref,
				sender: "klerm",
				recipient: state.ref.agentId,
				reason: "Invalid, duplicate or out-of-order prompt envelope.",
			});
			throw new Error("Invalid, duplicate or out-of-order prompt envelope.");
		}
		const snapshot = structuredClone(prompt);
		state.status = "running";
		state.lastSequence = snapshot.sequence;
		state.messageIds.add(snapshot.messageId);
		const controller = new AbortController();
		state.controller = controller;
		state.active = this.run(state, snapshot, controller.signal);
		try {
			return await state.active;
		} finally {
			state.active = undefined;
			state.controller = undefined;
			if (!state.closing) state.status = "idle";
		}
	}

	private async run(state: RuntimeState, prompt: AgentPrompt, signal: AbortSignal): Promise<AgentReply> {
		await this.journal.record({
			type: "PROMPT_ACCEPTED",
			session: state.ref,
			sender: prompt.sender,
			recipient: prompt.recipient,
			reason: prompt.reason,
			taskId: prompt.taskId,
			correlationId: prompt.correlationId,
			messageId: prompt.messageId,
			replyTo: prompt.replyTo,
			contentHash: createHash("sha256").update(prompt.text).digest("hex"),
		});
		let result: Awaited<ReturnType<AgentRuntime["prompt"]>> = { text: "" };
		try {
			if (state.runtime.nativeSessionId !== state.ref.nativeSessionId || state.runtime.model !== state.ref.model)
				throw new Error("Native session configuration changed.");
			if (!signal.aborted) result = await state.runtime.prompt(prompt.text, signal);
			if (state.runtime.nativeSessionId !== state.ref.nativeSessionId || state.runtime.model !== state.ref.model)
				result.failed = true;
		} catch {
			result = { text: "", failed: true };
		}
		const reply: AgentReply = {
			version: 1,
			messageId: randomUUID(),
			sequence: 0,
			timestamp: "",
			replyTo: prompt.messageId,
			taskId: prompt.taskId,
			correlationId: prompt.correlationId,
			sender: state.ref.agentId,
			recipient: prompt.sender,
			status: signal.aborted ? "aborted" : result.failed ? "failed" : "completed",
			text: result.text,
			artifacts: result.artifacts ?? [],
			session: structuredClone(state.ref),
		};
		const recorded = await this.journal.record({
			type: "REPLY_RETURNED",
			session: state.ref,
			sender: reply.sender,
			recipient: reply.recipient,
			reason: "Native turn settled.",
			taskId: reply.taskId,
			correlationId: reply.correlationId,
			messageId: reply.messageId,
			replyTo: reply.replyTo,
			status: reply.status,
			contentHash: createHash("sha256").update(reply.text).digest("hex"),
		});
		reply.sequence = recorded.sequence;
		reply.timestamp = recorded.timestamp;
		return reply;
	}

	async interrupt(session: AgentSessionRef): Promise<void> {
		const state = this.state(session);
		if (!this.descriptor.capabilities.interrupt) throw new Error("Interrupt unsupported.");
		if (!state.active) return;
		const active = state.active;
		const controller = state.controller;
		await this.journal.record({
			type: "INTERRUPT_REQUESTED",
			session: state.ref,
			sender: "user",
			recipient: state.ref.agentId,
			reason: "User requested interruption.",
		});
		if (state.controller === controller) {
			controller?.abort();
			await state.runtime.interrupt();
		}
		await active;
	}

	async stop(session: AgentSessionRef): Promise<void> {
		const state = this.state(session);
		if (state.status === "stopped") return;
		state.closing = true;
		try {
			if (state.active) await this.interrupt(session);
			await this.journal.record({
				type: "SESSION_STOPPED",
				session: state.ref,
				sender: "user",
				recipient: state.ref.agentId,
				reason: "Session stopped; native context retained.",
			});
			state.status = "stopped";
		} finally {
			if (state.status !== "stopped") state.closing = false;
		}
	}

	async dispose(): Promise<void> {
		if (this.starting) throw new Error("Wait for session startup before disposal.");
		this.disposed = true;
		for (const state of this.sessions.values()) {
			await this.stop(state.ref);
			await state.runtime.dispose();
			this.sessions.delete(state.ref.id);
		}
	}
}
