import { randomUUID } from "node:crypto";
import {
	AgentAdapterJournal,
	AgentAdapterRegistry,
	type AgentPrompt,
	type AgentReply,
	type AgentSessionRef,
	agentAdapterEventSink,
	RuntimeAgentAdapter,
} from "./agent-adapter-contract.ts";
import type {
	CodingHarnessAdapter,
	CodingHarnessAdapterEvent,
	CodingHarnessAdapterListener,
	CodingHarnessPromptContext,
	CodingHarnessSessionRef,
	ConnectedCodingHarnessKind,
} from "./coding-harness-adapter.ts";
import {
	type CodingHarnessAgentSettings,
	codingHarnessLabel,
	NATIVE_MODEL_CONFIGURATION,
} from "./coding-harness-setup.ts";

interface Binding {
	native: CodingHarnessSessionRef;
	shared: AgentSessionRef;
	sequence: number;
	disposed: boolean;
	closing: boolean;
	text: string;
	error?: string;
	nativeStatus?: "completed" | "failed" | "aborted";
	nativeUncertain?: boolean;
	nativeSessionIdAtStart?: string;
	request?: AgentPrompt;
	active?: Promise<void>;
	closePromise?: Promise<void>;
}

/** Transitional RPC-facing API; all native lifecycle dispatch goes through the common registry. */
class RegisteredCodingHarnessAdapter implements CodingHarnessAdapter {
	readonly kind: ConnectedCodingHarnessKind;
	readonly capabilities: NonNullable<CodingHarnessAdapter["capabilities"]>;
	private readonly native: CodingHarnessAdapter;
	private readonly registry: AgentAdapterRegistry;
	private readonly journal: AgentAdapterJournal;
	private readonly starts = new Map<string, { settings: CodingHarnessAgentSettings; binding?: Binding }>();
	private readonly bindings = new Map<string, Binding>();
	private readonly running = new Map<string, Binding>();
	private readonly listeners = new Set<CodingHarnessAdapterListener>();

	constructor(native: CodingHarnessAdapter, registry: AgentAdapterRegistry, journal: AgentAdapterJournal) {
		if (!native.capabilities)
			throw new Error("Native adapter must declare its actual capabilities before registration.");
		this.native = native;
		this.kind = native.kind;
		this.capabilities = structuredClone(native.capabilities);
		this.registry = registry;
		this.journal = journal;
		registry.register(
			new RuntimeAgentAdapter(
				{
					id: native.kind,
					harness: { id: native.kind, name: codingHarnessLabel(native.kind) },
					capabilities: this.capabilities,
				},
				async (request) => {
					const start = this.starts.get(request.agentId);
					if (!start) throw new Error("Native session configuration is not owned by this dispatch request.");
					const ref = await native.startSession(
						structuredClone(start.settings),
						request.cwd,
						request.nativeSessionId,
					);
					if (start.settings.executionProfile === "full-access" && ref.executionProfile !== "full-access") {
						await native.closeSession(ref);
						throw new Error("Native adapter did not apply the requested execution profile.");
					}
					const binding: Binding = {
						native: ref,
						// Filled after the common adapter has validated/audited startup.
						shared: {
							id: "",
							agentId: request.agentId,
							adapterId: native.kind,
							harnessId: native.kind,
							cwd: request.cwd,
							model: ref.model,
							nativeSessionId: ref.nativeSessionId,
						},
						sequence: 0,
						disposed: false,
						closing: false,
						text: "",
						nativeSessionIdAtStart: ref.nativeSessionId,
					};
					start.binding = binding;
					return {
						get nativeSessionId() {
							return ref.nativeSessionId;
						},
						get model() {
							return (native.capabilities?.modelSelection === "native" ||
								native.capabilities?.modelSelection === "explicit-or-native") &&
								ref.model === NATIVE_MODEL_CONFIGURATION
								? undefined
								: ref.model;
						},
						async prompt(text, signal) {
							if (!signal.aborted) await native.prompt(ref, text);
							return {
								text: binding.text,
								failed: binding.nativeStatus !== "completed",
								aborted: binding.nativeStatus === "aborted",
								uncertain: binding.nativeUncertain,
								error: binding.error,
							};
						},
						interrupt: () => native.abort(ref),
						async dispose() {
							await native.closeSession(ref);
							binding.disposed = true;
						},
					};
				},
				journal,
			),
		);
		native.subscribe((event) => this.onNativeEvent(event));
	}

