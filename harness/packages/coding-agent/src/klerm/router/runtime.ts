import { createHash } from "node:crypto";
import type { AgentMessage, PrepareNextTurnContext } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "../../core/extensions/types.ts";
import { findExactModelReferenceMatch } from "../../core/model-resolver.ts";
import type { ModelRuntime } from "../../core/model-runtime.ts";
import type { KlermConfig, KlermConfigStore, KlermRoutingMode } from "../config.ts";
import { appendKlermRouteDecision } from "./decision-log.ts";
import type {
	KlermCompletionOwner,
	KlermDecisionSource,
	KlermHandoffTrigger,
	KlermPromptRoutingOverride,
	KlermRouteDecision,
	KlermRoutingState,
	KlermTransitionState,
	KlermWorkerLane,
} from "./types.ts";

const LOCAL_PROVIDER_IDS = new Set(["ollama", "llama.cpp"]);

const delegateSchema = Type.Object({
	reason: Type.String({ maxLength: 2000, description: "Why the local worker needs the frontier worker" }),
	summary: Type.String({ maxLength: 12000, description: "Work already completed and relevant findings" }),
	remainingWork: Type.String({ maxLength: 12000, description: "What the frontier worker should do next" }),
});

const returnToLocalSchema = Type.Object({
	reason: Type.String({ maxLength: 2000, description: "Why the frontier assignment is ready for local review" }),
	frontierSummary: Type.String({ maxLength: 12000, description: "Work completed and important findings" }),
	frontierAnswer: Type.String({ maxLength: 16000, description: "Draft answer or result for the local orchestrator" }),
	changedFiles: Type.Array(Type.String({ maxLength: 2000 }), { maxItems: 200 }),
	verification: Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 100 }),
	openIssues: Type.Array(Type.String({ maxLength: 4000 }), { maxItems: 100 }),
	recommendedNextAction: Type.Union([
		Type.Literal("finalize"),
		Type.Literal("verify"),
		Type.Literal("delegate-again"),
	]),
});

interface PendingDelegation {
	reason: string;
	summary: string;
	remainingWork: string;
	trigger: KlermHandoffTrigger;
}

interface PendingReturnToLocal {
	reason: string;
	frontierSummary: string;
	frontierAnswer: string;
	changedFiles: string[];
	verification: string[];
	openIssues: string[];
	recommendedNextAction: "finalize" | "verify" | "delegate-again";
	trigger: KlermHandoffTrigger;
}

interface AutoRouteDecision {
	route: "LOCAL" | "FRONTIER";
	reason: string;
	complexity: number;
	score: number;
	confidence: number;
	risk: number;
	capabilityFactors: string[];
	policyTriggers: string[];
	decisionSource: KlermDecisionSource;
	fallbackReason?: string;
}

export interface KlermModelTransition {
	model: Model<any>;
	reason: string;
	state: KlermTransitionState;
	fallbackToSource: boolean;
	handoffPrompt?: string;
	commit: () => Promise<void>;
	reject: (error: unknown) => Promise<void>;
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
	const field = (key: string): string => (typeof args[key] === "string" ? args[key] : "(not provided)");
	if (name === "delegate_frontier") {
		return [
			"[Cross-model handoff]",
			`Reason: ${field("reason")}`,
			`Summary: ${field("summary")}`,
			`Remaining work: ${field("remainingWork")}`,
		].join("\n");
	}
	if (name === "return_to_local") {
		const list = (key: string): string =>
			Array.isArray(args[key]) ? (args[key] as unknown[]).filter((item) => typeof item === "string").join(", ") : "";
		return [
			"[Frontier return]",
			`Reason: ${field("reason")}`,
			`Summary: ${field("frontierSummary")}`,
			`Draft answer: ${field("frontierAnswer")}`,
			`Changed files: ${list("changedFiles") || "none reported"}`,
			`Verification: ${list("verification") || "none reported"}`,
			`Open issues: ${list("openIssues") || "none reported"}`,
			`Recommended next action: ${field("recommendedNextAction")}`,
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

	const hasForeignAssistant = messages.some(
		(message) =>
			message.role === "assistant" &&
			(message.provider !== target.provider || message.api !== target.api || message.model !== target.id),
	);
	if (!hasForeignAssistant) return messages;
	const toolCallsById = new Map<string, Array<{ name: string; foreign: boolean }>>();

	let changed = false;
	const projected = messages.map((message): AgentMessage => {
		if (message.role === "assistant") {
			const isForeign =
				message.provider !== target.provider || message.api !== target.api || message.model !== target.id;
			for (const part of message.content) {
				if (part.type !== "toolCall") continue;
				const calls = toolCallsById.get(part.id) ?? [];
				calls.push({ name: part.name, foreign: isForeign });
				toolCallsById.set(part.id, calls);
			}
			if (!isForeign) return message;

			changed = true;
			const content = message.content.flatMap((part) => {
				if (part.type === "text") {
					const text =
						part.text.length > 8000 ? `${part.text.slice(0, 8000)}\n[Prior response truncated]` : part.text;
					return text.trim() ? [{ type: "text" as const, text: `[Prior model response]\n${text}` }] : [];
				}
				if (part.type === "thinking") return [];
				return [{ type: "text" as const, text: formatForeignToolCall(part.name, part.arguments) }];
			});
			return {
				role: "user",
				content: content.length > 0 ? content : [{ type: "text", text: "[Prior model response omitted]" }],
				timestamp: message.timestamp,
			};
		}

		if (message.role === "toolResult") {
			const calls = toolCallsById.get(message.toolCallId);
			let matchingIndex = -1;
			if (calls) {
				for (let index = calls.length - 1; index >= 0; index--) {
					if (calls[index]?.name !== message.toolName) continue;
					matchingIndex = index;
					break;
				}
			}
			const call = matchingIndex >= 0 ? calls?.splice(matchingIndex, 1)[0] : calls?.pop();
			if (!call?.foreign) return message;
			const toolName = call.name;
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
						part.type === "text"
							? {
									type: "text" as const,
									text:
										part.text.length > 8000
											? `${part.text.slice(0, 8000)}\n[Tool result truncated]`
											: part.text,
								}
							: { ...part },
					),
				],
				timestamp: message.timestamp,
			};
		}

		return message;
	});
	return changed ? projected : messages;
}

