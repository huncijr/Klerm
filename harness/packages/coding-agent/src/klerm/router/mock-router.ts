import type { KlermRouteDecision, KlermRouteRequest } from "./types.ts";

export interface MockRouterOptions {
	now?: () => Date;
}

export function routeWithMock(request: KlermRouteRequest, options: MockRouterOptions = {}): KlermRouteDecision {
	return {
		timestamp: (options.now ?? (() => new Date()))().toISOString(),
		task: request.task,
		selectedAgent: "coding",
		selectedModel: "mock/coding-agent",
		reason: "default mock route",
		mode: "mock",
	};
}
