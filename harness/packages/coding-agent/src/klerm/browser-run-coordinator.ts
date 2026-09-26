import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../core/model-runtime.ts";
import {
	appendBrowserEvent,
	type BrowserAvailability,
	type BrowserEvent,
	BrowserEventSequencer,
	type BrowserEventType,
	type BrowserRunStatus,
	validateBrowserOrigin,
	validateBrowserUrl,
} from "./browser-agent.ts";
import {
	type BrowserWorkerApprovalDecision,
	type BrowserWorkerEvent,
	type BrowserWorkerEventListener,
	type BrowserWorkerFailure,
	type BrowserWorkerFailureListener,
	BrowserWorkerRunner,
	type BrowserWorkerStartRequest,
} from "./browser-worker-runner.ts";
import {
	type OpenAICompatibleChatServer,
	type OpenAICompatibleChatServerOptions,
	startOpenAICompatibleChatServer,
} from "./openai-compatible-chat.ts";

const MAX_LAST_ACTIONS = 20;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BROWSER_AGENT_ID = "browser-agent";
const BLOCKED_NETWORKS = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	BLOCKED_NETWORKS.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
	["2001:db8::", 32],
] as const) {
	BLOCKED_NETWORKS.addSubnet(network, prefix, "ipv6");
}

type BrowserCoordinatorModelRuntime = Pick<ModelRuntime, "completeSimple" | "getAvailableSnapshot">;

export type BrowserControlOwner = "ai" | "pausing" | "human";

export interface BrowserRunStartInput {
	model: string;
	prompt: string;
	startUrl?: string;
	maxSteps?: number;
}

export interface BrowserRunTakeoverInput {
	runId: string;
	reason?: string;
}

export interface BrowserRunApprovalInput {
	runId: string;
	approvalId: string;
	decision: "approved" | "denied";
	scope?: "allow_once" | "current_run";
}

export interface BrowserPendingOriginApproval {
	approvalId: string;
	origin: string;
	requestedAt: string;
}

export interface BrowserRunResultMetadata {
	present: boolean;
	length: number;
	sha256: string | null;
}

export interface BrowserRunPublicState {
	runId: string;
	sessionId?: string;
	taskId: string;
	correlationId: string;
	agentId: string;
	model: string;
	status: BrowserRunStatus;
	browserReset?: boolean;
	control: BrowserControlOwner;
	controlReason?: string;
	requestedAt: string;
	updatedAt: string;
	startedAt?: string;
	settledAt?: string;
	startUrl?: string;
	pendingApproval?: BrowserPendingOriginApproval;
	lastActions: readonly string[];
	resultSummary?: string;
	resultMetadata?: BrowserRunResultMetadata;
	error?: string;
}

export interface BrowserRunCoordinatorUpdate {
	event: BrowserEvent;
	state: BrowserRunPublicState;
}

export interface BrowserRunCoordinatorRunner {
	availability(): Promise<BrowserAvailability>;
	subscribe(listener: BrowserWorkerEventListener): () => void;
	subscribeFailure(listener: BrowserWorkerFailureListener): () => void;
	start(request: BrowserWorkerStartRequest): Promise<void>;
	approve(decision: BrowserWorkerApprovalDecision): Promise<void>;
	takeover(runId: string, reason?: string): Promise<void>;
	resume(runId: string): Promise<void>;
	stop(runId: string): Promise<void>;
	shutdown(): Promise<void>;
}

export interface BrowserRunCoordinatorOptions {
	cwd: string;
	sessionId?: string;
	modelRuntime: BrowserCoordinatorModelRuntime;
	onEvent?: (update: BrowserRunCoordinatorUpdate) => void | Promise<void>;
	createRunner?: () => BrowserRunCoordinatorRunner;
	startGateway?: (options: OpenAICompatibleChatServerOptions) => Promise<OpenAICompatibleChatServer>;
	appendEvent?: (cwd: string, event: BrowserEvent) => Promise<void>;
	createId?: (kind: "run" | "task" | "correlation" | "approval") => string;
	now?: () => Date | string;
	resolveHostname?: (hostname: string) => Promise<readonly string[]>;
}