function deterministicAssessment(task: string): {
	complexityFloor: number;
	riskFloor: number;
	factors: string[];
} {
	let complexityFloor = 1;
	let riskFloor = 0;
	const factors: string[] = [];
	if (
		/\b(security audit|authentication system|authorization|credentials?|secrets?|cryptography|encryption|payment|production deploy|database migration|schema migration|destructive data)\b|biztonsági audit|hitelesítés|jogosultság|titkosítás|éles telepítés|adatbázis[- ]migráció/iu.test(
			task,
		)
	) {
		complexityFloor = Math.max(complexityFloor, 7);
		riskFloor = Math.max(riskFloor, 0.75);
		factors.push("security, production, or data-integrity sensitive work");
	}
	if (
		/\b(architecture|architectural|multi[- ]?package|large refactor|across the (repository|codebase)|concurrent|distributed)\b|architektúra|több csomag|nagy refaktor|teljes (repó|repository|kódbázis)/iu.test(
			task,
		)
	) {
		complexityFloor = Math.max(complexityFloor, 8);
		riskFloor = Math.max(riskFloor, 0.55);
		factors.push("repository-scale or architectural scope");
	}
	if (task.length > 1200) {
		complexityFloor = Math.max(complexityFloor, 7);
		factors.push("long multi-part task description");
	}
	return { complexityFloor, riskFloor, factors };
}

function heuristicRoute(task: string, fallbackReason = "router-error"): AutoRouteDecision {
	const assessment = deterministicAssessment(task);
	const complex = task.length > 600 || assessment.complexityFloor >= 7;
	return complex
		? {
				route: "FRONTIER",
				reason: "deterministic fallback selected frontier for complex or sensitive work",
				complexity: Math.max(8, assessment.complexityFloor),
				score: 0.4,
				confidence: 0.6,
				risk: Math.max(0.65, assessment.riskFloor),
				capabilityFactors:
					assessment.factors.length > 0 ? assessment.factors : ["task exceeds the focused local-work threshold"],
				policyTriggers: ["deterministic fallback selected frontier"],
				decisionSource: "deterministic-fallback",
				fallbackReason,
			}
		: {
				route: "LOCAL",
				reason: "deterministic fallback selected local for focused low-risk work",
				complexity: 3,
				score: 0.8,
				confidence: 0.8,
				risk: 0.2,
				capabilityFactors: ["focused low-risk task"],
				policyTriggers: [],
				decisionSource: "deterministic-fallback",
				fallbackReason,
			};
}

