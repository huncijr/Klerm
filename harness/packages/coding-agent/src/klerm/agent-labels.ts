import type { KlermActiveStartLane, KlermRoutingMode } from "./config.ts";
import type { KlermWorkerLane } from "./router/types.ts";

export function agentSlashName(lane: string): "agent1" | "agent2" {
	return lane === "frontier" ? "agent2" : "agent1";
}

export function parseAgentSlashCommand(text: string): { lane: KlermWorkerLane; argument: string } | undefined {
	const raw = text.trimStart();
	if (!raw.startsWith("/")) return undefined;
	const body = raw.slice(1);
	const lower = body.toLowerCase();
	const take = (prefix: string, lane: KlermWorkerLane) => {
		if (lower === prefix) return { lane, argument: "" };
		if (lower.startsWith(`${prefix} `) || lower.startsWith(`${prefix}\t`)) {
			return { lane, argument: body.slice(prefix.length) };
		}
		return undefined;
	};
	return (
		take("agent-1", "local") ??
		take("agent-2", "frontier") ??
		take("agent1", "local") ??
		take("agent2", "frontier") ??
		take("agent 1", "local") ??
		take("agent 2", "frontier") ??
		take("local", "local") ??
		take("frontier", "frontier")
	);
}

export function agentLaneLabel(lane: string): string {
	if (lane === "local") return "Agent 1";
	if (lane === "frontier") return "Agent 2";
	if (lane === "direct") return "Direct";
	return lane;
}

export function routingValueLabel(value: string): string {
	if (value === "off") return "Direct";
	if (value === "auto") return "Auto";
	if (value === "frontier-local") return "Agent 2 -> Agent 1";
	return agentLaneLabel(value);
}

export function parseAgentLaneToken(value: string): KlermWorkerLane | undefined {
	const normalized = value.trim().toLowerCase();
	if (normalized === "1" || normalized === "agent1" || normalized === "agent-1" || normalized === "local") {
		return "local";
	}
	if (normalized === "2" || normalized === "agent2" || normalized === "agent-2" || normalized === "frontier") {
		return "frontier";
	}
	return undefined;
}

export function parseAgentLaneArgs(args: string[]): { lane: KlermWorkerLane; roleIndex: number } | undefined {
	const [first, second] = args.map((arg) => arg.toLowerCase());
	const direct = first ? parseAgentLaneToken(first) : undefined;
	if (direct) return { lane: direct, roleIndex: 1 };
	if (first === "agent" && second === "1") return { lane: "local", roleIndex: 2 };
	if (first === "agent" && second === "2") return { lane: "frontier", roleIndex: 2 };
	return undefined;
}

export function parseRoutingModeInput(value: string): KlermRoutingMode | undefined {
	const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
	if (normalized === "off" || normalized === "direct") return "off";
	if (normalized === "auto") return "auto";
	const lane = parseAgentLaneToken(normalized);
	if (lane === "local" || lane === "frontier") return lane;
	if (normalized === "agent 1") return "local";
	if (normalized === "agent 2") return "frontier";
	return undefined;
}

export function parseActiveStartLaneInput(value: string): KlermActiveStartLane | undefined {
	const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
	if (normalized === "auto") return "auto";
	const routing = parseRoutingModeInput(normalized);
	if (routing === "local" || routing === "frontier") return routing;
	if (
		normalized === "frontier-local" ||
		normalized === "2-1" ||
		normalized === "agent 2-1" ||
		normalized === "agent 2 -> agent 1" ||
		normalized === "agent 2 to agent 1"
	) {
		return "frontier-local";
	}
	return undefined;
}
