import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeOllamaServerUrl, OllamaClient, ollamaInferenceUrl } from "../src/extensions/ollama/client.ts";
import { createOllamaProvider } from "../src/extensions/ollama/provider.ts";
import { runKlermLocalCommand } from "../src/klerm/cli/local-command.ts";

describe("Klerm Ollama integration", () => {
	let server: Server;
	let serverUrl: string;
	let responseBody: unknown;

	beforeEach(async () => {
		responseBody = {
			models: [
				{
					model: "qwen2.5-coder:7b",
					size: 4_500_000_000,
					details: { parameter_size: "7B", quantization_level: "Q4_K_M" },
				},
			],
		};
		server = createServer((request, response) => {
			expect(request.url).toBe("/api/tags");
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

	it("discovers installed models without downloading anything", async () => {
		const models = await new OllamaClient(serverUrl).list();
		expect(models).toHaveLength(1);
		expect(models[0]?.model).toBe("qwen2.5-coder:7b");
	});

	it("registers Ollama models as OpenAI-compatible local models", () => {
		const provider = createOllamaProvider(serverUrl, (responseBody as { models: [] }).models).provider;
		const model = provider.getModels()[0];
		expect(model).toMatchObject({
			provider: "ollama",
			id: "qwen2.5-coder:7b",
			api: "openai-completions",
			baseUrl: `${serverUrl}/v1`,
			cost: { input: 0, output: 0 },
		});
	});

	it("prints local runtime status and models", async () => {
		const output: string[] = [];
		await expect(
			runKlermLocalCommand(["local", "status"], {
				client: new OllamaClient(serverUrl),
				stdout: (message) => output.push(message),
			}),
		).resolves.toBe(true);
		expect(output[0]).toContain("Ollama: running");
		expect(output[0]).toContain("Local models: 1");
	});

	it("normalizes Ollama root and inference URLs", () => {
		expect(normalizeOllamaServerUrl("127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434");
		expect(ollamaInferenceUrl("http://127.0.0.1:11434/")).toBe("http://127.0.0.1:11434/v1");
	});

	it("rejects malformed model catalogs", async () => {
		responseBody = { models: "invalid" };
		await expect(new OllamaClient(serverUrl).list()).rejects.toThrow("invalid model catalog");
	});
});
