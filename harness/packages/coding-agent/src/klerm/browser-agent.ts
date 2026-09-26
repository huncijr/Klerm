import { appendFile, mkdir } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";

export const KLERM_BROWSER_LOG_DIRECTORY = ".klerm";
export const KLERM_BROWSER_LOG_FILE = "browser-events.jsonl";
export const BROWSER_REDACTED_VALUE = "[REDACTED]";

export type BrowserAvailability =
	| { available: true; runtime: string; version?: string }
	| { available: false; runtime: string; reason: string };

export type BrowserRunStatus = "queued" | "running" | "waiting-approval" | "completed" | "failed" | "cancelled";

export interface BrowserRunRequest {
	runId: string;
	agentId: string;
	prompt: string;
	model?: string;
	startUrl?: string;
	allowedOrigins?: readonly string[];
}

export interface BrowserRunResult {
	runId: string;
	status: Exclude<BrowserRunStatus, "queued" | "running" | "waiting-approval">;
	summary?: string;
	error?: string;
}

export type BrowserApprovalKind =
	| "cross-origin-navigation"
	| "credential-entry"
	| "form-submission"
	| "file-download"
	| "external-protocol"
	| "financial-action";

export interface BrowserApprovalRequest {
	approvalId: string;
	runId: string;
	kind: BrowserApprovalKind;
	title: string;
	message: string;
	origin?: string;
}

export interface BrowserApprovalDecision {
	approvalId: string;
	runId: string;
	decision: "approved" | "denied";
	decidedBy: "user";
}

export type BrowserEventType =
	| "AVAILABILITY_CHECKED"
	| "RUN_REQUESTED"
	| "RUN_STARTED"
	| "NAVIGATION"
	| "ACTION"
	| "ACTION_DISPATCHED"
	| "ACTION_COMPLETED"
	| "ACTION_FAILED"
	| "APPROVAL_REQUESTED"
	| "APPROVAL_RESOLVED"
	| "CONTROL_PAUSE_REQUESTED"
	| "CONTROL_GRANTED"
	| "CONTROL_RESUMED"
	| "RUN_COMPLETED"
	| "RUN_FAILED"
	| "RUN_CANCELLED"
	| "BROWSER_RESET";

export interface BrowserEventInput {
	event: BrowserEventType;
	runId: string;
	sessionId?: string;
	taskId?: string;
	correlationId?: string;
	agentId?: string;
	status?: BrowserRunStatus;
	url?: string;
	reason?: string;
	details?: unknown;
}

export interface BrowserEvent extends BrowserEventInput {
	version: 1;
	timestamp: string;
	sequence: number;
}

export interface BrowserUrlPolicy {
	allowedOrigins?: readonly string[];
}

export type BrowserUrlPolicyCode =
	| "invalid-url"
	| "unsupported-protocol"
	| "embedded-credentials"
	| "blocked-host"
	| "blocked-ip"
	| "invalid-origin"
	| "invalid-origin-policy"
	| "origin-not-allowed";

export type BrowserUrlPolicyDecision =
	| { allowed: true; url: string; origin: string }
	| { allowed: false; code: BrowserUrlPolicyCode; reason: string };

export type BrowserOriginPolicyDecision =
	| { allowed: true; origin: string }
	| { allowed: false; code: BrowserUrlPolicyCode; reason: string };

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa"];
const BLOCKED_METADATA_HOSTS = new Set([
	"metadata",
	"metadata.google.internal",
	"metadata.goog",
	"metadata.aws.internal",
	"instance-data",
]);
const SENSITIVE_FIELD =
	/^(?:authorization|proxyauthorization|cookie|setcookie|credentials)$|(?:cookie|token|apikey|password|passwd|secret|credential)$/;

function normalizedHostname(hostname: string): string {
	return hostname
		.replace(/^\[|\]$/g, "")
		.replace(/\.+$/, "")
		.toLowerCase();
}

function blockedHostname(hostname: string): "blocked-host" | "blocked-ip" | undefined {
	const normalized = normalizedHostname(hostname);
	if (isIP(normalized) !== 0) return "blocked-ip";
	if (
		!normalized.includes(".") ||
		normalized === "localhost" ||
		BLOCKED_METADATA_HOSTS.has(normalized) ||
		BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
	) {
		return "blocked-host";
	}
	return undefined;
}

function parseBrowserUrl(value: string): BrowserUrlPolicyDecision {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return { allowed: false, code: "invalid-url", reason: "Browser URLs must be absolute URLs." };
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		return {
			allowed: false,
			code: "unsupported-protocol",
			reason: "Browser URLs must use HTTP or HTTPS.",
		};
	}
	if (parsed.username || parsed.password) {
		return {
			allowed: false,
			code: "embedded-credentials",
			reason: "Browser URLs must not contain embedded credentials.",
		};
	}
	const blocked = blockedHostname(parsed.hostname);
	if (blocked) {
		return {
			allowed: false,
			code: blocked,
			reason:
				blocked === "blocked-ip"
					? "Browser URLs must use a public DNS hostname instead of an IP address."
					: "Browser URLs must not target localhost, private, link-local, or metadata hosts.",
		};
	}
	parsed.hostname = normalizedHostname(parsed.hostname);
	return { allowed: true, url: parsed.toString(), origin: parsed.origin };
}

