import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnProcess } from "../utils/child-process.ts";
import { killProcessTree } from "../utils/shell.ts";
import type { BrowserApprovalDecision, BrowserAvailability, BrowserRunRequest } from "./browser-agent.ts";
import {
	BROWSER_REDACTED_VALUE,
	redactBrowserSecretText,
	validateBrowserOrigin,
	validateBrowserUrl,
} from "./browser-agent.ts";

export const BROWSER_WORKER_PROTOCOL_VERSION = 1;
export const BROWSER_WORKER_MAX_LINE_BYTES = 1_048_576;

const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface BrowserWorkerStartRequest extends BrowserRunRequest {
	taskId: string;
	correlationId: string;
	model: string;
	baseUrl: string;
	token: string;
	allowedOrigins: readonly string[];
	maxSteps?: number;
}

export interface BrowserWorkerApprovalDecision extends BrowserApprovalDecision {
	origin: string;
	scope?: "allow_once" | "current_run";
}

export interface BrowserWorkerRunnerOptions {
	env?: Readonly<NodeJS.ProcessEnv>;
	workerDirectory?: string;
	startupTimeoutMs?: number;
	commandTimeoutMs?: number;
	stopTimeoutMs?: number;
	maxLineBytes?: number;
}

interface WorkerEventBase {
	version: 1;
	sequence: number;
	event: string;
	status: string;
	timestamp: string;
}

interface WorkerRunFields {
	run_id: string;
	task_id: string;
	correlation_id: string;
	agent_id: string;
}

export interface BrowserWorkerReadyEvent extends WorkerEventBase {
	event: "ready";
	status: "ready";
	protocol_version: 1;
	worker_version: string;
}

export interface BrowserWorkerCommandAcceptedEvent extends WorkerEventBase, WorkerRunFields {
	event: "command_accepted";
	status: "accepted";
	request_id: string;
	command: "start" | "stop" | "takeover" | "resume";
}

export interface BrowserWorkerOriginApprovalRequiredEvent extends WorkerEventBase, WorkerRunFields {
	event: "origin_approval_required";
	status: "paused";
	origin: string;
	choices: ["allow_once", "current_run"];
}

export interface BrowserWorkerOriginApprovedEvent extends WorkerEventBase, WorkerRunFields {
	event: "origin_approved";
	status: "accepted";
	request_id: string;
	origin: string;
	scope: "allow_once" | "current_run";
}

export interface BrowserWorkerRunStartedEvent extends WorkerEventBase, WorkerRunFields {
	event: "run_started";
	status: "running";
}

export interface BrowserWorkerStepPlannedEvent extends WorkerEventBase, WorkerRunFields {
	event: "step_planned";
	status: "running";
	actions: string[];
}

export interface BrowserWorkerRunCompletedEvent extends WorkerEventBase, WorkerRunFields {
	event: "run_completed";
	status: "completed";
	result: { present: boolean; length: number; sha256: string | null };
}

export interface BrowserWorkerRunFailedEvent extends WorkerEventBase, WorkerRunFields {
	event: "run_failed";
	status: "failed";
	error: string;
}

export interface BrowserWorkerRunStoppedEvent extends WorkerEventBase, WorkerRunFields {
	event: "run_stopped";
	status: "stopped";
}

export interface BrowserWorkerControlGrantedEvent extends WorkerEventBase, WorkerRunFields {
	event: "control_granted";
	status: "paused";
	reason: string;
}

export interface BrowserWorkerControlResumedEvent extends WorkerEventBase, WorkerRunFields {
	event: "control_resumed";
	status: "running";
	reason: string;
}

export interface BrowserWorkerShutdownEvent extends WorkerEventBase {
	event: "shutdown";
	status: "completed";
	request_id: string | null;
}

export interface BrowserWorkerCommandRejectedEvent extends WorkerEventBase {
	event: "command_rejected";
	status: "rejected";
	request_id: string | null;
	error: string;
}

export type BrowserWorkerEvent =
	| BrowserWorkerReadyEvent
	| BrowserWorkerCommandAcceptedEvent
	| BrowserWorkerOriginApprovalRequiredEvent
	| BrowserWorkerOriginApprovedEvent
	| BrowserWorkerRunStartedEvent
	| BrowserWorkerStepPlannedEvent
	| BrowserWorkerRunCompletedEvent
	| BrowserWorkerRunFailedEvent
	| BrowserWorkerRunStoppedEvent
	| BrowserWorkerControlGrantedEvent
	| BrowserWorkerControlResumedEvent
	| BrowserWorkerShutdownEvent
	| BrowserWorkerCommandRejectedEvent;