export interface BrowserRunCoordinatorApi {
	availability(): Promise<BrowserAvailability>;
	state(): BrowserRunPublicState | undefined;
	start(input: BrowserRunStartInput): Promise<BrowserRunPublicState>;
	approve(decision: BrowserRunApprovalInput): Promise<BrowserRunPublicState>;
	takeover(input: BrowserRunTakeoverInput): Promise<BrowserRunPublicState>;
	resume(runId: string): Promise<BrowserRunPublicState>;
	stop(runId: string): Promise<BrowserRunPublicState>;
	close(): Promise<void>;
}

interface ActiveRun {
	runner: BrowserRunCoordinatorRunner;
	gateway?: OpenAICompatibleChatServer;
	unsubscribeEvent: () => void;
	unsubscribeFailure: () => void;
	settled: boolean;
	cleanup?: Promise<void>;
}

function modelReference(model: Model<Api>): string {
	return model.id === `${model.provider}/${model.id}` ? model.id : `${model.provider}/${model.id}`;
}

function cloneState(state: BrowserRunPublicState): BrowserRunPublicState {
	return {
		...state,
		lastActions: [...state.lastActions],
		...(state.controlReason === undefined ? {} : { controlReason: state.controlReason }),
		...(state.pendingApproval ? { pendingApproval: { ...state.pendingApproval } } : {}),
		...(state.resultMetadata ? { resultMetadata: { ...state.resultMetadata } } : {}),
	};
}

export class BrowserRunCoordinator implements BrowserRunCoordinatorApi {
	private readonly cwd: string;
	private readonly sessionId?: string;
	private readonly modelRuntime: BrowserCoordinatorModelRuntime;
	private readonly onEvent?: (update: BrowserRunCoordinatorUpdate) => void | Promise<void>;
	private readonly createRunner: () => BrowserRunCoordinatorRunner;
	private readonly startGateway: (options: OpenAICompatibleChatServerOptions) => Promise<OpenAICompatibleChatServer>;
	private readonly appendEvent: (cwd: string, event: BrowserEvent) => Promise<void>;
	private readonly createId: (kind: "run" | "task" | "correlation" | "approval") => string;
	private readonly now: () => Date | string;
	private readonly resolveHostname: (hostname: string) => Promise<readonly string[]>;
	private readonly sequencer: BrowserEventSequencer;
	private operationTail: Promise<void> = Promise.resolve();
	private eventTail: Promise<void> = Promise.resolve();
	private eventError = false;
	private current?: BrowserRunPublicState;
	private active?: ActiveRun;
	private browserRunner?: BrowserRunCoordinatorRunner;
	private unsubscribeIdleFailure?: () => void;
	private closed = false;

