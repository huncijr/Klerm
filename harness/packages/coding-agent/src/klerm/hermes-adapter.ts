import { randomUUID } from "node:crypto";
import { AcpConnection, acpRecord } from "./acp-connection.ts";
import type {
	CodingHarnessAdapter,
	CodingHarnessAdapterEvent,
	CodingHarnessAdapterListener,
	CodingHarnessProcessSpawner,
	CodingHarnessSessionRef,
} from "./coding-harness-adapter.ts";
import type { CodingHarnessAgentSettings } from "./coding-harness-setup.ts";

interface HermesSession {
	ref: CodingHarnessSessionRef;
	connection: AcpConnection;
	fullAccess: boolean;
	running?: Promise<void>;
	aborted: boolean;
	tools: Map<string, string>;
	text: string;
}

/** Hermes v0.20 ACP; credentials, native tools and history stay in Hermes. */
export class HermesAdapter implements CodingHarnessAdapter {
	readonly kind = "hermes" as const;
	private readonly sessions = new Map<string, HermesSession>();
	private readonly listeners = new Set<CodingHarnessAdapterListener>();
	private readonly spawnProcess?: CodingHarnessProcessSpawner;

	constructor(spawnProcess?: CodingHarnessProcessSpawner) {
		this.spawnProcess = spawnProcess;
	}

	async startSession(
		agent: CodingHarnessAgentSettings,
		cwd: string,
		nativeSessionId?: string,
	): Promise<CodingHarnessSessionRef> {
		if (agent.kind !== "hermes" || !agent.model)
			throw new Error("Hermes requires a configured native model or native-default.");
		if (agent.role === "planner")
			throw new Error("Hermes ACP does not enforce read-only Plan mode. Use a Build slot.");
		const ref: CodingHarnessSessionRef = {
			id: randomUUID(),
			agentId: agent.id,
			harness: "hermes",
			model: agent.model,
			role: agent.role,
			executionProfile: agent.executionProfile ?? "native",
		};
		let state: HermesSession | undefined;
		const connection = new AcpConnection(
			"hermes",
			["acp"],
			cwd,
			(message) => {
				if (state) this.handleMessage(state, message);
			},
			this.spawnProcess,
		);
		state = {
			ref,
			connection,
			fullAccess: agent.executionProfile === "full-access",
			aborted: false,
			tools: new Map(),
			text: "",
		};
		try {
			const initialized = acpRecord(
				await connection.request("initialize", {
					protocolVersion: 1,
					clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
					clientInfo: { name: "klerm", version: "0.0.3" },
				}),
			);
			if (initialized.protocolVersion !== 1) throw new Error("Unsupported Hermes ACP protocol version.");
			if (nativeSessionId && acpRecord(initialized.agentCapabilities).loadSession !== true)
				throw new Error("Hermes cannot load this native session.");
			const opened = await connection.request(
				nativeSessionId ? "session/load" : "session/new",
				{
					cwd,
					mcpServers: [],
					...(nativeSessionId ? { sessionId: nativeSessionId } : {}),
				},
				60_000,
			);
			if (opened === null) throw new Error("Hermes native session could not be loaded.");
			const sessionId = nativeSessionId ?? acpRecord(opened).sessionId;
			if (typeof sessionId !== "string" || !sessionId) throw new Error("Hermes returned no native session ID.");
			ref.nativeSessionId = sessionId;
			if (agent.model !== "native-default")
				await connection.request("session/set_model", { sessionId, modelId: agent.model }, 60_000);
			if (state.fullAccess) {
				const modes = acpRecord(acpRecord(opened).modes).availableModes;
				if (!Array.isArray(modes) || !modes.some((mode) => acpRecord(mode).id === "dont_ask"))
					throw new Error("Hermes does not support the requested Full access mode.");
				await connection.request("session/set_mode", { sessionId, modeId: "dont_ask" });
			}
			this.sessions.set(ref.id, state);
			return ref;
		} catch (error) {
			await connection.close();
			throw new Error(
				`Hermes native session startup failed: ${error instanceof Error ? error.message : "unknown error"}. Check hermes setup and hermes doctor on the worker.`,
			);
		}
	}

