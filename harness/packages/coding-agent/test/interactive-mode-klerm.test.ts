import { describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { OllamaClient } from "../src/extensions/ollama/client.ts";
import { InteractiveMode, parseKlermLaneCommand } from "../src/modes/interactive/interactive-mode.ts";

type LaneContext = {
	session: {
		isStreaming: boolean;
		isCompacting: boolean;
		klermRouting: {
			config: { localModel?: string; frontierModel?: string };
			setLocalModel: (reference: string | undefined) => Promise<void>;
			setFrontierModel: (reference: string | undefined) => Promise<void>;
		};
		modelRuntime: Pick<ModelRuntime, "getAvailableSnapshot" | "hasConfiguredAuth" | "refresh">;
		prompt: (text: string, options: unknown) => Promise<void>;
	};
	showError: (message: string) => void;
	showWarning: (message: string) => void;
	showStatus: (message: string) => void;
	showKlermModelSelector: (lane: "local" | "frontier", search?: string) => void;
};

type RoutingContext = {
	session: {
		klermRouting: {
			describe: () => string;
			setRoutingMode: (mode: "off" | "local" | "frontier" | "auto") => Promise<void>;
			setAllowFrontierFallback: (enabled: boolean) => Promise<void>;
			setHandbackEnabled: (enabled: boolean) => Promise<void>;
			setMaxDelegationCycles: (count: number) => Promise<void>;
		};
	};
	showError: (message: string) => void;
	showStatus: (message: string) => void;
	showSelector: () => void;
	updateKlermRoutingStatus: () => void;
};

type SubmitContext = {
	defaultEditor: { onSubmit?: (text: string) => Promise<void> };
	editor: { setText: (text: string) => void };
	handleKlermModelCommand: (lane: "local" | "frontier", argument: string) => Promise<void>;
};

type InteractiveModePrivate = {
	handleKlermModelCommand(this: LaneContext, lane: "local" | "frontier", argument: string): Promise<void>;
	handleKlermRoutingCommand(this: RoutingContext, argument: string): Promise<void>;
	setupEditorSubmitHandler(this: SubmitContext): void;
};

const prototype = InteractiveMode.prototype as unknown as InteractiveModePrivate;

function createLaneContext(): LaneContext {
	return {
		session: {
			isStreaming: false,
			isCompacting: false,
			klermRouting: {
				config: {
					localModel: "ollama/qwen2.5-coder:7b",
					frontierModel: "google/gemini-3.5-flash-lite",
				},
				setLocalModel: vi.fn(async () => {}),
				setFrontierModel: vi.fn(async () => {}),
			},
			modelRuntime: {
				getAvailableSnapshot: () => [],
				hasConfiguredAuth: () => false,
				refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
			},
			prompt: vi.fn(async () => {}),
		},
		showError: vi.fn(),
		showWarning: vi.fn(),
		showStatus: vi.fn(),
		showKlermModelSelector: vi.fn(),
	};
}

describe("interactive Klerm commands", () => {
	it("parses selector, explicit model, legacy model, and full task remainder forms", () => {
		expect(parseKlermLaneCommand("")).toEqual({ action: "selector" });
		expect(parseKlermLaneCommand(" model ")).toEqual({ action: "selector" });
		expect(parseKlermLaneCommand(" model ollama/qwen:7b ")).toEqual({
			action: "model",
			reference: "ollama/qwen:7b",
		});
		expect(parseKlermLaneCommand("ollama/qwen:7b")).toEqual({
			action: "model",
			reference: "ollama/qwen:7b",
		});
		expect(parseKlermLaneCommand(" task   keep  internal spacing  ")).toEqual({
			action: "task",
			prompt: "keep  internal spacing  ",
		});
	});

	it("opens selectors and persistently sets explicit and shorthand models", async () => {
		const context = createLaneContext();

		await prototype.handleKlermModelCommand.call(context, "local", "");
		await prototype.handleKlermModelCommand.call(context, "local", "model");
		await prototype.handleKlermModelCommand.call(context, "local", "model ollama/explicit");
		await prototype.handleKlermModelCommand.call(context, "local", "ollama/legacy");

		expect(context.showKlermModelSelector).toHaveBeenCalledTimes(2);
		expect(context.session.klermRouting.setLocalModel).toHaveBeenNthCalledWith(1, "ollama/explicit");
		expect(context.session.klermRouting.setLocalModel).toHaveBeenNthCalledWith(2, "ollama/legacy");
	});

	it("refreshes the referenced local provider on a catalog cache miss before setting the model", async () => {
		const context = createLaneContext();
		let models = context.session.modelRuntime.getAvailableSnapshot();
		context.session.modelRuntime.getAvailableSnapshot = () => models;
		context.session.modelRuntime.refresh = vi.fn(async (options) => {
			models = [
				{
					provider: "ollama",
					id: "qwen3.5:9b-q4_K_M",
					name: "Qwen 3.5",
					api: "faux",
					baseUrl: "http://localhost",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 1000,
					maxTokens: 100,
				},
			];
			return { aborted: false, errors: new Map(), options };
		});

		await prototype.handleKlermModelCommand.call(context, "local", "model ollama/qwen3.5:9b-q4_K_M");

		expect(context.session.modelRuntime.refresh).toHaveBeenCalledWith({
			providers: ["ollama"],
			allowNetwork: true,
			signal: expect.any(AbortSignal),
		});
		expect(context.session.klermRouting.setLocalModel).toHaveBeenCalledWith("ollama/qwen3.5:9b-q4_K_M");
	});

	it("submits a one-task override directly and prints exact missing-prompt usage", async () => {
		const context = createLaneContext();

		await prototype.handleKlermModelCommand.call(context, "frontier", "task preserve  this");
		expect(context.session.prompt).toHaveBeenCalledWith("preserve  this", {
			expandPromptTemplates: false,
			routingOverride: "frontier",
		});

		await prototype.handleKlermModelCommand.call(context, "frontier", "task   ");
		expect(context.showError).toHaveBeenCalledWith("Usage: /frontier task <prompt>");
	});

	it.each([
		{ state: "isStreaming" as const, message: "Cannot run /local task while a response is in progress." },
		{ state: "isCompacting" as const, message: "Cannot run /local task while compaction is in progress." },
	])("rejects a task while $state without queueing", async ({ state, message }) => {
		const context = createLaneContext();
		context.session[state] = true;

		await prototype.handleKlermModelCommand.call(context, "local", "task do work");

		expect(context.showWarning).toHaveBeenCalledWith(message);
		expect(context.session.prompt).not.toHaveBeenCalled();
	});

	it("reports frontier selectability from the cached catalog and auth snapshot", async () => {
		const context = createLaneContext();
		context.session.modelRuntime.getAvailableSnapshot = () => [
			{
				provider: "google",
				id: "gemini-3.5-flash-lite",
				name: "Gemini",
				api: "faux",
				baseUrl: "http://localhost",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000,
				maxTokens: 100,
			},
		];
		context.session.modelRuntime.hasConfiguredAuth = () => true;

		await prototype.handleKlermModelCommand.call(context, "frontier", "status");

		expect(context.showStatus).toHaveBeenCalledWith("Frontier model: google/gemini-3.5-flash-lite\nSelectable: yes");
	});

	it("reports Ollama health, configured local model, and discovered models", async () => {
		const context = createLaneContext();
		const list = vi.spyOn(OllamaClient.prototype, "list").mockResolvedValue([{ model: "qwen2.5-coder:7b" }]);

		try {
			await prototype.handleKlermModelCommand.call(context, "local", "status");
			expect(context.showStatus).toHaveBeenCalledWith(
				expect.stringContaining("Ollama: running\nEndpoint: http://127.0.0.1:11434\nModels: 1"),
			);

			await prototype.handleKlermModelCommand.call(context, "local", "models");
			expect(context.showStatus).toHaveBeenLastCalledWith("ollama/qwen2.5-coder:7b");
			expect(list).toHaveBeenCalledTimes(2);
		} finally {
			list.mockRestore();
		}
	});

	it("updates fallback, handback, cycle budget, and includes controller status", async () => {
		const routing = {
			describe: vi.fn(() => "Routing: auto\nFrontier fallback: on"),
			setRoutingMode: vi.fn(async () => {}),
			setAllowFrontierFallback: vi.fn(async () => {}),
			setHandbackEnabled: vi.fn(async () => {}),
			setMaxDelegationCycles: vi.fn(async () => {}),
		};
		const context: RoutingContext = {
			session: { klermRouting: routing },
			showError: vi.fn(),
			showStatus: vi.fn(),
			showSelector: vi.fn(),
			updateKlermRoutingStatus: vi.fn(),
		};

		await prototype.handleKlermRoutingCommand.call(context, "fallback on");
		await prototype.handleKlermRoutingCommand.call(context, "fallback off");
		await prototype.handleKlermRoutingCommand.call(context, "handback on");
		await prototype.handleKlermRoutingCommand.call(context, "handback off");
		await prototype.handleKlermRoutingCommand.call(context, "cycles 5");
		await prototype.handleKlermRoutingCommand.call(context, "status");

		expect(routing.setAllowFrontierFallback).toHaveBeenNthCalledWith(1, true);
		expect(routing.setAllowFrontierFallback).toHaveBeenNthCalledWith(2, false);
		expect(routing.setHandbackEnabled).toHaveBeenNthCalledWith(1, true);
		expect(routing.setHandbackEnabled).toHaveBeenNthCalledWith(2, false);
		expect(routing.setMaxDelegationCycles).toHaveBeenCalledWith(5);
		expect(context.showStatus).toHaveBeenLastCalledWith("Routing: auto\nFrontier fallback: on");
	});

	it("passes the untrimmed task command remainder through editor dispatch", async () => {
		const context: SubmitContext = {
			defaultEditor: {},
			editor: { setText: vi.fn() },
			handleKlermModelCommand: vi.fn(async () => {}),
		};
		prototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("  /local task   keep  spaces  ");

		expect(context.handleKlermModelCommand).toHaveBeenCalledWith("local", " task   keep  spaces  ");
	});
});