export type BrowserWorkerEventListener = (event: BrowserWorkerEvent) => void;

export interface BrowserWorkerFailure {
	reason: "process-failed" | "process-exited" | "protocol-failed";
	message: string;
}

export type BrowserWorkerFailureListener = (failure: BrowserWorkerFailure) => void;

interface WorkerLaunch {
	command: string;
	args: string[];
	cwd: string;
	runtime: string;
	extraEnv?: Readonly<Record<string, string>>;
}

interface EventWaiter {
	predicate: (event: BrowserWorkerEvent) => boolean;
	resolve: (event: BrowserWorkerEvent) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

function positiveTimeout(value: number | undefined, fallback: number, name: string): number {
	const timeout = value ?? fallback;
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) {
		throw new RangeError(`${name} must be an integer from 1 to 120000 milliseconds.`);
	}
	return timeout;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): void {
	const allowed = new Set(fields);
	if (Object.keys(value).length !== allowed.size || Object.keys(value).some((key) => !allowed.has(key))) {
		throw new Error("Unexpected browser worker event fields.");
	}
}

function stringField(value: Record<string, unknown>, key: string, maximum: number): string {
	const field = value[key];
	if (typeof field !== "string" || field.length < 1 || field.length > maximum) {
		throw new Error(`Invalid browser worker ${key}.`);
	}
	return field;
}

function identifierField(value: Record<string, unknown>, key: string): string {
	const field = stringField(value, key, 128);
	if (!ID_PATTERN.test(field)) throw new Error(`Invalid browser worker ${key}.`);
	return field;
}

function validateEnvelope(value: Record<string, unknown>, expectedStatus: string): void {
	if (value.version !== BROWSER_WORKER_PROTOCOL_VERSION) throw new Error("Unsupported browser worker protocol.");
	if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
		throw new Error("Invalid browser worker sequence.");
	}
	if (value.status !== expectedStatus) throw new Error("Invalid browser worker status.");
	const timestamp = stringField(value, "timestamp", 32);
	if (!TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
		throw new Error("Invalid browser worker timestamp.");
	}
}

function validateRunFields(value: Record<string, unknown>): void {
	identifierField(value, "run_id");
	identifierField(value, "task_id");
	identifierField(value, "correlation_id");
	identifierField(value, "agent_id");
}

function validateOrigin(value: Record<string, unknown>): void {
	const decision = validateBrowserOrigin(stringField(value, "origin", 2048));
	if (!decision.allowed) throw new Error("Invalid browser worker origin.");
}

