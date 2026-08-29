import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";
import { OllamaClient } from "../src/extensions/ollama/client.ts";
import { KLERM_SESSION_TRANSITION_CUSTOM_TYPE } from "../src/klerm/router/types.ts";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import {
	deriveLegacyKlermTranscriptTransitions,
	formatKlermStartupGuide,
	formatKlermStartupHeader,
	InteractiveMode,
	parseKlermLaneCommand,
} from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type LaneContext = {
	session: {
		isStreaming: boolean;
		isCompacting: boolean;
		klermRouting: {
			config: { localModel?: string; frontierModel?: string; activeStartLane: string };
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
			setActiveStartLane: (lane: "auto" | "local" | "frontier" | "frontier-local") => Promise<void>;
			config: { activeStartLane: "auto" | "local" | "frontier" | "frontier-local" };
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
	handleKlermActiveCommand: (argument: string) => Promise<void>;
};

type InteractiveModePrivate = {
	handleKlermModelCommand(this: LaneContext, lane: "local" | "frontier", argument: string): Promise<void>;
	handleKlermRoutingCommand(this: RoutingContext, argument: string): Promise<void>;
	handleKlermActiveCommand(this: RoutingContext, argument: string): Promise<void>;
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
					activeStartLane: "auto",
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
	it("reconstructs enforced delegation and native return markers from a legacy session", () => {
		const entries = [
			{
				type: "model_change",
				id: "local-model",
				parentId: null,
				timestamp: "2026-08-27T17:03:40.905Z",
				provider: "ollama",
				modelId: "qwen3.5-16k:latest",
			},
			{
				type: "model_change",
				id: "frontier-model",
				parentId: "local-model",
				timestamp: "2026-08-27T17:04:42.033Z",
				provider: "openai-codex",
				modelId: "gpt-5.5",
			},
			{
				type: "message",
				id: "handoff-prompt",
				parentId: "frontier-model",
				timestamp: "2026-08-27T17:04:42.033Z",
				message: {
					role: "user",
					content: "[Klerm enforced frontier handoff]\nReason: explicit delegation",
					timestamp: 2,
				},
			},
			{
				type: "message",
				id: "return-result",
				parentId: "handoff-prompt",
				timestamp: "2026-08-27T17:10:40.673Z",
				message: {
					role: "toolResult",
					toolCallId: "return-call",
					toolName: "return_to_local",
					content: [{ type: "text", text: "Frontier return recorded." }],
					details: { reason: "frontier pass complete" },
					isError: false,
					timestamp: 3,
				},
			},
			{
				type: "model_change",
				id: "resumed-local-model",
				parentId: "return-result",
				timestamp: "2026-08-27T17:10:40.675Z",
				provider: "ollama",
				modelId: "qwen3.5-16k:latest",
			},
		] as SessionEntry[];

		expect([...deriveLegacyKlermTranscriptTransitions(entries).entries()]).toEqual([
			[
				"frontier-model",
				expect.objectContaining({
					kind: "delegate",
					toLane: "frontier",
					toTarget: "openai-codex/gpt-5.5",
					reason: "explicit delegation",
				}),
			],
			[
				"resumed-local-model",
				expect.objectContaining({
					kind: "return",
					toLane: "local",
					toTarget: "ollama/qwen3.5-16k:latest",
					reason: "frontier pass complete",
				}),
			],
		]);
	});

	it("does not reconstruct a duplicate marker beside a persisted transition", () => {
		const entries = [
			{
				type: "model_change",
				id: "frontier-model",
				parentId: null,
				timestamp: "2026-08-27T17:04:42.033Z",
				provider: "openai-codex",
				modelId: "gpt-5.5",
			},
			{
				type: "custom",
				customType: KLERM_SESSION_TRANSITION_CUSTOM_TYPE,
				id: "persisted-transition",
				parentId: "frontier-model",
				timestamp: "2026-08-27T17:04:42.034Z",
				data: {
					version: 1,
					transition: {
						id: "transition-task-1",
						sequence: 1,
						kind: "delegate",
						fromLane: "local",
						toLane: "frontier",
						toTarget: "openai-codex/gpt-5.5",
						reason: "specialist",
						trigger: "native-tool",
						cycle: 1,
						maxCycles: 3,
					},
				},
			},
		] as SessionEntry[];

		expect(deriveLegacyKlermTranscriptTransitions(entries).size).toBe(0);
	});

	beforeAll(() => initTheme("dark"));

	it("shows three startup commands when collapsed and the full guide when expanded", () => {
		const collapsed = stripAnsi(formatKlermStartupGuide(false, "ctrl+o"));
		const expanded = stripAnsi(formatKlermStartupGuide(true, "ctrl+o"));
		const commandLines = (text: string) => text.split("\n").filter((line) => line.trimStart().startsWith("/"));

		expect(commandLines(collapsed)).toHaveLength(3);
		expect(collapsed).toContain("ctrl+o show more");
		expect(collapsed).not.toContain("/routing cycles");
		expect(commandLines(expanded)).toHaveLength(10);
		expect(expanded).toContain("/routing cycles <count|unlimited>");
		expect(expanded).toContain("ctrl+o show less");
	});

	it("hides basic keyboard instructions until startup help is expanded", () => {
		const collapsed = stripAnsi(formatKlermStartupHeader("LOGO", "escape to interrupt", false, "ctrl+o"));
		const expanded = stripAnsi(formatKlermStartupHeader("LOGO", "escape to interrupt", true, "ctrl+o"));

		expect(collapsed).not.toContain("escape to interrupt");
		expect(expanded).toContain("escape to interrupt");
	});

	it("persistently toggles token and cost usage for rendered responses", () => {
		let shown = true;
		const rendered = new AssistantMessageComponent();
		const streaming = new AssistantMessageComponent();
		const renderedSpy = vi.spyOn(rendered, "setShowKlermUsage");
		const streamingSpy = vi.spyOn(streaming, "setShowKlermUsage");
		const context = {
			settingsManager: {
				getShowKlermUsage: () => shown,
				setShowKlermUsage: (value: boolean) => {
					shown = value;
				},
			},
			chatContainer: { children: [rendered] },
			streamingComponent: streaming,
			showError: vi.fn(),
			showStatus: vi.fn(),
			ui: { requestRender: vi.fn() },
		};

		(InteractiveMode as any).prototype.handleTokenCommand.call(context, "off");
		expect(shown).toBe(false);
		expect(renderedSpy).toHaveBeenCalledWith(false);
		expect(streamingSpy).toHaveBeenCalledWith(false);
		expect(context.showStatus).toHaveBeenCalledWith("Token and cost usage: hidden");

		(InteractiveMode as any).prototype.handleTokenCommand.call(context, "");
		expect(shown).toBe(true);
		expect(context.showStatus).toHaveBeenCalledWith("Token and cost usage: shown");

		(InteractiveMode as any).prototype.handleTokenCommand.call(context, "sometimes");
		expect(context.showError).toHaveBeenCalledWith("Usage: /token [on|off]");
	});

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
			setActiveStartLane: vi.fn(async () => {}),
			config: { activeStartLane: "auto" as const },
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
		await prototype.handleKlermRoutingCommand.call(context, "cycles 999");
		await prototype.handleKlermRoutingCommand.call(context, "cycles unlimited");
		await prototype.handleKlermRoutingCommand.call(context, "status");

		expect(routing.setAllowFrontierFallback).toHaveBeenNthCalledWith(1, true);
		expect(routing.setAllowFrontierFallback).toHaveBeenNthCalledWith(2, false);
		expect(routing.setHandbackEnabled).toHaveBeenNthCalledWith(1, true);
		expect(routing.setHandbackEnabled).toHaveBeenNthCalledWith(2, false);
		expect(routing.setMaxDelegationCycles).toHaveBeenNthCalledWith(1, 5);
		expect(routing.setMaxDelegationCycles).toHaveBeenNthCalledWith(2, 999);
		expect(routing.setMaxDelegationCycles).toHaveBeenNthCalledWith(3, 0);
		expect(context.showStatus).toHaveBeenLastCalledWith("Routing: auto\nFrontier fallback: on");
	});

	it("shows and updates the active start lane", async () => {
		const routing = {
			describe: vi.fn(() => "Routing: auto"),
			setRoutingMode: vi.fn(async () => {}),
			setAllowFrontierFallback: vi.fn(async () => {}),
			setHandbackEnabled: vi.fn(async () => {}),
			setMaxDelegationCycles: vi.fn(async () => {}),
			setActiveStartLane: vi.fn(async () => {}),
			config: { activeStartLane: "auto" as const },
		};
		const context: RoutingContext = {
			session: { klermRouting: routing },
			showError: vi.fn(),
			showStatus: vi.fn(),
			showSelector: vi.fn(),
			updateKlermRoutingStatus: vi.fn(),
		};

		await prototype.handleKlermActiveCommand.call(context, "status");
		await prototype.handleKlermActiveCommand.call(context, "frontier-local");
		await prototype.handleKlermActiveCommand.call(context, "invalid");

		expect(context.showStatus).toHaveBeenNthCalledWith(1, "Start lane: auto");
		expect(routing.setActiveStartLane).toHaveBeenCalledWith("frontier-local");
		expect(context.showStatus).toHaveBeenNthCalledWith(2, "Start lane: frontier-local");
		expect(context.showError).toHaveBeenCalledWith("Start lane must be auto, local, frontier, or frontier-local.");
	});

	it("passes the untrimmed task command remainder through editor dispatch", async () => {
		const context: SubmitContext = {
			defaultEditor: {},
			editor: { setText: vi.fn() },
			handleKlermModelCommand: vi.fn(async () => {}),
			handleKlermActiveCommand: vi.fn(async () => {}),
		};
		prototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("  /local task   keep  spaces  ");

		expect(context.handleKlermModelCommand).toHaveBeenCalledWith("local", " task   keep  spaces  ");
	});

	it("dispatches the /activ alias to the active start-lane handler", async () => {
		const context: SubmitContext = {
			defaultEditor: {},
			editor: { setText: vi.fn() },
			handleKlermModelCommand: vi.fn(async () => {}),
			handleKlermActiveCommand: vi.fn(async () => {}),
		};
		prototype.setupEditorSubmitHandler.call(context);

		await context.defaultEditor.onSubmit?.("/activ frontier-local");

		expect(context.handleKlermActiveCommand).toHaveBeenCalledWith("frontier-local");
	});
});
