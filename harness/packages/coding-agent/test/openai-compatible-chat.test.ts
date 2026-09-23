import type { Api, AssistantMessage, Context, Model, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	completeOpenAICompatibleChat,
	type OpenAICompatibleChatResponse,
	type OpenAICompatibleChatServer,
	startOpenAICompatibleChatServer,
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

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 7,
			output: 5,
			cacheRead: 3,
			cacheWrite: 2,
			reasoning: 1,
			totalTokens: 17,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

function createRuntime(response = assistantMessage()) {
	const completeSimple = vi.fn(
		async (_model: Model<Api>, _context: Context, _options?: ModelsSimpleStreamOptions) => response,
	);
	return {
		runtime: { getAvailableSnapshot: () => [model], completeSimple },
		completeSimple,
	};
}

const servers: OpenAICompatibleChatServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("OpenAI-compatible chat gateway", () => {
	it("maps Browser Use text, function-tool history, options, tool calls, and usage", async () => {
		const { runtime, completeSimple } = createRuntime(
			assistantMessage({
				content: [
					{ type: "text", text: "" },
					{ type: "toolCall", id: "call-2", name: "open_page", arguments: { url: "https://example.com" } },
				],
				stopReason: "toolUse",
			}),
		);
		const controller = new AbortController();
		const result = await completeOpenAICompatibleChat(
			{
				model: "faux/browser-model",
				stream: false,
				n: 1,
				response_format: { type: "text" },
				temperature: 0.2,
				max_completion_tokens: 200,
				tool_choice: "auto",
				tools: [
					{
						type: "function",
						function: {
							name: "open_page",
							description: "Open a public page",
							parameters: {
								type: "object",
								properties: { url: { type: "string" } },
								required: ["url"],
							},
							strict: true,
						},
					},
				],
				messages: [
					{ role: "system", content: "Use the browser safely." },
					{ role: "user", content: "Open the page." },
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call-1",
								type: "function",
								function: { name: "open_page", arguments: '{"url":"https://example.com"}' },
							},
						],
					},
					{ role: "tool", tool_call_id: "call-1", content: "Example Domain" },
				],
			},
			{ modelRuntime: runtime },
			controller.signal,
		);

		expect(completeSimple).toHaveBeenCalledOnce();
		expect(completeSimple.mock.calls[0][0]).toBe(model);
		expect(completeSimple.mock.calls[0][1]).toMatchObject({
			systemPrompt: "Use the browser safely.",
			messages: [
				{ role: "user", content: "Open the page." },
				{
					role: "assistant",
					content: [
						{ type: "toolCall", id: "call-1", name: "open_page", arguments: { url: "https://example.com" } },
					],
				},
				{
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "open_page",
					content: [{ type: "text", text: "Example Domain" }],
				},
			],
			tools: [
				{
					name: "open_page",
					description: "Open a public page",
					constrainedSampling: { type: "json_schema", strict: "require" },
				},
			],
		});
		expect(completeSimple.mock.calls[0][2]).toMatchObject({
			toolChoice: "auto",
			temperature: 0.2,
			maxTokens: 200,
			signal: controller.signal,
		});
		expect(result.choices[0]).toEqual({
			index: 0,
			message: {
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call-2",
						type: "function",
						function: { name: "open_page", arguments: '{"url":"https://example.com"}' },
					},
				],
			},
			logprobs: null,
			finish_reason: "tool_calls",
		});
		expect(result.usage).toEqual({
			prompt_tokens: 12,
			completion_tokens: 5,
			total_tokens: 17,
			prompt_tokens_details: { cached_tokens: 3 },
			completion_tokens_details: { reasoning_tokens: 1 },
		});
	});

	it("uses an injected pinned model but still requires its exact id", async () => {
		const { runtime, completeSimple } = createRuntime();
		const unavailableRuntime = { ...runtime, getAvailableSnapshot: () => [] };
		await expect(
			completeOpenAICompatibleChat(
				{ model: "browser-model", messages: [{ role: "user", content: "hello" }] },
				{ modelRuntime: unavailableRuntime, pinnedModel: model },
			),
		).resolves.toMatchObject({ model: "browser-model" });
		await expect(
			completeOpenAICompatibleChat(
				{ model: "other-model", messages: [{ role: "user", content: "hello" }] },
				{ modelRuntime: unavailableRuntime, pinnedModel: model },
			),
		).rejects.toThrow("not available");
		expect(completeSimple).toHaveBeenCalledOnce();
	});

	it.each([
		[{ model: "browser-model", messages: [{ role: "user", content: "hello" }], stream: true }, "non-streaming"],
		[{ model: "browser-model", messages: [{ role: "user", content: "hello" }], n: 2 }, "n=1"],
		[{ model: "browser-model", messages: [{ role: "user", content: "hello" }], top_p: 0.5 }, "not supported"],
		[
			{ model: "browser-model", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] },
			"must be a string",
		],
		[
			{ model: "browser-model", messages: [{ role: "user", content: "hello" }], tool_choice: "required" },
			"tool_choice",
		],
		[
			{
				model: "browser-model",
				messages: [{ role: "user", content: "hello" }],
				response_format: { type: "json_object" },
			},
			"text",
		],
	])("strictly rejects unsupported request shapes", async (request, message) => {
		const { runtime, completeSimple } = createRuntime();
		await expect(completeOpenAICompatibleChat(request, { modelRuntime: runtime })).rejects.toThrow(message);
		expect(completeSimple).not.toHaveBeenCalled();
	});

	it("serves only the authenticated JSON chat path and does not return upstream errors", async () => {
		const { runtime } = createRuntime(
			assistantMessage({ stopReason: "error", errorMessage: "provider key sk-secret failed" }),
		);
		const server = await startOpenAICompatibleChatServer({ modelRuntime: runtime });
		servers.push(server);
		const endpoint = `${server.url}/chat/completions`;

		const unauthorized = await fetch(endpoint, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(unauthorized.status).toBe(401);

		const wrongPath = await fetch(`${server.url}/models`, {
			method: "POST",
			headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
			body: "{}",
		});
		expect(wrongPath.status).toBe(404);

		const wrongContentType = await fetch(endpoint, {
			method: "POST",
			headers: { authorization: `Bearer ${server.token}`, "content-type": "text/plain" },
			body: "{}",
		});
		expect(wrongContentType.status).toBe(415);

		const upstreamFailure = await fetch(endpoint, {
			method: "POST",
			headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
			body: JSON.stringify({ model: "browser-model", messages: [{ role: "user", content: "hello" }] }),
		});
		expect(upstreamFailure.status).toBe(502);
		const body = await upstreamFailure.text();
		expect(body).toContain("upstream model request failed");
		expect(body).not.toContain("sk-secret");
	});

	it("enforces the configured body limit", async () => {
		const { runtime, completeSimple } = createRuntime();
		const server = await startOpenAICompatibleChatServer({ modelRuntime: runtime, maxBodyBytes: 32 });
		servers.push(server);
		const response = await fetch(`${server.url}/chat/completions`, {
			method: "POST",
			headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
			body: JSON.stringify({ model: "browser-model", messages: [{ role: "user", content: "too large" }] }),
		});
		expect(response.status).toBe(413);
		expect(completeSimple).not.toHaveBeenCalled();
	});

	it("aborts an in-flight model call when the server closes", async () => {
		let markStarted: ((signal: AbortSignal) => void) | undefined;
		const started = new Promise<AbortSignal>((resolve) => {
			markStarted = resolve;
		});
		const completeSimple = vi.fn(
			async (_model: Model<Api>, _context: Context, options?: ModelsSimpleStreamOptions) => {
				const signal = options?.signal;
				if (!signal) throw new Error("missing signal");
				markStarted?.(signal);
				await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
				return assistantMessage({ stopReason: "aborted" });
			},
		);
		const server = await startOpenAICompatibleChatServer({
			modelRuntime: { getAvailableSnapshot: () => [model], completeSimple },
		});
		servers.push(server);
		const pendingFetch = fetch(`${server.url}/chat/completions`, {
			method: "POST",
			headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
			body: JSON.stringify({ model: "browser-model", messages: [{ role: "user", content: "wait" }] }),
		}).catch(() => undefined);
		const requestSignal = await started;
		await server.close();
		await pendingFetch;
		expect(requestSignal.aborted).toBe(true);
	});

	it("returns a normal non-streaming HTTP completion", async () => {
		const { runtime } = createRuntime();
		const server = await startOpenAICompatibleChatServer({ modelRuntime: runtime });
		servers.push(server);
		const response = await fetch(`${server.url}/chat/completions`, {
			method: "POST",
			headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json; charset=utf-8" },
			body: JSON.stringify({ model: "faux/browser-model", messages: [{ role: "user", content: "hello" }] }),
		});
		const body = (await response.json()) as OpenAICompatibleChatResponse;
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(body).toMatchObject({
			object: "chat.completion",
			model: "faux/browser-model",
			choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
		});
	});
});