function parseWorkerEvent(line: string): BrowserWorkerEvent {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		throw new Error("Browser worker emitted malformed JSONL.");
	}
	const value = record(parsed);
	if (!value) throw new Error("Browser worker event must be an object.");
	const event = stringField(value, "event", 64);
	const baseFields = ["version", "sequence", "event", "status", "timestamp"];
	const runFields = ["run_id", "task_id", "correlation_id", "agent_id"];

	switch (event) {
		case "ready":
			exactFields(value, [...baseFields, "protocol_version", "worker_version"]);
			validateEnvelope(value, "ready");
			if (value.protocol_version !== BROWSER_WORKER_PROTOCOL_VERSION) {
				throw new Error("Unsupported browser worker protocol.");
			}
			stringField(value, "worker_version", 64);
			break;
		case "command_accepted":
			exactFields(value, [...baseFields, "request_id", "command", ...runFields]);
			validateEnvelope(value, "accepted");
			identifierField(value, "request_id");
			if (
				value.command !== "start" &&
				value.command !== "stop" &&
				value.command !== "takeover" &&
				value.command !== "resume"
			) {
				throw new Error("Invalid browser worker command acknowledgement.");
			}
			validateRunFields(value);
			break;
		case "origin_approval_required": {
			exactFields(value, [...baseFields, ...runFields, "origin", "choices"]);
			validateEnvelope(value, "paused");
			validateRunFields(value);
			validateOrigin(value);
			const choices = value.choices;
			if (
				!Array.isArray(choices) ||
				choices.length !== 2 ||
				choices[0] !== "allow_once" ||
				choices[1] !== "current_run"
			) {
				throw new Error("Invalid browser worker approval choices.");
			}
			break;
		}
		case "origin_approved":
			exactFields(value, [...baseFields, "request_id", ...runFields, "origin", "scope"]);
			validateEnvelope(value, "accepted");
			identifierField(value, "request_id");
			validateRunFields(value);
			validateOrigin(value);
			if (value.scope !== "allow_once" && value.scope !== "current_run") {
				throw new Error("Invalid browser worker approval scope.");
			}
			break;
		case "run_started":
			exactFields(value, [...baseFields, ...runFields]);
			validateEnvelope(value, "running");
			validateRunFields(value);
			break;
		case "step_planned": {
			exactFields(value, [...baseFields, ...runFields, "actions"]);
			validateEnvelope(value, "running");
			validateRunFields(value);
			const actions = value.actions;
			if (
				!Array.isArray(actions) ||
				actions.length > 100 ||
				actions.some((action) => typeof action !== "string" || action.length < 1 || action.length > 128)
			) {
				throw new Error("Invalid browser worker actions.");
			}
			break;
		}
		case "run_completed": {
			exactFields(value, [...baseFields, ...runFields, "result"]);
			validateEnvelope(value, "completed");
			validateRunFields(value);
			const result = record(value.result);
			if (!result) throw new Error("Invalid browser worker result.");
			exactFields(result, ["present", "length", "sha256"]);
			if (
				typeof result.present !== "boolean" ||
				!Number.isSafeInteger(result.length) ||
				(result.length as number) < 0 ||
				(result.length as number) > 100_000_000 ||
				(result.sha256 !== null && (typeof result.sha256 !== "string" || !SHA256_PATTERN.test(result.sha256)))
			) {
				throw new Error("Invalid browser worker result.");
			}
			break;
		}
		case "run_failed":
			exactFields(value, [...baseFields, ...runFields, "error"]);
			validateEnvelope(value, "failed");
			validateRunFields(value);
			stringField(value, "error", 500);
			break;
		case "run_stopped":
			exactFields(value, [...baseFields, ...runFields]);
			validateEnvelope(value, "stopped");
			validateRunFields(value);
			break;
		case "control_granted":
			exactFields(value, [...baseFields, ...runFields, "reason"]);
			validateEnvelope(value, "paused");
			validateRunFields(value);
			stringField(value, "reason", 500);
			break;
		case "control_resumed":
			exactFields(value, [...baseFields, ...runFields, "reason"]);
			validateEnvelope(value, "running");
			validateRunFields(value);
			stringField(value, "reason", 500);
			break;
		case "shutdown":
			exactFields(value, [...baseFields, "request_id"]);
			validateEnvelope(value, "completed");
			if (value.request_id !== null) identifierField(value, "request_id");
			break;
		case "command_rejected":
			exactFields(value, [...baseFields, "request_id", "error"]);
			validateEnvelope(value, "rejected");
			if (value.request_id !== null) identifierField(value, "request_id");
			stringField(value, "error", 500);
			break;
		default:
			throw new Error("Unknown browser worker event.");
	}

	return value as unknown as BrowserWorkerEvent;
}

function parseConfiguredArgv(value: string): string[] {
	const trimmed = value.trim();
	if (!trimmed) throw new Error("The browser worker command is empty.");
	if (trimmed.startsWith("[")) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			throw new Error("The browser worker command is invalid.");
		}
		if (!Array.isArray(parsed) || parsed.length < 1 || parsed.some((part) => typeof part !== "string" || !part)) {
			throw new Error("The browser worker command must be a non-empty JSON string array.");
		}
		return parsed;
	}

	const argv: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	let started = false;
	for (const character of trimmed) {
		if (escaped) {
			current += character;
			escaped = false;
			started = true;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			started = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else current += character;
			started = true;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			started = true;
			continue;
		}
		if (/\s/.test(character)) {
			if (started) {
				argv.push(current);
				current = "";
				started = false;
			}
			continue;
		}
		current += character;
		started = true;
	}
	if (escaped || quote) throw new Error("The browser worker command has an unfinished quote or escape.");
	if (started) argv.push(current);
	if (!argv[0]) throw new Error("The browser worker command is empty.");
	return argv;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function defaultWorkerDirectory(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "../../../browser-worker");
}

