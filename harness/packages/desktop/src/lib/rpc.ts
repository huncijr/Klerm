import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { JsonObject } from "./model.ts";

export interface RpcResponse<T = unknown> extends JsonObject {
	id?: string;
	type: "response";
	command: string;
	success: boolean;
	data?: T;
	error?: string;
	code?: string;
}

export type RpcEventHandler = (message: JsonObject) => void;

export class RpcCommandError extends Error {
	readonly code: string | undefined;

	constructor(message: string, code?: string) {
		super(message);
		this.name = "RpcCommandError";
		this.code = code;
	}
}

export class RpcBridge {
	private requestId = 0;
	private readonly pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }
	>();
	private readonly handlers = new Set<RpcEventHandler>();
	private unlisten: UnlistenFn[] = [];

	async start(): Promise<void> {
		this.unlisten.push(
			await listen<JsonObject>("klerm://rpc", (event) => this.handleMessage(event.payload)),
			await listen<{ message: string }>("klerm://backend-error", (event) => {
				this.emit({ type: "backend_error", message: event.payload.message });
			}),
			await listen<{ code: number | null }>("klerm://backend-exit", (event) => {
				this.rejectPending(new Error("The Klerm backend stopped."));
				this.emit({ type: "backend_exit", code: event.payload.code });
			}),
		);
		await invoke("start_backend", { cwd: null });
	}

	onEvent(handler: RpcEventHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	async send<T>(type: string, fields: JsonObject = {}): Promise<T> {
		const id = `desktop_${++this.requestId}`;
		const response = new Promise<T>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Backend timed out while handling ${type}.`));
			}, 30_000);
			this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
		});

		try {
			await invoke("rpc_send", { command: { id, type, ...fields } });
		} catch (error) {
			const pending = this.pending.get(id);
			if (pending) {
				window.clearTimeout(pending.timer);
				this.pending.delete(id);
				pending.reject(toError(error));
			}
		}
		return response;
	}

	private handleMessage(message: JsonObject): void {
		if (message.type === "response" && typeof message.id === "string") {
			const pending = this.pending.get(message.id);
			if (pending) {
				window.clearTimeout(pending.timer);
				this.pending.delete(message.id);
				const response = message as RpcResponse;
				if (response.success) pending.resolve(response.data);
				else
					pending.reject(
						new RpcCommandError(response.error ?? `Backend command ${response.command} failed.`, response.code),
					);
				return;
			}
		}
		this.emit(message);
	}

	private emit(message: JsonObject): void {
		for (const handler of this.handlers) handler(message);
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			window.clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
