import { randomUUID } from "node:crypto";
import { spawnHarnessProcess } from "../utils/child-process.ts";
import { AcpConnection, acpRecord } from "./acp-connection.ts";
import type { AgentCapability } from "./agent-adapter-contract.ts";
import type {
	CodingHarnessAdapter,
	CodingHarnessAdapterEvent,
	CodingHarnessAdapterListener,
	CodingHarnessProcessSpawner,
	CodingHarnessSessionRef,
} from "./coding-harness-adapter.ts";
import { type CodingHarnessAgentSettings, NATIVE_MODEL_CONFIGURATION } from "./coding-harness-setup.ts";

interface OpenClawSession {
	ref: CodingHarnessSessionRef;
	connection: AcpConnection;
	protocolId?: string;
	gatewayKey: string;
	metadata: Map<string, string>;
	bound: () => void;
	rejectBinding: (error: Error) => void;
	canClose: boolean;
	ready: boolean;
	closed: boolean;
	prompting: boolean;
	aborted: boolean;
	cancelUncertain?: boolean;
	running?: Promise<void>;
	closing?: Promise<void>;
	text: string;
	failure?: string;
	tools: Map<string, { name: string; ended: boolean }>;
}

/** Gateway-backed ACP, audited against the upstream source pinned in OPENCLAW.md. */
export class OpenClawAdapter implements CodingHarnessAdapter {
	readonly kind = "openclaw" as const;
	readonly capabilities: AgentCapability = {
		nativeSessionIdentity: "on-start",
		resumeSession: true,
		interrupt: true,
		tools: [],
		enforcedRoles: ["builder"],
		modelSelection: "native",
		requiresAcpHandshake: true,
		executionProfiles: ["native"],
		supportsEffortOverride: false,
		supportsToolOverrides: false,
	};
	private readonly sessions = new Map<string, OpenClawSession>();
	private readonly listeners = new Set<CodingHarnessAdapterListener>();
	private readonly spawn: CodingHarnessProcessSpawner;

	constructor(spawnProcess?: CodingHarnessProcessSpawner) {
		this.spawn =
			spawnProcess ??
			((command, args, options) =>
				spawnHarnessProcess(command, args, {
					...options,
					env: { ...process.env, OPENCLAW_HIDE_BANNER: "1", OPENCLAW_SUPPRESS_NOTES: "1" },
				}));
	}

	async startSession(
		agent: CodingHarnessAgentSettings,
		cwd: string,
		nativeSessionId?: string,
	): Promise<CodingHarnessSessionRef> {
		if (agent.kind !== this.kind || !agent.enabled) throw new Error("OpenClaw requires an enabled native worker.");
		if (agent.model !== NATIVE_MODEL_CONFIGURATION)
			throw new Error("OpenClaw ACP keeps model selection in its native Gateway configuration.");
		if (agent.role !== "builder") throw new Error("OpenClaw ACP does not enforce read-only Plan mode. Select Build.");
		if (agent.executionProfile === "full-access")
			throw new Error(
				"OpenClaw ACP does not implement Klerm's Full access profile; use native Gateway permissions.",
			);
		if (agent.effort !== "off" || agent.tools.length)
			throw new Error(
				"Configure OpenClaw reasoning and tools in the native Gateway; Klerm overrides are unsupported.",
			);
		// This is the stable Gateway key, not the ACP process-local session UUID.
		// Never attach to an unrelated default/human session or request a reset.
		const gatewayKey = nativeSessionId ?? `acp-bridge:klerm-${randomUUID()}`;
		if (!/^acp-bridge:klerm-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(gatewayKey))
			throw new Error("Only Klerm-owned isolated OpenClaw sessions may be resumed.");
		let bound = () => {};
		let rejectBinding = (_error: Error) => {};
		const binding = new Promise<void>((resolve, reject) => {
			bound = resolve;
			rejectBinding = reject;
		});
		void binding.catch(() => {});
		let state: OpenClawSession | undefined;
		const connection = new AcpConnection(
			"openclaw",
			["acp"],
			cwd,
			(message) => {
				if (state) this.message(state, message);
			},
			this.spawn,
		);
		const ref: CodingHarnessSessionRef = {
			id: randomUUID(),
			agentId: agent.id,
			harness: this.kind,
			model: NATIVE_MODEL_CONFIGURATION,
			role: agent.role,
			executionProfile: "native",
			nativeSessionId: gatewayKey,
		};
		state = {
			ref,
			connection,
			gatewayKey,
			bound,
			rejectBinding,
			canClose: false,
			ready: false,
			closed: false,
			prompting: false,
			aborted: false,
			text: "",
			tools: new Map(),
			metadata: new Map(),
		};
		try {
			const hello = acpRecord(
				await connection.request("initialize", {
					protocolVersion: 1,
					clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
					clientInfo: { name: "klerm", version: "0.0.3" },
				}),
			);
			if (hello.protocolVersion !== 1) throw new Error("Unsupported OpenClaw ACP protocol version.");
			const lifecycle = acpRecord(acpRecord(hello.agentCapabilities).sessionCapabilities);
			const supports = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
			state.canClose = supports(lifecycle.close);
			if (nativeSessionId && !supports(lifecycle.resume))
				throw new Error("The OpenClaw bridge does not advertise safe session resume.");
			const opened = await connection.request(
				nativeSessionId ? "session/resume" : "session/new",
				{
					cwd,
					mcpServers: [],
					...(nativeSessionId ? { sessionId: gatewayKey } : {}),
					_meta: { sessionKey: gatewayKey, resetSession: false, requireExisting: Boolean(nativeSessionId) },
				},
				60_000,
			);
			const protocolId = nativeSessionId ?? acpRecord(opened).sessionId;
			if (typeof protocolId !== "string" || !protocolId)
				throw new Error("OpenClaw returned no ACP session identity.");
			state.protocolId = protocolId;
			this.checkBinding(state);
			const timer = setTimeout(
				() => state?.rejectBinding(new Error("OpenClaw did not acknowledge its isolated Gateway session mapping.")),
				5000,
			);
			try {
				await binding;
			} finally {
				clearTimeout(timer);
			}
			state.ready = true;
			this.sessions.set(ref.id, state);
			return ref;
		} catch (error) {
			await connection.close();
			throw new Error(
				`OpenClaw native session startup failed: ${error instanceof Error ? error.message : "unknown error"}. Check openclaw gateway status and native configuration.`,
			);
		}
	}