async function workerLaunches(options: BrowserWorkerRunnerOptions): Promise<WorkerLaunch[]> {
	const sourceEnv = options.env ?? process.env;
	const configured = sourceEnv.KLERM_BROWSER_WORKER_COMMAND;
	const workerDirectory = resolve(options.workerDirectory ?? defaultWorkerDirectory());
	if (configured !== undefined) {
		const [command, ...args] = parseConfiguredArgv(configured);
		return [{ command, args, cwd: process.cwd(), runtime: "configured browser worker" }];
	}

	const packageSource = join(workerDirectory, "src", "klerm_browser_worker", "__main__.py");
	if (!(await exists(packageSource))) return [];
	const pythonPath = join(workerDirectory, "src");
	const localPython =
		process.platform === "win32"
			? join(workerDirectory, ".venv", "Scripts", "python.exe")
			: join(workerDirectory, ".venv", "bin", "python");
	const launches: WorkerLaunch[] = [];
	if (await exists(localPython)) {
		launches.push({
			command: localPython,
			args: ["-m", "klerm_browser_worker"],
			cwd: workerDirectory,
			runtime: "repo-local Python browser worker",
			extraEnv: { PYTHONPATH: pythonPath },
		});
	}
	launches.push({
		command: "uv",
		args: ["run", "--offline", "--no-python-downloads", "--project", workerDirectory, "klerm-browser-worker"],
		cwd: workerDirectory,
		runtime: "repo-local uv browser worker",
	});
	return launches;
}

function sanitizedEnvironment(
	source: Readonly<NodeJS.ProcessEnv>,
	extra: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {};
	for (const key of [
		"PATH",
		"HOME",
		"USERPROFILE",
		"TMPDIR",
		"TEMP",
		"TMP",
		"SystemRoot",
		"WINDIR",
		"PATHEXT",
		"COMSPEC",
		"LANG",
		"LC_ALL",
		"DISPLAY",
		"XAUTHORITY",
		"WAYLAND_DISPLAY",
		"XDG_RUNTIME_DIR",
		"XDG_SESSION_TYPE",
		"DBUS_SESSION_BUS_ADDRESS",
	]) {
		if (source[key] !== undefined) result[key] = source[key];
	}
	Object.assign(result, extra);
	result.PYTHONUTF8 = "1";
	result.PYTHONUNBUFFERED = "1";
	result.ANONYMIZED_TELEMETRY = "false";
	result.BROWSER_USE_TELEMETRY = "false";
	result.DO_NOT_TRACK = "1";
	result.OTEL_SDK_DISABLED = "true";
	result.BROWSER_USE_LOGGING_LEVEL = "critical";
	return result;
}

