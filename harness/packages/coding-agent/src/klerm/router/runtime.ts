import { createHash } from "node:crypto";
import type { AgentMessage, PrepareNextTurnContext } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "../../core/extensions/types.ts";
import { findExactModelReferenceMatch } from "../../core/model-resolver.ts";
import type { ModelRuntime } from "../../core/model-runtime.ts";
import type { KlermConfig, KlermConfigStore, KlermRoutingMode } from "../config.ts";
import { isLocalProviderId } from "../local-providers.ts";
import { appendKlermRouteDecision } from "./decision-log.ts";
import type {
	KlermCompletionOwner,
	KlermHandoffTrigger,
	KlermPromptRoutingOverride,
	KlermRouteDecision,
	KlermRoutingState,
	KlermTransitionState,
	KlermWorkerLane,
} from "./types.ts";

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

function explicitlyRequestsFrontier(task: string): boolean {
	if (/\bdelegate_frontier\b/iu.test(task)) return true;
	const target = /\b(frontier|codex|claude|gemini)\b/iu;
	const action = /\b(delegate|delegál\w*|ask|kér\w*|consult|konzult\w*|use|használ\w*|hand\s*off)\b/iu;
	return target.test(task) && action.test(task);
}

function assessDelegationRecommendation(task: string): {
	delegationRecommended: boolean;
	complexity: number;
	risk: number;
	factors: string[];
	policyTriggers: string[];
} {
	let complexity = 3;
	let risk = 0.2;
	const factors: string[] = [];
	if (
		/\b(security audit|authentication system|authorization|credentials?|secrets?|cryptography|encryption|payment|production deploy|database migration|schema migration|destructive data)\b|biztonsági audit|hitelesítés|jogosultság|titkosítás|éles telepítés|adatbázis[- ]migráció/iu.test(
			task,
		)
	) {
		complexity = Math.max(complexity, 7);
		risk = Math.max(risk, 0.75);
		factors.push("security, production, or data-integrity sensitive work");
	}
	if (
		/\b(architecture|architectural|multi[- ]?package|large refactor|across the (repository|codebase)|concurrent|distributed)\b|architektúra|több csomag|nagy refaktor|teljes (repó|repository|kódbázis)/iu.test(
			task,
		)
	) {
		complexity = Math.max(complexity, 8);
		risk = Math.max(risk, 0.55);
		factors.push("repository-scale or architectural scope");
	}
	if (
		/\b(create|build|scaffold|set up|implement)\b[^\n]{0,80}\b(react|tailwind|next\.js|vite)\b|\b(react|tailwind|next\.js|vite)\b[^\n]{0,80}\b(project|application|app)\b|(?:készíts|hozz létre|építs)[^\n]{0,80}(?:react|tailwind|next\.js|vite)/iu.test(
			task,
		)
	) {
		complexity = Math.max(complexity, 8);
		factors.push("frontend project creation or scaffolding");
	}
	if (
		/\b(multiple|several|many)\s+(components?|files?|pages?|packages?|modules?)\b|\btöbb\s+(komponens|fájl|oldal|csomag|modul)/iu.test(
			task,
		)
	) {
		complexity = Math.max(complexity, 7);
		factors.push("multi-file or multi-component scope");
	}
	if (
		/\b(build|dev|development)\s+(setup|environment|server|configuration)\b|\b(set up|configure)\b[^\n]{0,60}\b(build|dev|development)\b|(?:build|dev|fejlesztői)[- ]?(?:setup|környezet|beállítás)|(?:állítsd be|konfiguráld)[^\n]{0,60}(?:build|dev|fejlesztői)/iu.test(
			task,
		)
	) {
		complexity = Math.max(complexity, 7);
		factors.push("build or development environment setup");
	}
	if (task.length > 600) {
		complexity = Math.max(complexity, 7);
		factors.push("long multi-part task description");
	}
	const delegationRecommended = complexity >= 7 || risk >= 0.65;
	return {
		delegationRecommended,
		complexity,
		risk,
		factors,
		policyTriggers: delegationRecommended ? ["deterministic complexity policy recommends frontier"] : [],
	};
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
			delegationRecommended: undefined,
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

	private hasAvailableFrontierModel(): boolean {
		const reference = this.config.frontierModel;
		if (!reference) return false;
		const model = findExactModelReferenceMatch(reference, [...this.modelRuntime.getAvailableSnapshot()]);
		return model !== undefined && !isLocalProviderId(model.provider);
	}

	getSystemPromptContribution(): string | undefined {
		const localModel = this.config.localModel ?? "not configured";
		const frontierModel = this.config.frontierModel ?? "not configured";
		if (this.state.lane === "local") {
			const returnedFromFrontier = this.state.lastTransition?.kind === "return";
			const recommendedDelegation =
				this.state.mode === "auto" &&
				this.state.delegationRecommended === true &&
				!returnedFromFrontier &&
				(this.state.delegationCycle ?? 0) === 0 &&
				this.hasAvailableFrontierModel();
			return [
				"<klerm_a2a>",
				returnedFromFrontier
					? "You are the Klerm local orchestrator resumed after frontier work. Verify the returned result, complete focused local work, and answer the user when the task is ready."
					: "You are the Klerm local worker and may hand work to the configured frontier worker.",
				`Current local model: ${localModel}`,
				`Configured frontier model: ${frontierModel}`,
				`Frontier delegation cycle: ${this.state.delegationCycle ?? 0}/${this.config.maxDelegationCycles}`,
				...(this.state.mode === "auto" && !returnedFromFrontier
					? [
							"Auto mode starts with you as the local orchestrator. Assess the task's difficulty, risk, breadth, and your ability before committing to the full implementation.",
							"Complete focused, low-risk work locally. For broad, risky, specialist, architecture, or multi-file work beyond your capability, inspect only enough context to create a precise handoff, then call delegate_frontier.",
						]
					: []),
				...(recommendedDelegation
					? [
							"Klerm recommends frontier delegation for this task.",
							"Inspect only enough context to summarize the handoff.",
							"Call delegate_frontier before creating or modifying many files.",
						]
					: []),
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
			delegationRecommended: undefined,
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
			delegationRecommended: undefined,
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
			delegationRecommended: undefined,
			fallbackReason: undefined,
			completionOwner: undefined,
			delegationCycle: 0,
			transitionSequence: 0,
			lastTransition: undefined,
			explicitFrontierRequestSatisfied: false,
		};
	}

	getLocalModels(): Model<any>[] {
		return [...this.modelRuntime.getAvailableSnapshot()].filter((model) => isLocalProviderId(model.provider));
	}

	getFrontierModels(): Model<any>[] {
		return [...this.modelRuntime.getAvailableSnapshot()].filter((model) => !isLocalProviderId(model.provider));
	}

	private resolveModel(reference: string, lane: "local" | "frontier"): Model<any> {
		const model = findExactModelReferenceMatch(reference, [...this.modelRuntime.getAvailableSnapshot()]);
		if (!model) throw new Error(`Model "${reference}" is unavailable. Use /${lane} to select an available model.`);
		if (lane === "local" && !isLocalProviderId(model.provider)) {
			throw new Error(`Model "${reference}" is not a local model.`);
		}
		if (lane === "frontier" && isLocalProviderId(model.provider)) {
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
			delegationRecommended: this.state.delegationRecommended,
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
				delegationRecommended: undefined,
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
		let routerModel: string | undefined;
		let completionOwner: KlermCompletionOwner;
		let delegationAssessment: ReturnType<typeof assessDelegationRecommendation> | undefined;

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
				delegationAssessment = assessDelegationRecommendation(task);
				route = "LOCAL";
				reason = "auto mode starts local orchestrator to assess the task and delegate when needed";
				completionOwner = "local";
			}
		}

		const reference = route === "LOCAL" ? config.localModel : config.frontierModel;
		if (!reference)
			throw new Error(`${route === "LOCAL" ? "Local" : "Frontier"} routing requires a configured model.`);
		const model = this.resolveModel(reference, route === "LOCAL" ? "local" : "frontier");
		const selectedTarget = modelReference(model);
		const initialCycle = 0;
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
			complexity: delegationAssessment?.complexity,
			score: undefined,
			confidence: undefined,
			risk: delegationAssessment?.risk,
			capabilityFactors: delegationAssessment?.factors,
			policyTriggers: delegationAssessment?.policyTriggers,
			decisionSource: delegationAssessment ? "deterministic-policy" : undefined,
			delegationRecommended: delegationAssessment?.delegationRecommended,
			fallbackReason: undefined,
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
			complexity: delegationAssessment?.complexity,
			risk: delegationAssessment?.risk,
			capabilityFactors: delegationAssessment?.factors,
			policyTriggers: delegationAssessment?.policyTriggers,
			decisionSource: delegationAssessment ? "deterministic-policy" : undefined,
			delegationRecommended: delegationAssessment?.delegationRecommended,
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

	async enforceRequiredFrontierDelegation(localResponse: string): Promise<KlermEnforcedDelegation | undefined> {
		const recommendedEnforcement =
			this.state.mode === "auto" &&
			this.state.delegationRecommended === true &&
			(this.state.delegationCycle ?? 0) === 0;
		if (
			this.state.lane !== "local" ||
			(!this.explicitFrontierRequest && !recommendedEnforcement) ||
			this.state.explicitFrontierRequestSatisfied ||
			this.pendingDelegation
		)
			return undefined;
		if (recommendedEnforcement && !this.hasAvailableFrontierModel()) {
			await this.logLifecycle(
				"HANDOFF_REJECTED",
				"LOCAL",
				this.state.selectedTarget ?? this.config.localModel ?? "local",
				"recommended frontier handoff skipped because no available frontier model is configured",
			);
			return undefined;
		}

		const reason = this.explicitFrontierRequest
			? "user explicitly requested frontier delegation; Klerm enforced the handoff"
			: "local orchestrator ignored recommended frontier handoff for complex auto task";
		const trigger: KlermHandoffTrigger = this.explicitFrontierRequest
			? "explicit-enforcement"
			: "recommended-enforcement";
		const summary = localResponse.trim() || "The local worker returned without a native delegation tool call.";
		this.requestFrontierDelegation(
			{
				reason,
				summary,
				remainingWork: this.task,
			},
			trigger,
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
				delegationRecommended: this.state.delegationRecommended,
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
				delegationRecommended,
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
				delegationRecommended,
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
