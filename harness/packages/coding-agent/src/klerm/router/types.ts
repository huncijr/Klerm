import type { KlermActiveStartLane } from "../config.ts";

export type KlermRouteMode = "mock";
export type KlermRoute = "SELF" | "LOCAL" | "FRONTIER";
export type KlermPromptRoutingOverride = "local" | "frontier";
export type KlermDecisionSource = "local-model" | "deterministic-fallback" | "deterministic-policy";
export type KlermCostSource = "model-catalog" | "unavailable";
export type KlermWorkerLane = "local" | "frontier";
export type KlermCompletionOwner = KlermWorkerLane | "direct";
export type KlermTransitionKind = "initial" | "delegate" | "return";
export type KlermHandoffTrigger =
	| "initial-route"
	| "native-tool"
	| "explicit-enforcement"
	| "recommended-enforcement"
	| "required-handback"
	| "turn-limit"
	| "tool-error-limit"
	| "repeated-tool-call"
	| "provider-failure";
export type KlermDecisionEventType =
	| "INITIAL_ROUTE"
	| "LOCAL_STARTED"
	| "FRONTIER_STARTED"
	| "DELEGATE_FRONTIER"
	| "DELEGATE_LOCAL"
	| "FRONTIER_COMPLETED"
	| "RETURN_TO_LOCAL"
	| "RETURN_TO_FRONTIER"
	| "LOCAL_RESUMED"
	| "FRONTIER_RESUMED"
	| "HANDOFF_REJECTED"
	| "HANDOFF_FAILED"
	| "MODEL_RESPONSE"
	| "TASK_COMPLETED"
	| "TASK_FAILED";

export interface KlermTransitionState {
	id: string;
	sequence: number;
	kind: KlermTransitionKind;
	fromLane: KlermWorkerLane | "direct";
	toLane: KlermWorkerLane;
	fromTarget?: string;
	toTarget: string;
	reason: string;
	trigger: KlermHandoffTrigger;
	cycle: number;
	maxCycles: number;
	transcriptHash?: string;
}

export interface KlermRouteRequest {
	task: string;
}

export interface KlermRouteDecision {
	timestamp: string;
	taskId: string;
	event: KlermDecisionEventType;
	task: string;
	route: KlermRoute;
	routerModel?: string;
	selectedTarget: string;
	reason: string;
	complexity?: number;
	score?: number;
	confidence?: number;
	risk?: number;
	capabilityFactors?: string[];
	policyTriggers?: string[];
	decisionSource?: KlermDecisionSource;
	delegationRecommended?: boolean;
	fallbackReason?: string;
	completionOwner?: KlermCompletionOwner;
	handbackEnabled?: boolean;
	transitionId?: string;
	transitionSequence?: number;
	transitionKind?: KlermTransitionKind;
	fromLane?: KlermWorkerLane | "direct";
	toLane?: KlermWorkerLane;
	fromTarget?: string;
	trigger?: KlermHandoffTrigger;
	delegationCycle?: number;
	maxDelegationCycles?: number;
	transcriptHash?: string;
	changedFileCount?: number;
	verificationCount?: number;
	openIssueCount?: number;
	provider?: string;
	model?: string;
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
	totalTokens?: number;
	costUsd?: number;
	costSource?: KlermCostSource;
	usageAvailable?: boolean;
	registryProfileHash: string;
	mode: KlermRouteMode | "local" | "frontier" | "auto" | "off";
	activeStartLane?: KlermActiveStartLane;
	cwd?: string;
}

export interface KlermRoutingState {
	taskId?: string;
	task?: string;
	mode: "off" | "local" | "frontier" | "auto";
	activeStartLane: KlermActiveStartLane;
	lane: "direct" | "local" | "frontier";
	localModel?: string;
	frontierModel?: string;
	selectedTarget?: string;
	otherModelCalled?: string;
	handoffReason?: string;
	reason?: string;
	complexity?: number;
	score?: number;
	confidence?: number;
	risk?: number;
	capabilityFactors?: string[];
	policyTriggers?: string[];
	decisionSource?: KlermDecisionSource;
	delegationRecommended?: boolean;
	fallbackReason?: string;
	completionOwner?: KlermCompletionOwner;
	handbackEnabled?: boolean;
	delegationCycle?: number;
	maxDelegationCycles?: number;
	transitionSequence?: number;
	lastTransition?: KlermTransitionState;
	explicitFrontierRequestSatisfied?: boolean;
}