function validateStartRequest(request: BrowserWorkerStartRequest): void {
	for (const [name, value] of [
		["runId", request.runId],
		["taskId", request.taskId],
		["correlationId", request.correlationId],
		["agentId", request.agentId],
	] as const) {
		if (!ID_PATTERN.test(value)) throw new Error(`Invalid browser worker ${name}.`);
	}
	if (!request.prompt || request.prompt.length > 32_768) throw new Error("Invalid browser worker prompt.");
	if (!request.model || request.model.length > 256) throw new Error("Invalid browser worker model.");
	if (!request.token || request.token.length > 8192) throw new Error("Invalid browser worker token.");
	if (request.allowedOrigins.length > 64) {
		throw new Error("A browser run accepts at most 64 allowed origins.");
	}
	for (const origin of request.allowedOrigins) {
		if (!validateBrowserOrigin(origin).allowed) throw new Error("Invalid browser worker allowed origin.");
	}
	if (
		request.maxSteps !== undefined &&
		(!Number.isSafeInteger(request.maxSteps) || request.maxSteps < 1 || request.maxSteps > 100)
	) {
		throw new Error("Browser worker maxSteps must be an integer from 1 to 100.");
	}
	let baseUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
	} catch {
		throw new Error("Browser worker baseUrl must be an absolute loopback URL.");
	}
	const hostname = baseUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	const loopback =
		hostname === "localhost" || hostname === "::1" || (isIP(hostname) === 4 && hostname.startsWith("127."));
	if (
		(baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
		!loopback ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash
	) {
		throw new Error("Browser worker baseUrl must be a credential-free loopback HTTP URL.");
	}
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	return new Promise<T>((resolvePromise, rejectPromise) => {
		const timer = setTimeout(() => rejectPromise(new Error(message)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolvePromise(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				rejectPromise(error);
			},
		);
	});
}

export class BrowserWorkerRunner {
	private readonly options: BrowserWorkerRunnerOptions;
	private readonly listeners = new Set<BrowserWorkerEventListener>();
	private readonly failureListeners = new Set<BrowserWorkerFailureListener>();
	private readonly waiters = new Set<EventWaiter>();
	private readonly startupTimeoutMs: number;
	private readonly commandTimeoutMs: number;
	private readonly stopTimeoutMs: number;
	private readonly maxLineBytes: number;
	private child?: ChildProcessWithoutNullStreams;
	private closePromise?: Promise<void>;
	private ready?: BrowserWorkerReadyEvent;
	private launch?: WorkerLaunch;
	private stdoutBuffer = Buffer.alloc(0);
	private sequence = 0;
	private failure?: Error;
	private activeRunId?: string;
	private runTerminal = false;
	private shutdownRequested = false;
	private promptSecret?: string;
	private tokenSecret?: string;

	constructor(options: BrowserWorkerRunnerOptions = {}) {
		this.options = options;
		this.startupTimeoutMs = positiveTimeout(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS, "startupTimeoutMs");
		this.commandTimeoutMs = positiveTimeout(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS, "commandTimeoutMs");
		this.stopTimeoutMs = positiveTimeout(options.stopTimeoutMs, DEFAULT_STOP_TIMEOUT_MS, "stopTimeoutMs");
		this.maxLineBytes = options.maxLineBytes ?? BROWSER_WORKER_MAX_LINE_BYTES;
		if (
			!Number.isSafeInteger(this.maxLineBytes) ||
			this.maxLineBytes < 256 ||
			this.maxLineBytes > BROWSER_WORKER_MAX_LINE_BYTES
		) {
			throw new RangeError(`maxLineBytes must be from 256 to ${BROWSER_WORKER_MAX_LINE_BYTES}.`);
		}
	}

	subscribe(listener: BrowserWorkerEventListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	subscribeFailure(listener: BrowserWorkerFailureListener): () => void {
		this.failureListeners.add(listener);
		return () => this.failureListeners.delete(listener);
	}

	async availability(): Promise<BrowserAvailability> {
		try {
			const ready = await this.ensureProcess();
			return { available: true, runtime: this.launch?.runtime ?? "browser worker", version: ready.worker_version };
		} catch {
			await this.forceTerminate();
			return {
				available: false,
				runtime: "browser worker",
				reason: "The browser worker did not complete its protocol handshake.",
			};
		}
	}

	async start(request: BrowserWorkerStartRequest): Promise<void> {
		if (this.activeRunId && !this.runTerminal) throw new Error("A browser run is already active.");
		if (this.shutdownRequested) throw new Error("The browser worker runner is shut down.");
		validateStartRequest(request);
		await this.ensureProcess();
		this.activeRunId = request.runId;
		this.runTerminal = false;
		let task = request.prompt;
		if (request.startUrl !== undefined) {
			const startUrl = validateBrowserUrl(request.startUrl, { allowedOrigins: request.allowedOrigins });
			if (!startUrl.allowed) throw new Error("Invalid browser worker startUrl.");
			task = `Begin at this validated public URL: ${startUrl.url}\n\nRequested task:\n${request.prompt}`;
			if (task.length > 32_768) throw new Error("Invalid browser worker prompt.");
		}
		this.promptSecret = request.prompt;
		this.tokenSecret = request.token;
		const requestId = randomUUID();
		const response = this.waitForEvent(
			(event) =>
				(event.event === "command_accepted" && event.command === "start" && event.request_id === requestId) ||
				(event.event === "command_rejected" && event.request_id === requestId),
			this.commandTimeoutMs,
			"Browser worker did not acknowledge start.",
		);
		await this.writeCommand({
			version: BROWSER_WORKER_PROTOCOL_VERSION,
			command: "start",
			request_id: requestId,
			run_id: request.runId,
			task_id: request.taskId,
			correlation_id: request.correlationId,
			agent_id: request.agentId,
			task,
			model: request.model,
			base_url: request.baseUrl,
			token: request.token,
			allowed_origins: request.allowedOrigins,
			...(request.maxSteps === undefined ? {} : { max_steps: request.maxSteps }),
		});
		const event = await response;
		if (event.event === "command_rejected") {
			this.activeRunId = undefined;
			throw new Error(event.error);
		}
	}

	async approve(decision: BrowserWorkerApprovalDecision): Promise<void> {
		if (decision.decision === "denied") {
			await this.stop(decision.runId);
			return;
		}
		if (decision.decidedBy !== "user") throw new Error("Browser origin approval must be decided by the user.");
		this.assertActiveRun(decision.runId);
		if (this.runTerminal) throw new Error("Browser run is not active.");
		const origin = validateBrowserOrigin(decision.origin);
		if (!origin.allowed) throw new Error("Invalid browser worker approval origin.");
		const requestId = randomUUID();
		const response = this.waitForEvent(
			(event) =>
				(event.event === "origin_approved" && event.request_id === requestId) ||
				(event.event === "command_rejected" && event.request_id === requestId),
			this.commandTimeoutMs,
			"Browser worker did not acknowledge approval.",
		);
		await this.writeCommand({
			version: BROWSER_WORKER_PROTOCOL_VERSION,
			command: "approve_origin",
			request_id: requestId,
			run_id: decision.runId,
			origin: origin.origin,
			scope: decision.scope ?? "allow_once",
		});
		const event = await response;
		if (event.event === "command_rejected") throw new Error(event.error);
	}

	async stop(runId: string): Promise<void> {
		this.assertActiveRun(runId);
		if (this.runTerminal) return;
		const requestId = randomUUID();
		const terminal = this.waitForEvent(
			(event) =>
				(event.event === "run_stopped" && event.run_id === runId) ||
				(event.event === "run_completed" && event.run_id === runId) ||
				(event.event === "run_failed" && event.run_id === runId) ||
				(event.event === "command_rejected" && event.request_id === requestId),
			this.stopTimeoutMs,
			"Browser worker stop timed out.",
		);
		try {
			await this.writeCommand({
				version: BROWSER_WORKER_PROTOCOL_VERSION,
				command: "stop",
				request_id: requestId,
				run_id: runId,
			});
			const event = await terminal;
			if (event.event === "command_rejected") throw new Error(event.error);
		} catch (error) {
			await this.forceTerminate();
			throw error;
		}
	}

	async takeover(runId: string, reason?: string): Promise<void> {
		this.assertActiveRun(runId);
		if (this.runTerminal) throw new Error("Browser run is not active.");
		if (reason !== undefined && (reason.length < 1 || reason.length > 500)) {
			throw new Error("Browser takeover reason must be 1 through 500 characters.");
		}
		const requestId = randomUUID();
		const response = this.waitForEvent(
			(event) =>
				(event.event === "command_accepted" && event.command === "takeover" && event.request_id === requestId) ||
				(event.event === "command_rejected" && event.request_id === requestId),
			this.commandTimeoutMs,
			"Browser worker did not acknowledge takeover.",
		);
		await this.writeCommand({
			version: BROWSER_WORKER_PROTOCOL_VERSION,
			command: "takeover",
			request_id: requestId,
			run_id: runId,
			...(reason === undefined ? {} : { reason }),
		});
		const event = await response;
		if (event.event === "command_rejected") throw new Error(event.error);
	}

	async resume(runId: string): Promise<void> {
		this.assertActiveRun(runId);
		if (this.runTerminal) throw new Error("Browser run is not active.");
		const requestId = randomUUID();
		const response = this.waitForEvent(
			(event) =>
				(event.event === "command_accepted" && event.command === "resume" && event.request_id === requestId) ||
				(event.event === "command_rejected" && event.request_id === requestId),
			this.commandTimeoutMs,
			"Browser worker did not acknowledge resume.",
		);
		await this.writeCommand({
			version: BROWSER_WORKER_PROTOCOL_VERSION,
			command: "resume",
			request_id: requestId,
			run_id: runId,
		});
		const event = await response;
		if (event.event === "command_rejected") throw new Error(event.error);
	}

	async shutdown(): Promise<void> {
		if (this.shutdownRequested) {
			if (this.closePromise)
				await withTimeout(this.closePromise, this.stopTimeoutMs, "Browser worker shutdown timed out.");
			return;
		}
		this.shutdownRequested = true;
		if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) return;
		const requestId = randomUUID();
		const shutdown = this.waitForEvent(
			(event) => event.event === "shutdown" && event.request_id === requestId,
			this.stopTimeoutMs,
			"Browser worker shutdown timed out.",
		);
		try {
			await this.writeCommand({
				version: BROWSER_WORKER_PROTOCOL_VERSION,
				command: "shutdown",
				request_id: requestId,
			});
			await shutdown;
			if (this.closePromise)
				await withTimeout(this.closePromise, this.stopTimeoutMs, "Browser worker shutdown timed out.");
		} catch (error) {
			await this.forceTerminate();
			throw error;
		}
	}

	private async ensureProcess(): Promise<BrowserWorkerReadyEvent> {
		if (this.failure) throw this.failure;
		if (this.ready) return this.ready;
		if (this.child) {
			const event = await this.waitForEvent(
				(candidate) => candidate.event === "ready",
				this.startupTimeoutMs,
				"Browser worker startup timed out.",
			);
			return event as BrowserWorkerReadyEvent;
		}

		let launches: WorkerLaunch[];
		try {
			launches = await workerLaunches(this.options);
		} catch {
			throw new Error("KLERM_BROWSER_WORKER_COMMAND is invalid.");
		}
		if (launches.length === 0) throw new Error("No repo-local browser worker was found.");
		let lastError: Error | undefined;
		for (const launch of launches) {
			try {
				return await this.launchProcess(launch);
			} catch (error) {
				lastError = error instanceof Error ? error : new Error("Browser worker failed to start.");
				await this.forceTerminate();
				this.failure = undefined;
				this.sequence = 0;
				this.stdoutBuffer = Buffer.alloc(0);
			}
		}
		throw lastError ?? new Error("Browser worker failed to start.");
	}

	private async launchProcess(launch: WorkerLaunch): Promise<BrowserWorkerReadyEvent> {
		this.launch = launch;
		const sourceEnv = this.options.env ?? process.env;
		const child = spawnProcess(launch.command, launch.args, {
			cwd: launch.cwd,
			env: sanitizedEnvironment(sourceEnv, launch.extraEnv),
			stdio: ["pipe", "pipe", "pipe"],
			detached: true,
			windowsHide: true,
		}) as ChildProcessWithoutNullStreams;
		this.child = child;
		child.stderr.resume();
		child.stdout.on("data", (chunk: Buffer | string) =>
			this.consumeStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
		);
		child.stdout.once("end", () => {
			if (this.stdoutBuffer.length > 0 && !this.failure) this.failProtocol();
		});
		const closePromise = new Promise<void>((resolveClose) => {
			child.once("error", () => {
				if (this.child !== child) {
					resolveClose();
					return;
				}
				const error = new Error("Browser worker process failed.");
				this.fail(error, {
					reason: "process-failed",
					message: "The browser worker process failed.",
				});
				resolveClose();
			});
			child.once("close", (code, signal) => {
				if (this.child !== child) {
					resolveClose();
					return;
				}
				this.child = undefined;
				if (!this.failure && (!this.shutdownRequested || this.waiters.size > 0)) {
					this.fail(new Error(`Browser worker exited unexpectedly (${code ?? signal ?? "unknown"}).`), {
						reason: "process-exited",
						message: "The browser worker process exited unexpectedly.",
					});
				}
				resolveClose();
			});
		});
		this.closePromise = closePromise;
		const ready = await this.waitForEvent(
			(event) => event.event === "ready",
			this.startupTimeoutMs,
			"Browser worker startup timed out.",
		);
		this.ready = ready as BrowserWorkerReadyEvent;
		return this.ready;
	}

	private consumeStdout(chunk: Buffer): void {
		if (this.failure) return;
		this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
		while (true) {
			const newline = this.stdoutBuffer.indexOf(0x0a);
			if (newline < 0) {
				if (this.stdoutBuffer.length > this.maxLineBytes) this.failProtocol();
				return;
			}
			if (newline > this.maxLineBytes) {
				this.failProtocol();
				return;
			}
			let line = this.stdoutBuffer.subarray(0, newline);
			this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
			if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
			if (line.length === 0) {
				this.failProtocol();
				return;
			}
			let text: string;
			try {
				text = new TextDecoder("utf-8", { fatal: true }).decode(line);
			} catch {
				this.failProtocol();
				return;
			}
			let event: BrowserWorkerEvent;
			try {
				event = parseWorkerEvent(text);
			} catch {
				this.failProtocol();
				return;
			}
			if (
				event.sequence !== this.sequence + 1 ||
				(this.sequence === 0 && event.event !== "ready") ||
				(this.sequence > 0 && event.event === "ready") ||
				("run_id" in event && this.activeRunId !== undefined && event.run_id !== this.activeRunId)
			) {
				this.failProtocol();
				return;
			}
			this.sequence = event.sequence;
			this.dispatchEvent(this.sanitizeEvent(event));
		}
	}

	private sanitizeEvent(event: BrowserWorkerEvent): BrowserWorkerEvent {
		if (event.event !== "run_failed" && event.event !== "command_rejected") return event;
		let error = redactBrowserSecretText(event.error);
		for (const secret of [this.tokenSecret, this.promptSecret]) {
			if (secret) error = error.split(secret).join(BROWSER_REDACTED_VALUE);
		}
		return { ...event, error };
	}

	private dispatchEvent(event: BrowserWorkerEvent): void {
		if (event.event === "run_completed" || event.event === "run_failed" || event.event === "run_stopped") {
			this.runTerminal = true;
		}
		for (const waiter of [...this.waiters]) {
			if (!waiter.predicate(event)) continue;
			this.waiters.delete(waiter);
			clearTimeout(waiter.timer);
			waiter.resolve(event);
		}
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// A consumer callback must not compromise worker isolation or ordering.
			}
		}
	}

	private waitForEvent(
		predicate: (event: BrowserWorkerEvent) => boolean,
		timeoutMs: number,
		timeoutMessage: string,
	): Promise<BrowserWorkerEvent> {
		if (this.failure) return Promise.reject(this.failure);
		return new Promise((resolveEvent, rejectEvent) => {
			const waiter: EventWaiter = {
				predicate,
				resolve: resolveEvent,
				reject: rejectEvent,
				timer: setTimeout(() => {
					this.waiters.delete(waiter);
					rejectEvent(new Error(timeoutMessage));
				}, timeoutMs),
			};
			this.waiters.add(waiter);
		});
	}

	private async writeCommand(command: Record<string, unknown>): Promise<void> {
		if (this.failure) throw this.failure;
		if (!this.child?.stdin.writable) throw new Error("Browser worker input is unavailable.");
		const line = `${JSON.stringify(command)}\n`;
		if (Buffer.byteLength(line, "utf8") > BROWSER_WORKER_MAX_LINE_BYTES) {
			throw new Error("Browser worker command exceeds the maximum size.");
		}
		await new Promise<void>((resolveWrite, rejectWrite) => {
			this.child?.stdin.write(line, (error) => {
				if (error) rejectWrite(new Error("Browser worker input failed."));
				else resolveWrite();
			});
		});
	}

	private assertActiveRun(runId: string): void {
		if (!ID_PATTERN.test(runId) || this.activeRunId !== runId) throw new Error("Browser run is not active.");
		if (this.failure) throw this.failure;
	}

	private failProtocol(): void {
		this.fail(new Error("Browser worker emitted invalid protocol output."), {
			reason: "protocol-failed",
			message: "The browser worker emitted invalid protocol output.",
		});
		void this.forceTerminate();
	}

	private fail(error: Error, failure: BrowserWorkerFailure): void {
		if (this.failure) return;
		this.failure = error;
		for (const waiter of this.waiters) {
			clearTimeout(waiter.timer);
			waiter.reject(error);
		}
		this.waiters.clear();
		for (const listener of this.failureListeners) {
			try {
				listener(failure);
			} catch {
				// Failure observers must not compromise process cleanup.
			}
		}
	}

	private async forceTerminate(): Promise<void> {
		const child = this.child;
		const closePromise = this.closePromise;
		if (!child) return;
		child.stdin.destroy();
		if (child.pid !== undefined) killProcessTree(child.pid);
		else child.kill("SIGKILL");
		if (closePromise) {
			try {
				await withTimeout(closePromise, Math.min(this.stopTimeoutMs, 2_000), "Browser worker did not exit.");
			} catch {
				// The process tree has already received the strongest supported termination.
			}
		}
	}
}

export async function getBrowserWorkerAvailability(
	options: BrowserWorkerRunnerOptions = {},
): Promise<BrowserAvailability> {
	const runner = new BrowserWorkerRunner(options);
	const availability = await runner.availability();
	try {
		await runner.shutdown();
	} catch {
		return {
			available: false,
			runtime: availability.runtime,
			reason: "The browser worker started but did not shut down cleanly.",
		};
	}
	return availability;
}