function applyHybridPolicy(
	task: string,
	assessment: Omit<AutoRouteDecision, "route" | "reason" | "policyTriggers" | "decisionSource"> & {
		proposedRoute: "LOCAL" | "FRONTIER";
		modelReason: string;
	},
): AutoRouteDecision {
	const deterministic = deterministicAssessment(task);
	const complexity = Math.max(assessment.complexity, deterministic.complexityFloor);
	const risk = Math.max(assessment.risk, deterministic.riskFloor);
	const capabilityFactors = [...new Set([...assessment.capabilityFactors, ...deterministic.factors])];
	const policyTriggers: string[] = [];
	if (assessment.proposedRoute === "FRONTIER") policyTriggers.push("local model requested frontier");
	if (assessment.score < 0.65) policyTriggers.push(`local capability score ${assessment.score.toFixed(2)} < 0.65`);
	if (assessment.confidence < 0.7) policyTriggers.push(`local confidence ${assessment.confidence.toFixed(2)} < 0.70`);
	if (risk >= 0.65) policyTriggers.push(`task risk ${risk.toFixed(2)} >= 0.65`);
	if (complexity >= 7) policyTriggers.push(`task complexity ${complexity} >= 7`);
	const route = policyTriggers.length > 0 ? "FRONTIER" : "LOCAL";
	return {
		route,
		reason:
			route === "FRONTIER"
				? `hybrid auto policy selected frontier (${policyTriggers.join("; ")}); local assessment: ${assessment.modelReason}`
				: `hybrid auto policy selected local; local assessment: ${assessment.modelReason}`,
		complexity,
		score: assessment.score,
		confidence: assessment.confidence,
		risk,
		capabilityFactors,
		policyTriggers,
		decisionSource: "local-model",
	};
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
	private pendingReturnToLocal?: PendingReturnToLocal;
	private preparedTransitionId?: string;
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
			handbackEnabled: config.handbackEnabled,
			delegationCycle: 0,
			maxDelegationCycles: config.maxDelegationCycles,
			transitionSequence: 0,
			explicitFrontierRequestSatisfied: false,
		};
	}

	get config(): Readonly<KlermConfig> {
		return this.configStore.get();
	}

	get routingState(): Readonly<KlermRoutingState> {
		return this.state;
	}

	private handbackRequired(): boolean {
		return (
			this.state.lane === "frontier" &&
			this.state.completionOwner === "local" &&
			this.config.handbackEnabled &&
			this.config.localModel !== undefined
		);
	}

	getSystemPromptContribution(): string | undefined {
		const localModel = this.config.localModel ?? "not configured";
		const frontierModel = this.config.frontierModel ?? "not configured";
		if (this.state.lane === "local") {
			const returnedFromFrontier = this.state.lastTransition?.kind === "return";
			return [
				"<klerm_a2a>",
				returnedFromFrontier
					? "You are the Klerm local orchestrator resumed after frontier work. Verify the returned result, complete focused local work, and answer the user when the task is ready."
					: "You are the Klerm local worker and may hand work to the configured frontier worker.",
				`Current local model: ${localModel}`,
				`Configured frontier model: ${frontierModel}`,
				`Frontier delegation cycle: ${this.state.delegationCycle ?? 0}/${this.config.maxDelegationCycles}`,
				...(returnedFromFrontier && this.state.lastTransition?.transcriptHash
					? [`Frontier transcript hash: ${this.state.lastTransition.transcriptHash}`]
					: []),
				"Call delegate_frontier when the user explicitly asks you to ask, consult, use, delegate to, or hand off to the frontier model, Codex, Claude, Gemini, or the other configured model. An explicit user request requires delegation even when the task is simple.",
				"Also call delegate_frontier when the task exceeds your capability, is unusually risky, or repeated tool attempts fail.",
				'Invoke it through the native tool interface with exactly these string arguments: {"reason":"why frontier is needed","summary":"completed local work and findings","remainingWork":"what frontier must do next"}.',
				"Never print delegate_frontier as TypeScript, JSON, XML, Markdown, or a code block. Text that resembles a tool call does not execute the tool.",
				"Before delegating, complete any specifically requested local-only observation. Put completed work and findings in summary, and give the frontier worker a precise remainingWork instruction. Call delegate_frontier alone, without other tool calls in the same turn.",
				"After a frontier return, finalize locally when possible. Delegate again only for a concrete unresolved issue that still exceeds local capability.",
				"Do not merely say that delegation is unnecessary or describe how to delegate. Invoke delegate_frontier and let Klerm perform the handoff.",
				"PI_PROVIDER and PI_MODEL describe the model currently executing a shell command; inspecting them is not a substitute for a requested frontier handoff.",
				"Do not claim that the frontier worker answered unless the handoff occurred and the frontier worker actually responded.",
				"</klerm_a2a>",
			].join("\n");
		}

		if (this.state.lane === "frontier") {
			const mustReturn = this.handbackRequired();
			return [
				"<klerm_a2a>",
				"You are the Klerm frontier worker. Continue the current task using the existing session and provider-neutral handoff context.",
				`Local worker model: ${localModel}`,
				`Current frontier model: ${frontierModel}`,
				"Treat [Cross-model handoff] sections as instructions and context supplied by the local worker.",
				`When the user asks which model you are, identify the current frontier model exactly as ${frontierModel}.`,
				"Do not call delegate_frontier because you are already the frontier worker.",
				"Do not restart completed local work unless verification is required; continue from the stated summary and remaining work.",
				mustReturn
					? "This task is owned by the local orchestrator. When your assignment is complete, call return_to_local alone with a structured summary, draft answer, changed files, verification, open issues, and recommended next action. Do not finish with a direct user answer."
					: "This is a direct frontier task. Answer the user directly and do not call return_to_local.",
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
			complexity: undefined,
			score: undefined,
			confidence: undefined,
			risk: undefined,
			capabilityFactors: undefined,
			policyTriggers: undefined,
			decisionSource: undefined,
			fallbackReason: undefined,
			completionOwner: undefined,
			delegationCycle: 0,
			maxDelegationCycles: this.config.maxDelegationCycles,
			transitionSequence: 0,
			lastTransition: undefined,
			explicitFrontierRequestSatisfied: false,
		};
	}

	async setAllowFrontierFallback(enabled: boolean): Promise<void> {
		await this.configStore.update({ allowFrontierFallback: enabled });
	}

	async setHandbackEnabled(enabled: boolean): Promise<void> {
		await this.configStore.update({ handbackEnabled: enabled });
		this.state = { ...this.state, handbackEnabled: enabled };
	}

	async setMaxDelegationCycles(maxDelegationCycles: number): Promise<void> {
		if (!Number.isInteger(maxDelegationCycles) || maxDelegationCycles < 1 || maxDelegationCycles > 20) {
			throw new Error("Delegation cycles must be an integer between 1 and 20.");
		}
		await this.configStore.update({ maxDelegationCycles });
		this.state = { ...this.state, maxDelegationCycles };
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
			reason: undefined,
			complexity: undefined,
			score: undefined,
			confidence: undefined,
			risk: undefined,
			capabilityFactors: undefined,
			policyTriggers: undefined,
			decisionSource: undefined,
			fallbackReason: undefined,
			completionOwner: undefined,
			delegationCycle: 0,
			transitionSequence: 0,
			lastTransition: undefined,
			explicitFrontierRequestSatisfied: false,
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
			reason: undefined,
			complexity: undefined,
			score: undefined,
			confidence: undefined,
			risk: undefined,
			capabilityFactors: undefined,
			policyTriggers: undefined,
			decisionSource: undefined,
			fallbackReason: undefined,
			completionOwner: undefined,
			delegationCycle: 0,
			transitionSequence: 0,
			lastTransition: undefined,
			explicitFrontierRequestSatisfied: false,
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
				handbackEnabled: this.config.handbackEnabled,
				maxDelegationCycles: this.config.maxDelegationCycles,
			}),
		);
	}

	private async log(decision: KlermRouteDecision): Promise<void> {
		await appendKlermRouteDecision(this.cwd, decision);
	}

	private async logLifecycle(
		event: KlermRouteDecision["event"],
		route: "LOCAL" | "FRONTIER" | "SELF",
		selectedTarget: string,
		reason: string,
		transition?: KlermTransitionState,
		counts?: { changedFileCount?: number; verificationCount?: number; openIssueCount?: number },
	): Promise<void> {
		const timestamp = new Date().toISOString();
		const taskId = this.state.taskId ?? `task-${hash(`${timestamp}\n${this.task}`).slice(0, 16)}`;
		await this.log({
			timestamp,
			taskId,
			event,
			task: this.task,
			route,
			routerModel: this.config.localModel,
			selectedTarget,
			reason,
			complexity: this.state.complexity,
			score: this.state.score,
			confidence: this.state.confidence,
			risk: this.state.risk,
			capabilityFactors: this.state.capabilityFactors,
			policyTriggers: this.state.policyTriggers,
			decisionSource: this.state.decisionSource,
			fallbackReason: this.state.fallbackReason,
			completionOwner:
				transition?.toLane === "frontier" &&
				(!this.config.handbackEnabled || transition.trigger === "provider-failure")
					? "frontier"
					: this.state.completionOwner,
			handbackEnabled: this.config.handbackEnabled,
			transitionId: transition?.id,
			transitionSequence: transition?.sequence,
			transitionKind: transition?.kind,
			fromLane: transition?.fromLane,
			toLane: transition?.toLane,
			fromTarget: transition?.fromTarget,
			trigger: transition?.trigger,
			delegationCycle: transition?.cycle ?? this.state.delegationCycle,
			maxDelegationCycles: transition?.maxCycles ?? this.config.maxDelegationCycles,
			transcriptHash: transition?.transcriptHash,
			changedFileCount: counts?.changedFileCount,
			verificationCount: counts?.verificationCount,
			openIssueCount: counts?.openIssueCount,
			registryProfileHash: this.profileHash(),
			mode: this.config.routing,
			cwd: this.cwd,
		});
	}

	private async prepareTransition(options: {
		kind: "initial" | "delegate" | "return";
		toLane: KlermWorkerLane;
		model: Model<any>;
		reason: string;
		trigger: KlermHandoffTrigger;
		cycle: number;
		transcriptHash?: string;
		completionOwner?: KlermCompletionOwner;
		returnCounts?: { changedFileCount: number; verificationCount: number; openIssueCount: number };
	}): Promise<KlermModelTransition> {
		if (this.preparedTransitionId) throw new Error("A Klerm model transition is already pending.");
		const fromLane = this.state.lane;
		const toTarget = modelReference(options.model);
		const sequence = (this.state.transitionSequence ?? 0) + 1;
		const transition: KlermTransitionState = {
			id: `transition-${this.state.taskId ?? "task"}-${sequence}`,
			sequence,
			kind: options.kind,
			fromLane,
			toLane: options.toLane,
			fromTarget: this.state.selectedTarget,
			toTarget,
			reason: options.reason,
			trigger: options.trigger,
			cycle: options.cycle,
			maxCycles: this.config.maxDelegationCycles,
			transcriptHash: options.transcriptHash,
		};
		this.preparedTransitionId = transition.id;

		if (options.kind === "delegate") {
			await this.logLifecycle("DELEGATE_FRONTIER", "FRONTIER", toTarget, options.reason, transition);
		} else if (options.kind === "return") {
			if (options.trigger !== "provider-failure") {
				await this.logLifecycle(
					"FRONTIER_COMPLETED",
					"FRONTIER",
					this.state.selectedTarget ?? toTarget,
					options.reason,
					transition,
					options.returnCounts,
				);
			}
			await this.logLifecycle(
				"RETURN_TO_LOCAL",
				"LOCAL",
				toTarget,
				options.reason,
				transition,
				options.returnCounts,
			);
		}

		return {
			model: options.model,
			reason: options.reason,
			state: transition,
			fallbackToSource: options.kind !== "initial",
			commit: async () => {
				if (this.preparedTransitionId !== transition.id) return;
				await this.logLifecycle(
					options.kind === "return"
						? "LOCAL_RESUMED"
						: options.toLane === "local"
							? "LOCAL_STARTED"
							: "FRONTIER_STARTED",
					options.toLane === "local" ? "LOCAL" : "FRONTIER",
					toTarget,
					options.reason,
					transition,
					options.returnCounts,
				);
				this.state = {
					...this.state,
					lane: options.toLane,
					selectedTarget: toTarget,
					otherModelCalled:
						options.kind === "initial"
							? this.state.otherModelCalled
							: (transition.fromTarget ?? this.state.otherModelCalled),
					completionOwner: options.completionOwner ?? this.state.completionOwner,
					delegationCycle: options.cycle,
					maxDelegationCycles: this.config.maxDelegationCycles,
					transitionSequence: sequence,
					lastTransition: transition,
					handoffReason: options.kind === "initial" ? undefined : options.reason,
					reason: options.reason,
					explicitFrontierRequestSatisfied:
						options.toLane === "frontier" ? true : this.state.explicitFrontierRequestSatisfied,
				};
				if (options.toLane === "local") {
					this.localTurns = 0;
					this.localToolErrors = 0;
					this.lastToolSignature = undefined;
					this.repeatedToolCalls = 0;
				}
				this.pendingDelegation = undefined;
				this.pendingReturnToLocal = undefined;
				this.preparedTransitionId = undefined;
			},
			reject: async (error) => {
				if (this.preparedTransitionId !== transition.id) return;
				this.preparedTransitionId = undefined;
				this.pendingDelegation = undefined;
				this.pendingReturnToLocal = undefined;
				const message = error instanceof Error ? error.message : String(error);
				this.state = {
					...this.state,
					reason: `handoff failed: ${message}`,
					completionOwner: this.state.lane === "frontier" ? "frontier" : this.state.completionOwner,
				};
				await this.logLifecycle(
					"HANDOFF_FAILED",
					this.state.lane === "local" ? "LOCAL" : this.state.lane === "frontier" ? "FRONTIER" : "SELF",
					this.state.selectedTarget ?? transition.fromTarget ?? "direct",
					`transition to ${toTarget} failed: ${message}`,
					transition,
				);
			},
		};
	}

	private async selectAutoRoute(task: string, localModel: Model<any>): Promise<AutoRouteDecision> {
		try {
			const routerPrompt = [
				"You are the Klerm local capability router. Assess whether this exact local model can complete the task correctly without frontier help.",
				`Local model profile: ${JSON.stringify({
					reference: modelReference(localModel),
					contextWindow: localModel.contextWindow,
					maxTokens: localModel.maxTokens,
					reasoning: localModel.reasoning,
					input: localModel.input,
				})}`,
				"Return only one JSON object with this exact shape:",
				'{"route":"LOCAL"|"FRONTIER","score":0.0-1.0,"confidence":0.0-1.0,"risk":0.0-1.0,"complexity":1-10,"factors":["short factor"],"reason":"short reason"}',
				"score means this local model's ability to finish correctly without frontier help. confidence means certainty in that ability and assessment. risk means the consequence of an incorrect local result.",
				"Choose LOCAL only for focused, low-risk work when score >= 0.65, confidence >= 0.70, risk < 0.65, and complexity < 7.",
				"Choose FRONTIER when unsure, when broad repository context or specialist reasoning is needed, or for security, authentication, migrations, destructive changes, production incidents, architecture, and large refactors.",
				"Do not overstate confidence. The policy may override LOCAL for safety.",
			].join("\n");
			const response = await this.modelRuntime.completeSimple(
				localModel,
				{
					systemPrompt: routerPrompt,
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
				score?: unknown;
				confidence?: unknown;
				risk?: unknown;
				factors?: unknown;
			};
			if (parsed.route !== "LOCAL" && parsed.route !== "FRONTIER")
				throw new Error("router returned an invalid route");
			if (
				typeof parsed.score !== "number" ||
				!Number.isFinite(parsed.score) ||
				typeof parsed.confidence !== "number" ||
				!Number.isFinite(parsed.confidence) ||
				typeof parsed.risk !== "number" ||
				!Number.isFinite(parsed.risk) ||
				typeof parsed.complexity !== "number" ||
				!Number.isFinite(parsed.complexity) ||
				parsed.score < 0 ||
				parsed.score > 1 ||
				parsed.confidence < 0 ||
				parsed.confidence > 1 ||
				parsed.risk < 0 ||
				parsed.risk > 1 ||
				parsed.complexity < 1 ||
				parsed.complexity > 10
			) {
				throw new Error("router omitted required numeric scores");
			}
			const factors = Array.isArray(parsed.factors)
				? parsed.factors
						.filter((factor): factor is string => typeof factor === "string" && factor.trim().length > 0)
						.map((factor) => factor.trim())
						.slice(0, 8)
				: [];
			return applyHybridPolicy(task, {
				proposedRoute: parsed.route,
				modelReason:
					typeof parsed.reason === "string" && parsed.reason.trim()
						? parsed.reason.trim()
						: "local model supplied no reason",
				complexity: Math.max(1, Math.min(10, Math.round(parsed.complexity))),
				score: parsed.score,
				confidence: parsed.confidence,
				risk: parsed.risk,
				capabilityFactors: factors.length > 0 ? factors : ["local model supplied no capability factors"],
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			const fallbackReason =
				error instanceof SyntaxError || message.includes("JSON") || message.includes("invalid route")
					? "invalid-json"
					: message.includes("numeric scores")
						? "missing-scores"
						: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
							? "timeout"
							: "provider-error";
			return heuristicRoute(task, fallbackReason);
		}
	}

	async routePrompt(
		task: string,
		routingOverride?: KlermPromptRoutingOverride,
	): Promise<KlermModelTransition | undefined> {
		this.task = task;
		this.pendingDelegation = undefined;
		this.pendingReturnToLocal = undefined;
		this.preparedTransitionId = undefined;
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
				complexity: undefined,
				score: undefined,
				confidence: undefined,
				risk: undefined,
				capabilityFactors: undefined,
				policyTriggers: undefined,
				decisionSource: undefined,
				fallbackReason: undefined,
				completionOwner: "direct",
				handbackEnabled: config.handbackEnabled,
				delegationCycle: 0,
				maxDelegationCycles: config.maxDelegationCycles,
				transitionSequence: 0,
				lastTransition: undefined,
				explicitFrontierRequestSatisfied: false,
			};
			return undefined;
		}

		const timestamp = new Date().toISOString();
		const taskId = `task-${hash(`${timestamp}\n${task}`).slice(0, 16)}`;
		let route: "LOCAL" | "FRONTIER";
		let reason: string;
		let complexity: number | undefined;
		let score: number | undefined;
		let confidence: number | undefined;
		let risk: number | undefined;
		let capabilityFactors: string[] | undefined;
		let policyTriggers: string[] | undefined;
		let decisionSource: KlermDecisionSource | undefined;
		let fallbackReason: string | undefined;
		let routerModel: string | undefined;
		let completionOwner: KlermCompletionOwner;

		if (routingOverride === "local") {
			route = "LOCAL";
			reason = "interactive task forced local";
			completionOwner = "local";
		} else if (routingOverride === "frontier") {
			route = "FRONTIER";
			reason = "interactive task forced frontier";
			completionOwner = "frontier";
		} else if (config.routing === "local") {
			route = "LOCAL";
			reason = "routing mode forced local";
			completionOwner = "local";
		} else if (config.routing === "frontier") {
			route = "FRONTIER";
			reason = "routing mode forced frontier";
			completionOwner = "frontier";
		} else {
			if (!config.localModel) {
				if (config.allowFrontierFallback && config.frontierModel) {
					route = "FRONTIER";
					reason = "local router is not configured and explicit frontier fallback is enabled";
					completionOwner = "frontier";
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
				score = decision.score;
				confidence = decision.confidence;
				risk = decision.risk;
				capabilityFactors = decision.capabilityFactors;
				policyTriggers = decision.policyTriggers;
				decisionSource = decision.decisionSource;
				fallbackReason = decision.fallbackReason;
				completionOwner = decision.route === "FRONTIER" && !config.handbackEnabled ? "frontier" : "local";
			}
		}

		const reference = route === "LOCAL" ? config.localModel : config.frontierModel;
		if (!reference)
			throw new Error(`${route === "LOCAL" ? "Local" : "Frontier"} routing requires a configured model.`);
		const model = this.resolveModel(reference, route === "LOCAL" ? "local" : "frontier");
		const selectedTarget = modelReference(model);
		const initialCycle = route === "FRONTIER" && completionOwner === "local" ? 1 : 0;
		this.state = {
			taskId,
			task,
			mode: config.routing,
			lane: "direct",
			localModel: config.localModel,
			frontierModel: config.frontierModel,
			selectedTarget: undefined,
			otherModelCalled: routerModel && routerModel !== selectedTarget ? routerModel : undefined,
			reason,
			complexity,
			score,
			confidence,
			risk,
			capabilityFactors,
			policyTriggers,
			decisionSource,
			fallbackReason,
			completionOwner,
			handbackEnabled: config.handbackEnabled,
			delegationCycle: initialCycle,
			maxDelegationCycles: config.maxDelegationCycles,
			transitionSequence: 0,
			lastTransition: undefined,
			explicitFrontierRequestSatisfied: false,
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
			score,
			confidence,
			risk,
			capabilityFactors,
			policyTriggers,
			decisionSource,
			fallbackReason,
			completionOwner,
			handbackEnabled: config.handbackEnabled,
			delegationCycle: initialCycle,
			maxDelegationCycles: config.maxDelegationCycles,
			registryProfileHash: this.profileHash(),
			mode: config.routing,
			cwd: this.cwd,
		});
		return this.prepareTransition({
			kind: "initial",
			toLane: route === "LOCAL" ? "local" : "frontier",
			model,
			reason,
			trigger: "initial-route",
			cycle: initialCycle,
			completionOwner,
		});
	}

	requestFrontierDelegation(
		delegation: Omit<PendingDelegation, "trigger">,
		trigger: KlermHandoffTrigger = "native-tool",
	): void {
		this.pendingDelegation = { ...delegation, trigger };
	}

	requestReturnToLocal(
		result: Omit<PendingReturnToLocal, "trigger">,
		trigger: KlermHandoffTrigger = "native-tool",
	): void {
		this.pendingReturnToLocal = { ...result, trigger };
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
				if (this.state.lane !== "local") {
					throw new Error("delegate_frontier is only available while the local worker is active.");
				}
				if (this.pendingDelegation || this.pendingReturnToLocal || this.preparedTransitionId) {
					throw new Error("A Klerm handoff is already pending for this turn.");
				}
				if ((this.state.delegationCycle ?? 0) >= this.config.maxDelegationCycles) {
					await this.logLifecycle(
						"HANDOFF_REJECTED",
						"LOCAL",
						this.state.selectedTarget ?? this.config.localModel ?? "local",
						`frontier delegation cycle limit ${this.config.maxDelegationCycles} reached`,
					);
					throw new Error(
						`Frontier delegation cycle limit ${this.config.maxDelegationCycles} reached. Finish with the available results.`,
					);
				}
				this.requestFrontierDelegation(params);
				return {
					content: [
						{
							type: "text",
							text: `Delegation recorded. Klerm will attempt to start the frontier worker.\nSummary: ${params.summary}\nRemaining work: ${params.remainingWork}`,
						},
					],
					details: params,
				};
			},
		});
	}

	createReturnToLocalTool(): ToolDefinition {
		return defineTool({
			name: "return_to_local",
			label: "Return to local",
			description:
				"Return completed frontier work to the local orchestrator for verification, additional work, or the final user answer.",
			promptSnippet: "Return frontier results to the local orchestrator as a structured handback packet.",
			promptGuidelines: [
				"Use return_to_local only when acting as the frontier worker on a task owned by the local orchestrator.",
				"Call return_to_local alone after completing the frontier assignment. Include changed files, verification, open issues, and a draft answer.",
				"Do not print a pseudo tool call or answer the user directly when the system prompt requires a local handback.",
			],
			parameters: returnToLocalSchema,
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				if (this.state.lane !== "frontier") {
					throw new Error("return_to_local is only available while the frontier worker is active.");
				}
				if (!this.handbackRequired()) {
					throw new Error(
						"This is a direct frontier task. Answer the user directly instead of returning to local.",
					);
				}
				if (this.pendingDelegation || this.pendingReturnToLocal || this.preparedTransitionId) {
					throw new Error("A Klerm handoff is already pending for this turn.");
				}
				this.requestReturnToLocal(params);
				return {
					content: [
						{
							type: "text",
							text: `Frontier return recorded. Klerm will attempt to resume the local orchestrator.\nSummary: ${params.frontierSummary}\nRecommended next action: ${params.recommendedNextAction}`,
						},
					],
					details: params,
				};
			},
		});
	}

	createRoutingTools(): ToolDefinition[] {
		return [this.createDelegationTool(), this.createReturnToLocalTool()];
	}

	async enforceExplicitFrontierDelegation(localResponse: string): Promise<KlermEnforcedDelegation | undefined> {
		if (
			this.state.lane !== "local" ||
			!this.explicitFrontierRequest ||
			this.state.explicitFrontierRequestSatisfied ||
			this.pendingDelegation
		)
			return undefined;

		const reason = "user explicitly requested frontier delegation; Klerm enforced the handoff";
		const summary = localResponse.trim() || "The local worker returned without a native delegation tool call.";
		this.requestFrontierDelegation(
			{
				reason,
				summary,
				remainingWork: this.task,
			},
			"explicit-enforcement",
		);
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
				"Continue the original task as the configured frontier worker. Return the completed assignment to the local orchestrator when required by the Klerm system prompt.",
			].join("\n"),
		};
	}

	async enforceRequiredLocalReturn(frontierResponse: string): Promise<KlermEnforcedDelegation | undefined> {
		if (this.state.lane !== "frontier" || !this.handbackRequired() || this.pendingReturnToLocal) return undefined;
		const reason = "frontier completed without a native return_to_local call; Klerm enforced the handback";
		const summary = frontierResponse.trim() || "The frontier worker completed without a textual response.";
		this.requestReturnToLocal(
			{
				reason,
				frontierSummary: summary,
				frontierAnswer: summary,
				changedFiles: [],
				verification: [],
				openIssues: ["Frontier did not provide a structured return packet."],
				recommendedNextAction: "verify",
			},
			"required-handback",
		);
		const frontierReference = this.config.frontierModel;
		if (!frontierReference) return undefined;
		const frontierModel = this.resolveModel(frontierReference, "frontier");
		const transition = await this.prepareNextTurn({
			message: {
				role: "assistant",
				content: [{ type: "text", text: frontierResponse }],
				api: frontierModel.api,
				provider: frontierModel.provider,
				model: frontierModel.id,
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
				"[Klerm enforced frontier return]",
				`Reason: ${reason}`,
				`Frontier summary: ${summary}`,
				`Original task: ${this.task}`,
				"Verify the frontier result, complete any remaining focused work, and answer the user. Delegate again only for a concrete unresolved issue.",
			].join("\n"),
		};
	}

	private async prepareFrontierTransition(
		turn: PrepareNextTurnContext,
		reason: string,
		trigger: KlermHandoffTrigger,
	): Promise<KlermModelTransition | undefined> {
		const currentCycle = this.state.delegationCycle ?? 0;
		if (currentCycle >= this.config.maxDelegationCycles) {
			this.pendingDelegation = undefined;
			await this.logLifecycle(
				"HANDOFF_REJECTED",
				"LOCAL",
				this.state.selectedTarget ?? this.config.localModel ?? "local",
				`frontier delegation cycle limit ${this.config.maxDelegationCycles} reached`,
			);
			return undefined;
		}
		const reference = this.config.frontierModel;
		if (!reference)
			throw new Error(
				`Local worker requested frontier delegation (${reason}), but no frontier model is configured.`,
			);
		const model = this.resolveModel(reference, "frontier");
		return this.prepareTransition({
			kind: "delegate",
			toLane: "frontier",
			model,
			reason,
			trigger,
			cycle: currentCycle + 1,
			transcriptHash: hash(stableJson(turn.context.messages)),
			completionOwner:
				trigger === "provider-failure" || !this.config.handbackEnabled
					? "frontier"
					: (this.state.completionOwner ?? "local"),
		});
	}

	private async prepareLocalReturn(turn: PrepareNextTurnContext): Promise<KlermModelTransition | undefined> {
		const result = this.pendingReturnToLocal;
		if (!result) return undefined;
		const reference = this.config.localModel;
		if (!reference) {
			this.pendingReturnToLocal = undefined;
			this.state = { ...this.state, completionOwner: "frontier", reason: "local handback target is unavailable" };
			await this.logLifecycle(
				"HANDOFF_FAILED",
				"FRONTIER",
				this.state.selectedTarget ?? this.config.frontierModel ?? "frontier",
				"cannot return to local because no local model is configured",
			);
			return undefined;
		}
		let model: Model<any>;
		try {
			model = this.resolveModel(reference, "local");
		} catch (error) {
			this.pendingReturnToLocal = undefined;
			this.state = { ...this.state, completionOwner: "frontier", reason: "local handback target is unavailable" };
			await this.logLifecycle(
				"HANDOFF_FAILED",
				"FRONTIER",
				this.state.selectedTarget ?? this.config.frontierModel ?? "frontier",
				error instanceof Error ? error.message : String(error),
			);
			return undefined;
		}
		return this.prepareTransition({
			kind: "return",
			toLane: "local",
			model,
			reason: result.reason,
			trigger: result.trigger,
			cycle: this.state.delegationCycle ?? 0,
			transcriptHash: hash(stableJson(turn.context.messages)),
			completionOwner: "local",
			returnCounts: {
				changedFileCount: result.changedFiles.length,
				verificationCount: result.verification.length,
				openIssueCount: result.openIssues.length,
			},
		});
	}

	async prepareNextTurn(turn: PrepareNextTurnContext): Promise<KlermModelTransition | undefined> {
		if (this.state.lane === "frontier") return this.prepareLocalReturn(turn);
		if (this.state.lane !== "local") return undefined;
		this.localTurns++;
		this.localToolErrors += turn.toolResults.filter((result) => result.isError).length;
		const toolCalls = turn.message.content.filter((part) => part.type === "toolCall");
		const signature = toolCalls.map((call) => `${call.name}:${JSON.stringify(call.arguments)}`).join("|");
		if (signature && signature === this.lastToolSignature) this.repeatedToolCalls++;
		else this.repeatedToolCalls = 0;
		this.lastToolSignature = signature || undefined;

		let reason: string | undefined;
		let trigger: KlermHandoffTrigger | undefined;
		if (this.pendingDelegation) {
			reason = this.pendingDelegation.reason;
			trigger = this.pendingDelegation.trigger;
		} else if (this.localToolErrors >= this.config.localMaxToolErrors) {
			reason = "local tool error limit reached";
			trigger = "tool-error-limit";
		} else if (this.localTurns >= this.config.localMaxTurns && turn.toolResults.length > 0) {
			reason = "local turn limit reached";
			trigger = "turn-limit";
		} else if (this.repeatedToolCalls >= 2) {
			reason = "local worker repeated the same tool call";
			trigger = "repeated-tool-call";
		}
		if (!reason) return undefined;
		return this.prepareFrontierTransition(turn, reason, trigger!);
	}

	async handleLocalFailure(errorMessage: string | undefined): Promise<KlermModelTransition | undefined> {
		if (this.state.lane !== "local") return undefined;
		this.requestFrontierDelegation(
			{
				reason: `local provider failed${errorMessage ? `: ${errorMessage}` : ""}`,
				summary: "The local provider failed before completing its turn.",
				remainingWork: "Continue the original task using the existing session context.",
			},
			"provider-failure",
		);
		const transition = await this.prepareNextTurn({
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
		if (!transition) return undefined;
		return {
			...transition,
			handoffPrompt: [
				"[Klerm local failure delegation]",
				`Reason: local provider failed${errorMessage ? `: ${errorMessage}` : ""}`,
				"Summary: The local provider failed before completing its turn.",
				`Original task: ${this.task}`,
				"Continue the original task using the existing session and repository context.",
			].join("\n"),
		};
	}

	async handleFrontierFailure(errorMessage: string | undefined): Promise<KlermModelTransition | undefined> {
		if (this.state.lane !== "frontier" || !this.handbackRequired()) return undefined;
		this.requestReturnToLocal(
			{
				reason: `frontier provider failed${errorMessage ? `: ${errorMessage}` : ""}`,
				frontierSummary: "The frontier provider failed before completing its assignment.",
				frontierAnswer: "",
				changedFiles: [],
				verification: [],
				openIssues: [errorMessage ?? "Frontier provider failure"],
				recommendedNextAction: "delegate-again",
			},
			"provider-failure",
		);
		const reference = this.config.frontierModel;
		if (!reference) return undefined;
		const model = this.resolveModel(reference, "frontier");
		const transition = await this.prepareNextTurn({
			message: {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
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
		if (!transition) return undefined;
		return {
			...transition,
			handoffPrompt: [
				"[Klerm frontier failure return]",
				`Reason: frontier provider failed${errorMessage ? `: ${errorMessage}` : ""}`,
				"Open issue: The frontier provider did not complete its assignment.",
				"Recommended next action: verify the current repository state, then either finish locally or delegate again if the cycle budget permits.",
			].join("\n"),
		};
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
				complexity: this.state.complexity,
				score: this.state.score,
				confidence: this.state.confidence,
				risk: this.state.risk,
				capabilityFactors: this.state.capabilityFactors,
				policyTriggers: this.state.policyTriggers,
				decisionSource: this.state.decisionSource,
				fallbackReason: this.state.fallbackReason,
				completionOwner: this.state.completionOwner,
				handbackEnabled: this.config.handbackEnabled,
				delegationCycle: this.state.delegationCycle,
				maxDelegationCycles: this.state.maxDelegationCycles,
				transcriptHash: this.state.lastTransition?.transcriptHash,
				registryProfileHash: this.profileHash(),
				mode: this.config.routing,
				cwd: this.cwd,
			});
		} finally {
			const {
				task,
				selectedTarget,
				otherModelCalled,
				handoffReason,
				reason,
				complexity,
				score,
				confidence,
				risk,
				capabilityFactors,
				policyTriggers,
				decisionSource,
				fallbackReason,
				completionOwner,
				handbackEnabled,
				delegationCycle,
				maxDelegationCycles,
				transitionSequence,
				lastTransition,
				explicitFrontierRequestSatisfied,
			} = this.state;
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
				complexity,
				score,
				confidence,
				risk,
				capabilityFactors,
				policyTriggers,
				decisionSource,
				fallbackReason,
				completionOwner,
				handbackEnabled,
				delegationCycle,
				maxDelegationCycles,
				transitionSequence,
				lastTransition,
				explicitFrontierRequestSatisfied,
			};
			this.pendingDelegation = undefined;
			this.pendingReturnToLocal = undefined;
			this.preparedTransitionId = undefined;
		}
	}

	describe(): string {
		return [
			`Routing: ${this.state.mode}`,
			`Active lane: ${this.state.lane}`,
			`Local model: ${this.config.localModel ?? "not configured"}`,
			`Frontier model: ${this.config.frontierModel ?? "not configured"}`,
			`Frontier fallback: ${this.config.allowFrontierFallback ? "on" : "off"}`,
			`Return to local: ${this.config.handbackEnabled ? "on" : "off"}`,
			`Delegation cycles: ${this.state.delegationCycle ?? 0}/${this.config.maxDelegationCycles}`,
			`Other model called: ${this.state.otherModelCalled ?? "none"}`,
			`Task: ${this.state.task ?? "none"}`,
			`Last decision: ${this.state.reason ?? "none"}`,
			`Capability score: ${this.state.score === undefined ? "none" : this.state.score.toFixed(2)}`,
			`Confidence: ${this.state.confidence === undefined ? "none" : this.state.confidence.toFixed(2)}`,
			`Risk: ${this.state.risk === undefined ? "none" : this.state.risk.toFixed(2)}`,
		].join("\n");
	}
}
