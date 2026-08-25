import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	normalizeOpenAILocalServerUrl,
	OpenAILocalClient,
	openAILocalInferenceUrl,
} from "../src/extensions/openai-local/client.ts";
import { createOpenAILocalProvider } from "../src/extensions/openai-local/provider.ts";
import type { OpenAILocalRuntimeDefinition } from "../src/extensions/openai-local/runtimes.ts";
import { runKlermLocalCommand } from "../src/klerm/cli/local-command.ts";
import { isLocalProviderId } from "../src/klerm/local-providers.ts";
import {
	discoverLocalRuntimes,
	formatLocalRuntimeModels,
	formatLocalRuntimeStatus,
	type LocalRuntimeProbe,
} from "../src/klerm/local-runtime-discovery.ts";

describe("OpenAI-compatible local runtime discovery", () => {
	let server: Server;
	let serverUrl: string;
	let requestPath: string | undefined;
	let authorization: string | undefined;
	let responseBody: unknown;

	beforeEach(async () => {
		requestPath = undefined;
		authorization = undefined;
		responseBody = {
			data: [{ id: "unsloth/Qwen3-Coder-GGUF", owned_by: "local" }, { id: "alpha" }, { id: "alpha" }],
		};
		server = createServer((request, response) => {
			requestPath = request.url;
			authorization = request.headers.authorization;
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify(responseBody));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("test server did not bind");
		serverUrl = `http://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});

	it("discovers, validates, deduplicates, and sorts /v1/models", async () => {
		const models = await new OpenAILocalClient(`${serverUrl}/v1`, "secret").list();

		expect(requestPath).toBe("/v1/models");
		expect(authorization).toBe("Bearer secret");
		expect(models).toEqual([
			{ id: "alpha", ownedBy: undefined },
			{ id: "unsloth/Qwen3-Coder-GGUF", ownedBy: "local" },
		]);
	});

	it("registers an Unsloth export under the serving vLLM provider", () => {
		const runtime: OpenAILocalRuntimeDefinition = {
			providerId: "vllm",
			name: "vLLM",
			serverUrl,
		};
		const provider = createOpenAILocalProvider(runtime, [{ id: "unsloth/Qwen3-Coder-GGUF" }]);

		expect(provider.getModels()[0]).toMatchObject({
			provider: "vllm",
			id: "unsloth/Qwen3-Coder-GGUF",
			api: "openai-completions",
			baseUrl: `${serverUrl}/v1`,
			cost: { input: 0, output: 0 },
		});
		expect(isLocalProviderId("vllm")).toBe(true);
		expect(isLocalProviderId("openai")).toBe(false);
	});

	it("reports successful and unavailable runtimes independently", async () => {
		const probes: LocalRuntimeProbe[] = [
			{
				providerId: "lm-studio",
				name: "LM Studio",
				serverUrl,
				detect: async () => ({ models: [{ id: "local-model" }] }),
			},
			{
				providerId: "vllm",
				name: "vLLM",
				serverUrl: "http://127.0.0.1:8000",
				detect: async () => {
					throw new Error("connection refused");
				},
			},
		];
		const results = await discoverLocalRuntimes(probes);

		expect(formatLocalRuntimeStatus(results)).toContain("LM Studio: running");
		expect(formatLocalRuntimeStatus(results)).toContain("vLLM: unavailable");
		expect(formatLocalRuntimeModels(results)).toBe("lm-studio/local-model");
		const stdout: string[] = [];
		const stderr: string[] = [];
		await runKlermLocalCommand(["local", "models"], {
			probes,
			stdout: (message) => stdout.push(message),
			stderr: (message) => stderr.push(message),
		});
		expect(stdout).toEqual(["lm-studio/local-model"]);
		expect(stderr).toEqual([]);
	});

	it("normalizes root and inference URLs and rejects malformed catalogs", async () => {
		expect(normalizeOpenAILocalServerUrl("127.0.0.1:1234/v1/")).toBe("http://127.0.0.1:1234");
		expect(openAILocalInferenceUrl("http://127.0.0.1:1234/")).toBe("http://127.0.0.1:1234/v1");
		responseBody = { data: "invalid" };
		await expect(new OpenAILocalClient(serverUrl).list()).rejects.toThrow("invalid catalog");
	});
});
