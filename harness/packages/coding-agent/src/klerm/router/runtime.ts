import { createHash } from "node:crypto";
import type { AgentMessage, PrepareNextTurnContext } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "../../core/extensions/types.ts";
import { findExactModelReferenceMatch } from "../../core/model-resolver.ts";
import type { ModelRuntime } from "../../core/model-runtime.ts";
import type { KlermConfig, KlermConfigStore, KlermRoutingMode } from "../config.ts";
import { appendKlermRouteDecision } from "./decision-log.ts";
import type { KlermPromptRoutingOverride, KlermRouteDecision, KlermRoutingState } from "./types.ts";

const LOCAL_PROVIDER_IDS = new Set(["ollama", "llama.cpp"]);

const delegateSchema = Type.Object({
	reason: Type.String({ description: "Why the local worker needs the frontier worker" }),
	summary: Type.String({ description: "Work already completed and relevant findings" }),
	remainingWork: Type.String({ description: "What the frontier worker should do next" }),
});

interface PendingDelegation {
	reason: string;
	summary: string;
	remainingWork: string;
}

export interface KlermModelTransition {
	model: Model<any>;
	reason: string;
}

export interface KlermEnforcedDelegation extends KlermModelTransition {
	handoffPrompt: string;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function modelReference(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

function assistantText(message: { content: Array<{ type: string; text?: string }> }): string {
	return message.content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
			.join(",")}}`;
	}
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function formatForeignToolCall(name: string, args: Record<string, unknown>): string {
	if (name === "delegate_frontier") {
		const field = (key: string): string => (typeof args[key] === "string" ? args[key] : "(not provided)");
		return [
			"[Cross-model handoff]",
			`Reason: ${field("reason")}`,
			`Summary: ${field("summary")}`,
			`Remaining work: ${field("remainingWork")}`,
		].join("\n");
	}
	return `[Cross-model tool request]\nTool: ${name}\nArguments: ${stableJson(args)}`;
}

/** Project provider-specific tool exchanges into neutral request-only context. */
export function projectKlermHandoffContext(
	messages: AgentMessage[],
	target: Model<any>,
	routingState: Readonly<KlermRoutingState>,
): AgentMessage[] {
	if (routingState.lane === "direct") return messages;

	const foreignToolCalls = new Map<string, string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		const isForeign =
			message.provider !== target.provider || message.api !== target.api || message.model !== target.id;
		if (!isForeign) continue;
		for (const part of message.content) {
			if (part.type === "toolCall") foreignToolCalls.set(part.id, part.name);
		}
	}
	if (foreignToolCalls.size === 0) return messages;

	let changed = false;
	const projected = messages.map((message): AgentMessage => {
		if (message.role === "assistant") {
			const isForeign =
				message.provider !== target.provider || message.api !== target.api || message.model !== target.id;
			const hasForeignToolCall = isForeign && message.content.some((part) => part.type === "toolCall");
			if (!hasForeignToolCall) return message;

			changed = true;
			return {
				role: "user",
				content: message.content.flatMap((part) => {
					if (part.type === "text") return [{ type: "text" as const, text: part.text }];
					if (part.type === "thinking") {
						return part.redacted || !part.thinking.trim()
							? []
							: [{ type: "text" as const, text: `[Prior model reasoning]\n${part.thinking}` }];
					}
					return [
						{
							type: "text" as const,
							text: formatForeignToolCall(part.name, part.arguments),
						},
					];
				}),
				timestamp: message.timestamp,
			};
		}

		if (message.role === "toolResult") {
			const toolName = foreignToolCalls.get(message.toolCallId);
			if (!toolName) return message;
			changed = true;
			return {
				role: "user",
				content: [
					{
						type: "text",
						text:
							toolName === "delegate_frontier"
								? "[Cross-model handoff result]"
								: `[Cross-model tool result]\nTool: ${toolName}`,
					},
					...message.content.map((part) =>
						part.type === "text" ? { type: "text" as const, text: part.text } : { ...part },
					),
				],
				timestamp: message.timestamp,
			};
		}

		return message;
	});
	return changed ? projected : messages;
}

function heuristicRoute(task: string): { route: "LOCAL" | "FRONTIER"; reason: string; complexity: number } {
	const complex =
		task.length > 600 ||
		/\b(architecture|architectural|multi[- ]?package|migration|security audit|authentication system|large refactor|across the (repository|codebase)|concurrent|distributed)\b/iu.test(
			task,
		);
	return complex
		? {
				route: "FRONTIER",
				reason: "deterministic complexity fallback matched a repository-scale task",
				complexity: 8,
			}
		: { route: "LOCAL", reason: "deterministic complexity fallback selected the local worker", complexity: 3 };
}

function explicitlyRequestsFrontier(task: string): boolean {
	if (/\bdelegate_frontier\b/iu.test(task)) return true;
	const target = /\b(frontier|codex|claude|gemini)\b/iu;
	const action = /\b(delegate|delegál\w*|ask|kér\w*|consult|konzult\w*|use|használ\w*|hand\s*off)\b/iu;
	return target.test(task) && action.test(task);
}

export class KlermRoutingController {
	private readonly cwd: string;
	private readonly modelRuntime: ModelRuntime;
	private readonly configStore: KlermConfigStore;
	private state: KlermRoutingState;
	private pendingDelegation?: PendingDelegation;
	private localTurns = 0;
	private localToolErrors = 0;
	private lastToolSignature?: string;
	private repeatedToolCalls = 0;
	private task = "";
	private explicitFrontierRequest = false;

	constructor(cwd: string, modelRuntime: ModelRuntime, configStore: KlermConfigStore) {
		this.cwd = cwd;
		this.modelRuntime = modelRuntime;
		this.configStore = configStore;
		const config = configStore.get();
		this.state = {
			mode: config.routing,
			lane: "direct",
			localModel: config.localModel,
			frontierModel: config.frontierModel,
		};
	}

	get config(): Readonly<KlermConfig> {
		return this.configStore.get();
	}

	get routingState(): Readonly<KlermRoutingState> {
		return this.state;
	}

	getSystemPromptContribution(): string | undefined {
		const localModel = this.config.localModel ?? "not configured";
		const frontierModel = this.config.frontierModel ?? "not configured";
		if (this.state.lane === "local") {
			return [
				"<klerm_a2a>",
				"You are the Klerm local worker and may hand work to the configured frontier worker.",
				`Current local model: ${localModel}`,
				`Configured frontier model: ${frontierModel}`,
				"Call delegate_frontier when the user explicitly asks you to ask, consult, use, delegate to, or hand off to the frontier model, Codex, Claude, Gemini, or the other configured model. An explicit user request requires delegation even when the task is simple.",
				"Also call delegate_frontier when the task exceeds your capability, is unusually risky, or repeated tool attempts fail.",
				'Invoke it through the native tool interface with exactly these string arguments: {"reason":"why frontier is needed","summary":"completed local work and findings","remainingWork":"what frontier must do next"}.',
				"Never print delegate_frontier as TypeScript, JSON, XML, Markdown, or a code block. Text that resembles a tool call does not execute the tool.",
				"Before delegating, complete any specifically requested local-only observation. Put completed work and findings in summary, and give the frontier worker a precise remainingWork instruction.",
				"Do not merely say that delegation is unnecessary or describe how to delegate. Invoke delegate_frontier and let Klerm perform the handoff.",
				"PI_PROVIDER and PI_MODEL describe the model currently executing a shell command; inspecting them is not a substitute for a requested frontier handoff.",
				"Do not claim that the frontier worker answered unless the handoff occurred and the frontier worker actually responded.",
				"</klerm_a2a>",
			].join("\n");
		}

		if (this.state.lane === "frontier") {
			return [
				"<klerm_a2a>",
				"You are the Klerm frontier worker. Continue the current task using the existing session and provider-neutral handoff context.",
				`Local worker model: ${localModel}`,
				`Current frontier model: ${frontierModel}`,
				"Treat [Cross-model handoff] sections as instructions and context supplied by the local worker.",
				`When the user asks which model you are, identify the current frontier model exactly as ${frontierModel}.`,
				"Do not call delegate_frontier because you are already the frontier worker.",
				"Do not restart completed local work unless verification is required; continue from the stated summary and remaining work.",
				"</klerm_a2a>",
			].join("\n");
		}

		return undefined;
	}

	async setRoutingMode(mode: KlermRoutingMode): Promise<void> {
		await this.configStore.update({ routing: mode });
		this.state = {
			...this.state,
			mode,
			lane: "direct",
			task: undefined,
			selectedTarget: undefined,
			otherModelCalled: undefined,
			handoffReason: undefined,
			reason: undefined,
		};
	}

	async setAllowFrontierFallback(enabled: boolean): Promise<void> {
		await this.configStore.update({ allowFrontierFallback: enabled });
	}

	async setLocalModel(reference: string | undefined): Promise<void> {
		if (reference) this.resolveModel(reference, "local");
		await this.configStore.update({ localModel: reference });
		this.state = {
			...this.state,
			localModel: reference,
			task: undefined,
			otherModelCalled: undefined,
			handoffReason: undefined,
		};
	}

	async setFrontierModel(reference: string | undefined): Promise<void> {
		if (reference) this.resolveModel(reference, "frontier");
		await this.configStore.update({ frontierModel: reference });
		this.state = {
			...this.state,
			frontierModel: reference,
			task: undefined,
			otherModelCalled: undefined,
			handoffReason: undefined,
		};
	}

	getLocalModels(): Model<any>[] {
		return [...this.modelRuntime.getAvailableSnapshot()].filter((model) => LOCAL_PROVIDER_IDS.has(model.provider));
	}

	getFrontierModels(): Model<any>[] {
		return [...this.modelRuntime.getAvailableSnapshot()].filter((model) => !LOCAL_PROVIDER_IDS.has(model.provider));
	}

	private resolveModel(reference: string, lane: "local" | "frontier"): Model<any> {
		const model = findExactModelReferenceMatch(reference, [...this.modelRuntime.getAvailableSnapshot()]);
		if (!model) throw new Error(`Model "${reference}" is unavailable. Use /${lane} to select an available model.`);
		if (lane === "local" && !LOCAL_PROVIDER_IDS.has(model.provider)) {
			throw new Error(`Model "${reference}" is not a local model.`);
		}
		if (lane === "frontier" && LOCAL_PROVIDER_IDS.has(model.provider)) {
			throw new Error(`Model "${reference}" is local; select it with /local.`);
		}
		return model;
	}

	private profileHash(): string {
		return hash(
			JSON.stringify({
				localModel: this.config.localModel,
				frontierModel: this.config.frontierModel,
				localMaxTurns: this.config.localMaxTurns,
				localMaxToolErrors: this.config.localMaxToolErrors,
			}),
		);
	}

	private async log(decision: KlermRouteDecision): Promise<void> {
		await appendKlermRouteDecision(this.cwd, decision);
	}

	private async selectAutoRoute(
		task: string,
		localModel: Model<any>,
	): Promise<{
		route: "LOCAL" | "FRONTIER";
		reason: string;
		complexity: number;
	}> {
		try {
			const response = await this.modelRuntime.completeSimple(
				localModel,
				{
					systemPrompt:
						'You are the Klerm router. Return only JSON: {"route":"LOCAL"|"FRONTIER","complexity":1-10,"reason":"short reason"}. Choose LOCAL for small edits, questions, and focused work. Choose FRONTIER for repository-scale architecture, security-critical, or highly complex work.',
					messages: [{ role: "user", content: task, timestamp: Date.now() }],
				},
				{ signal: AbortSignal.timeout(30_000) },
			);
			if (response.stopReason === "error" || response.stopReason === "aborted")
				throw new Error(response.errorMessage);
			const text = assistantText(response);
			const start = text.indexOf("{");
			const end = text.lastIndexOf("}");
			if (start < 0 || end <= start) throw new Error("router did not return JSON");
			const parsed = JSON.parse(text.slice(start, end + 1)) as {
				route?: unknown;
				reason?: unknown;
				complexity?: unknown;
			};
			if (parsed.route !== "LOCAL" && parsed.route !== "FRONTIER")
				throw new Error("router returned an invalid route");
			return {
				route: parsed.route,
				reason:
					typeof parsed.reason === "string" && parsed.reason.trim()
						? parsed.reason.trim()
						: "local router decision",
				complexity:
					typeof parsed.complexity === "number" && Number.isFinite(parsed.complexity)
						? Math.max(1, Math.min(10, Math.round(parsed.complexity)))
						: parsed.route === "LOCAL"
							? 3
							: 8,
			};
		} catch {
			return heuristicRoute(task);
		}
	}

	async routePrompt(
		task: string,
		routingOverride?: KlermPromptRoutingOverride,
	): Promise<KlermModelTransition | undefined> {
		this.task = task;
		this.pendingDelegation = undefined;
		this.localTurns = 0;
		this.localToolErrors = 0;
		this.lastToolSignature = undefined;
		this.repeatedToolCalls = 0;
		this.explicitFrontierRequest = explicitlyRequestsFrontier(task);
		const config = this.config;
		if (config.routing === "off" && !routingOverride) {
			this.state = {
				...this.state,
				task,
				mode: "off",
				lane: "direct",
				selectedTarget: undefined,
				otherModelCalled: undefined,
				handoffReason: undefined,
				reason: undefined,
			};
			return undefined;
		}

		const timestamp = new Date().toISOString();
		const taskId = `task-${hash(`${timestamp}\n${task}`).slice(0, 16)}`;
		let route: "LOCAL" | "FRONTIER";
		let reason: string;
		let complexity: number | undefined;
		let routerModel: string | undefined;

		if (routingOverride === "local") {
			route = "LOCAL";
			reason = "interactive task forced local";
		} else if (routingOverride === "frontier") {
			route = "FRONTIER";
			reason = "interactive task forced frontier";
		} else if (config.routing === "local") {
			route = "LOCAL";
			reason = "routing mode forced local";
		} else if (config.routing === "frontier") {
			route = "FRONTIER";
			reason = "routing mode forced frontier";
		} else {
			if (!config.localModel) {
				if (config.allowFrontierFallback && config.frontierModel) {
					route = "FRONTIER";
					reason = "local router is not configured and explicit frontier fallback is enabled";
				} else {
					throw new Error("Auto routing requires a local model. Use /local or --local-model.");
				}
			} else {
				const localModel = this.resolveModel(config.localModel, "local");
				routerModel = modelReference(localModel);
				const decision = await this.selectAutoRoute(task, localModel);
				route = decision.route;
				reason = decision.reason;
				complexity = decision.complexity;
			}
		}

		const reference = route === "LOCAL" ? config.localModel : config.frontierModel;
		if (!reference)
			throw new Error(`${route === "LOCAL" ? "Local" : "Frontier"} routing requires a configured model.`);
		const model = this.resolveModel(reference, route === "LOCAL" ? "local" : "frontier");
		const selectedTarget = modelReference(model);
		this.state = {
			taskId,
			task,
			mode: config.routing,
			lane: route === "LOCAL" ? "local" : "frontier",
			localModel: config.localModel,
			frontierModel: config.frontierModel,
			selectedTarget,
			otherModelCalled: routerModel && routerModel !== selectedTarget ? routerModel : undefined,
			reason,
		};
		await this.log({
			timestamp,
			taskId,
			event: "INITIAL_ROUTE",
			task,
			route,
			routerModel,
			selectedTarget,
			reason,
			complexity,
			registryProfileHash: this.profileHash(),
			mode: config.routing,
			cwd: this.cwd,
		});
		await this.log({
			timestamp,
			taskId,
			event: route === "LOCAL" ? "LOCAL_STARTED" : "FRONTIER_STARTED",
			task,
			route,
			routerModel,
			selectedTarget,
			reason,
			complexity,
			registryProfileHash: this.profileHash(),
			mode: config.routing,
			cwd: this.cwd,
		});
		return { model, reason };
	}

	requestFrontierDelegation(delegation: PendingDelegation): void {
		this.pendingDelegation = delegation;
	}

	createDelegationTool(): ToolDefinition {
		return defineTool({
			name: "delegate_frontier",
			label: "Delegate to frontier",
			description:
				"Hand the current task to the configured frontier model. The local worker must use this when the user explicitly asks to consult Codex, a frontier model, or the other configured model, and may use it for complex, risky, or blocked work.",
			promptSnippet:
				"Hand the task to the configured frontier worker, including completed work and precise remaining instructions.",
			promptGuidelines: [
				"When acting as the Klerm local worker, use delegate_frontier whenever the user explicitly asks to consult, ask, use, delegate to, or hand off to Codex, the frontier model, or the other configured model.",
				"When acting as the Klerm local worker, use delegate_frontier when the task exceeds your capability or repeated tool attempts fail.",
				"As the local worker, do not replace a requested frontier handoff with a textual explanation; invoke delegate_frontier.",
				"Call delegate_frontier through the native tool interface with reason, summary, and remainingWork string arguments. Never print a code example that imitates the call.",
			],
			parameters: delegateSchema,
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				this.requestFrontierDelegation(params);
				return {
					content: [
						{
							type: "text",
							text: `Delegation accepted. The frontier worker will continue this session.\nSummary: ${params.summary}\nRemaining work: ${params.remainingWork}`,
						},
					],
					details: params,
				};
			},
		});
	}

	async enforceExplicitFrontierDelegation(localResponse: string): Promise<KlermEnforcedDelegation | undefined> {
		if (this.state.lane !== "local" || !this.explicitFrontierRequest || this.pendingDelegation) return undefined;

		const reason = "user explicitly requested frontier delegation; Klerm enforced the handoff";
		const summary = localResponse.trim() || "The local worker returned without a native delegation tool call.";
		this.requestFrontierDelegation({
			reason,
			summary,
			remainingWork: this.task,
		});
		const localReference = this.config.localModel;
		if (!localReference) throw new Error("Cannot enforce frontier delegation without a configured local model.");
		const localModel = this.resolveModel(localReference, "local");
		const transition = await this.prepareNextTurn({
			message: {
				role: "assistant",
				content: [{ type: "text", text: localResponse }],
				api: localModel.api,
				provider: localModel.provider,
				model: localModel.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			},
			toolResults: [],
			context: { systemPrompt: "", messages: [], tools: [] },
			newMessages: [],
		});
		if (!transition) return undefined;
		return {
			...transition,
			handoffPrompt: [
				"[Klerm enforced frontier handoff]",
				`Reason: ${reason}`,
				`Local worker response: ${summary}`,
				`Original task: ${this.task}`,
				"Continue the original task as the configured frontier worker and answer the user directly.",
			].join("\n"),
		};
	}

	async prepareNextTurn(turn: PrepareNextTurnContext): Promise<KlermModelTransition | undefined> {
		if (this.state.lane !== "local") return undefined;
		this.localTurns++;
		this.localToolErrors += turn.toolResults.filter((result) => result.isError).length;
		const toolCalls = turn.message.content.filter((part) => part.type === "toolCall");
		const signature = toolCalls.map((call) => `${call.name}:${JSON.stringify(call.arguments)}`).join("|");
		if (signature && signature === this.lastToolSignature) this.repeatedToolCalls++;
		else this.repeatedToolCalls = 0;
		this.lastToolSignature = signature || undefined;

		let reason: string | undefined;
		if (this.pendingDelegation) reason = this.pendingDelegation.reason;
		else if (this.localToolErrors >= this.config.localMaxToolErrors) reason = "local tool error limit reached";
		else if (this.localTurns >= this.config.localMaxTurns && turn.toolResults.length > 0)
			reason = "local turn limit reached";
		else if (this.repeatedToolCalls >= 2) reason = "local worker repeated the same tool call";
		if (!reason) return undefined;

		const reference = this.config.frontierModel;
		if (!reference)
			throw new Error(
				`Local worker requested frontier delegation (${reason}), but no frontier model is configured.`,
			);
		const model = this.resolveModel(reference, "frontier");
		const selectedTarget = modelReference(model);
		const timestamp = new Date().toISOString();
		const taskId = this.state.taskId ?? `task-${hash(`${timestamp}\n${this.task}`).slice(0, 16)}`;
		this.state = {
			...this.state,
			lane: "frontier",
			selectedTarget,
			otherModelCalled: this.state.otherModelCalled ?? this.state.selectedTarget ?? this.config.localModel,
			handoffReason: reason,
			reason,
		};
		await this.log({
			timestamp,
			taskId,
			event: "DELEGATE_FRONTIER",
			task: this.task,
			route: "FRONTIER",
			routerModel: this.config.localModel,
			selectedTarget,
			reason,
			registryProfileHash: this.profileHash(),
			mode: this.config.routing,
			cwd: this.cwd,
		});
		await this.log({
			timestamp,
			taskId,
			event: "FRONTIER_STARTED",
			task: this.task,
			route: "FRONTIER",
			routerModel: this.config.localModel,
			selectedTarget,
			reason,
			registryProfileHash: this.profileHash(),
			mode: this.config.routing,
			cwd: this.cwd,
		});
		this.pendingDelegation = undefined;
		return { model, reason };
	}

	async handleLocalFailure(errorMessage: string | undefined): Promise<KlermModelTransition | undefined> {
		if (this.state.lane !== "local") return undefined;
		this.requestFrontierDelegation({
			reason: `local provider failed${errorMessage ? `: ${errorMessage}` : ""}`,
			summary: "The local provider failed before completing its turn.",
			remainingWork: "Continue the original task using the existing session context.",
		});
		return this.prepareNextTurn({
			message: {
				role: "assistant",
				content: [],
				api: "openai-completions",
				provider: "ollama",
				model: this.config.localModel ?? "local",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error",
				errorMessage,
				timestamp: Date.now(),
			},
			toolResults: [],
			context: { systemPrompt: "", messages: [], tools: [] },
			newMessages: [],
		});
	}

	async recordCompletion(success: boolean): Promise<void> {
		try {
			if (!this.state.taskId) return;
			await this.log({
				timestamp: new Date().toISOString(),
				taskId: this.state.taskId,
				event: success ? "TASK_COMPLETED" : "TASK_FAILED",
				task: this.task,
				route: this.state.lane === "local" ? "LOCAL" : this.state.lane === "frontier" ? "FRONTIER" : "SELF",
				routerModel: this.config.localModel,
				selectedTarget: this.state.selectedTarget ?? "direct",
				reason: success ? "agent run completed" : "agent run failed",
				registryProfileHash: this.profileHash(),
				mode: this.config.routing,
				cwd: this.cwd,
			});
		} finally {
			const { task, selectedTarget, otherModelCalled, handoffReason, reason } = this.state;
			this.state = {
				task,
				mode: this.config.routing,
				lane: "direct",
				localModel: this.config.localModel,
				frontierModel: this.config.frontierModel,
				selectedTarget,
				otherModelCalled,
				handoffReason,
				reason,
			};
			this.pendingDelegation = undefined;
		}
	}

	describe(): string {
		return [
			`Routing: ${this.state.mode}`,
			`Active lane: ${this.state.lane}`,
			`Local model: ${this.config.localModel ?? "not configured"}`,
			`Frontier model: ${this.config.frontierModel ?? "not configured"}`,
			`Frontier fallback: ${this.config.allowFrontierFallback ? "on" : "off"}`,
			`Other model called: ${this.state.otherModelCalled ?? "none"}`,
			`Task: ${this.state.task ?? "none"}`,
			`Last decision: ${this.state.reason ?? "none"}`,
		].join("\n");
	}
}
