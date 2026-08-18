export type KlermRouteMode = "mock";

export interface KlermRouteRequest {
	task: string;
}

export interface KlermRouteDecision {
	timestamp: string;
	task: string;
	selectedAgent: string;
	selectedModel: string;
	reason: string;
	mode: KlermRouteMode;
}
