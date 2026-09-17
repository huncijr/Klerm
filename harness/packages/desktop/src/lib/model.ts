export type JsonObject = Record<string, unknown>;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type WorkerRole = "planner" | "builder";
export type ApprovalMode = "always" | "risky" | "never";
export type DesktopAppearance = "dark" | "light" | "system";
export type CodingHarnessKind = "klerm" | "pi" | "claude-code" | "codex" | "opencode" | "cline";
export type CodingHarnessSlot = CodingHarnessKind | null;
export type CodingHarnessEffectiveRouting = "auto" | "none" | "disabled";
export type WorkspaceView = "agents-routing" | "personal-bots" | "kanban";

export interface CodingHarnessSlotSettings {
	id: string;
	kind: CodingHarnessSlot;
	enabled: boolean;
	model?: string;
	memoryProfileId?: string;
	role: WorkerRole;
	effort: ThinkingLevel;
	tools: string[];
	specialties?: string[];
}

export interface CodingHarnessSetup {
	slots: {
		externalHarnessesEnabled: boolean;
		workTogetherEnabled?: boolean;
		agents: CodingHarnessSlotSettings[];
	};
	harnesses: Array<{
		kind: CodingHarnessKind;
		available: boolean;
		builtin: boolean;
		adapterConnected?: boolean;
		version?: string;
		error?: string;
		models: string[];
		acp?: {
			command: string;
			protocolVersion: number;
			agentName?: string;
			agentTitle?: string;
			agentVersion?: string;
			loadSession?: boolean;
		};
	}>;
	effectiveRouting: CodingHarnessEffectiveRouting;
	externalPromptingAvailable: boolean;
	workTogetherAvailable: boolean;
	runnableAgents: Array<{
		order: number;
		agentId: string;
		harness: CodingHarnessKind;
		model: string;
		role: WorkerRole;
		effort: ThinkingLevel;
		tools: string[];
		specialties: string[];
		strengthBand: 1 | 2 | 3 | 4 | 5;
		strengths: string[];
		limits: string[];
		capabilitySource: "model-profile-inference";
		adapterCapabilities: {
			prompt: true;
			abort: true;
			resumeSession: boolean;
			roleEnforcement: boolean;
			childTaskEvents: false;
		};
	}>;
	excludedAgents: Array<{ agentId: string; reason: string }>;
	sharedContextPreview?: string;
	blockingReason?: string;
}

export const KLERM_PROFILE_FACES = ["fox", "owl", "wolf", "cat", "bear", "otter"] as const;
export type KlermProfileFace = (typeof KLERM_PROFILE_FACES)[number];

export type KlermProfileMemoryFormat = "md" | "html";

export interface KlermProfile {
	id: string;
	name: string;
	face: KlermProfileFace;
	level: number;
	behaviour: string;
	workPlan: string;
	planMode: string;
	buildMode: string;
	memoryFormat: KlermProfileMemoryFormat;
	/** @deprecated Use behaviour instead. Kept for reading older settings. */
	memory: string;
	/** @deprecated Use workPlan instead. Kept for reading older settings. */
	readme: string;
}

export interface KlermProfileState {
	localProfileId?: string;
	frontierProfileId?: string;
	sharedMemory: string;
	defaultSharedMemory: string;
	selectedSharedMemoryPresetId?: string;
	sharedMemoryPresets: KlermSharedMemoryPreset[];
	profiles: KlermProfile[];
}

export interface KlermSharedMemoryPreset {
	id: string;
	name: string;
	memory: string;
}

export interface CustomModelEntry {
	provider: string;
	id: string;
	name?: string;
	api: string;
	baseUrl: string;
	apiKey?: string;
}

export interface DesktopShortcut {
	action: string;
	keys: string;
}

export interface ProviderAccount {
	id: string;
	label: string;
	models: string[];
	configured: boolean;
	source?: string;
	local: boolean;
	detected?: string;
	defaultEndpoint?: string;
	supportsOauth: boolean;
}

export interface ProviderOauthPrompt {
	id: string;
	promptType: string;
	message: string;
	options?: Array<{ id: string; label: string; description?: string }>;
}

export interface ProviderOauthStep {
	provider: string;
	url?: string;
	instructions?: string;
	userCode?: string;
	verificationUri?: string;
	message?: string;
	prompt?: ProviderOauthPrompt;
}

export interface ProviderConnect {
	provider: string;
	apiKey?: string;
	baseUrl?: string;
}

export interface DesktopSettings {
	appearance: DesktopAppearance;
	agentDir: string;
	klermVersion: string;
	cwd: string;
	profiles: KlermProfileState;
	customModels: CustomModelEntry[];
	shortcuts: DesktopShortcut[];
}

export interface ThinkingSetting {
	level: ThinkingLevel;
	levels: ThinkingLevel[];
}

export interface SessionState {
	sessionId: string;
	sessionFile?: string;
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
	selectedAgentId?: string;
	selectedHarness?: CodingHarnessKind;
	routingSequence?: number;
	reason?: string;
	handoffReason?: string;
	fallbackReason?: string;
	lastTransition?: RoutingTransition;
	taskIntent?: "answer" | "review" | "workspace-change";
}

