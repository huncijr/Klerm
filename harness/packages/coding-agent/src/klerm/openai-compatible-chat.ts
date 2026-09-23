import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type {
	Api,
	AssistantMessage,
	Context,
	Message,
	Model,
	ModelsSimpleStreamOptions,
	Tool,
	TSchema,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../core/model-runtime.ts";

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const FUNCTION_NAME = /^[A-Za-z0-9_-]{1,64}$/;

type ChatRuntime = Pick<ModelRuntime, "completeSimple" | "getAvailableSnapshot">;

export interface OpenAICompatibleChatOptions {
	modelRuntime: ChatRuntime;
	/** A model that may be used without being present in ModelRuntime's available snapshot. */
	pinnedModel?: Model<Api>;
}

export interface OpenAICompatibleChatServerOptions extends OpenAICompatibleChatOptions {
	maxBodyBytes?: number;
	signal?: AbortSignal;
}

export interface OpenAICompatibleChatServer {
	/** OpenAI-compatible base URL. Configure ChatOpenAI with this value. */
	url: string;
	/** Ephemeral gateway bearer token. This is not a provider credential. */
	token: string;
	close(): Promise<void>;
}

export interface OpenAICompatibleChatResponse {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: Array<{
		index: 0;
		message: {
			role: "assistant";
			content: string | null;
			tool_calls?: Array<{
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}>;
		};
		logprobs: null;
		finish_reason: "stop" | "length" | "tool_calls";
	}>;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		prompt_tokens_details: { cached_tokens: number };
		completion_tokens_details: { reasoning_tokens: number };
	};
}

interface ParsedToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

type ParsedMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| { role: "assistant"; content: string | null; toolCalls: ParsedToolCall[] }
	| { role: "tool"; content: string; toolCallId: string };

interface ParsedRequest {
	model: string;
	messages: ParsedMessage[];
	tools: Tool<TSchema>[];
	toolChoice: "auto" | "none";
	temperature?: number;
	maxTokens?: number;
}

class GatewayError extends Error {
	readonly status: number;
	readonly code: string;
	readonly type: string;

	constructor(status: number, code: string, message: string, type = "invalid_request_error") {
		super(message);
		this.name = "GatewayError";
		this.status = status;
		this.code = code;
		this.type = type;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new GatewayError(400, "invalid_request", `${path} must be an object.`);
	return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const allowedKeys = new Set(allowed);
	const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
	if (unknownKey) throw new GatewayError(400, "unsupported_field", `${path}.${unknownKey} is not supported.`);
}

function expectString(value: unknown, path: string, allowEmpty = true): string {
	if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
		throw new GatewayError(
			400,
			"invalid_request",
			`${path} must be ${allowEmpty ? "a string" : "a non-empty string"}.`,
		);
	}
	return value;
}

function parseFunctionName(value: unknown, path: string): string {
	const name = expectString(value, path, false);
	if (!FUNCTION_NAME.test(name)) {
		throw new GatewayError(
			400,
			"invalid_request",
			`${path} must contain only letters, numbers, underscores, or hyphens.`,
		);
	}
	return name;
}

function parseToolCalls(value: unknown, path: string): ParsedToolCall[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new GatewayError(400, "invalid_request", `${path} must be a non-empty array.`);
	}
	return value.map((entry, index) => {
		const callPath = `${path}[${index}]`;
		const call = expectRecord(entry, callPath);
		rejectUnknownKeys(call, ["id", "type", "function"], callPath);
		const id = expectString(call.id, `${callPath}.id`, false);
		if (call.type !== "function") {
			throw new GatewayError(400, "unsupported_tool", `${callPath}.type must be "function".`);
		}
		const functionValue = expectRecord(call.function, `${callPath}.function`);
		rejectUnknownKeys(functionValue, ["name", "arguments"], `${callPath}.function`);
		const serializedArguments = expectString(functionValue.arguments, `${callPath}.function.arguments`);
		let argumentsValue: unknown;
		try {
			argumentsValue = JSON.parse(serializedArguments);
		} catch {
			throw new GatewayError(400, "invalid_tool_arguments", `${callPath}.function.arguments must be valid JSON.`);
		}
		if (!isRecord(argumentsValue)) {
			throw new GatewayError(400, "invalid_tool_arguments", `${callPath}.function.arguments must encode an object.`);
		}
		return {
			id,
			name: parseFunctionName(functionValue.name, `${callPath}.function.name`),
			arguments: argumentsValue,
		};
	});
}