	async startSession(
		settings: CodingHarnessAgentSettings,
		cwd: string,
		nativeSessionId?: string,
	): Promise<CodingHarnessSessionRef> {
		if (!settings.enabled) throw new Error("Native agent is disabled.");
		if (!settings.model || settings.kind !== this.kind)
			throw new Error("Native harness/model configuration does not match the registered adapter.");
		if (this.starts.has(settings.id) || this.running.has(settings.id))
			throw new Error("Agent already starting or working.");
		const pending: { settings: CodingHarnessAgentSettings; binding?: Binding } = {
			settings: structuredClone(settings),
		};
		this.starts.set(settings.id, pending);
		try {
			const shared = await this.registry.get(this.kind).start({
				agentId: settings.id,
				cwd,
				model:
					(this.capabilities.modelSelection === "native" ||
						this.capabilities.modelSelection === "explicit-or-native") &&
					settings.model === NATIVE_MODEL_CONFIGURATION
						? undefined
						: settings.model,
				role: settings.role,
				nativeSessionId,
			});
			const binding = pending.binding;
			if (!binding) throw new Error("Native session startup returned no binding.");
			binding.shared = shared;
			this.bindings.set(shared.id, binding);
			return { ...binding.native, id: shared.id };
		} finally {
			this.starts.delete(settings.id);
		}
	}

	private binding(ref: CodingHarnessSessionRef): Binding {
		const binding = this.bindings.get(ref.id);
		if (
			!binding ||
			ref.agentId !== binding.shared.agentId ||
			ref.harness !== this.kind ||
			ref.model !== binding.native.model ||
			ref.role !== binding.native.role ||
			ref.executionProfile !== binding.native.executionProfile
		)
			throw new Error("Unknown or mismatched native adapter session.");
		if (
			ref.nativeSessionId !== binding.native.nativeSessionId &&
			ref.nativeSessionId !== binding.nativeSessionIdAtStart
		)
			throw new Error("Mismatched native session identity.");
		return binding;
	}

	async prompt(ref: CodingHarnessSessionRef, text: string, context?: CodingHarnessPromptContext): Promise<void> {
		const binding = this.binding(ref);
		if (binding.closing || this.running.has(ref.agentId)) throw new Error("Agent already working or closing.");
		binding.text = "";
		binding.error = undefined;
		binding.nativeStatus = undefined;
		binding.nativeUncertain = false;
		const id = randomUUID();
		const request: AgentPrompt = {
			version: 1,
			messageId: id,
			taskId: context?.taskId ?? id,
			correlationId: context?.correlationId ?? binding.shared.id,
			sender: context?.sender ?? "klerm",
			recipient: ref.agentId,
			sequence: ++binding.sequence,
			timestamp: new Date().toISOString(),
			reason: context?.reason ?? "Live native adapter dispatch.",
			text,
			...(context?.replyTo ? { replyTo: context.replyTo } : {}),
		};
		binding.request = request;
		this.running.set(ref.agentId, binding);
		binding.active = this.dispatch(binding, ref, request);
		await binding.active;
	}

