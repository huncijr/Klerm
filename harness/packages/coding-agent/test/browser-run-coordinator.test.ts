import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import type { BrowserAvailability, BrowserEvent } from "../src/klerm/browser-agent.ts";
import { BrowserRunCoordinator, type BrowserRunCoordinatorRunner } from "../src/klerm/browser-run-coordinator.ts";
import type {
	BrowserWorkerApprovalDecision,
	BrowserWorkerEvent,
	BrowserWorkerEventListener,
	BrowserWorkerFailure,
	BrowserWorkerFailureListener,
	BrowserWorkerStartRequest,
} from "../src/klerm/browser-worker-runner.ts";
import type {
	OpenAICompatibleChatServer,
	OpenAICompatibleChatServerOptions,
} from "../src/klerm/openai-compatible-chat.ts";

const model: Model<Api> = {
	id: "browser-model",
	name: "Browser Model",
	api: "faux",
	provider: "faux",
	baseUrl: "http://localhost:0",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 10_000,
};

class FakeRunner implements BrowserRunCoordinatorRunner {
	readonly approvals: BrowserWorkerApprovalDecision[] = [];
	readonly starts: BrowserWorkerStartRequest[] = [];
	readonly stops: string[] = [];
	shutdownCalls = 0;
	private eventListener?: BrowserWorkerEventListener;
	private failureListener?: BrowserWorkerFailureListener;
	private sequence = 0;

	async availability(): Promise<BrowserAvailability> {
		return { available: true, runtime: "fake-browser", version: "1.0.0" };
	}

	subscribe(listener: BrowserWorkerEventListener): () => void {
		this.eventListener = listener;
		return () => {
			if (this.eventListener === listener) this.eventListener = undefined;
		};
	}

	subscribeFailure(listener: BrowserWorkerFailureListener): () => void {
		this.failureListener = listener;
		return () => {
			if (this.failureListener === listener) this.failureListener = undefined;
		};
	}

	async start(request: BrowserWorkerStartRequest): Promise<void> {
		this.starts.push(request);
		this.emit({ ...this.base("run_started", "running"), ...this.runFields() });
	}

	async approve(decision: BrowserWorkerApprovalDecision): Promise<void> {
		this.approvals.push(decision);
		if (decision.decision === "approved") {
			this.emit({
				...this.base("origin_approved", "accepted"),
				...this.runFields(),
				request_id: "worker-request",
				origin: decision.origin,
				scope: decision.scope ?? "allow_once",
			});
		}
	}

	async stop(runId: string): Promise<void> {
		this.stops.push(runId);
		this.emit({ ...this.base("run_stopped", "stopped"), ...this.runFields() });
	}

	async shutdown(): Promise<void> {
		this.shutdownCalls += 1;
	}

	requestOrigin(origin: string): void {
		this.emit({
			...this.base("origin_approval_required", "paused"),
			...this.runFields(),
			origin,
			choices: ["allow_once", "current_run"],
		});
	}

	plan(actions: string[]): void {
		this.emit({ ...this.base("step_planned", "running"), ...this.runFields(), actions });
	}

	complete(present = true): void {
		this.emit({
			...this.base("run_completed", "completed"),
			...this.runFields(),
			result: { present, length: present ? 42 : 0, sha256: present ? "a".repeat(64) : null },
		});
	}

	failRun(error: string): void {
		this.emit({ ...this.base("run_failed", "failed"), ...this.runFields(), error });
	}

	failProcess(failure: BrowserWorkerFailure): void {
		this.failureListener?.(failure);
	}

	private base<Event extends BrowserWorkerEvent["event"], Status extends string>(event: Event, status: Status) {
		return {
			version: 1 as const,
			sequence: ++this.sequence,
			event,
			status,
			timestamp: `2026-09-23T10:00:${String(this.sequence).padStart(2, "0")}.000Z`,
		};
	}

	private runFields() {
		const request = this.starts[0];
		if (!request) throw new Error("Fake run has not started.");
		return {
			run_id: request.runId,
			task_id: request.taskId,
			correlation_id: request.correlationId,
			agent_id: request.agentId,
		};
	}

	private emit(event: BrowserWorkerEvent): void {
		this.eventListener?.(event);
	}
}

function runtime(models: readonly Model<Api>[] = [model]) {
	return {
		getAvailableSnapshot: () => models,
		completeSimple: vi.fn(),
	} as unknown as Pick<ModelRuntime, "completeSimple" | "getAvailableSnapshot">;
}

function deterministicIds() {
	const counts = { run: 0, task: 0, correlation: 0, approval: 0 };
	return (kind: keyof typeof counts) => `${kind}-${++counts[kind]}`;
}

function clock() {
	let tick = 0;
	return () => `2026-09-23T11:00:${String(tick++).padStart(2, "0")}.000Z`;
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for coordinator state.");
}

