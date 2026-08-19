import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentMessage, type PrepareNextTurnContext } from "@earendil-works/pi-agent-core";
import {
	type Api,
	type AssistantMessage,
	fauxAssistantMessage,
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
	const modelRuntime = {
		getAvailableSnapshot: () => [local, frontier],
		completeSimple: async () =>
			assistantMessage([{ type: "text", text: '{"route":"LOCAL","complexity":2,"reason":"small edit"}' }], local),
		checkAuth: async () => ({ source: "config" }),
		hasConfiguredAuth: () => true,
		isUsingOAuth: () => false,
	} as unknown as ModelRuntime;

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

	it("uses the local model as router and worker in auto mode", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "auto",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		const transition = await controller.routePrompt("Fix a typo");
		expect(transition?.model).toBe(local);
		expect(controller.routingState).toMatchObject({ lane: "local", selectedTarget: "ollama/qwen2.5-coder:7b" });
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
			models: [{ id: "qwen2.5-coder:7b" }],
		});
		const frontierFaux = registerFauxProvider({
			provider: "google",
			models: [{ id: "gemini-3.5-flash-lite" }],
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
			initialState: { model: initialModel, systemPrompt: "test", tools: [], thinkingLevel: "off" },
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
			forcedFaux.setResponses([fauxAssistantMessage("forced response")]);
			await session.prompt("one forced task", { routingOverride: lane });

			expect(forcedFaux.state.callCount).toBe(1);
			expect(session.model).toBe(initialModel);
			expect(controller.config.routing).toBe("off");
			expect(controller.routingState).toMatchObject({ mode: "off", lane: "direct" });
			expect(settings.getDefaultProvider()).toBe(initialModel.provider);
			expect(settings.getDefaultModel()).toBe(initialModel.id);

			directFaux.setResponses([fauxAssistantMessage("direct response")]);
			await session.prompt("normal task");
			expect(directFaux.state.callCount).toBe(initial === lane ? 2 : 1);

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
		await controller.routePrompt("Refactor this module");
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
		expect(controller.routingState.lane).toBe("frontier");
	});

	it("escalates a local provider failure to frontier", async () => {
		const store = await KlermConfigStore.load(tempDir, {
			routing: "local",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		const controller = new KlermRoutingController(tempDir, modelRuntime, store);
		await controller.routePrompt("Fix the failing test");
		const transition = await controller.handleLocalFailure("connection reset");
		expect(transition?.model).toBe(frontier);
		expect(transition?.reason).toContain("connection reset");
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
			await controller.routePrompt("Refactor this module");
			controller.requestFrontierDelegation(delegation);
			const nextTurn = await agent.prepareNextTurnWithContext?.({
				message: call,
				toolResults: [result],
				context: { systemPrompt: "test", messages: rawMessages, tools: [] },
				newMessages: [call, result],
			});
			expect(nextTurn?.model).toBe(frontier);

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
			lane: "direct",
			localModel: "ollama/qwen2.5-coder:7b",
			frontierModel: "google/gemini-3.5-flash-lite",
		});
		expect(directProjection).toBe(messages);
	});
});