	private checkBinding(state: OpenClawSession): void {
		if (!state.protocolId || !state.metadata.has(state.protocolId)) return;
		if (state.metadata.get(state.protocolId) !== state.gatewayKey) {
			state.failure = "OpenClaw Gateway session mapping changed or does not match this worker.";
			state.rejectBinding(new Error(state.failure));
			if (state.ready) {
				state.closed = true;
				void state.connection.close().catch(() => {});
			}
		} else state.bound();
	}

	async prompt(ref: CodingHarnessSessionRef, message: string): Promise<void> {
		const state = this.sessions.get(ref.id);
		if (!state || state.closed) throw new Error("OpenClaw session is closed or unavailable; reconnect explicitly.");
		if (state.prompting) throw new Error("OpenClaw session is already working.");
		state.prompting = true;
		state.aborted = false;
		state.cancelUncertain = false;
		state.failure = undefined;
		state.text = "";
		state.tools.clear();
		state.running = (async () => {
			try {
				const result = acpRecord(
					await state.connection.request(
						"session/prompt",
						{
							sessionId: state.protocolId,
							prompt: [{ type: "text", text: message }],
						},
						900_000,
					),
				);
				const aborted = state.aborted || result.stopReason === "cancelled";
				if (state.text) this.emit({ type: "message", agentId: ref.agentId, text: state.text });
				if (!aborted && !state.failure && result.stopReason !== "end_turn")
					state.failure = "OpenClaw stopped without completing the native turn.";
				if (state.failure) this.emit({ type: "error", agentId: ref.agentId, message: state.failure });
				this.emit({
					type: "settled",
					agentId: ref.agentId,
					status: aborted ? "aborted" : state.failure ? "failed" : "completed",
				});
			} catch (error) {
				// Losing the bridge is not an acknowledgement from the remote Gateway,
				// even when a cancellation notification was sent just before it failed.
				if (!state.cancelUncertain) {
					const reason = state.failure ?? (error instanceof Error ? error.message : "OpenClaw prompt failed.");
					state.failure = `${reason} Native completion was not confirmed. Gateway work may still be active; inspect it before retrying.`;
				}
				state.cancelUncertain = true;
				state.closed = true;
				await state.connection.close();
				this.emit({
					type: "error",
					agentId: ref.agentId,
					message: state.failure ?? (error instanceof Error ? error.message : "OpenClaw prompt failed."),
				});
				this.emit({
					type: "settled",
					agentId: ref.agentId,
					status: "failed",
					uncertain: true,
				});
			}
		})();
		try {
			await state.running;
		} finally {
			state.running = undefined;
			state.prompting = false;
		}
	}