function parseMessages(value: unknown): ParsedMessage[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new GatewayError(400, "invalid_request", "messages must be a non-empty array.");
	}
	let conversationStarted = false;
	const toolCallIds = new Set<string>();
	return value.map((entry, index): ParsedMessage => {
		const path = `messages[${index}]`;
		const message = expectRecord(entry, path);
		const role = expectString(message.role, `${path}.role`, false);
		if (role === "system") {
			rejectUnknownKeys(message, ["role", "content"], path);
			if (conversationStarted) {
				throw new GatewayError(
					400,
					"unsupported_message_order",
					"System messages must precede conversation messages.",
				);
			}
			return { role, content: expectString(message.content, `${path}.content`) };
		}
		conversationStarted = true;
		if (role === "user") {
			rejectUnknownKeys(message, ["role", "content"], path);
			return { role, content: expectString(message.content, `${path}.content`) };
		}
		if (role === "assistant") {
			rejectUnknownKeys(message, ["role", "content", "tool_calls"], path);
			const content = message.content === null ? null : expectString(message.content, `${path}.content`);
			const toolCalls =
				message.tool_calls === undefined ? [] : parseToolCalls(message.tool_calls, `${path}.tool_calls`);
			if (content === null && toolCalls.length === 0) {
				throw new GatewayError(
					400,
					"invalid_request",
					`${path}.content may be null only when tool_calls are present.`,
				);
			}
			for (const call of toolCalls) {
				if (toolCallIds.has(call.id)) {
					throw new GatewayError(400, "invalid_request", `Duplicate tool call id "${call.id}".`);
				}
				toolCallIds.add(call.id);
			}
			return { role, content, toolCalls };
		}
		if (role === "tool") {
			rejectUnknownKeys(message, ["role", "content", "tool_call_id"], path);
			const toolCallId = expectString(message.tool_call_id, `${path}.tool_call_id`, false);
			if (!toolCallIds.has(toolCallId)) {
				throw new GatewayError(
					400,
					"invalid_request",
					`${path}.tool_call_id does not reference an earlier tool call.`,
				);
			}
			return { role, content: expectString(message.content, `${path}.content`), toolCallId };
		}
		throw new GatewayError(400, "unsupported_message_role", `${path}.role is not supported.`);
	});
}

function parseTools(value: unknown): Tool<TSchema>[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new GatewayError(400, "invalid_request", "tools must be an array.");
	const names = new Set<string>();
	return value.map((entry, index) => {
		const path = `tools[${index}]`;
		const tool = expectRecord(entry, path);
		rejectUnknownKeys(tool, ["type", "function"], path);
		if (tool.type !== "function") throw new GatewayError(400, "unsupported_tool", `${path}.type must be "function".`);
		const definition = expectRecord(tool.function, `${path}.function`);
		rejectUnknownKeys(definition, ["name", "description", "parameters", "strict"], `${path}.function`);
		const name = parseFunctionName(definition.name, `${path}.function.name`);
		if (names.has(name)) throw new GatewayError(400, "invalid_request", `Duplicate tool name "${name}".`);
		names.add(name);
		const parameters = expectRecord(definition.parameters, `${path}.function.parameters`);
		if (parameters.type !== "object") {
			throw new GatewayError(400, "unsupported_tool", `${path}.function.parameters.type must be "object".`);
		}
		if (definition.strict !== undefined && typeof definition.strict !== "boolean") {
			throw new GatewayError(400, "invalid_request", `${path}.function.strict must be a boolean.`);
		}
		return {
			name,
			description:
				definition.description === undefined
					? ""
					: expectString(definition.description, `${path}.function.description`),
			parameters: parameters as TSchema,
			...(definition.strict === true
				? { constrainedSampling: { type: "json_schema" as const, strict: "require" as const } }
				: {}),
		};
	});
}