	constructor(options: BrowserRunCoordinatorOptions) {
		this.cwd = options.cwd;
		this.sessionId = options.sessionId;
		this.modelRuntime = options.modelRuntime;
		this.onEvent = options.onEvent;
		this.createRunner = options.createRunner ?? (() => new BrowserWorkerRunner());
		this.startGateway = options.startGateway ?? startOpenAICompatibleChatServer;
		this.appendEvent = options.appendEvent ?? appendBrowserEvent;
		this.createId = options.createId ?? (() => randomUUID());
		this.now = options.now ?? (() => new Date());
		this.resolveHostname =
			options.resolveHostname ??
			(async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address));
		this.sequencer = new BrowserEventSequencer({ now: this.now });
	}

	async availability(): Promise<BrowserAvailability> {
		if (this.closed) return { available: false, runtime: "browser worker", reason: "The coordinator is closed." };
		const runner = this.createRunner();
		let availability: BrowserAvailability;
		try {
			availability = await runner.availability();
		} catch {
			try {
				await runner.shutdown();
			} catch {
				// The public failure remains intentionally independent of process details.
			}
			return {
				available: false,
				runtime: "browser worker",
				reason: "The browser worker availability check failed.",
			};
		}
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

	state(): BrowserRunPublicState | undefined {
		return this.current ? cloneState(this.current) : undefined;
	}

	start(input: BrowserRunStartInput): Promise<BrowserRunPublicState> {
		return this.exclusive(async () => {
			await this.flushEvents();
			if (this.closed) throw new Error("The browser run coordinator is closed.");
			if (this.active) throw new Error("A browser run is already active.");
			if (!input.prompt || input.prompt.length > 32_000) throw new Error("Invalid browser prompt.");
			if (!input.model || input.model.length > 256) throw new Error("Invalid browser model.");
			if (
				input.maxSteps !== undefined &&
				(!Number.isSafeInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > 100)
			) {
				throw new Error("Browser maxSteps must be an integer from 1 to 100.");
			}

			const url = input.startUrl?.trim() ? validateBrowserUrl(input.startUrl.trim()) : undefined;
			if (url && !url.allowed) throw new Error(url.reason);
			if (url?.allowed) {
				await this.assertPublicOrigin(url.origin);
				if (url.url.length > 2_048) throw new Error("Browser startUrl must not exceed 2048 characters.");
			}
			const models = this.modelRuntime
				.getAvailableSnapshot()
				.filter((model) => input.model === model.id || input.model === modelReference(model));
			if (models.length !== 1) throw new Error(`Browser model "${input.model}" is unavailable or ambiguous.`);
			const pinnedModel = models[0];
			const ids = {
				runId: this.generatedId("run"),
				taskId: this.generatedId("task"),
				correlationId: this.generatedId("correlation"),
			};
			await this.flushEvents();
			const requestedAt = this.timestamp();
			this.current = {
				...ids,
				...(this.sessionId ? { sessionId: this.sessionId } : {}),
				agentId: BROWSER_AGENT_ID,
				model: modelReference(pinnedModel),
				status: "queued",
				control: "ai",
				requestedAt,
				updatedAt: requestedAt,
				...(url?.allowed ? { startUrl: url.url } : {}),
				lastActions: [],
			};

			const runner = this.browserRunner ?? this.createRunner();
			this.unsubscribeIdleFailure?.();
			this.unsubscribeIdleFailure = undefined;
			this.browserRunner = undefined;
			const active: ActiveRun = {
				runner,
				unsubscribeEvent: () => undefined,
				unsubscribeFailure: () => undefined,
				settled: false,
			};
			active.unsubscribeEvent = runner.subscribe((event) => this.queueWorkerEvent(active, event));
			active.unsubscribeFailure = runner.subscribeFailure((failure) => this.queueWorkerFailure(active, failure));
			this.active = active;

			await this.queueEvent(async () => {
				await this.record(
					"RUN_REQUESTED",
					"Browser run requested.",
					"queued",
					url?.allowed ? { url: url.url } : undefined,
				);
			});
			try {
				active.gateway = await this.startGateway({ modelRuntime: this.modelRuntime, pinnedModel });
				await runner.start({
					...ids,
					agentId: BROWSER_AGENT_ID,
					prompt: input.prompt,
					model: modelReference(pinnedModel),
					...(url?.allowed ? { startUrl: url.url } : {}),
					baseUrl: active.gateway.url,
					token: active.gateway.token,
					allowedOrigins: url?.allowed ? [url.origin] : [],
					...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
				});
				await this.flushEvents();
				return this.requiredState();
			} catch {
				await this.queueEvent(() =>
					this.failActive(active, "Browser run could not be started.", "Browser run startup failed."),
				);
				await this.flushEvents();
				throw new Error("Browser run could not be started.");
			}
		});
	}

	approve(input: BrowserRunApprovalInput): Promise<BrowserRunPublicState> {
		return this.exclusive(async () => {
			const active = this.requireActive(input.runId);
			const pending = this.current?.pendingApproval;
			if (!pending || pending.approvalId !== input.approvalId) {
				throw new Error("Browser approval is not pending.");
			}
			if (input.scope !== undefined && input.scope !== "allow_once" && input.scope !== "current_run") {
				throw new Error("Invalid browser approval scope.");
			}

			if (input.decision === "denied") {
				await this.queueEvent(async () => {
					if (this.active !== active || active.settled) return;
					this.current = { ...this.requiredState(), pendingApproval: undefined };
					await this.record("APPROVAL_RESOLVED", "User denied the pending origin.", "waiting-approval", {
						approvalId: pending.approvalId,
						origin: pending.origin,
						decision: "denied",
					});
				});
				try {
					await active.runner.stop(input.runId);
					await this.flushEvents();
					if (!active.settled) {
						await this.queueEvent(() => this.cancelActive(active, "Browser run stopped after origin denial."));
					}
				} catch {
					await this.queueEvent(() =>
						this.failActive(active, "Browser worker process failed.", "Browser worker failed while stopping."),
					);
				}
				await this.flushEvents();
				return this.requiredState();
			}

			try {
				await active.runner.approve({
					approvalId: pending.approvalId,
					runId: input.runId,
					decision: "approved",
					decidedBy: "user",
					origin: pending.origin,
					scope: input.scope ?? "allow_once",
				});
				await this.flushEvents();
				return this.requiredState();
			} catch {
				await this.queueEvent(() =>
					this.failActive(active, "Browser approval failed.", "Browser worker rejected the origin approval."),
				);
				await this.flushEvents();
				throw new Error("Browser approval failed.");
			}
		});
	}

	takeover(input: BrowserRunTakeoverInput): Promise<BrowserRunPublicState> {
		return this.exclusive(async () => {
			const active = this.requireActive(input.runId);
			if (this.current?.control !== "ai") throw new Error("Browser run is already under human control.");
			if (input.reason !== undefined && (input.reason.length < 1 || input.reason.length > 500)) {
				throw new Error("Browser takeover reason must be 1 through 500 characters.");
			}
			const reason = input.reason ?? "Human takeover requested.";
			try {
				await active.runner.takeover(input.runId, reason);
				await this.flushEvents();
			} catch {
				await this.queueEvent(() =>
					this.failActive(active, "Browser worker process failed.", "Browser worker failed on takeover."),
				);
				await this.flushEvents();
				throw new Error("Browser takeover failed.");
			}
			await this.queueEvent(async () => {
				if (this.active !== active || active.settled) return;
				this.current = { ...this.requiredState(), control: "pausing", controlReason: reason };
				await this.record("CONTROL_PAUSE_REQUESTED", "Human control was requested.", "running", { reason });
			});
			await this.flushEvents();
			return this.requiredState();
		});
	}

	resume(runId: string): Promise<BrowserRunPublicState> {
		return this.exclusive(async () => {
			const active = this.requireActive(runId);
			if (this.current?.control === "ai") throw new Error("Browser run is not paused for human control.");
			try {
				await active.runner.resume(runId);
				await this.flushEvents();
			} catch {
				await this.queueEvent(() =>
					this.failActive(active, "Browser worker process failed.", "Browser worker failed on resume."),
				);
				await this.flushEvents();
				throw new Error("Browser resume failed.");
			}
			await this.queueEvent(async () => {
				if (this.active !== active || active.settled) return;
				if (this.requiredState().control === "ai") return;
				const { controlReason: _dropped, ...rest } = this.requiredState();
				this.current = { ...rest, control: "ai" };
				await this.record("CONTROL_RESUMED", "Human returned control to the agent.", "running");
			});
			await this.flushEvents();
			return this.requiredState();
		});
	}

	stop(runId: string): Promise<BrowserRunPublicState> {
		return this.exclusive(async () => {
			if (this.current?.runId !== runId) throw new Error("Browser run is not active.");
			if (!this.active) return cloneState(this.current);
			const active = this.active;
			try {
				await active.runner.stop(runId);
				await this.flushEvents();
				if (!active.settled) await this.queueEvent(() => this.cancelActive(active, "Browser run stopped by user."));
			} catch {
				await this.queueEvent(() =>
					this.failActive(active, "Browser worker process failed.", "Browser worker failed while stopping."),
				);
			}
			await this.flushEvents();
			return this.requiredState();
		});
	}

	close(): Promise<void> {
		return this.exclusive(async () => {
			if (this.closed && !this.active && !this.browserRunner) return;
			this.closed = true;
			const active = this.active;
			if (!active) {
				this.unsubscribeIdleFailure?.();
				this.unsubscribeIdleFailure = undefined;
				const runner = this.browserRunner;
				this.browserRunner = undefined;
				await runner?.shutdown();
				return;
			}
			if (!active.settled) {
				try {
					await active.runner.stop(this.requiredState().runId);
					await this.flushEvents();
					if (!active.settled)
						await this.queueEvent(() => this.cancelActive(active, "Browser coordinator closed."));
				} catch {
					await this.queueEvent(() =>
						this.failActive(active, "Browser worker process failed.", "Browser worker failed during close."),
					);
				}
			}
			await this.flushEvents();
			await this.cleanup(active);
		});
	}

	private queueWorkerEvent(active: ActiveRun, event: BrowserWorkerEvent): void {
		void this.queueEvent(() => this.handleWorkerEvent(active, event));
	}

	private queueWorkerFailure(active: ActiveRun, failure: BrowserWorkerFailure): void {
		void this.queueEvent(async () => {
			if (this.active !== active || active.settled) return;
			const message =
				failure.reason === "protocol-failed" ? "Browser worker protocol failed." : "Browser worker process failed.";
			await this.failActive(active, message, message);
			this.current = { ...this.requiredState(), browserReset: true };
			await this.record(
				"BROWSER_RESET",
				"Browser worker crashed; the next task starts with a blank page.",
				"failed",
			);
		});
	}

	private async handleWorkerEvent(active: ActiveRun, event: BrowserWorkerEvent): Promise<void> {
		if (this.active !== active || active.settled) return;
		if (
			"run_id" in event &&
			(event.run_id !== this.current?.runId ||
				event.task_id !== this.current.taskId ||
				event.correlation_id !== this.current.correlationId ||
				event.agent_id !== this.current.agentId)
		) {
			await this.failActive(active, "Browser worker protocol failed.", "Browser worker run identity mismatch.");
			return;
		}

		switch (event.event) {
			case "run_started":
				this.current = { ...this.requiredState(), status: "running", startedAt: event.timestamp };
				await this.record("RUN_STARTED", "Browser worker started the run.", "running");
				break;
			case "step_planned": {
				const actions = [...this.requiredState().lastActions, ...event.actions].slice(-MAX_LAST_ACTIONS);
				this.current = { ...this.requiredState(), status: "running", lastActions: actions };
				await this.record("ACTION", "Browser worker planned actions.", "running", { actions: event.actions });
				break;
			}
			case "origin_approval_required": {
				if (this.current?.pendingApproval) {
					await this.failActive(
						active,
						"Browser worker protocol failed.",
						"Multiple origin approvals were requested.",
					);
					break;
				}
				const origin = validateBrowserOrigin(event.origin);
				if (!origin.allowed) {
					await this.failActive(
						active,
						"Browser worker protocol failed.",
						"Browser worker requested an invalid origin.",
					);
					break;
				}
				try {
					await this.assertPublicOrigin(origin.origin);
				} catch {
					await this.failActive(
						active,
						"Browser navigation target is not public.",
						"Browser worker requested a blocked network target.",
					);
					break;
				}
				const pendingApproval = {
					approvalId: this.generatedId("approval"),
					origin: origin.origin,
					requestedAt: event.timestamp,
				};
				this.current = { ...this.requiredState(), status: "waiting-approval", pendingApproval };
				await this.record(
					"APPROVAL_REQUESTED",
					"A new browser origin requires user approval.",
					"waiting-approval",
					{
						approvalId: pendingApproval.approvalId,
						origin: pendingApproval.origin,
					},
				);
				break;
			}
			case "origin_approved": {
				const pending = this.current?.pendingApproval;
				if (!pending || pending.origin !== event.origin) {
					await this.failActive(
						active,
						"Browser worker protocol failed.",
						"Browser worker approved an unexpected origin.",
					);
					break;
				}
				this.current = { ...this.requiredState(), status: "running", pendingApproval: undefined };
				await this.record("APPROVAL_RESOLVED", "User approved the pending origin.", "running", {
					approvalId: pending.approvalId,
					origin: pending.origin,
					decision: "approved",
					scope: event.scope,
				});
				break;
			}
			case "run_completed": {
				const summary = event.result.present
					? `Browser run completed; result metadata reports ${event.result.length} bytes.`
					: "Browser run completed without result content.";
				this.current = {
					...this.requiredState(),
					resultSummary: summary,
					resultMetadata: { ...event.result },
				};
				await this.completeActive(active, summary);
				break;
			}
			case "run_failed":
				await this.failActive(active, "Browser run failed.", "Browser worker reported a run failure.");
				break;
			case "run_stopped":
				await this.cancelActive(active, "Browser run stopped.");
				break;
			case "control_granted": {
				if (this.requiredState().control === "human") break;
				this.current = {
					...this.requiredState(),
					control: "human",
					controlReason: event.reason,
				};
				await this.record(
					"CONTROL_GRANTED",
					"Human control is now active; the agent waits.",
					this.requiredState().status,
					{ reason: event.reason },
				);
				break;
			}
			case "control_resumed": {
				if (this.requiredState().control === "ai") break;
				const { controlReason: _dropped, ...rest } = this.requiredState();
				this.current = { ...rest, control: "ai" };
				await this.record(
					"CONTROL_RESUMED",
					"Human returned control; the agent re-observes the page.",
					this.requiredState().status,
				);
				break;
			}
			case "command_rejected":
				await this.failActive(active, "Browser worker rejected the command.", "Browser worker rejected a command.");
				break;
			case "ready":
			case "command_accepted":
			case "shutdown":
				break;
		}
	}

	private async completeActive(active: ActiveRun, summary: string): Promise<void> {
		if (this.active !== active || active.settled) return;
		active.settled = true;
		const settledAt = this.timestamp();
		this.current = {
			...this.requiredState(),
			status: "completed",
			pendingApproval: undefined,
			settledAt,
			resultSummary: summary,
		};
		try {
			await this.record("RUN_COMPLETED", "Browser run completed.", "completed", {
				result: this.current.resultMetadata,
			});
		} finally {
			await this.cleanup(active, true);
		}
	}

	private async failActive(active: ActiveRun, error: string, reason: string): Promise<void> {
		if (this.active !== active || active.settled) return;
		active.settled = true;
		this.current = {
			...this.requiredState(),
			status: "failed",
			pendingApproval: undefined,
			settledAt: this.timestamp(),
			error,
		};
		try {
			await this.record("RUN_FAILED", reason, "failed");
		} finally {
			await this.cleanup(active);
		}
	}

	private async cancelActive(active: ActiveRun, reason: string): Promise<void> {
		if (this.active !== active || active.settled) return;
		active.settled = true;
		this.current = {
			...this.requiredState(),
			status: "cancelled",
			pendingApproval: undefined,
			settledAt: this.timestamp(),
			resultSummary: "Browser run was stopped.",
		};
		try {
			await this.record("RUN_CANCELLED", reason, "cancelled");
		} finally {
			await this.cleanup(active, true);
		}
	}

	private async record(
		event: BrowserEventType,
		reason: string,
		status: BrowserRunStatus,
		details?: unknown,
	): Promise<void> {
		const state = this.requiredState();
		const record = this.sequencer.next({
			event,
			runId: state.runId,
			taskId: state.taskId,
			correlationId: state.correlationId,
			...(state.sessionId ? { sessionId: state.sessionId } : {}),
			agentId: state.agentId,
			status,
			reason,
			...(details === undefined ? {} : { details }),
		});
		this.current = { ...state, status, updatedAt: record.timestamp };
		await this.appendEvent(this.cwd, record);
		if (this.onEvent) {
			try {
				await this.onEvent({ event: record, state: cloneState(this.requiredState()) });
			} catch {
				// A desktop observer must not compromise run settlement or audit ordering.
			}
		}
	}

	private cleanup(active: ActiveRun, retainBrowser = false): Promise<void> {
		if (active.cleanup) return active.cleanup;
		active.unsubscribeEvent();
		active.unsubscribeFailure();
		active.cleanup = (async () => {
			await active.gateway?.close().catch(() => undefined);
			if (retainBrowser && !this.closed) {
				this.browserRunner = active.runner;
				this.unsubscribeIdleFailure = active.runner.subscribeFailure(() => {
					if (this.browserRunner !== active.runner) return;
					this.unsubscribeIdleFailure?.();
					this.unsubscribeIdleFailure = undefined;
					this.browserRunner = undefined;
					void this.queueEvent(async () => {
						this.current = { ...this.requiredState(), browserReset: true };
						await this.record(
							"BROWSER_RESET",
							"Browser worker crashed; the next task starts with a blank page.",
							this.requiredState().status,
						);
					});
					void active.runner.shutdown().catch(() => undefined);
				});
			} else {
				await active.runner.shutdown().catch(() => undefined);
			}
			if (this.active === active) this.active = undefined;
		})();
		return active.cleanup;
	}

	private queueEvent(operation: () => Promise<void>): Promise<void> {
		const queued = this.eventTail.then(operation);
		this.eventTail = queued.catch(() => {
			this.eventError = true;
		});
		return this.eventTail;
	}

	private async flushEvents(): Promise<void> {
		await this.eventTail;
		if (this.eventError) throw new Error("Browser event handling failed.");
	}

	private exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.operationTail.then(operation, operation);
		this.operationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private requireActive(runId: string): ActiveRun {
		if (this.current?.runId !== runId || !this.active || this.active.settled) {
			throw new Error("Browser run is not active.");
		}
		return this.active;
	}

	private requiredState(): BrowserRunPublicState {
		if (!this.current) throw new Error("Browser run state is unavailable.");
		return this.current;
	}

	private generatedId(kind: "run" | "task" | "correlation" | "approval"): string {
		const id = this.createId(kind);
		if (!IDENTIFIER_PATTERN.test(id)) throw new Error(`Generated browser ${kind} ID is invalid.`);
		return id;
	}

	private timestamp(): string {
		const now = this.now();
		return typeof now === "string" ? now : now.toISOString();
	}

	private async assertPublicOrigin(origin: string): Promise<void> {
		const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, "");
		let addresses: readonly string[];
		try {
			addresses = await this.resolveHostname(hostname);
		} catch {
			throw new Error("Browser origin hostname could not be resolved.");
		}
		if (
			addresses.length === 0 ||
			addresses.some((address) => {
				const family = isIP(address);
				return family === 0 || BLOCKED_NETWORKS.check(address, family === 6 ? "ipv6" : "ipv4");
			})
		) {
			throw new Error("Browser origins must resolve only to public network addresses.");
		}
	}
}
