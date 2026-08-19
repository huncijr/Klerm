import { createHash } from "node:crypto";
import type { KlermRouteDecision, KlermRouteRequest } from "./types.ts";

export interface MockRouterOptions {
	now?: () => Date;
}

const MOCK_REGISTRY_PROFILE = {
	id: "mock-default",
	version: 1,
	targets: [{ id: "mock/coding-agent", capabilities: ["coding"] }],
};

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function routeWithMock(request: KlermRouteRequest, options: MockRouterOptions = {}): KlermRouteDecision {
	const timestamp = (options.now ?? (() => new Date()))().toISOString();
	return {
		timestamp,
		taskId: `task-${hash(`${timestamp}\n${request.task}`).slice(0, 16)}`,
		event: "INITIAL_ROUTE",
		task: request.task,
		route: "SELF",
		selectedTarget: "mock/coding-agent",
		reason: "default mock route",
		registryProfileHash: hash(JSON.stringify(MOCK_REGISTRY_PROFILE)),
		mode: "mock",
	};
}