function parseRequest(value: unknown): ParsedRequest {
	const request = expectRecord(value, "request");
	rejectUnknownKeys(
		request,
		[
			"model",
			"messages",
			"tools",
			"tool_choice",
			"stream",
			"n",
			"response_format",
			"temperature",
			"max_tokens",
			"max_completion_tokens",
		],
		"request",
	);
	if (request.stream !== undefined && request.stream !== false) {
		throw new GatewayError(400, "unsupported_streaming", "Only non-streaming requests are supported.");
	}
	if (request.n !== undefined && request.n !== 1) {
		throw new GatewayError(400, "unsupported_n", "Only n=1 is supported.");
	}
	if (request.tool_choice !== undefined && request.tool_choice !== "auto" && request.tool_choice !== "none") {
		throw new GatewayError(
			400,
			"unsupported_tool_choice",
			"Only tool_choice values " + '"auto" and "none" are supported.',
		);
	}
	if (request.response_format !== undefined) {
		const format = expectRecord(request.response_format, "response_format");
		rejectUnknownKeys(format, ["type"], "response_format");
		if (format.type !== "text") {
			throw new GatewayError(400, "unsupported_response_format", 'Only response_format type "text" is supported.');
		}
	}
	let temperature: number | undefined;
	if (request.temperature !== undefined) {
		if (
			typeof request.temperature !== "number" ||
			!Number.isFinite(request.temperature) ||
			request.temperature < 0 ||
			request.temperature > 2
		) {
			throw new GatewayError(400, "invalid_request", "temperature must be a finite number from 0 through 2.");
		}
		temperature = request.temperature;
	}
	if (request.max_tokens !== undefined && request.max_completion_tokens !== undefined) {
		throw new GatewayError(400, "invalid_request", "Specify only one of max_tokens and max_completion_tokens.");
	}
	const rawMaxTokens = request.max_completion_tokens ?? request.max_tokens;
	let maxTokens: number | undefined;
	if (rawMaxTokens !== undefined) {
		if (!Number.isSafeInteger(rawMaxTokens) || typeof rawMaxTokens !== "number" || rawMaxTokens < 1) {
			throw new GatewayError(400, "invalid_request", "max tokens must be a positive safe integer.");
		}
		maxTokens = rawMaxTokens;
	}
	return {
		model: expectString(request.model, "model", false),
		messages: parseMessages(request.messages),
		tools: parseTools(request.tools),
		toolChoice: request.tool_choice === "none" ? "none" : "auto",
		...(temperature === undefined ? {} : { temperature }),
		...(maxTokens === undefined ? {} : { maxTokens }),
	};
}

function modelReferences(model: Model<Api>): readonly string[] {
	return model.id === `${model.provider}/${model.id}` ? [model.id] : [model.id, `${model.provider}/${model.id}`];
}

function resolveModel(requestedModel: string, options: OpenAICompatibleChatOptions): Model<Api> {
	if (options.pinnedModel) {
		if (modelReferences(options.pinnedModel).includes(requestedModel)) return options.pinnedModel;
		throw new GatewayError(404, "model_not_found", `Model "${requestedModel}" is not available.`);
	}
	const matches = options.modelRuntime
		.getAvailableSnapshot()
		.filter((model) => modelReferences(model).includes(requestedModel));
	if (matches.length !== 1) {
		throw new GatewayError(404, "model_not_found", `Model "${requestedModel}" is not available or is ambiguous.`);
	}
	return matches[0];
}