export type CodingHarnessBridgeTaskStatus =
	| "assigned"
	| "running"
	| "waiting"
	| "returned"
	| "completed"
	| "failed"
	| "cancelled";

export interface CodingHarnessBridgeArtifact {
	kind: "file" | "diff" | "report";
	reference: string;
	digest?: string;
}

export interface CodingHarnessBridgeEvent {
	version: 1;
	timestamp: string;
	event:
		| "TASK_CREATED"
		| "TASK_ASSIGNED"
		| "TASK_STARTED"
		| "TASK_WAITING"
		| "TASK_RETURNED"
		| "TASK_COMPLETED"
		| "TASK_FAILED"
		| "TASK_CANCELLED"
		| "NO_DELEGATION";
	taskId: string;
	parentTaskId?: string;
	correlationId: string;
	sequence: number;
	sender: string;
	recipient: string;
	status: CodingHarnessBridgeTaskStatus;
	reason: string;
	agentId?: string;
	harness?: string;
	model?: string;
	nativeSessionId?: string;
	responseHash?: string;
	artifact?: CodingHarnessBridgeArtifact;
}

export interface TaskOutcome {
	status:
		| "completed"
		| "implemented-and-verified"
		| "blocked-before-implementation"
		| "plan-returned-instead-of-implementation"
		| "verification-missing"
		| "failed";
	taskIntent?: "answer" | "review" | "workspace-change";
	reason?: string;
	changedFileCount: number;
	verificationCount: number;
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
	capabilities?: {
		commands: string[];
		events: string[];
	};
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
	localApprovalMode: ApprovalMode;
	frontierApprovalMode: ApprovalMode;
	localThinkingLevel?: ThinkingLevel;
	frontierThinkingLevel?: ThinkingLevel;
	maxDelegationCycles: number;
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
	projectId?: string;
}

export interface DesktopProject {
	id: string;
	name: string;
	summary?: string;
	sessionCount: number;
}

export interface DesktopProjects {
	version: number;
	defaultProjectId: string;
	projects: DesktopProject[];
}

export interface PersonalBot {
	id: string;
	name: string;
	face: KlermProfileFace;
	profileId: string;
	harness: CodingHarnessKind;
	model?: string;
	role: "planner";
	effort: ThinkingLevel;
	enabled: boolean;
	createdSequence: number;
}

export interface PersonalBotRegistry {
	version: number;
	defaultsInitialized: true;
	bots: PersonalBot[];
}

export interface PersonalBotChatMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	timestamp: string;
}

export interface PersonalBotConversation {
	version: 1;
	id: string;
	botId: string;
	cwd: string;
	harness: CodingHarnessKind;
	model: string;
	role: "planner";
	nativeSessionId?: string;
	sessionContextDigest?: string;
	peerSummaryDigest?: string;
	summary?: {
		text: string;
		updatedAt: string;
		sourceMessageCount: number;
		digest: string;
	};
	status: "idle" | "running" | "summarizing" | "failed";
	eventSequence: number;
	messages: PersonalBotChatMessage[];
	updatedAt: string;
}

export interface ProjectSessionExtract {
	sessionId: string;
	sessionName: string;
	role: "user" | "assistant";
	timestamp: string;
	label: string;
	text: string;
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

export interface McpToolStatus {
	name: string;
	serverName: string;
	remoteName: string;
	title?: string;
	description?: string;
	capability: "read" | "write" | "unknown";
}

export type McpColor = "base" | "green" | "blue" | "amber" | "red" | "purple" | "teal";

export interface McpServerStatus {
	name: string;
	transport: "stdio" | "http" | "sse";
	enabled: boolean;
	state: "disabled" | "connecting" | "connected" | "failed" | "closed";
	tools: McpToolStatus[];
	skippedTools: string[];
	error?: string;
	errorKind?: "authentication" | "configuration" | "connection";
	label?: string;
	color?: McpColor;
	command?: string;
	args?: string[];
	url?: string;
	envKeys?: string[];
}

export interface McpStatus {
	servers: McpServerStatus[];
	toolCount: number;
	reloadRequired: boolean;
}

export interface McpServerUpdate {
	name: string;
	transport: "stdio" | "http" | "sse";
	scope?: "global" | "project";
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	enabled?: boolean;
	label?: string;
	color?: McpColor;
}

export interface McpToolOption extends McpToolStatus {
	label: string;
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
	data?: string;
	mimeType?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

export interface ImageAttachment {
	type: "image";
	data: string;
	mimeType: string;
	name?: string;
}

export interface ChatMessage {
	id: number;
	role: "user" | "assistant";
	text: string;
	agentId?: string;
	images?: ImageAttachment[];
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
	agentId?: string;
	bridgeStatus?: CodingHarnessBridgeTaskStatus;
	detailType?: "text" | "diff" | "code";
	images?: ImageAttachment[];
	dedupeId?: string;
	mcp?: {
		serverName: string;
		displayName: string;
		toolName?: string;
		color: McpColor;
	};
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