export function validateBrowserOrigin(value: string): BrowserOriginPolicyDecision {
	const decision = parseBrowserUrl(value);
	if (!decision.allowed) return decision;
	const parsed = new URL(decision.url);
	if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
		return {
			allowed: false,
			code: "invalid-origin",
			reason: "Allowed browser origins must not contain a path, query, or fragment.",
		};
	}
	return { allowed: true, origin: decision.origin };
}

export function validateBrowserUrl(value: string, policy: BrowserUrlPolicy = {}): BrowserUrlPolicyDecision {
	const decision = parseBrowserUrl(value);
	if (!decision.allowed || policy.allowedOrigins === undefined) return decision;

	const allowedOrigins = new Set<string>();
	for (const configuredOrigin of policy.allowedOrigins) {
		const originDecision = validateBrowserOrigin(configuredOrigin);
		if (!originDecision.allowed) {
			return {
				allowed: false,
				code: "invalid-origin-policy",
				reason: `Invalid allowed browser origin: ${redactBrowserSecretText(configuredOrigin)}`,
			};
		}
		allowedOrigins.add(originDecision.origin);
	}
	if (!allowedOrigins.has(decision.origin)) {
		return {
			allowed: false,
			code: "origin-not-allowed",
			reason: `Browser origin is not allowed: ${decision.origin}`,
		};
	}
	return decision;
}

export function redactBrowserSecretText(value: string): string {
	return value
		.replace(/\b((?:https?):\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${BROWSER_REDACTED_VALUE}@`)
		.replace(/\b(bearer|basic)\s+[a-z0-9._~+/=-]+/gi, `$1 ${BROWSER_REDACTED_VALUE}`)
		.replace(
			/\b(authorization|proxy-authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|passwd|client[_-]?secret|secret|credential)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
			`$1=${BROWSER_REDACTED_VALUE}`,
		)
		.replace(
			/([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|password|secret)=)[^&#\s]*/gi,
			`$1${BROWSER_REDACTED_VALUE}`,
		);
}

export function redactBrowserSecrets(value: unknown): unknown {
	const seen = new WeakSet<object>();
	const redact = (current: unknown, key?: string): unknown => {
		if (key && SENSITIVE_FIELD.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase())) {
			return BROWSER_REDACTED_VALUE;
		}
		if (typeof current === "string") return redactBrowserSecretText(current);
		if (current instanceof Error) return { name: current.name, message: redactBrowserSecretText(current.message) };
		if (!current || typeof current !== "object") return current;
		if (seen.has(current)) return "[Circular]";
		seen.add(current);
		if (Array.isArray(current)) return current.map((entry) => redact(entry));
		return Object.fromEntries(
			Object.entries(current).map(([entryKey, entry]) => [entryKey, redact(entry, entryKey)]),
		);
	};
	return redact(value);
}

export function buildBrowserEvent(input: BrowserEventInput, sequence: number, timestamp: string): BrowserEvent {
	if (!Number.isSafeInteger(sequence) || sequence < 1) {
		throw new RangeError("Browser event sequence must be a positive safe integer.");
	}
	const safeInput = redactBrowserSecrets(input) as BrowserEventInput;
	return { version: 1, timestamp, sequence, ...safeInput };
}

export interface BrowserEventSequencerOptions {
	initialSequence?: number;
	now?: () => Date | string;
}

export class BrowserEventSequencer {
	private sequence: number;
	private readonly now: () => Date | string;

	constructor(options: BrowserEventSequencerOptions = {}) {
		const initialSequence = options.initialSequence ?? 0;
		if (!Number.isSafeInteger(initialSequence) || initialSequence < 0) {
			throw new RangeError("Initial browser event sequence must be a non-negative safe integer.");
		}
		this.sequence = initialSequence;
		this.now = options.now ?? (() => new Date());
	}

	next(input: BrowserEventInput): BrowserEvent {
		const now = this.now();
		return buildBrowserEvent(input, ++this.sequence, typeof now === "string" ? now : now.toISOString());
	}

	currentSequence(): number {
		return this.sequence;
	}
}

export function getBrowserLogPath(cwd: string): string {
	return join(cwd, KLERM_BROWSER_LOG_DIRECTORY, KLERM_BROWSER_LOG_FILE);
}

export async function appendBrowserEvent(cwd: string, event: BrowserEvent): Promise<void> {
	await mkdir(join(cwd, KLERM_BROWSER_LOG_DIRECTORY), { recursive: true });
	const safeEvent = redactBrowserSecrets(event);
	await appendFile(getBrowserLogPath(cwd), `${JSON.stringify(safeEvent)}\n`, "utf8");
}