function buildContext(request: ParsedRequest, model: Model<Api>): Context {
	const systemMessages: string[] = [];
	const messages: Message[] = [];
	const toolNames = new Map<string, string>();
	const emptyUsage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	for (const message of request.messages) {
		const timestamp = Date.now();
		if (message.role === "system") {
			systemMessages.push(message.content);
		} else if (message.role === "user") {
			messages.push({ role: "user", content: message.content, timestamp });
		} else if (message.role === "assistant") {
			for (const call of message.toolCalls) toolNames.set(call.id, call.name);
			messages.push({
				role: "assistant",
				content: [
					...(message.content === null ? [] : [{ type: "text" as const, text: message.content }]),
					...message.toolCalls.map((call) => ({
						type: "toolCall" as const,
						id: call.id,
						name: call.name,
						arguments: call.arguments,
					})),
				],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: emptyUsage,
				stopReason: message.toolCalls.length > 0 ? "toolUse" : "stop",
				timestamp,
			});
		} else {
			const toolName = toolNames.get(message.toolCallId);
			if (!toolName) throw new GatewayError(400, "invalid_request", "Tool result references an unknown tool call.");
			messages.push({
				role: "toolResult",
				toolCallId: message.toolCallId,
				toolName,
				content: [{ type: "text", text: message.content }],
				isError: false,
				timestamp,
			});
		}
	}
	return {
		...(systemMessages.length > 0 ? { systemPrompt: systemMessages.join("\n\n") } : {}),
		messages,
		...(request.tools.length > 0 ? { tools: request.tools } : {}),
	};
}

