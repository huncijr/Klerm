import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { CodingHarnessDiscoveryResult } from "../klerm/coding-harness-setup.ts";
import { HEADLESS_PAGE } from "./headless-page.ts";
import type { HeadlessBackend } from "./rpc-process-backend.ts";

const COMMANDS = new Set([
	"desktop_handshake",
	"get_state",
	"get_messages",
	"get_entries",
	"get_last_assistant_text",
	"get_available_models",
	"set_model",
	"get_coding_harness_setup",
	"set_coding_harness_slots",
	"refresh_coding_harness_models",
	"prompt",
	"abort",
	"new_session",
	"get_klerm_config",
	"set_klerm_config",
	"get_kanban_registry",
	"set_kanban_registry",
	"run_kanban_task",
	"stop_kanban_task",
	"get_personal_bots",
	"upsert_personal_bot",
	"prompt_personal_bot",
	"abort_personal_bot",
	"get_personal_bot_conversation",
	"get_browser_availability",
	"get_browser_sessions",
	"create_browser_session",
	"get_browser_run",
	"start_browser_run",
	"stop_browser_run",
	"resolve_browser_action",
	"resolve_browser_origin",
	"request_browser_takeover",
	"resume_browser_run",
	"get_mcp_status",
	"reload_mcp_servers",
	"get_workspace_status",
	"list_workspace_files",
	"read_workspace_file",
	"get_workspace_diff",
	"write_workspace_file",
	"get_project_trust",
	"set_project_trust",
	"extension_ui_response",
]);

interface AuditRecord {
	version: 1;
	sequence: number;
	timestamp: string;
	sender: string;
	recipient: string;
	event: string;
	reason: string;
	requestId?: string;
	digest?: string;
}

export interface HeadlessServerOptions {
	backend: HeadlessBackend;
	token: string;
	stateDirectory: string;
	publicOrigin?: string;
	scan?: () => Promise<CodingHarnessDiscoveryResult[]>;
	scanIntervalMs?: number;
}