	async prompt(ref: CodingHarnessSessionRef, message: string): Promise<void> {
		const state = this.sessions.get(ref.id);
		if (!state) throw new Error("Unknown Hermes session.");
		if (state.running) throw new Error(`${ref.agentId} is already working.`);
		state.aborted = false;
		state.tools.clear();
		state.text = "";
		state.running = (async () => {
			try {
				const result = acpRecord(
					await state.connection.request(
						"session/prompt",
						{ sessionId: ref.nativeSessionId, prompt: [{ type: "text", text: message }] },
						900_000,
					),
				);
				const cancelled = state.aborted || result.stopReason === "cancelled";
				if (state.text) this.emit({ type: "message", agentId: ref.agentId, text: state.text });
				this.emit({ type: "settled", agentId: ref.agentId, status: cancelled ? "aborted" : "completed" });
			} catch (error) {
				await state.connection.close();
				this.sessions.delete(ref.id);
				this.emit({
					type: "error",
					agentId: ref.agentId,
					message: error instanceof Error ? error.message : "Hermes prompt failed.",
				});
				this.emit({ type: "settled", agentId: ref.agentId, status: state.aborted ? "aborted" : "failed" });
			}
		})();
		try {
			await state.running;
		} finally {
			state.running = undefined;
		}
	}

	async abort(ref: CodingHarnessSessionRef): Promise<void> {
		const state = this.sessions.get(ref.id);
		if (!state?.running) return;
		state.aborted = true;
		state.connection.notify("session/cancel", { sessionId: ref.nativeSessionId });
		const timer = setTimeout(() => {
			void state.connection.close();
		}, 5000);
		try {
			await state.running;
		} finally {
			clearTimeout(timer);
		}
	}

	async closeSession(ref: CodingHarnessSessionRef): Promise<void> {
		const state = this.sessions.get(ref.id);
		if (!state) return;
		await this.abort(ref);
		await state.connection.close();
		this.sessions.delete(ref.id);
	}

	subscribe(listener: CodingHarnessAdapterListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: CodingHarnessAdapterEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	private handleMessage(state: HermesSession, message: Record<string, unknown>): void {
		const params = acpRecord(message.params);
		if (message.method === "session/request_permission" && message.id !== undefined) {
			const options = Array.isArray(params.options) ? params.options.map(acpRecord) : [];
			const selected = state.fullAccess
				? options.find((option) => option.kind === "allow_once")
				: options.find((option) => option.kind === "reject_once");
			state.connection.reply(message.id, {
				outcome: selected ? { outcome: "selected", optionId: selected.optionId } : { outcome: "cancelled" },
			});
			return;
		}
		if (message.id !== undefined && message.method) {
			state.connection.rejectRequest(message.id);
			return;
		}
		if (message.method !== "session/update" || !state.running || params.sessionId !== state.ref.nativeSessionId)
			return;
		const update = acpRecord(params.update);
		const agentId = state.ref.agentId;
		if (update.sessionUpdate === "agent_message_chunk") {
			const content = acpRecord(update.content);
			if (content.type === "text" && typeof content.text === "string") {
				if (state.text.length + content.text.length > 8_388_608) throw new Error("Hermes response exceeded 8 MiB.");
				state.text += content.text;
			}
		}
		if (typeof update.toolCallId !== "string") return;
		const toolCallId = update.toolCallId;
		if (update.sessionUpdate === "tool_call") {
			const nativeName = typeof update.title === "string" ? update.title.split(":")[0]!.trim() : "native-tool";
			const toolName =
				nativeName === "terminal"
					? "bash"
					: nativeName === "write" || nativeName === "write_file"
						? "write"
						: nativeName.startsWith("patch")
							? "edit"
							: nativeName;
			state.tools.set(toolCallId, toolName);
			this.emit({ type: "tool-start", agentId, toolCallId, toolName, input: update.rawInput ?? {} });
		}
		if (
			(update.sessionUpdate === "tool_call_update" || update.sessionUpdate === "tool_call") &&
			(update.status === "completed" || update.status === "failed")
		) {
			this.emit({
				type: "tool-end",
				agentId,
				toolCallId,
				toolName: state.tools.get(toolCallId) ?? "native-tool",
				output: update.rawOutput ?? update.content ?? [],
				isError: update.status === "failed",
			});
		}
	}
}