function setup(options: { models?: readonly Model<Api>[] } = {}) {
	const runner = new FakeRunner();
	const audit: BrowserEvent[] = [];
	const callbacks: BrowserEvent[] = [];
	const gatewayClose = vi.fn(async () => undefined);
	let gatewayOptions: OpenAICompatibleChatServerOptions | undefined;
	const startGateway = vi.fn(async (received: OpenAICompatibleChatServerOptions) => {
		gatewayOptions = received;
		return {
			url: "http://127.0.0.1:43210/v1",
			token: "ephemeral-gateway-token",
			close: gatewayClose,
		} satisfies OpenAICompatibleChatServer;
	});
	const coordinator = new BrowserRunCoordinator({
		cwd: "/workspace",
		modelRuntime: runtime(options.models),
		createRunner: () => runner,
		startGateway,
		appendEvent: async (_cwd, event) => {
			await new Promise((resolve) => setTimeout(resolve, event.sequence % 2));
			audit.push(event);
		},
		onEvent: async ({ event }) => {
			await Promise.resolve();
			callbacks.push(event);
		},
		createId: deterministicIds(),
		now: clock(),
		resolveHostname: async () => ["93.184.216.34"],
	});
	return { audit, callbacks, coordinator, gatewayClose, gatewayOptions: () => gatewayOptions, runner, startGateway };
}

const startInput = {
	model: "faux/browser-model",
	prompt: "Summarize the public page without exposing prompt-secret.",
	startUrl: "https://EXAMPLE.com:443/docs?q=public",
	maxSteps: 12,
} as const;

