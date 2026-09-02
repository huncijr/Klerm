export type JsonObject = Record<string, unknown>;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type WorkerRole = "planner" | "builder";

export interface ThinkingSetting {
	level: ThinkingLevel;
	levels: ThinkingLevel[];
}

export interface SessionState {
	sessionId: string;
	sessionName?: string;
	cwd: string;
	isStreaming: boolean;
	messageCount: number;
	thinkingLevel: ThinkingLevel;
	model?: { provider: string; id: string };
}

export interface RoutingState {
	mode: "off" | "local" | "frontier" | "auto";
	activeStartLane?: "auto" | "local" | "frontier" | "frontier-local";
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
	activeStartLane: "auto" | "local" | "frontier" | "frontier-local";
	localModel?: string;
	frontierModel?: string;
	localRole: WorkerRole;
	frontierRole: WorkerRole;
	localThinkingLevel?: ThinkingLevel;
	frontierThinkingLevel?: ThinkingLevel;
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

export interface WorkspaceAttribution {
	source: "local" | "frontier" | "direct" | "manual" | "external";
	provider?: string;
	model?: string;
	lane?: "local" | "frontier" | "direct";
	timestamp?: string;
}

export interface WorkspaceFileStatus {
	path: string;
	oldPath?: string;
	indexStatus: string;
	worktreeStatus: string;
	status: "modified" | "added" | "deleted" | "renamed" | "untracked";
	staged: boolean;
	attribution: WorkspaceAttribution;
}

export interface WorkspaceStatus {
	workspaceRoot: string;
	projectRoot: string;
	gitRoot?: string;
	isGit: boolean;
	files: WorkspaceFileStatus[];
}

export interface EditorInfo {
	id: "zed" | "vscode" | "vim";
	label: string;
	available: boolean;
}

export interface RunningService {
	id: string;
	kind: "backend" | "listener";
	processName: string;
	pid: number;
	cwd: string;
	port?: number;
	url?: string;
}

export interface BashResult {
	output: string;
	exitCode?: number;
	cancelled: boolean;
	truncated: boolean;
}

export interface AgentMessage {
	role: string;
	content?: string | AgentContentPart[];
	provider?: string;
	model?: string;
	responseModel?: string;
	usage?: { totalTokens?: number; cost?: { total?: number } };
	stopReason?: string;
	errorMessage?: string;
	toolCallId?: string;
	toolName?: string;
	details?: unknown;
	isError?: boolean;
	timestamp?: number;
}

export interface AgentContentPart {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
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
	detailType?: "text" | "diff" | "code";
	dedupeId?: string;
}

export interface SessionEntryRecord {
	id: string;
	parentId: string | null;
	type: string;
	message?: AgentMessage;
	customType?: string;
	data?: unknown;
}

export type FeedItem =
	| { id: number; type: "message"; message: ChatMessage }
	| { id: number; type: "activity"; activity: TimelineItem };

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
