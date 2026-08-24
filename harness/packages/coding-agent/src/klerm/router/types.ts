export type KlermRouteMode = "mock";
export type KlermRoute = "SELF" | "LOCAL" | "FRONTIER";
export type KlermPromptRoutingOverride = "local" | "frontier";
export type KlermDecisionSource = "local-model" | "deterministic-fallback";
export type KlermWorkerLane = "local" | "frontier";
export type KlermCompletionOwner = KlermWorkerLane | "direct";
export type KlermTransitionKind = "initial" | "delegate" | "return";
export type KlermHandoffTrigger =
	| "initial-route"
	| "native-tool"
	| "explicit-enforcement"
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
	| "FRONTIER_COMPLETED"
	| "RETURN_TO_LOCAL"
	| "LOCAL_RESUMED"
	| "HANDOFF_REJECTED"
	| "HANDOFF_FAILED"
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
	registryProfileHash: string;
	mode: KlermRouteMode | "local" | "frontier" | "auto" | "off";
	cwd?: string;
}

export interface KlermRoutingState {
	taskId?: string;
	task?: string;
	mode: "off" | "local" | "frontier" | "auto";
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
	fallbackReason?: string;
	completionOwner?: KlermCompletionOwner;
	handbackEnabled?: boolean;
	delegationCycle?: number;
	maxDelegationCycles?: number;
	transitionSequence?: number;
	lastTransition?: KlermTransitionState;
	explicitFrontierRequestSatisfied?: boolean;
}
