export type JsonObject = Record<string, unknown>;

export interface SessionState {
	sessionId: string;
	sessionName?: string;
	cwd: string;
	isStreaming: boolean;
	messageCount: number;
	model?: { provider: string; id: string };
}

export interface RoutingState {
	mode: "off" | "local" | "frontier" | "auto";
	lane: "direct" | "local" | "frontier";
	localModel?: string;
	frontierModel?: string;
	selectedTarget?: string;
	handoffReason?: string;
	fallbackReason?: string;
	lastTransition?: RoutingTransition;
}

export interface RoutingTransition {
	id?: string;
	sequence?: number;
	kind?: string;
	fromLane?: string;
	toLane?: string;
	fromTarget?: string;
	toTarget?: string;
	reason?: string;
	trigger?: string;
	cycle?: number;
	maxCycles?: number;
}

export interface DesktopHandshake {
	protocolVersion: number;
	klermVersion: string;
	state: SessionState;
	routingState?: RoutingState;
}

export interface LocalRuntime {
	providerId: string;
	name: string;
	serverUrl: string;
	models: Array<{ id: string; details?: string }>;
	error?: string;
}

export interface AvailableModel {
	provider: string;
	id: string;
}

export interface KlermConfig {
	routing: "off" | "local" | "frontier" | "auto";
	localModel?: string;
	frontierModel?: string;
}

export interface DesktopSession {
	id: string;
	sessionToken: string;
	name?: string;
	cwd: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
}

export interface AgentMessage {
	role: string;
	content?: string | Array<{ type: string; text?: string }>;
	provider?: string;
	model?: string;
	usage?: { totalTokens?: number; cost?: { total?: number } };
}

export interface ChatMessage {
	id: number;
	role: "user" | "assistant";
	text: string;
	model?: string;
	streaming: boolean;
}

export interface SelectOption {
	value: string;
	label: string;
}

export type TimelineTone = "neutral" | "green" | "blue" | "red" | "amber";
export type TimelineStatus = "running" | "settled" | "error";

export interface TimelineItem {
	id: number;
	kind: string;
	tone: TimelineTone;
	title: string;
	detail: string;
	status: TimelineStatus;
	open: boolean;
	dedupeId?: string;
}

export interface SessionEntryRecord {
	type: string;
	customType?: string;
	data?: unknown;
}

export interface StatusInfo {
	state: "starting" | "online" | "error";
	label: string;
	detail: string;
}

export interface RuntimeStatus {
	state: "starting" | "online" | "error";
	title: string;
	detail: string;
}