	private async dispatch(binding: Binding, ref: CodingHarnessSessionRef, request: AgentPrompt): Promise<void> {
		let reply: AgentReply | undefined;
		let failure: string | undefined;
		try {
			reply = await this.registry.get(this.kind).prompt(binding.shared, request);
			binding.shared = reply.session;
			ref.nativeSessionId = reply.session.nativeSessionId;
		} catch (error) {
			failure = error instanceof Error ? error.message : "Native dispatch failed.";
		} finally {
			this.running.delete(ref.agentId);
			binding.active = undefined;
			binding.request = undefined;
		}
		// Native 'settled' may arrive before native/common prompt promises release
		// ownership. Publish it only after the audited common turn is actually idle.
		if (reply?.text) this.emit({ type: "message", agentId: ref.agentId, text: reply.text });
		const error = failure ?? reply?.error ?? (reply?.status === "failed" ? "Native turn failed." : undefined);
		if (error) this.emit({ type: "error", agentId: ref.agentId, message: error });
		this.emit({
			type: "settled",
			agentId: ref.agentId,
			status: failure ? "failed" : (reply?.status ?? "failed"),
			...(reply?.uncertain ? { uncertain: true } : {}),
		});
	}

	private onNativeEvent(event: CodingHarnessAdapterEvent): void {
		const binding = this.running.get(event.agentId);
		if (!binding) return;
		if (event.type === "message") {
			binding.text += event.text;
			return;
		}
		if (event.type === "error") {
			binding.error = event.message;
			return;
		}
		if (event.type === "settled") {
			binding.nativeStatus = event.status;
			binding.nativeUncertain = event.uncertain;
			return;
		}
		const request = binding.request;
		if (!request) return;
		void this.journal
			.record({
				type: event.type === "tool-start" ? "TOOL_STARTED" : "TOOL_FINISHED",
				session: { ...binding.shared, nativeSessionId: binding.native.nativeSessionId },
				sender: event.agentId,
				recipient: "klerm",
				reason: "Native tool activity.",
				taskId: request.taskId,
				correlationId: request.correlationId,
				messageId: request.messageId,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				...(event.type === "tool-end" ? { isError: event.isError } : {}),
			})
			.catch(() => {
				/* The poisoned journal rejects the enclosing turn and subsequent dispatch. */
			});
		this.emit(event);
	}

	private emit(event: CodingHarnessAdapterEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(structuredClone(event));
			} catch {
				/* Observers cannot alter native execution. */
			}
		}
	}

	async abort(ref: CodingHarnessSessionRef): Promise<void> {
		const binding = this.binding(ref);
		const active = binding.active;
		await this.registry.get(this.kind).interrupt(binding.shared);
		await active;
	}

	async closeSession(ref: CodingHarnessSessionRef): Promise<void> {
		if (!this.bindings.has(ref.id)) return;
		const binding = this.binding(ref);
		if (binding.closePromise) return binding.closePromise;
		binding.closing = true;
		binding.closePromise = (async () => {
			try {
				await this.registry.get(this.kind).close(binding.shared);
			} finally {
				if (binding.disposed) this.bindings.delete(ref.id);
			}
		})();
		try {
			await binding.closePromise;
		} finally {
			binding.closePromise = undefined;
		}
	}

	subscribe(listener: CodingHarnessAdapterListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	subscribeDebug(listener: Parameters<NonNullable<CodingHarnessAdapter["subscribeDebug"]>>[0]): () => void {
		return this.native.subscribeDebug?.(listener) ?? (() => {});
	}
}

export function createRegisteredCodingHarnessAdapters(
	nativeAdapters: ReadonlyMap<ConnectedCodingHarnessKind, CodingHarnessAdapter>,
	journal = new AgentAdapterJournal(async (event) => agentAdapterEventSink(event.session.cwd)(event)),
	registry = new AgentAdapterRegistry(),
): Map<ConnectedCodingHarnessKind, CodingHarnessAdapter> {
	return new Map(
		[...nativeAdapters].map(([id, native]) => {
			if (id !== native.kind) throw new Error("Registered native adapter identity mismatch.");
			return [id, new RegisteredCodingHarnessAdapter(native, registry, journal)];
		}),
	);
}