describe("BrowserRunCoordinator", () => {
	it("pins one exact available model and emits ordered credential-free public state", async () => {
		const context = setup();
		const started = await context.coordinator.start(startInput);

		expect(started).toMatchObject({
			runId: "run-1",
			taskId: "task-1",
			correlationId: "correlation-1",
			agentId: "browser-agent",
			model: "faux/browser-model",
			status: "running",
			startUrl: "https://example.com/docs?q=public",
		});
		expect(context.gatewayOptions()?.pinnedModel).toBe(model);
		expect(context.runner.starts[0]).toMatchObject({
			runId: "run-1",
			taskId: "task-1",
			correlationId: "correlation-1",
			agentId: "browser-agent",
			model: "faux/browser-model",
			startUrl: "https://example.com/docs?q=public",
			allowedOrigins: ["https://example.com"],
			baseUrl: "http://127.0.0.1:43210/v1",
			token: "ephemeral-gateway-token",
		});
		const serializedState = JSON.stringify(context.coordinator.state());
		expect(serializedState).not.toContain("prompt-secret");
		expect(serializedState).not.toContain("ephemeral-gateway-token");
		expect(context.audit.map((event) => event.event)).toEqual(["RUN_REQUESTED", "RUN_STARTED"]);
		expect(context.callbacks).toEqual(context.audit);
		for (const event of context.audit) {
			expect(event).toMatchObject({
				runId: "run-1",
				taskId: "task-1",
				correlationId: "correlation-1",
				agentId: "browser-agent",
			});
			expect(event.reason).toBeTruthy();
			expect(event.status).toBeTruthy();
		}
		await expect(context.coordinator.start(startInput)).rejects.toThrow("already active");

		context.runner.complete();
		await waitFor(() => context.runner.shutdownCalls === 1);
		expect(context.coordinator.state()).toMatchObject({
			status: "completed",
			resultSummary: "Browser run completed; result metadata reports 42 bytes.",
			resultMetadata: { present: true, length: 42, sha256: "a".repeat(64) },
		});
		expect(context.gatewayClose).toHaveBeenCalledOnce();
		expect(context.runner.shutdownCalls).toBe(1);
	});

	it("rejects unavailable and ambiguous model references before creating a gateway", async () => {
		const duplicate = { ...model, provider: "other", name: "Other Browser Model" };
		const ambiguous = setup({ models: [model, duplicate] });
		await expect(ambiguous.coordinator.start({ ...startInput, model: "browser-model" })).rejects.toThrow("ambiguous");
		expect(ambiguous.startGateway).not.toHaveBeenCalled();

		const missing = setup();
		await expect(missing.coordinator.start({ ...startInput, model: "faux/missing" })).rejects.toThrow("unavailable");
		expect(missing.startGateway).not.toHaveBeenCalled();
	});

	it("rejects origins that resolve to private network addresses", async () => {
		const context = setup();
		const blocked = new BrowserRunCoordinator({
			cwd: "/workspace",
			modelRuntime: runtime(),
			createRunner: () => context.runner,
			startGateway: context.startGateway,
			appendEvent: async () => undefined,
			resolveHostname: async () => ["127.0.0.1"],
		});
		await expect(blocked.start(startInput)).rejects.toThrow("public network");
		expect(context.startGateway).not.toHaveBeenCalled();
	});

	it("rejects IPv4-mapped private addresses without blocking mapped public addresses", async () => {
		const context = setup();
		const blocked = new BrowserRunCoordinator({
			cwd: "/workspace",
			modelRuntime: runtime(),
			createRunner: () => context.runner,
			startGateway: context.startGateway,
			appendEvent: async () => undefined,
			resolveHostname: async () => ["::ffff:7f00:1"],
		});
		await expect(blocked.start(startInput)).rejects.toThrow("public network");

		const allowed = setup();
		const publicCoordinator = new BrowserRunCoordinator({
			cwd: "/workspace",
			modelRuntime: runtime(),
			createRunner: () => allowed.runner,
			startGateway: allowed.startGateway,
			appendEvent: async () => undefined,
			resolveHostname: async () => ["::ffff:5db8:d822"],
		});
		await expect(publicCoordinator.start(startInput)).resolves.toMatchObject({ status: "running" });
		await publicCoordinator.close();
	});

	it("approves only the exact pending origin and bounds the public action history", async () => {
		const context = setup();
		const started = await context.coordinator.start(startInput);
		context.runner.requestOrigin("https://docs.example.com");
		await waitFor(() => context.coordinator.state()?.status === "waiting-approval");
		const pending = context.coordinator.state()?.pendingApproval;
		expect(pending).toMatchObject({ approvalId: "approval-1", origin: "https://docs.example.com" });
		await expect(
			context.coordinator.approve({
				runId: started.runId,
				approvalId: "approval-wrong",
				decision: "approved",
			}),
		).rejects.toThrow("not pending");

		const approved = await context.coordinator.approve({
			runId: started.runId,
			approvalId: "approval-1",
			decision: "approved",
			scope: "current_run",
		});
		expect(approved.status).toBe("running");
		expect(approved.pendingApproval).toBeUndefined();
		expect(context.runner.approvals[0]).toMatchObject({
			approvalId: "approval-1",
			origin: "https://docs.example.com",
			scope: "current_run",
		});

		for (let index = 0; index < 25; index += 1) context.runner.plan([`action-${index}`]);
		await waitFor(() => context.coordinator.state()?.lastActions.at(-1) === "action-24");
		expect(context.coordinator.state()?.lastActions).toEqual(
			Array.from({ length: 20 }, (_value, index) => `action-${index + 5}`),
		);
		await context.coordinator.close();
	});

	it("denies an origin by stopping and settles only once across stop and close", async () => {
		const context = setup();
		const started = await context.coordinator.start(startInput);
		context.runner.requestOrigin("https://other.example.com");
		await waitFor(() => context.coordinator.state()?.pendingApproval !== undefined);

		const denied = await context.coordinator.approve({
			runId: started.runId,
			approvalId: "approval-1",
			decision: "denied",
		});
		expect(denied.status).toBe("cancelled");
		expect(context.runner.stops).toEqual([started.runId]);
		expect(context.audit.filter((event) => event.event === "RUN_CANCELLED")).toHaveLength(1);
		await context.coordinator.close();
		expect(context.gatewayClose).toHaveBeenCalledOnce();
		expect(context.runner.shutdownCalls).toBe(1);
	});

	it("settles post-start worker failures without exposing raw provider errors", async () => {
		const context = setup();
		await context.coordinator.start(startInput);
		context.runner.failRun("provider key sk-secret failed for prompt-secret");
		await waitFor(() => context.audit.some((event) => event.event === "RUN_FAILED"));
		await waitFor(() => context.gatewayClose.mock.calls.length === 1);

		expect(context.coordinator.state()?.error).toBe("Browser run failed.");
		const serialized = JSON.stringify({ audit: context.audit, state: context.coordinator.state() });
		expect(serialized).not.toContain("sk-secret");
		expect(serialized).not.toContain("prompt-secret");
		expect(context.audit.filter((event) => event.event === "RUN_FAILED")).toHaveLength(1);
		expect(context.gatewayClose).toHaveBeenCalledOnce();
	});

	it("serializes concurrent stop and close without double settlement", async () => {
		const context = setup();
		const started = await context.coordinator.start(startInput);

		const [stopped] = await Promise.all([context.coordinator.stop(started.runId), context.coordinator.close()]);
		expect(stopped.status).toBe("cancelled");
		expect(context.audit.filter((event) => event.event === "RUN_CANCELLED")).toHaveLength(1);
		expect(context.runner.stops).toEqual([started.runId]);
		expect(context.gatewayClose).toHaveBeenCalledOnce();
		expect(context.runner.shutdownCalls).toBe(1);
	});

	it("uses the sanitized process failure channel and reports isolated availability", async () => {
		const context = setup();
		expect(await context.coordinator.availability()).toEqual({
			available: true,
			runtime: "fake-browser",
			version: "1.0.0",
		});
		expect(context.runner.shutdownCalls).toBe(1);

		await context.coordinator.start(startInput);
		context.runner.failProcess({
			reason: "process-exited",
			message: "The browser worker process exited unexpectedly.",
		});
		await waitFor(() => context.audit.some((event) => event.event === "RUN_FAILED"));
		expect(context.coordinator.state()?.error).toBe("Browser worker process failed.");
		expect(context.audit.at(-1)).toMatchObject({ event: "RUN_FAILED", status: "failed" });
	});
});