function mapResponse(request: ParsedRequest, message: AssistantMessage): OpenAICompatibleChatResponse {
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		throw new GatewayError(
			message.stopReason === "aborted" ? 499 : 502,
			message.stopReason === "aborted" ? "request_aborted" : "upstream_error",
			message.stopReason === "aborted" ? "The model request was aborted." : "The upstream model request failed.",
			message.stopReason === "aborted" ? "request_aborted" : "api_error",
		);
	}
	if (message.stopReason === "pending" || message.stopReason === "deferred") {
		throw new GatewayError(
			502,
			"unsupported_upstream_response",
			"The upstream model returned an unsupported response.",
			"api_error",
		);
	}
	const text = message.content
		.filter((entry) => entry.type === "text")
		.map((entry) => entry.text)
		.join("");
	const toolCalls = message.content
		.filter((entry) => entry.type === "toolCall")
		.map((entry) => ({
			id: entry.id,
			type: "function" as const,
			function: { name: entry.name, arguments: JSON.stringify(entry.arguments) },
		}));
	const promptTokens = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
	return {
		id: `chatcmpl_${randomUUID().replaceAll("-", "")}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: request.model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: text.length > 0 || toolCalls.length === 0 ? text : null,
					...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
				},
				logprobs: null,
				finish_reason: message.stopReason === "length" ? "length" : toolCalls.length > 0 ? "tool_calls" : "stop",
			},
		],
		usage: {
			prompt_tokens: promptTokens,
			completion_tokens: message.usage.output,
			total_tokens: message.usage.totalTokens,
			prompt_tokens_details: { cached_tokens: message.usage.cacheRead },
			completion_tokens_details: { reasoning_tokens: message.usage.reasoning ?? 0 },
		},
	};
}

/** Validate and execute one supported OpenAI chat-completions request. */
export async function completeOpenAICompatibleChat(
	requestValue: unknown,
	options: OpenAICompatibleChatOptions,
	signal?: AbortSignal,
): Promise<OpenAICompatibleChatResponse> {
	signal?.throwIfAborted();
	const request = parseRequest(requestValue);
	const model = resolveModel(request.model, options);
	const requestOptions: ModelsSimpleStreamOptions = {
		toolChoice: request.toolChoice,
		...(request.temperature === undefined ? {} : { temperature: request.temperature }),
		...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
		...(signal ? { signal } : {}),
	};
	let result: AssistantMessage;
	try {
		result = await options.modelRuntime.completeSimple(model, buildContext(request, model), requestOptions);
	} catch {
		if (signal?.aborted)
			throw new GatewayError(499, "request_aborted", "The model request was aborted.", "request_aborted");
		throw new GatewayError(502, "upstream_error", "The upstream model request failed.", "api_error");
	}
	return mapResponse(request, result);
}

function bearerTokenMatches(header: string | undefined, token: string): boolean {
	if (!header?.startsWith("Bearer ")) return false;
	const supplied = Buffer.from(header.slice("Bearer ".length));
	const expected = Buffer.from(token);
	return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		"cache-control": "no-store",
	});
	response.end(payload);
}

function sendError(response: ServerResponse, error: GatewayError): void {
	sendJson(response, error.status, {
		error: { message: error.message, type: error.type, param: null, code: error.code },
	});
}

function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let length = 0;
		let settled = false;
		const cleanup = () => {
			request.off("data", onData);
			request.off("end", onEnd);
			request.off("aborted", onAborted);
			request.off("error", onError);
		};
		const finish = (action: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			action();
		};
		const onData = (chunk: Buffer) => {
			length += chunk.length;
			if (length > maxBodyBytes) {
				finish(() => reject(new GatewayError(413, "body_too_large", "Request body is too large.")));
				request.resume();
				return;
			}
			chunks.push(chunk);
		};
		const onEnd = () => finish(() => resolve(Buffer.concat(chunks, length)));
		const onAborted = () =>
			finish(() => reject(new GatewayError(499, "request_aborted", "Request was aborted.", "request_aborted")));
		const onError = () =>
			finish(() => reject(new GatewayError(400, "invalid_request", "Could not read request body.")));
		request.on("data", onData);
		request.on("end", onEnd);
		request.on("aborted", onAborted);
		request.on("error", onError);
	});
}

/** Start an authenticated OpenAI-compatible chat server on the IPv4 loopback interface. */
export async function startOpenAICompatibleChatServer(
	options: OpenAICompatibleChatServerOptions,
): Promise<OpenAICompatibleChatServer> {
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
	if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
		throw new RangeError("maxBodyBytes must be a positive safe integer.");
	}
	options.signal?.throwIfAborted();
	const token = randomBytes(32).toString("base64url");
	const serverController = new AbortController();
	const server = createServer(async (request, response) => {
		try {
			if (request.url !== CHAT_COMPLETIONS_PATH) {
				throw new GatewayError(404, "not_found", "Not found.");
			}
			if (request.method !== "POST") {
				response.setHeader("allow", "POST");
				throw new GatewayError(405, "method_not_allowed", "Only POST is supported.");
			}
			if (!bearerTokenMatches(request.headers.authorization, token)) {
				throw new GatewayError(401, "invalid_api_key", "Invalid gateway token.", "authentication_error");
			}
			const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
			if (contentType !== "application/json") {
				throw new GatewayError(415, "unsupported_media_type", "Content-Type must be application/json.");
			}
			const contentLength = request.headers["content-length"];
			if (contentLength !== undefined) {
				if (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBodyBytes) {
					request.resume();
					throw new GatewayError(413, "body_too_large", "Request body is too large.");
				}
			}
			const body = await readBody(request, maxBodyBytes);
			let requestValue: unknown;
			try {
				requestValue = JSON.parse(body.toString("utf8"));
			} catch {
				throw new GatewayError(400, "invalid_json", "Request body must be valid JSON.");
			}
			const requestController = new AbortController();
			const onClose = () => {
				if (!response.writableEnded) requestController.abort();
			};
			response.once("close", onClose);
			try {
				const signal = options.signal
					? AbortSignal.any([requestController.signal, serverController.signal, options.signal])
					: AbortSignal.any([requestController.signal, serverController.signal]);
				const result = await completeOpenAICompatibleChat(requestValue, options, signal);
				if (!response.destroyed) sendJson(response, 200, result);
			} finally {
				response.off("close", onClose);
			}
		} catch (error) {
			if (!response.destroyed) {
				sendError(
					response,
					error instanceof GatewayError
						? error
						: new GatewayError(500, "internal_error", "The gateway failed to process the request.", "api_error"),
				);
			}
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address() as AddressInfo;
	let closed: Promise<void> | undefined;
	const close = (): Promise<void> => {
		if (closed) return closed;
		serverController.abort();
		closed = new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
		return closed;
	};
	const onAbort = () => void close();
	options.signal?.addEventListener("abort", onAbort, { once: true });
	return {
		url: `http://127.0.0.1:${address.port}/v1`,
		token,
		async close() {
			options.signal?.removeEventListener("abort", onAbort);
			await close();
		},
	};
}