/** Single-owner HTTP transport around the existing Klerm RPC backend. */
export async function createHeadlessServer(options: HeadlessServerOptions) {
	if (Buffer.byteLength(options.token) < 32) throw new Error("Server token must contain at least 32 bytes.");
	mkdirSync(options.stateDirectory, { recursive: true, mode: 0o700 });
	const auditPath = join(options.stateDirectory, "server-events.jsonl");
	const prior = existsSync(auditPath)
		? readFileSync(auditPath, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as AuditRecord)
		: [];
	let auditSequence = prior.at(-1)?.sequence ?? 0;
	const accepted = new Set(
		prior.filter((event) => event.event === "COMMAND_ACCEPTED").map((event) => event.requestId),
	);
	const audit = (event: string, reason: string, details: Partial<AuditRecord> = {}) => {
		const record: AuditRecord = {
			version: 1,
			sequence: ++auditSequence,
			timestamp: new Date().toISOString(),
			sender: "klerm-server",
			recipient: "owner",
			event,
			reason,
			...details,
		};
		appendFileSync(auditPath, `${JSON.stringify(record)}\n`, { mode: 0o600, flush: true });
	};
	const epoch = randomUUID();
	let sequence = 0;
	const replay: Array<{ id: string; data: string }> = [];
	let replayBytes = 0;
	const streams = new Set<ServerResponse>();
	const requests = new Map<string, { digest: string; result: Promise<unknown> }>();
	let harnesses: CodingHarnessDiscoveryResult[] = [];
	let scanning: Promise<void> | undefined;
	let closing = false;
	let ready = false;
	const publish = (event: Record<string, unknown>) => {
		const frame = { id: `${epoch}:${++sequence}`, data: JSON.stringify(event) };
		if (Buffer.byteLength(frame.data) > 1_048_576)
			frame.data = JSON.stringify({ type: "stream_reset", reason: "Large event omitted. Refresh persisted state." });
		replay.push(frame);
		replayBytes += Buffer.byteLength(frame.data);
		while (replay.length > 1000 || replayBytes > 8_388_608) replayBytes -= Buffer.byteLength(replay.shift()!.data);
		for (const stream of streams) {
			if (!stream.write(`id: ${frame.id}\ndata: ${frame.data}\n\n`)) stream.destroy();
		}
	};
	const unsubscribe = options.backend.subscribe((event) => {
		if (event.type === "backend_unavailable") ready = false;
		// Request responses may contain settings or credentials; only their caller receives them.
		if (event.type !== "response") publish(event);
	});
	const refresh = (): Promise<void> => {
		if (scanning) return scanning;
		scanning = (async () => {
			try {
				let discovered: CodingHarnessDiscoveryResult[];
				if (options.scan) discovered = await options.scan();
				else {
					const result = (await options.backend.request({
						id: randomUUID(),
						type: "get_coding_harness_setup",
					})) as { success?: boolean; data?: { harnesses?: CodingHarnessDiscoveryResult[] } };
					if (!result.success || !Array.isArray(result.data?.harnesses))
						throw new Error("Backend discovery unavailable.");
					discovered = result.data.harnesses;
				}
				const next = discovered.sort((a, b) => a.kind.localeCompare(b.kind));
				if (JSON.stringify(next) !== JSON.stringify(harnesses)) {
					harnesses = next;
					audit("HARNESS_REGISTRY_CHANGED", "Installed harness availability changed.", {
						digest: createHash("sha256").update(JSON.stringify(next)).digest("hex"),
					});
					publish({ type: "harness_registry_changed", harnesses });
				}
			} catch {
				audit("DISCOVERY_FAILED", "Harness scan failed; prior snapshot retained.");
			}
		})();
		void scanning.finally(() => {
			scanning = undefined;
		});
		return scanning;
	};
	const timer = setInterval(() => {
		if (!closing) void refresh();
	}, options.scanIntervalMs ?? 60_000);
	timer.unref();
	void refresh();
	const heartbeat = setInterval(() => {
		for (const stream of streams) if (!stream.write(": heartbeat\n\n")) stream.destroy();
	}, 15_000);
	heartbeat.unref();
	const json = (response: ServerResponse, status: number, value: unknown) => {
		response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
		response.end(JSON.stringify(value));
	};
	const authorized = (request: IncomingMessage) => {
		const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer /, "") ?? "");
		const expected = Buffer.from(options.token);
		return supplied.length === expected.length && timingSafeEqual(supplied, expected);
	};
	const server = createServer((request, response) => {
		void (async () => {
			response.setHeader("X-Content-Type-Options", "nosniff");
			response.setHeader("Referrer-Policy", "no-referrer");
			const path = new URL(request.url ?? "/", "http://localhost").pathname;
			if (request.method === "GET" && path === "/healthz") {
				json(response, 200, { serving: true, ready });
				return;
			}
			if (request.method === "GET" && path === "/") {
				response.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
					"Content-Security-Policy":
						"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
				});
				response.end(HEADLESS_PAGE);
				return;
			}
			if (!authorized(request)) {
				request.resume();
				json(response, 401, { error: "Owner authentication required." });
				return;
			}
			const expectedOrigin = options.publicOrigin ?? `http://${request.headers.host}`;
			if (request.headers.origin && request.headers.origin !== expectedOrigin) {
				request.resume();
				json(response, 403, { error: "Origin rejected." });
				return;
			}
			if (request.method === "GET" && path === "/api/events") {
				response.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-store",
					Connection: "keep-alive",
					"X-Accel-Buffering": "no",
				});
				const cursor = request.headers["last-event-id"];
				const index = replay.findIndex((frame) => frame.id === cursor);
				if (cursor && index < 0)
					response.write(
						`data: ${JSON.stringify({ type: "stream_reset", reason: "Cursor expired or service restarted. Refresh state; do not resend prompts." })}\n\n`,
					);
				for (const frame of replay.slice(index < 0 ? 0 : index + 1))
					response.write(`id: ${frame.id}\ndata: ${frame.data}\n\n`);
				if (streams.size >= 16) {
					response.end();
					return;
				}
				streams.add(response);
				response.on("close", () => streams.delete(response));
				return;
			}
			if (request.method === "GET" && path === "/api/harnesses") {
				json(response, 200, { harnesses, scanning: !!scanning });
				return;
			}
			if (request.method === "POST" && path === "/api/refresh") {
				request.resume();
				await refresh();
				json(response, 200, { harnesses });
				return;
			}
			if (request.method !== "POST" || path !== "/api/command") {
				request.resume();
				json(response, 404, { error: "Unknown endpoint." });
				return;
			}
			if (closing) {
				request.resume();
				json(response, 503, { error: "Service is shutting down." });
				return;
			}
			if (!request.headers["content-type"]?.startsWith("application/json")) {
				request.resume();
				json(response, 415, { error: "JSON required." });
				return;
			}
			const chunks: Buffer[] = [];
			let bytes = 0;
			for await (const chunk of request) {
				bytes += Buffer.byteLength(chunk);
				if (bytes > 2_097_152) {
					json(response, 413, { error: "Request exceeds 2 MiB." });
					request.destroy();
					return;
				}
				chunks.push(Buffer.from(chunk));
			}
			let command: Record<string, unknown>;
			try {
				command = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
			} catch {
				json(response, 400, { error: "Invalid JSON." });
				return;
			}
			if (
				!command ||
				Array.isArray(command) ||
				typeof command.type !== "string" ||
				!COMMANDS.has(command.type) ||
				typeof command.id !== "string" ||
				!/^[A-Za-z0-9_-]{1,128}$/.test(command.id)
			) {
				json(response, 400, { error: "Unsupported command or invalid request ID." });
				return;
			}
			if (
				command.type === "prompt" &&
				(typeof command.message !== "string" || !command.message.trim() || command.message.length > 32_000)
			) {
				json(response, 400, { error: "Prompt must contain 1–32000 characters." });
				return;
			}
			const digest = createHash("sha256").update(JSON.stringify(command)).digest("hex");
			const duplicate = requests.get(command.id);
			if (duplicate) {
				if (duplicate.digest !== digest) {
					json(response, 409, { error: "Request ID was already used for a different command." });
					return;
				}
				json(response, 200, await duplicate.result);
				return;
			}
			if (accepted.has(command.id)) {
				json(response, 409, {
					error: "Request was previously accepted. Inspect state before retrying after restart or cache expiry.",
				});
				return;
			}
			if (requests.size >= 512) {
				json(response, 503, {
					error: "Request cache is full. Restart after tasks settle to clear cached responses.",
				});
				return;
			}
			audit("COMMAND_ACCEPTED", command.type, {
				requestId: command.id,
				digest,
				sender: "owner",
				recipient: "klerm-rpc",
			});
			accepted.add(command.id);
			const requestId = command.id;
			const commandType = command.type;
			const result = options.backend.request(command).then(
				(value) => {
					audit("COMMAND_REPLIED", commandType, { requestId });
					if (requests.size > 128) requests.delete(requestId);
					return value;
				},
				() => {
					ready = false;
					audit("COMMAND_UNCERTAIN", "Backend disconnected or timed out. Inspect state before retrying.", {
						requestId,
					});
					return {
						type: "response",
						id: command.id,
						command: command.type,
						success: false,
						error: "Backend unavailable or request timed out. Execution may have started; do not blindly retry.",
					};
				},
			);
			requests.set(command.id, { digest, result });
			json(response, 200, await result);
		})().catch(() => {
			if (!response.headersSent) json(response, 500, { error: "Server operation failed." });
			else response.end();
		});
	});
	server.requestTimeout = 30_000;
	server.headersTimeout = 10_000;
	audit("SERVER_STARTED", "Single-owner headless transport started.");
	void options.backend
		.request({ id: randomUUID(), type: "desktop_handshake" })
		.then((value) => {
			ready = !!value && (value as Record<string, unknown>).success === true;
		})
		.catch(() => {
			ready = false;
		});
	return {
		server,
		refresh,
		async close() {
			closing = true;
			clearInterval(timer);
			clearInterval(heartbeat);
			unsubscribe();
			for (const stream of streams) stream.end();
			await options.backend.close();
			if (scanning) await scanning;
			audit("SERVER_STOPPED", "Backend shutdown requested; interrupted tasks require native reconciliation.");
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		},
	};
}
