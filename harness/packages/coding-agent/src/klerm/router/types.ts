export type KlermRouteMode = "mock";
export type KlermRoute = "SELF" | "LOCAL" | "FRONTIER";
export type KlermPromptRoutingOverride = "local" | "frontier";
export type KlermDecisionEventType =
	| "INITIAL_ROUTE"
	| "LOCAL_STARTED"
	| "FRONTIER_STARTED"
	| "DELEGATE_FRONTIER"
	| "TASK_COMPLETED"
	| "TASK_FAILED";

export interface KlermRouteRequest {
	task: string;
}

export interface KlermRouteDecision {
	timestamp: string;
	taskId: string;
	event?: KlermDecisionEventType;
	task: string;
	route: KlermRoute;
	routerModel?: string;
	selectedTarget: string;
	reason: string;
	complexity?: number;
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
}
