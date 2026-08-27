import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentMessage, type PrepareNextTurnContext } from "@earendil-works/pi-agent-core";
import {
	type Api,
	type AssistantMessage,
	fauxAssistantMessage,
	fauxToolCall,
	type Model,
	type ToolResultMessage,
	type UserMessage,
} from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../src/cli/args.ts";
import { AgentSession } from "../src/core/agent-session.ts";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { KlermConfigStore } from "../src/klerm/config.ts";
import { readKlermRouteDecisionLog } from "../src/klerm/router/decision-log.ts";
import { KlermRoutingController, projectKlermHandoffContext } from "../src/klerm/router/runtime.ts";
import { createTestResourceLoader } from "./utilities.ts";

function createModel(provider: string, id: string, api: Api): Model<Api> {
	return {
		provider,
		id,
		name: id,
		api,
		baseUrl: "http://localhost/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768,
		maxTokens: 4096,
	};
}

function assistantMessage(content: AssistantMessage["content"], source: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: source.api,
		provider: source.provider,
		model: source.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 0,
	};
}

describe("Klerm routing runtime", () => {
	let tempDir: string;
	const local = createModel("ollama", "qwen2.5-coder:7b", "openai-completions");
	const frontier = createModel("google", "gemini-3.5-flash-lite", "google-generative-ai");
	const createRoutingRuntime = (): ModelRuntime =>
		({
			getAvailableSnapshot: () => [local, frontier],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		}) as unknown as ModelRuntime;
	const modelRuntime = createRoutingRuntime();

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "klerm-routing-"));
	});

	afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

	it("parses Klerm A2A CLI flags", () => {
		const args = parseArgs([
			"--routing",
			"auto",
			"--local-model",
			"ollama/qwen2.5-coder:7b",
			"--frontier-model",
			"google/gemini-3.5-flash-lite",
			"--allow-frontier-fallback",
		]);
		expect(args).toMatchObject({
			routing: "auto",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
			allowFrontierFallback: true,
		});
	});

	it("starts the local orchestrator in auto mode", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "auto",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		const transition = await controller.routePrompt("Fix a typo");
		expect(transition?.model).toBe(local);
		await transition?.commit();
		expect(controller.routingState).toMatchObject({
			task: "Fix a typo",
			lane: "local",
			delegationRecommended: false,
			selectedTarget: "ollama/qwen2.5-coder:7b",
			completionOwner: "local",
			delegationCycle: 0,
			reason: "auto mode starts local orchestrator to assess the task and delegate when needed",
		});
		expect(controller.routingState.otherModelCalled).toBeUndefined();
		expect(controller.getSystemPromptContribution()).toContain("Auto mode starts with you as the local orchestrator");
		const decisions = (await readKlermRouteDecisionLog(tempDir))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(decisions[0]).toMatchObject({
			event: "INITIAL_ROUTE",
			route: "LOCAL",
			selectedTarget: "ollama/qwen2.5-coder:7b",
			completionOwner: "local",
			reason: "auto mode starts local orchestrator to assess the task and delegate when needed",
		});
	});

	it("logs deterministic model response token and cost metadata", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen2.5-coder:7b",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await (await controller.routePrompt("Record response accounting"))?.commit();
		const reported = assistantMessage([{ type: "text", text: "done" }], local);
		reported.responseModel = "qwen-resolved";
		reported.usage = {
			input: 11,
			output: 5,
			cacheRead: 3,
			cacheWrite: 2,
			reasoning: 1,
			totalTokens: 21,
			cost: { input: 0.004, output: 0.005, cacheRead: 0.001, cacheWrite: 0.002, total: 0.012 },
		};
		await controller.recordModelResponse(reported);
		const unavailable = assistantMessage([{ type: "text", text: "no usage" }], local);
		unavailable.usage = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		await controller.recordModelResponse(unavailable);

		const responses = (await readKlermRouteDecisionLog(tempDir))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.filter((decision) => decision.event === "MODEL_RESPONSE");
		expect(responses).toHaveLength(2);
		expect(responses[0]).toMatchObject({
			route: "LOCAL",
			provider: "ollama",
			model: "qwen-resolved",
			inputTokens: 11,
			outputTokens: 5,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			reasoningTokens: 1,
			totalTokens: 21,
			costUsd: 0.012,
			costSource: "model-catalog",
			usageAvailable: true,
		});
		expect(responses[1]).toMatchObject({
			provider: "ollama",
			model: "qwen2.5-coder:7b",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalTokens: 0,
			costUsd: 0,
			costSource: "unavailable",
			usageAvailable: false,
		});
	});

	it.each([
		{
			activeStartLane: "local" as const,
			expectedModel: local,
			expectedRoute: "LOCAL",
			expectedOwner: "local",
			expectedReason: "active start lane forced local",
		},
		{
			activeStartLane: "frontier" as const,
			expectedModel: frontier,
			expectedRoute: "FRONTIER",
			expectedOwner: "frontier",
			expectedReason: "active start lane forced frontier",
		},
		{
			activeStartLane: "frontier-local" as const,
			expectedModel: frontier,
			expectedRoute: "FRONTIER",
			expectedOwner: "local",
			expectedReason: "active start lane begins with frontier and requires local completion",
		},
	])("forces the $activeStartLane initial lane", async (scenario) => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "off",
			activeStartLane: scenario.activeStartLane,
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
			handbackEnabled: false,
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);

		const transition = await controller.routePrompt("Use the configured start lane");

		expect(transition?.model).toBe(scenario.expectedModel);
		await transition?.commit();
		expect(controller.routingState).toMatchObject({
			activeStartLane: scenario.activeStartLane,
			lane: scenario.expectedRoute.toLowerCase(),
			completionOwner: scenario.expectedOwner,
			reason: scenario.expectedReason,
		});
		if (scenario.activeStartLane === "frontier-local") {
			expect(controller.getSystemPromptContribution()).toContain("call return_to_local alone");
		}
		const [decision] = (await readKlermRouteDecisionLog(tempDir))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(decision).toMatchObject({
			event: "INITIAL_ROUTE",
			activeStartLane: scenario.activeStartLane,
			route: scenario.expectedRoute,
			completionOwner: scenario.expectedOwner,
			handbackEnabled: scenario.activeStartLane === "frontier-local",
		});
	});

	it("returns a frontier-local task to local before completion", async () => {
		const localFaux = registerFauxProvider({ provider: "ollama", models: [{ id: "qwen:local" }] });
		const frontierFaux = registerFauxProvider({ provider: "openai-codex", models: [{ id: "gpt:frontier" }] });
		const localModel = localFaux.getModel();
		const frontierModel = frontierFaux.getModel();
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "off",
			activeStartLane: "frontier-local",
			localModel: "ollama/qwen:local",
			frontierModel: "openai-codex/gpt:frontier",
			handbackEnabled: false,
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: localModel, systemPrompt: "test", tools: [], thinkingLevel: "off" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			frontierFaux.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("return_to_local", {
							reason: "frontier pass complete",
							frontierSummary: "implemented the specialist change",
							frontierAnswer: "draft result",
							changedFiles: ["src/change.ts"],
							verification: ["targeted test passed"],
							openIssues: [],
							recommendedNextAction: "finalize",
						}),
					],
					{ stopReason: "toolUse" },
				),
			]);
			localFaux.setResponses([fauxAssistantMessage("Verified and complete.")]);

			await session.prompt("Start with frontier, then finalize locally");

			expect(frontierFaux.state.callCount).toBe(1);
			expect(localFaux.state.callCount).toBe(1);
			const decisions = (await readKlermRouteDecisionLog(tempDir))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { event: string; activeStartLane?: string });
			expect(decisions.map((decision) => decision.event)).toEqual([
				"INITIAL_ROUTE",
				"FRONTIER_STARTED",
				"MODEL_RESPONSE",
				"FRONTIER_COMPLETED",
				"RETURN_TO_LOCAL",
				"LOCAL_RESUMED",
				"MODEL_RESPONSE",
				"TASK_COMPLETED",
			]);
			expect(decisions.every((decision) => decision.activeStartLane === "frontier-local")).toBe(true);
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("returns a normal frontier start to local when handback is enabled", async () => {
		const localFaux = registerFauxProvider({ provider: "ollama", models: [{ id: "qwen:local" }] });
		const frontierFaux = registerFauxProvider({ provider: "openai-codex", models: [{ id: "gpt:frontier" }] });
		const localModel = localFaux.getModel();
		const frontierModel = frontierFaux.getModel();
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "off",
			activeStartLane: "frontier",
			localModel: "ollama/qwen:local",
			frontierModel: "openai-codex/gpt:frontier",
			handbackEnabled: true,
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: localModel, systemPrompt: "test", tools: [], thinkingLevel: "off" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			frontierFaux.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("return_to_local", {
							reason: "frontier start complete",
							frontierSummary: "completed the main implementation",
							frontierAnswer: "draft result",
							changedFiles: ["src/change.ts"],
							verification: ["targeted test passed"],
							openIssues: [],
							recommendedNextAction: "finalize",
						}),
					],
					{ stopReason: "toolUse" },
				),
			]);
			localFaux.setResponses([fauxAssistantMessage("Verified locally and complete.")]);

			await session.prompt("Start with frontier and use normal handback");

			expect(controller.routingState).toMatchObject({
				lane: "direct",
				completionOwner: "local",
				activeStartLane: "frontier",
			});
			const decisions = (await readKlermRouteDecisionLog(tempDir))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { event: string; completionOwner?: string });
			expect(decisions.map((decision) => decision.event)).toEqual([
				"INITIAL_ROUTE",
				"FRONTIER_STARTED",
				"MODEL_RESPONSE",
				"FRONTIER_COMPLETED",
				"RETURN_TO_LOCAL",
				"LOCAL_RESUMED",
				"MODEL_RESPONSE",
				"TASK_COMPLETED",
			]);
			expect(decisions.every((decision) => decision.completionOwner === "local")).toBe(true);
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("runs a frontier-owned local delegation and returns to frontier", async () => {
		const localFaux = registerFauxProvider({ provider: "ollama", models: [{ id: "qwen:local" }] });
		const frontierFaux = registerFauxProvider({ provider: "openai-codex", models: [{ id: "gpt:frontier" }] });
		const localModel = localFaux.getModel();
		const frontierModel = frontierFaux.getModel();
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "off",
			localModel: "ollama/qwen:local",
			frontierModel: "openai-codex/gpt:frontier",
			handbackEnabled: true,
			maxDelegationCycles: 3,
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: frontierModel, systemPrompt: "test", tools: [], thinkingLevel: "off" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			let frontierOwnerPrompt = "";
			let localWorkerPrompt = "";
			frontierFaux.setResponses([
				(context) => {
					frontierOwnerPrompt = context.systemPrompt ?? "";
					return fauxAssistantMessage(
						[
							fauxToolCall("delegate_local", {
								reason: "run focused local verification",
								summary: "frontier implementation complete",
								remainingWork: "inspect and verify the local project state",
							}),
						],
						{ stopReason: "toolUse" },
					);
				},
				fauxAssistantMessage("Reviewed the local return and finalized the answer."),
			]);
			localFaux.setResponses([
				(context) => {
					localWorkerPrompt = context.systemPrompt ?? "";
					return fauxAssistantMessage(
						[
							fauxToolCall("return_to_frontier", {
								reason: "focused verification complete",
								localSummary: "verified the project state",
								localAnswer: "verification passed",
								changedFiles: [],
								verification: ["targeted test passed"],
								openIssues: [],
								recommendedNextAction: "finalize",
							}),
						],
						{ stopReason: "toolUse" },
					);
				},
			]);

			await session.prompt("Delegate one focused check to local", { routingOverride: "frontier" });

			expect(frontierFaux.state.callCount).toBe(2);
			expect(localFaux.state.callCount).toBe(1);
			expect(frontierOwnerPrompt).toContain("Call delegate_local alone");
			expect(localWorkerPrompt).toContain("call return_to_frontier alone");
			expect(controller.routingState).toMatchObject({
				lane: "direct",
				completionOwner: "frontier",
				delegationCycle: 1,
				maxDelegationCycles: 3,
			});
			const decisions = (await readKlermRouteDecisionLog(tempDir))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { event: string; completionOwner?: string });
			expect(decisions.map((decision) => decision.event)).toEqual([
				"INITIAL_ROUTE",
				"FRONTIER_STARTED",
				"MODEL_RESPONSE",
				"DELEGATE_LOCAL",
				"LOCAL_STARTED",
				"MODEL_RESPONSE",
				"RETURN_TO_FRONTIER",
				"FRONTIER_RESUMED",
				"MODEL_RESPONSE",
				"TASK_COMPLETED",
			]);
			expect(decisions.every((decision) => decision.completionOwner === "frontier")).toBe(true);
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("enforces a missing local return to the frontier owner", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "off",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
			handbackEnabled: true,
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await (await controller.routePrompt("Run one local check", "frontier"))?.commit();
		controller.requestLocalDelegation({
			reason: "focused local check",
			summary: "frontier setup complete",
			remainingWork: "verify locally",
		});
		const frontierTurn = {
			message: assistantMessage([], frontier),
			toolResults: [],
			context: { systemPrompt: "", messages: [], tools: [] },
			newMessages: [],
		} as PrepareNextTurnContext;
		await (await controller.prepareNextTurn(frontierTurn))?.commit();

		const transition = await controller.enforceRequiredFrontierReturn("Local verification passed.");

		expect(transition?.model).toBe(frontier);
		expect(transition?.handoffPrompt).toContain("Klerm enforced local return");
		await transition?.commit();
		expect(controller.routingState).toMatchObject({
			lane: "frontier",
			completionOwner: "frontier",
			delegationCycle: 1,
			handoffReason: "local completed without a native return_to_frontier call; Klerm enforced the handback",
		});
		const events = (await readKlermRouteDecisionLog(tempDir))
			.trim()
			.split("\n")
			.map((line) => (JSON.parse(line) as { event: string }).event);
		expect(events).toContain("RETURN_TO_FRONTIER");
		expect(events).toContain("FRONTIER_RESUMED");
	});

	it("rejects frontier-local startup when the configured local model is unavailable", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "off",
			activeStartLane: "frontier-local",
			localModel: "ollama/missing",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);

		await expect(controller.routePrompt("Require a local final pass")).rejects.toThrow(
			'Model "ollama/missing" is unavailable',
		);
	});

	it("fails a frontier-local task if the local handback target disappears", async () => {
		let availableModels = [local, frontier];
		const runtime = {
			getAvailableSnapshot: () => availableModels,
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "off",
			activeStartLane: "frontier-local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		await (await controller.routePrompt("Require a local final pass"))?.commit();
		availableModels = [frontier];
		controller.requestReturnToLocal({
			reason: "frontier pass complete",
			frontierSummary: "done",
			frontierAnswer: "draft",
			changedFiles: [],
			verification: [],
			openIssues: [],
			recommendedNextAction: "finalize",
		});
		const turn = {
			message: assistantMessage([], frontier),
			toolResults: [],
			context: { systemPrompt: "", messages: [], tools: [] },
			newMessages: [],
		} as PrepareNextTurnContext;

		await expect(controller.prepareNextTurn(turn)).rejects.toThrow(
			"Frontier-local task cannot complete because the local handback model is unavailable",
		);
		expect(await readKlermRouteDecisionLog(tempDir)).toContain('"event":"HANDOFF_FAILED"');
	});

	it("starts complex tasks with the local orchestrator instead of pre-routing to frontier", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "auto",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);

		const transition = await controller.routePrompt(
			"Design and implement a broad multi-file authentication architecture across the repository",
		);

		expect(transition?.model).toBe(local);
		await transition?.commit();
		expect(controller.routingState).toMatchObject({
			lane: "local",
			delegationRecommended: true,
			decisionSource: "deterministic-policy",
			completionOwner: "local",
			delegationCycle: 0,
			selectedTarget: "ollama/qwen2.5-coder:7b",
		});
		expect(controller.getSystemPromptContribution()).toContain("Klerm recommends frontier delegation for this task.");
		const decisions = (await readKlermRouteDecisionLog(tempDir))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { event: string; route: string; delegationRecommended?: boolean });
		expect(decisions.slice(0, 2)).toEqual([
			expect.objectContaining({ event: "INITIAL_ROUTE", route: "LOCAL", delegationRecommended: true }),
			expect.objectContaining({ event: "LOCAL_STARTED", route: "LOCAL", delegationRecommended: true }),
		]);
	});

	it("enforces the recommended frontier handoff after a forced-local auto start", async () => {
		const localFaux = registerFauxProvider({ provider: "ollama", models: [{ id: "qwen:local" }] });
		const frontierFaux = registerFauxProvider({ provider: "openai-codex", models: [{ id: "gpt:frontier" }] });
		const localModel = localFaux.getModel();
		const frontierModel = frontierFaux.getModel();
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "auto",
			activeStartLane: "local",
			localModel: "ollama/qwen:local",
			frontierModel: "openai-codex/gpt:frontier",
			handbackEnabled: true,
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: localModel, systemPrompt: "test", tools: [], thinkingLevel: "off" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			let firstLocalSystemPrompt = "";
			localFaux.setResponses([
				(context) => {
					firstLocalSystemPrompt = context.systemPrompt ?? "";
					return fauxAssistantMessage("I can implement these multiple components and files locally.");
				},
				fauxAssistantMessage("The frontier result was verified and the task is complete."),
			]);
			frontierFaux.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("return_to_local", {
							reason: "implementation complete",
							frontierSummary: "created the React and Tailwind project",
							frontierAnswer: "implementation complete",
							changedFiles: ["src/App.tsx"],
							verification: ["build passed"],
							openIssues: [],
							recommendedNextAction: "finalize",
						}),
					],
					{ stopReason: "toolUse" },
				),
			]);

			await session.prompt(
				"Create a React and Tailwind project with multiple components and files, including build and dev setup.",
			);

			expect(firstLocalSystemPrompt).toContain("Klerm recommends frontier delegation for this task.");
			expect(firstLocalSystemPrompt).toContain("Call delegate_frontier before creating or modifying many files.");
			expect(localFaux.state.callCount).toBe(2);
			expect(frontierFaux.state.callCount).toBe(1);
			const decisions = (await readKlermRouteDecisionLog(tempDir))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { event: string; route: string; trigger?: string; reason: string });
			expect(decisions.map((decision) => decision.event)).toEqual([
				"INITIAL_ROUTE",
				"LOCAL_STARTED",
				"MODEL_RESPONSE",
				"DELEGATE_FRONTIER",
				"FRONTIER_STARTED",
				"MODEL_RESPONSE",
				"FRONTIER_COMPLETED",
				"RETURN_TO_LOCAL",
				"LOCAL_RESUMED",
				"MODEL_RESPONSE",
				"TASK_COMPLETED",
			]);
			expect(decisions.find((decision) => decision.event === "DELEGATE_FRONTIER")).toMatchObject({
				trigger: "recommended-enforcement",
				reason: "local orchestrator ignored recommended frontier handoff for complex auto task",
			});
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("keeps a completed local response when recommendation has no available frontier", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "auto",
			localModel: "ollama/qwen2.5-coder:7b",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await (await controller.routePrompt("Create a React project with multiple components and files"))?.commit();

		expect(await controller.enforceRequiredFrontierDelegation("Local work completed.")).toBeUndefined();
		expect(controller.routingState).toMatchObject({ lane: "local", delegationRecommended: true });
		const decisions = (await readKlermRouteDecisionLog(tempDir))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { event: string; reason: string });
		expect(decisions.at(-1)).toMatchObject({
			event: "HANDOFF_REJECTED",
			reason: "recommended frontier handoff skipped because no available frontier model is configured",
		});
	});

	it("does not bypass the local orchestrator when handback is disabled", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "auto",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
			handbackEnabled: false,
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await (await controller.routePrompt("Use specialist knowledge"))?.commit();

		expect(controller.routingState).toMatchObject({
			lane: "local",
			completionOwner: "local",
			handbackEnabled: false,
			delegationCycle: 0,
		});
	});

	it("uses direct frontier fallback only when auto mode has no local model", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "auto",
			frontierModel: "google/gemini-3.5-flash-lite",
			allowFrontierFallback: true,
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);

		const transition = await controller.routePrompt("Use the configured fallback");

		expect(transition?.model).toBe(frontier);
		await transition?.commit();
		expect(controller.routingState).toMatchObject({
			lane: "frontier",
			completionOwner: "frontier",
			reason: "local router is not configured and explicit frontier fallback is enabled",
		});
	});

	it("persists the frontier fallback setter", async () => {
		const store = await KlermConfigStore.load(tempDir);
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);

		await controller.setAllowFrontierFallback(true);

		expect(controller.config.allowFrontierFallback).toBe(true);
		expect(JSON.parse(readFileSync(store.path, "utf8"))).toMatchObject({ allowFrontierFallback: true });
		const reloaded = await KlermConfigStore.load(tempDir);
		expect(reloaded.get().allowFrontierFallback).toBe(true);

		await controller.setAllowFrontierFallback(false);
		expect(controller.config.allowFrontierFallback).toBe(false);

		await controller.setHandbackEnabled(false);
		await controller.setActiveStartLane("frontier-local");
		await controller.setMaxDelegationCycles(99);
		expect(JSON.parse(readFileSync(store.path, "utf8"))).toMatchObject({
			handbackEnabled: false,
			activeStartLane: "frontier-local",
			maxDelegationCycles: 99,
		});
		const policyReloaded = await KlermConfigStore.load(tempDir);
		expect(policyReloaded.get()).toMatchObject({
			handbackEnabled: false,
			activeStartLane: "frontier-local",
			maxDelegationCycles: 99,
		});
		await controller.setMaxDelegationCycles(0);
		expect((await KlermConfigStore.load(tempDir)).get().maxDelegationCycles).toBe(0);
		expect(controller.describe()).toContain("A2A cycles started: 0/unlimited (no cycle limit)");
		await expect(controller.setMaxDelegationCycles(-1)).rejects.toThrow("use 0 for unlimited");
		await store.update({ maxDelegationCycles: -1 });
		expect((await KlermConfigStore.load(tempDir)).get().maxDelegationCycles).toBe(3);
	});

	it("keeps the persisted routing mode after a one-prompt override", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "frontier",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await controller.setRoutingMode("frontier");

		const transition = await controller.routePrompt("Use local once", "local");
		expect(transition?.model).toBe(local);
		await transition?.commit();
		await controller.recordCompletion(true);

		expect(controller.config.routing).toBe("frontier");
		expect(controller.routingState).toMatchObject({ mode: "frontier", lane: "direct" });
		const reloaded = await KlermConfigStore.load(tempDir);
		expect(reloaded.get().routing).toBe("frontier");
	});

	it.each([
		{ lane: "local" as const, initial: "frontier" as const },
		{ lane: "frontier" as const, initial: "local" as const },
	])("forces one $lane task and restores the direct model with routing off", async ({ lane, initial }) => {
		const localFaux = registerFauxProvider({
			provider: "ollama",
			models: [{ id: "qwen2.5-coder:7b", reasoning: initial === "local" }],
		});
		const frontierFaux = registerFauxProvider({
			provider: "google",
			models: [{ id: "gemini-3.5-flash-lite", reasoning: initial === "frontier" }],
		});
		const localModel = localFaux.getModel();
		const frontierModel = frontierFaux.getModel();
		const initialModel = initial === "local" ? localModel : frontierModel;
		const forcedFaux = lane === "local" ? localFaux : frontierFaux;
		const directFaux = initial === "local" ? localFaux : frontierFaux;
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "off",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const settings = SettingsManager.inMemory({
			defaultProvider: initialModel.provider,
			defaultModel: initialModel.id,
		});
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: initialModel, systemPrompt: "test", tools: [], thinkingLevel: "high" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: settings,
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			let routedSystemPrompt = "";
			forcedFaux.setResponses([
				(context) => {
					routedSystemPrompt = context.systemPrompt ?? "";
					return fauxAssistantMessage("forced response");
				},
			]);
			await session.prompt("one forced task", { routingOverride: lane });

			expect(forcedFaux.state.callCount).toBe(1);
			expect(routedSystemPrompt).toContain(
				lane === "local" ? "You are the Klerm local worker" : "You are the Klerm frontier worker",
			);
			expect(routedSystemPrompt).toContain(
				lane === "local"
					? "Configured frontier model: google/gemini-3.5-flash-lite"
					: "Current frontier model: google/gemini-3.5-flash-lite",
			);
			if (lane === "local") {
				expect(routedSystemPrompt).toContain("An explicit user request requires delegation");
			}
			expect(session.model).toBe(initialModel);
			expect(session.thinkingLevel).toBe("high");
			expect(controller.config.routing).toBe("off");
			expect(controller.routingState).toMatchObject({ mode: "off", lane: "direct" });
			expect(settings.getDefaultProvider()).toBe(initialModel.provider);
			expect(settings.getDefaultModel()).toBe(initialModel.id);

			let directSystemPrompt = "";
			directFaux.setResponses([
				(context) => {
					directSystemPrompt = context.systemPrompt ?? "";
					return fauxAssistantMessage("direct response");
				},
			]);
			await session.prompt("normal task");
			expect(directFaux.state.callCount).toBe(initial === lane ? 2 : 1);
			expect(directSystemPrompt).not.toContain("You are the Klerm local worker");
			expect(directSystemPrompt).not.toContain("You are the Klerm frontier worker");

			const decisions = (await readKlermRouteDecisionLog(tempDir))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { event: string; reason: string; mode: string });
			const initialDecision = decisions.find((decision) => decision.event === "INITIAL_ROUTE");
			expect(initialDecision).toMatchObject({
				reason: `interactive task forced ${lane}`,
				mode: "off",
			});
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("hands the same run from local to frontier", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await (await controller.routePrompt("Refactor this module"))?.commit();
		expect(controller.getSystemPromptContribution()).toContain("You are the Klerm local worker");
		expect(controller.getSystemPromptContribution()).toContain("Current local model: ollama/qwen2.5-coder:7b");
		expect(controller.getSystemPromptContribution()).toContain(
			'{"reason":"why frontier is needed","summary":"completed local work and findings","remainingWork":"what frontier must do next"}',
		);
		expect(controller.getSystemPromptContribution()).toContain(
			"Text that resembles a tool call does not execute the tool",
		);
		controller.requestFrontierDelegation({
			reason: "too complex",
			summary: "inspected files",
			remainingWork: "refactor",
		});
		const turn = {
			message: assistantMessage(
				[{ type: "toolCall", id: "delegate", name: "delegate_frontier", arguments: {} }],
				local,
			),
			toolResults: [],
			context: { systemPrompt: "", messages: [], tools: [] },
			newMessages: [],
		} as PrepareNextTurnContext;
		const transition = await controller.prepareNextTurn(turn);
		expect(transition?.model).toBe(frontier);
		await transition?.commit();
		expect(controller.routingState).toMatchObject({
			task: "Refactor this module",
			lane: "frontier",
			selectedTarget: "google/gemini-3.5-flash-lite",
			otherModelCalled: "ollama/qwen2.5-coder:7b",
			handoffReason: "too complex",
		});
		expect(controller.getSystemPromptContribution()).toContain("You are the Klerm frontier worker");
		expect(controller.getSystemPromptContribution()).toContain(
			"Current frontier model: google/gemini-3.5-flash-lite",
		);

		await controller.recordCompletion(true);
		expect(controller.routingState).toMatchObject({
			lane: "direct",
			task: "Refactor this module",
			otherModelCalled: "ollama/qwen2.5-coder:7b",
		});
	});

	it("enforces a Hungarian request for the other model when local only prints a pseudo tool call", async () => {
		const localFaux = registerFauxProvider({
			provider: "ollama",
			models: [{ id: "qwen3.5:9b-q4_K_M" }],
		});
		const frontierFaux = registerFauxProvider({
			provider: "openai-codex",
			models: [{ id: "gpt-5.5" }],
		});
		const localModel = localFaux.getModel();
		const frontierModel = frontierFaux.getModel();
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen3.5:9b-q4_K_M",
			frontierModel: "openai-codex/gpt-5.5",
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: localModel, systemPrompt: "test", tools: [], thinkingLevel: "off" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			localFaux.setResponses([
				fauxAssistantMessage(
					'```typescript\ndelegate_frontier({ instruction: "Ask Codex which model it is" })\n```',
				),
				fauxAssistantMessage("The frontier response was verified and returned."),
			]);
			let frontierSystemPrompt = "";
			let frontierMessages = "";
			frontierFaux.setResponses([
				(context) => {
					frontierSystemPrompt = context.systemPrompt ?? "";
					frontierMessages = JSON.stringify(context.messages);
					return fauxAssistantMessage("I am openai-codex/gpt-5.5.");
				},
			]);

			await session.prompt("Hívd át a másik modellt, és kérdezd meg, milyen modell.");

			expect(localFaux.state.callCount).toBe(2);
			expect(frontierFaux.state.callCount).toBe(1);
			expect(frontierSystemPrompt).toContain("You are the Klerm frontier worker");
			expect(frontierMessages).toContain("Klerm enforced frontier handoff");
			expect(controller.routingState).toMatchObject({
				lane: "direct",
				otherModelCalled: "openai-codex/gpt-5.5",
				handoffReason: "frontier completed without a native return_to_local call; Klerm enforced the handback",
			});
			const decisions = (await readKlermRouteDecisionLog(tempDir))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { event: string; trigger?: string });
			expect(decisions.map((decision) => decision.event)).toContain("DELEGATE_FRONTIER");
			expect(decisions.find((decision) => decision.event === "DELEGATE_FRONTIER")?.trigger).toBe(
				"explicit-enforcement",
			);
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("runs repeated local-frontier-local delegation cycles from auto mode", async () => {
		const localFaux = registerFauxProvider({
			provider: "ollama",
			models: [{ id: "qwen3.5:9b-q4_K_M" }],
		});
		const frontierFaux = registerFauxProvider({
			provider: "openai-codex",
			models: [{ id: "gpt-5.5" }],
		});
		const localModel = { ...localFaux.getModel(), reasoning: true };
		const frontierModel = frontierFaux.getModel();
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "auto",
			localModel: "ollama/qwen3.5:9b-q4_K_M",
			frontierModel: "openai-codex/gpt-5.5",
			handbackEnabled: true,
			maxDelegationCycles: 3,
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: localModel, systemPrompt: "test", tools: [], thinkingLevel: "high" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			localFaux.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("delegate_frontier", {
							reason: "first specialist pass",
							summary: "local inspection complete",
							remainingWork: "implement the first specialist change",
						}),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					[
						fauxToolCall("delegate_frontier", {
							reason: "focused follow-up",
							summary: "first pass verified locally",
							remainingWork: "resolve the remaining specialist issue",
						}),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("Both frontier passes were verified locally."),
			]);
			frontierFaux.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("return_to_local", {
							reason: "first pass complete",
							frontierSummary: "implemented first change",
							frontierAnswer: "first result",
							changedFiles: ["src/first.ts"],
							verification: ["first check passed"],
							openIssues: ["one follow-up remains"],
							recommendedNextAction: "delegate-again",
						}),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					[
						fauxToolCall("return_to_local", {
							reason: "follow-up complete",
							frontierSummary: "resolved final issue",
							frontierAnswer: "final specialist result",
							changedFiles: ["src/second.ts"],
							verification: ["second check passed"],
							openIssues: [],
							recommendedNextAction: "finalize",
						}),
					],
					{ stopReason: "toolUse" },
				),
			]);

			await session.prompt("Coordinate multiple components and files across two specialist passes.");

			expect(localFaux.state.callCount).toBe(3);
			expect(frontierFaux.state.callCount).toBe(2);
			expect(session.model).toBe(localModel);
			expect(session.thinkingLevel).toBe("high");
			expect(controller.routingState).toMatchObject({
				lane: "direct",
				completionOwner: "local",
				delegationCycle: 2,
				maxDelegationCycles: 3,
			});
			const decisions = (await readKlermRouteDecisionLog(tempDir))
				.trim()
				.split("\n")
				.map(
					(line) =>
						JSON.parse(line) as {
							event: string;
							transitionId?: string;
							transcriptHash?: string;
							trigger?: string;
						},
				);
			expect(decisions.map((decision) => decision.event)).toEqual([
				"INITIAL_ROUTE",
				"LOCAL_STARTED",
				"MODEL_RESPONSE",
				"DELEGATE_FRONTIER",
				"FRONTIER_STARTED",
				"MODEL_RESPONSE",
				"FRONTIER_COMPLETED",
				"RETURN_TO_LOCAL",
				"LOCAL_RESUMED",
				"MODEL_RESPONSE",
				"DELEGATE_FRONTIER",
				"FRONTIER_STARTED",
				"MODEL_RESPONSE",
				"FRONTIER_COMPLETED",
				"RETURN_TO_LOCAL",
				"LOCAL_RESUMED",
				"MODEL_RESPONSE",
				"TASK_COMPLETED",
			]);
			expect(
				decisions
					.filter((decision) => decision.event === "DELEGATE_FRONTIER")
					.every((entry) => entry.transitionId !== undefined && entry.transcriptHash !== undefined),
			).toBe(true);
			expect(
				decisions
					.filter((decision) => decision.event === "DELEGATE_FRONTIER")
					.every((decision) => decision.trigger === "native-tool"),
			).toBe(true);
			expect(await readKlermRouteDecisionLog(tempDir)).not.toContain("final specialist result");
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("can remove a reached frontier cycle limit and continue delegating", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
			maxDelegationCycles: 1,
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await (await controller.routePrompt("Use at most one specialist pass"))?.commit();
		controller.requestFrontierDelegation({ reason: "first", summary: "ready", remainingWork: "work" });
		const localTurn = {
			message: assistantMessage([], local),
			toolResults: [],
			context: { systemPrompt: "", messages: [], tools: [] },
			newMessages: [],
		} as PrepareNextTurnContext;
		await (await controller.prepareNextTurn(localTurn))?.commit();
		controller.requestReturnToLocal({
			reason: "done",
			frontierSummary: "done",
			frontierAnswer: "done",
			changedFiles: [],
			verification: [],
			openIssues: [],
			recommendedNextAction: "finalize",
		});
		const frontierTurn = { ...localTurn, message: assistantMessage([], frontier) } as PrepareNextTurnContext;
		await (await controller.prepareNextTurn(frontierTurn))?.commit();
		controller.requestFrontierDelegation({ reason: "second", summary: "again", remainingWork: "more" });

		expect(await controller.prepareNextTurn(localTurn)).toBeUndefined();
		expect(controller.routingState).toMatchObject({ lane: "local", delegationCycle: 1 });
		expect(await readKlermRouteDecisionLog(tempDir)).toContain('"event":"HANDOFF_REJECTED"');

		await controller.setMaxDelegationCycles(0);
		controller.requestFrontierDelegation({ reason: "unlimited", summary: "again", remainingWork: "more" });
		const unlimitedTransition = await controller.prepareNextTurn(localTurn);
		expect(unlimitedTransition?.model).toBe(frontier);
		await unlimitedTransition?.commit();
		expect(controller.routingState).toMatchObject({
			lane: "frontier",
			delegationCycle: 2,
			maxDelegationCycles: 0,
		});
	});

	it("blocks a routing tool when the model batches it with another tool", async () => {
		const localFaux = registerFauxProvider({ provider: "ollama", models: [{ id: "qwen:local" }] });
		const frontierFaux = registerFauxProvider({ provider: "openai-codex", models: [{ id: "gpt:frontier" }] });
		const localModel = localFaux.getModel();
		const frontierModel = frontierFaux.getModel();
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen:local",
			frontierModel: "openai-codex/gpt:frontier",
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: localModel, systemPrompt: "test", tools: [], thinkingLevel: "off" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			localFaux.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("delegate_frontier", {
							reason: "specialist",
							summary: "ready",
							remainingWork: "finish",
						}),
						fauxToolCall("read", { path: "README.md" }),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("Retried without mixing routing and work tools."),
			]);

			await session.prompt("Use a specialist safely");

			expect(localFaux.state.callCount).toBe(2);
			expect(frontierFaux.state.callCount).toBe(0);
			expect(JSON.stringify(agent.state.messages)).toContain("Klerm routing tools must be called alone");
			expect(await readKlermRouteDecisionLog(tempDir)).not.toContain('"event":"DELEGATE_FRONTIER"');
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("rejects wrong-lane and duplicate native routing tool calls", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await (await controller.routePrompt("Delegate once"))?.commit();
		const [delegate, returnToLocal] = controller.createRoutingTools();
		const delegation = { reason: "specialist", summary: "ready", remainingWork: "finish" };
		const returned = {
			reason: "done",
			frontierSummary: "done",
			frontierAnswer: "done",
			changedFiles: [],
			verification: [],
			openIssues: [],
			recommendedNextAction: "finalize" as const,
		};

		await expect(
			returnToLocal.execute("return-wrong-lane", returned, undefined, undefined, undefined as never),
		).rejects.toThrow("frontier worker");
		await delegate.execute("delegate", delegation, undefined, undefined, undefined as never);
		await expect(
			delegate.execute("delegate-again", delegation, undefined, undefined, undefined as never),
		).rejects.toThrow("already pending");
		const turn = {
			message: assistantMessage([], local),
			toolResults: [],
			context: { systemPrompt: "", messages: [], tools: [] },
			newMessages: [],
		} as PrepareNextTurnContext;
		await (await controller.prepareNextTurn(turn))?.commit();
		await expect(
			delegate.execute("delegate-wrong-lane", delegation, undefined, undefined, undefined as never),
		).rejects.toThrow("local worker");
		await returnToLocal.execute("return", returned, undefined, undefined, undefined as never);
	});

	it("keeps the source model and lane when a routed model cannot authenticate", async () => {
		const localFaux = registerFauxProvider({ provider: "ollama", models: [{ id: "qwen:local" }] });
		const frontierFaux = registerFauxProvider({ provider: "openai-codex", models: [{ id: "gpt:frontier" }] });
		const localModel = localFaux.getModel();
		const frontierModel = frontierFaux.getModel();
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async (provider: string) => (provider === "openai-codex" ? undefined : { source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen:local",
			frontierModel: "openai-codex/gpt:frontier",
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: localModel, systemPrompt: "test", tools: [], thinkingLevel: "off" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			localFaux.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("delegate_frontier", {
							reason: "specialist",
							summary: "local work complete",
							remainingWork: "finish remotely",
						}),
					],
					{ stopReason: "toolUse" },
				),
			]);
			await session.prompt("Start locally, then delegate");
			expect(session.model).toBe(localModel);
			expect(controller.routingState.lane).toBe("direct");
			const log = await readKlermRouteDecisionLog(tempDir);
			expect(log).toContain('"event":"HANDOFF_FAILED"');
			expect(log).toContain('"event":"TASK_FAILED"');
			expect(log).not.toContain('"event":"TASK_COMPLETED"');
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("does not delegate when the user aborts a local response", async () => {
		const localFaux = registerFauxProvider({ provider: "ollama", models: [{ id: "qwen:local" }] });
		const frontierFaux = registerFauxProvider({ provider: "openai-codex", models: [{ id: "gpt:frontier" }] });
		const localModel = localFaux.getModel();
		const frontierModel = frontierFaux.getModel();
		const runtime = {
			getAvailableSnapshot: () => [localModel, frontierModel],
			checkAuth: async () => ({ source: "config" }),
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
		} as unknown as ModelRuntime;
		const store = await KlermConfigStore.load(tempDir, {
			routing: "auto",
			localModel: "ollama/qwen:local",
			frontierModel: "openai-codex/gpt:frontier",
		});
		const controller = new KlermRoutingController(tempDir, runtime, store);
		const agent = new Agent({
			streamFn: streamSimple,
			initialState: { model: localModel, systemPrompt: "test", tools: [], thinkingLevel: "off" },
		});
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime: runtime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});

		try {
			localFaux.setResponses([fauxAssistantMessage("", { stopReason: "aborted" })]);
			await session.prompt("Create a React project with multiple components and files, then stop when cancelled");

			expect(localFaux.state.callCount).toBe(1);
			expect(frontierFaux.state.callCount).toBe(0);
			const log = await readKlermRouteDecisionLog(tempDir);
			expect(log).not.toContain('"event":"DELEGATE_FRONTIER"');
			expect(log).toContain('"event":"TASK_FAILED"');
		} finally {
			session.dispose();
			localFaux.unregister();
			frontierFaux.unregister();
		}
	});

	it("escalates a local provider failure to frontier", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await (await controller.routePrompt("Fix the failing test"))?.commit();
		const transition = await controller.handleLocalFailure("connection reset");
		expect(transition?.model).toBe(frontier);
		expect(transition?.reason).toContain("connection reset");
	});

	it("returns a frontier provider failure to local with an explicit recovery packet", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await (await controller.routePrompt("Recover from a frontier outage"))?.commit();
		controller.requestFrontierDelegation({ reason: "specialist", summary: "ready", remainingWork: "finish" });
		const turn = {
			message: assistantMessage([], local),
			toolResults: [],
			context: { systemPrompt: "", messages: [], tools: [] },
			newMessages: [],
		} as PrepareNextTurnContext;
		await (await controller.prepareNextTurn(turn))?.commit();

		const transition = await controller.handleFrontierFailure("provider unavailable");

		expect(transition?.model).toBe(local);
		expect(transition?.handoffPrompt).toContain("provider unavailable");
		await transition?.commit();
		expect(controller.routingState.lane).toBe("local");
		const events = (await readKlermRouteDecisionLog(tempDir))
			.trim()
			.split("\n")
			.map((line) => (JSON.parse(line) as { event: string }).event);
		expect(events).toContain("RETURN_TO_LOCAL");
		expect(events).not.toContain("FRONTIER_COMPLETED");
	});

	it("projects a local delegation for every frontier request without mutating raw history", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		const transformMarker: AgentMessage = { role: "user", content: "existing transform ran", timestamp: 4 };
		const previousTransform = vi.fn(async (messages: AgentMessage[]) => [...messages, transformMarker]);
		const agent = new Agent({
			streamFn: streamSimple,
			transformContext: previousTransform,
			initialState: { model: local, systemPrompt: "test", tools: [], thinkingLevel: "off" },
		});
		const sessionManager = SessionManager.inMemory(tempDir);
		const session = new AgentSession({
			agent,
			sessionManager,
			settingsManager: SettingsManager.inMemory(),
			cwd: tempDir,
			modelRuntime,
			resourceLoader: createTestResourceLoader(),
			klermRoutingController: controller,
		});
		expect(session.systemPrompt).toContain(
			"When acting as the Klerm local worker, use delegate_frontier whenever the user explicitly asks to consult, ask, use, delegate to, or hand off",
		);
		const delegation = {
			reason: "repository-scale change",
			summary: "inspected files and found the failing boundary",
			remainingWork: "implement and verify the provider-neutral fix",
		};
		const call = assistantMessage(
			[
				{ type: "text", text: "I will hand this off.", textSignature: "ollama-text-metadata" },
				{
					type: "toolCall",
					id: "delegate-1",
					name: "delegate_frontier",
					arguments: delegation,
					thoughtSignature: "foreign-thought-signature",
				},
			],
			local,
		);
		const result: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "delegate-1",
			toolName: "delegate_frontier",
			content: [
				{ type: "text", text: "Delegation accepted." },
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
			],
			details: delegation,
			isError: false,
			timestamp: 3,
		};
		const userMessage: UserMessage = {
			role: "user",
			content: [
				{ type: "text", text: "Refactor this module" },
				{ type: "image", data: "dXNlcg==", mimeType: "image/png" },
			],
			timestamp: 1,
		};
		const rawMessages: AgentMessage[] = [userMessage, call, result];
		sessionManager.appendMessage(userMessage);
		sessionManager.appendMessage(call);
		sessionManager.appendMessage(result);
		agent.state.messages = rawMessages;

		try {
			await (await controller.routePrompt("Refactor this module"))?.commit();
			controller.requestFrontierDelegation(delegation);
			const nextTurn = await agent.prepareNextTurnWithContext?.({
				message: call,
				toolResults: [result],
				context: { systemPrompt: "test", messages: rawMessages, tools: [] },
				newMessages: [call, result],
			});
			if (!nextTurn?.context) throw new Error("Expected frontier next-turn context");
			expect(nextTurn.model).toBe(frontier);
			expect(nextTurn.context.systemPrompt).toContain("You are the Klerm frontier worker");
			expect(nextTurn.context.systemPrompt).toContain(
				"When the user asks which model you are, identify the current frontier model exactly as google/gemini-3.5-flash-lite.",
			);
			expect(nextTurn.context.systemPrompt).not.toContain("You are the Klerm local worker");

			const request = await agent.buildProviderContext({
				systemPrompt: "test",
				messages: agent.state.messages,
				tools: [],
			});
			const requestJson = JSON.stringify(request.messages);
			expect(requestJson).toContain(`Summary: ${delegation.summary}`);
			expect(requestJson).toContain(`Remaining work: ${delegation.remainingWork}`);
			expect(requestJson).toContain("existing transform ran");
			expect(requestJson).not.toContain('"type":"toolCall"');
			expect(requestJson).not.toContain('"role":"toolResult"');
			expect(requestJson).not.toContain("delegate_frontier");
			expect(requestJson).not.toContain("foreign-thought-signature");
			expect(requestJson).not.toContain("ollama-text-metadata");
			const requestImages = request.messages.flatMap((message) => {
				if (message.role === "assistant" || typeof message.content === "string") return [];
				return message.content.filter((part) => part.type === "image");
			});
			expect(requestImages).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: "image", data: "dXNlcg==" }),
					expect.objectContaining({ type: "image", data: "aW1hZ2U=" }),
				]),
			);

			const subsequentRequest = await agent.buildProviderContext({
				systemPrompt: "test",
				messages: agent.state.messages,
				tools: [],
			});
			expect(subsequentRequest.messages).toEqual(request.messages);
			expect(previousTransform).toHaveBeenCalledTimes(2);
			expect(agent.state.messages).toEqual(rawMessages);
			expect(agent.state.messages[1]).toBe(call);
			expect(sessionManager.buildSessionContext().messages).toEqual(rawMessages);
			expect(JSON.stringify(agent.state.messages)).toContain('"type":"toolCall"');
			expect(JSON.stringify(sessionManager.buildSessionContext().messages)).toContain('"role":"toolResult"');
		} finally {
			session.dispose();
		}
	});

	it("projects frontier tool exchanges when routing back to local and skips direct routing", () => {
		const frontierCall = assistantMessage(
			[
				{
					type: "toolCall",
					id: "frontier-call",
					name: "read",
					arguments: { path: "README.md" },
					thoughtSignature: "gemini-signature",
				},
			],
			frontier,
		);
		const frontierResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "frontier-call",
			toolName: "read",
			content: [{ type: "text", text: "README contents" }],
			isError: false,
			timestamp: 2,
		};
		const messages: AgentMessage[] = [frontierCall, frontierResult];
		const localProjection = projectKlermHandoffContext(messages, local, {
			mode: "local",
			activeStartLane: "auto",
			lane: "local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		expect(JSON.stringify(localProjection)).not.toContain('"type":"toolCall"');
		expect(JSON.stringify(localProjection)).not.toContain('"role":"toolResult"');
		expect(JSON.stringify(localProjection)).toContain("README contents");
		expect(messages[0]).toBe(frontierCall);

		const directProjection = projectKlermHandoffContext(messages, local, {
			mode: "off",
			activeStartLane: "auto",
			lane: "direct",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		expect(directProjection).toBe(messages);
	});

	it("matches foreign tool results by chronology when providers reuse a tool-call id", () => {
		const localCall = assistantMessage(
			[{ type: "toolCall", id: "reused-id", name: "read", arguments: { path: "local.txt" } }],
			local,
		);
		const frontierCall = assistantMessage(
			[{ type: "toolCall", id: "reused-id", name: "read", arguments: { path: "frontier.txt" } }],
			frontier,
		);
		const frontierResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "reused-id",
			toolName: "read",
			content: [{ type: "text", text: "frontier result" }],
			isError: false,
			timestamp: 2,
		};
		const projected = projectKlermHandoffContext([localCall, frontierCall, frontierResult], local, {
			mode: "local",
			activeStartLane: "auto",
			lane: "local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});

		expect(projected[0]).toBe(localCall);
		expect(projected[1]?.role).toBe("user");
		expect(projected[2]?.role).toBe("user");
		expect(JSON.stringify(projected[2])).toContain("frontier result");
	});
});