	private message(state: OpenClawSession, message: Record<string, unknown>): void {
		const params = acpRecord(message.params);
		if (message.id !== undefined && message.method) {
			if (message.method !== "session/request_permission") {
				state.connection.rejectRequest(message.id);
				return;
			}
			const options = Array.isArray(params.options) ? params.options.map(acpRecord) : [];
			const reject = options.find((option) => option.kind === "reject_once" && typeof option.optionId === "string");
			state.connection.reply(message.id, {
				outcome: reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" },
			});
			if (state.prompting && params.sessionId === state.protocolId)
				state.failure =
					"OpenClaw requested tool approval. Klerm's native permission relay is not available; this request was denied. Configure the native Gateway policy or perform the action there.";
			return;
		}
		if (message.method !== "session/update" || typeof params.sessionId !== "string") return;
		const update = acpRecord(params.update);
		if (update.sessionUpdate === "session_info_update" && typeof acpRecord(update._meta).sessionKey === "string") {
			if (state.protocolId && params.sessionId !== state.protocolId) return;
			if (!state.metadata.has(params.sessionId) && state.metadata.size >= 8)
				throw new Error("Too many OpenClaw session identities.");
			state.metadata.set(params.sessionId, acpRecord(update._meta).sessionKey as string);
			this.checkBinding(state);
			return;
		}
		if (!state.ready || !state.prompting || state.closed || params.sessionId !== state.protocolId) return;
		if (update.sessionUpdate === "agent_message_chunk") {
			const content = acpRecord(update.content);
			if (content.type === "text" && typeof content.text === "string") {
				if (state.text.length + content.text.length > 8_388_608)
					throw new Error("OpenClaw response exceeded 8 MiB.");
				state.text += content.text;
			}
			return;
		}
		if (typeof update.toolCallId !== "string") return;
		let tool = state.tools.get(update.toolCallId);
		if (update.sessionUpdate === "tool_call" && !tool) {
			const title = typeof update.title === "string" ? update.title.split(":")[0]!.trim() : "native-tool";
			const name = title === "exec" ? "bash" : title === "apply_patch" ? "edit" : title || "native-tool";
			tool = { name, ended: false };
			state.tools.set(update.toolCallId, tool);
			this.emit({
				type: "tool-start",
				agentId: state.ref.agentId,
				toolCallId: update.toolCallId,
				toolName: name,
				input: update.rawInput ?? {},
			});
		}
		if (
			tool &&
			!tool.ended &&
			(update.sessionUpdate === "tool_call_update" || update.sessionUpdate === "tool_call") &&
			(update.status === "completed" || update.status === "failed")
		) {
			tool.ended = true;
			this.emit({
				type: "tool-end",
				agentId: state.ref.agentId,
				toolCallId: update.toolCallId,
				toolName: tool.name,
				output: update.rawOutput ?? update.content ?? [],
				isError: update.status === "failed",
			});
		}
	}

	async abort(ref: CodingHarnessSessionRef): Promise<void> {
		const state = this.sessions.get(ref.id);
		if (!state?.prompting) return;
		state.aborted = true;
		state.connection.notify("session/cancel", { sessionId: state.protocolId });
		const timer = setTimeout(() => {
			state.cancelUncertain = true;
			state.failure =
				"OpenClaw did not acknowledge cancellation. Gateway work may still be active; inspect it before retrying.";
			state.closed = true;
			void state.connection.close().catch(() => {});
		}, 5000);
		try {
			await state.running;
		} finally {
			clearTimeout(timer);
		}
		if (state.cancelUncertain) throw new Error(state.failure);
	}

	async closeSession(ref: CodingHarnessSessionRef): Promise<void> {
		const state = this.sessions.get(ref.id);
		if (!state) return;
		if (state.closing) return state.closing;
		state.closing = (async () => {
			try {
				await this.abort(ref);
				if (!state.closed && state.canClose)
					await state.connection.request("session/close", { sessionId: state.protocolId }, 10_000);
			} finally {
				state.closed = true;
				await state.connection.close();
				this.sessions.delete(ref.id);
			}
		})();
		await state.closing;
	}

	subscribe(listener: CodingHarnessAdapterListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: CodingHarnessAdapterEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(structuredClone(event));
			} catch {
				/* Observers do not control the native worker. */
			}
		}
	}
}
