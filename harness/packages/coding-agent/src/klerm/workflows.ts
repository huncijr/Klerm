/** Browser-safe graph contracts. Graph drafts never dispatch work. */
export const WORKFLOW_NODE_KINDS = [
	"start",
	"task",
	"personal-agent",
	"harness-agent",
	"board",
	"kanban-card",
	"history",
	"condition",
	"join",
	"human-review",
	"end",
] as const;
export const WORKFLOW_EDGE_KINDS = ["assigned-to", "depends-on", "artifact", "message", "membership"] as const;
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];
export type WorkflowEdgeKind = (typeof WORKFLOW_EDGE_KINDS)[number];
export type GraphSourceKind =
	| "personal-agent"
	| "harness-agent"
	| "kanban-board"
	| "kanban-card"
	| "kanban-attempt"
	| "personal-conversation";
export interface GraphSourceRef {
	kind: GraphSourceKind;
	botId?: string;
	agentId?: string;
	boardId?: string;
	taskId?: string;
	attemptId?: string;
	conversationId?: string;
}
export interface WorkflowNode {
	id: string;
	kind: WorkflowNodeKind;
	title: string;
	createdSequence: number;
	position: { x: number; y: number };
	sourceRef?: GraphSourceRef;
	brief: string;
	note: string;
}
export interface WorkflowEdge {
	id: string;
	kind: WorkflowEdgeKind;
	source: string;
	target: string;
	label: string;
	createdSequence: number;
}
export interface WorkflowDefinition {
	version: 1;
	id: string;
	revision: number;
	name: string;
	workspaceRoot: string;
	createdAt: string;
	updatedAt: string;
	nodes: WorkflowNode[];
	edges: WorkflowEdge[];
	viewport: { x: number; y: number; zoom: number };
}
export interface WorkflowIssue {
	code: string;
	message: string;
	nodeId?: string;
	edgeId?: string;
	severity: "error" | "warning";
}
export interface WorkflowValidation {
	valid: boolean;
	executionSupported: false;
	issues: WorkflowIssue[];
	order: string[];
}
export interface GraphCatalogItem {
	key: string;
	category: "agents" | "kanban" | "history";
	nodeKind: WorkflowNodeKind;
	title: string;
	subtitle: string;
	status: string;
	workspaceRoot: string;
	sourceRef: GraphSourceRef;
	ownerBotId?: string;
	model?: string;
	mode?: string;
	available: boolean;
	explanation?: string;
	updatedAt?: string;
	kanbanEnabled?: boolean;
}
export interface GraphCatalogPage {
	items: GraphCatalogItem[];
	offset: number;
	nextOffset?: number;
	executionSupported: false;
}
export interface GraphSourceDetails {
	item: GraphCatalogItem;
	summary: string;
	steps: Array<{ id: string; label: string; status: string }>;
	activity: Array<{ sequence?: number; kind: string; text: string; timestamp: string }>;
	changedFiles: string[];
	verification: string[];
}
export interface GraphCatalogQuery {
	category?: "agents" | "kanban" | "history";
	search?: string;
	ownerBotId?: string;
	offset?: number;
	limit?: number;
}

const sourceFields: Record<GraphSourceKind, string[]> = {
	"personal-agent": ["botId"],
	"harness-agent": ["agentId"],
	"kanban-board": ["boardId"],
	"kanban-card": ["boardId", "taskId"],
	"kanban-attempt": ["boardId", "taskId", "attemptId"],
	"personal-conversation": ["botId", "conversationId"],
};
export function graphSourceKey(ref: GraphSourceRef): string {
	return JSON.stringify([
		ref.kind,
		...sourceFields[ref.kind].map((field) => (ref as unknown as Record<string, unknown>)[field]),
	]);
}
export function parseGraphSource(value: unknown): GraphSourceRef {
	const input = record(value, "source reference");
	if (typeof input.kind !== "string" || !Object.hasOwn(sourceFields, input.kind))
		throw new Error("Unknown graph source kind.");
	const fields = sourceFields[input.kind as GraphSourceKind];
	if (Object.keys(input).some((key) => key !== "kind" && !fields.includes(key)))
		throw new Error("Unexpected graph source field.");
	for (const field of fields) text(input[field], field, 300, true);
	return { ...input } as unknown as GraphSourceRef;
}
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}.`);
	return value as Record<string, unknown>;
}
function text(value: unknown, name: string, limit: number, required = false): string {
	if (typeof value !== "string" || value.length > limit || (required && !value.trim()) || value.includes("\0"))
		throw new Error(`Invalid ${name}.`);
	return value;
}
function number(value: unknown, name: string, min: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
		throw new Error(`Invalid ${name}.`);
	return value;
}
function identifier(value: unknown): string {
	const id = text(value, "graph id", 128, true);
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid graph id.");
	return id;
}
export function parseWorkflow(value: unknown): WorkflowDefinition {
	const input = record(value, "workflow");
	if (input.version !== 1) throw new Error("Unsupported workflow schema version.");
	if (
		!Array.isArray(input.nodes) ||
		input.nodes.length > 50 ||
		!Array.isArray(input.edges) ||
		input.edges.length > 100
	)
		throw new Error("A workflow supports at most 50 nodes and 100 edges.");
	const nodes = input.nodes.map((value): WorkflowNode => {
		const node = record(value, "node");
		if (!WORKFLOW_NODE_KINDS.includes(node.kind as WorkflowNodeKind)) throw new Error("Unknown node kind.");
		const position = record(node.position, "node position");
		const sequence = number(node.createdSequence, "node sequence", 1, 1_000_000);
		if (!Number.isInteger(sequence)) throw new Error("Node sequence must be an integer.");
		return {
			id: identifier(node.id),
			kind: node.kind as WorkflowNodeKind,
			title: text(node.title, "node title", 160, true),
			createdSequence: sequence,
			position: {
				x: number(position.x, "node x", 0, 5780),
				y: number(position.y, "node y", 0, 3868),
			},
			brief: text(node.brief ?? "", "task brief", 8000),
			note: text(node.note ?? "", "node note", 2000),
			...(node.sourceRef ? { sourceRef: parseGraphSource(node.sourceRef) } : {}),
		};
	});
	const edges = input.edges.map((value): WorkflowEdge => {
		const edge = record(value, "edge");
		if (!WORKFLOW_EDGE_KINDS.includes(edge.kind as WorkflowEdgeKind)) throw new Error("Unknown edge kind.");
		const sequence = number(edge.createdSequence, "edge sequence", 1, 1_000_000);
		if (!Number.isInteger(sequence)) throw new Error("Edge sequence must be an integer.");
		return {
			id: identifier(edge.id),
			kind: edge.kind as WorkflowEdgeKind,
			source: identifier(edge.source),
			target: identifier(edge.target),
			label: text(edge.label ?? "", "edge label", 120),
			createdSequence: sequence,
		};
	});
	if (
		new Set(nodes.map((node) => node.id)).size !== nodes.length ||
		new Set(edges.map((edge) => edge.id)).size !== edges.length
	)
		throw new Error("Duplicate node or edge id.");
	const viewport = record(input.viewport, "viewport");
	const revision = number(input.revision, "revision", 0, Number.MAX_SAFE_INTEGER);
	if (!Number.isInteger(revision)) throw new Error("Revision must be an integer.");
	return {
		version: 1,
		id: identifier(input.id),
		revision,
		name: text(input.name, "workflow name", 100, true),
		workspaceRoot: text(input.workspaceRoot, "workflow folder", 4096, true),
		createdAt: text(input.createdAt, "creation time", 100),
		updatedAt: text(input.updatedAt, "update time", 100),
		nodes,
		edges,
		viewport: {
			x: number(viewport.x, "viewport x", -100_000, 100_000),
			y: number(viewport.y, "viewport y", -100_000, 100_000),
			zoom: number(viewport.zoom, "zoom", 0.2, 2.5),
		},
	};
}

export function workflowEdgeAllowed(
	kind: WorkflowEdgeKind,
	source: WorkflowNodeKind,
	target: WorkflowNodeKind,
): boolean {
	const agent = (kind: WorkflowNodeKind) => kind === "personal-agent" || kind === "harness-agent";
	const task = (kind: WorkflowNodeKind) => kind === "task" || kind === "kanban-card";
	if (kind === "assigned-to") return task(source) && agent(target);
	if (kind === "membership") return source === "board" && target === "kanban-card";
	if (kind === "message") return agent(source) && agent(target);
	if (kind === "artifact")
		return (
			(source === "history" || task(source)) &&
			["task", "kanban-card", "condition", "join", "human-review", "end"].includes(target)
		);
	return (
		["start", "task", "kanban-card", "condition", "join", "human-review"].includes(source) &&
		["task", "kanban-card", "condition", "join", "human-review", "end"].includes(target)
	);
}

export function validateWorkflow(
	workflow: WorkflowDefinition,
	lookup?: (ref: GraphSourceRef) => GraphCatalogItem | undefined,
): WorkflowValidation {
	const issues: WorkflowIssue[] = [];
	const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
	const degree = new Map(workflow.nodes.map((node) => [node.id, 0]));
	const next = new Map(workflow.nodes.map((node) => [node.id, [] as string[]]));
	const pairs = new Set<string>();
	for (const edge of workflow.edges) {
		const source = nodes.get(edge.source),
			target = nodes.get(edge.target);
		if (!source || !target || source.id === target.id || !workflowEdgeAllowed(edge.kind, source.kind, target.kind)) {
			issues.push({
				code: "INVALID_EDGE",
				severity: "error",
				edgeId: edge.id,
				message: "The connection has missing nodes, incompatible ports or a self-loop.",
			});
			continue;
		}
		const pair = JSON.stringify([edge.kind, edge.source, edge.target]);
		if (pairs.has(pair))
			issues.push({
				code: "DUPLICATE_EDGE",
				severity: "error",
				edgeId: edge.id,
				message: "This connection already exists.",
			});
		pairs.add(pair);
		if (edge.kind === "depends-on" || edge.kind === "artifact") {
			degree.set(target.id, degree.get(target.id)! + 1);
			next.get(source.id)!.push(target.id);
		}
	}
	const compare = (a: string, b: string) =>
		nodes.get(a)!.createdSequence - nodes.get(b)!.createdSequence || a.localeCompare(b);
	const ready = [...degree]
			.filter(([, value]) => value === 0)
			.map(([id]) => id)
			.sort(compare),
		order: string[] = [];
	while (ready.length) {
		const id = ready.shift()!;
		order.push(id);
		for (const child of next.get(id)!) {
			const left = degree.get(child)! - 1;
			degree.set(child, left);
			if (!left) {
				ready.push(child);
				ready.sort(compare);
			}
		}
	}
	if (order.length !== nodes.size)
		issues.push({ code: "CYCLE", severity: "error", message: "Control and artifact connections must form a DAG." });
	for (const node of workflow.nodes) {
		if (["personal-agent", "harness-agent", "board", "kanban-card", "history"].includes(node.kind) && !node.sourceRef)
			issues.push({
				code: "NO_SOURCE",
				severity: "error",
				nodeId: node.id,
				message: "This node requires an existing source reference.",
			});
		if (node.sourceRef && lookup) {
			const item = lookup(node.sourceRef);
			if (!item)
				issues.push({
					code: "MISSING_SOURCE",
					severity: "error",
					nodeId: node.id,
					message: "The referenced source no longer exists.",
				});
			else {
				if (item.nodeKind !== node.kind)
					issues.push({
						code: "SOURCE_KIND",
						severity: "error",
						nodeId: node.id,
						message: "Node type does not match its source.",
					});
				if (!item.available)
					issues.push({
						code: "UNAVAILABLE_SOURCE",
						severity: "warning",
						nodeId: node.id,
						message: item.explanation ?? "The source is unavailable for future execution.",
					});
			}
		}
		const assignments = workflow.edges.filter((edge) => edge.kind === "assigned-to" && edge.source === node.id);
		if (assignments.length > 1)
			issues.push({
				code: "MULTIPLE_AGENTS",
				severity: "error",
				nodeId: node.id,
				message: "A task can have only one assigned agent.",
			});
		if (lookup && node.sourceRef?.kind === "kanban-card") {
			const card = lookup(node.sourceRef);
			for (const edge of assignments) {
				const agent = nodes.get(edge.target)?.sourceRef;
				const target = agent ? lookup(agent) : undefined;
				if (target?.sourceRef.kind === "personal-agent" && target.kanbanEnabled !== true)
					issues.push({
						code: "KANBAN_DISABLED",
						severity: "error",
						nodeId: node.id,
						message: "Assigned Personal Agent has no Kanban opt-in.",
					});
				if (card?.ownerBotId && target?.ownerBotId !== card.ownerBotId)
					issues.push({
						code: "ASSIGNMENT_CONFLICT",
						severity: "error",
						edgeId: edge.id,
						message: "This graph assignment differs from the source card. Edit its assignment in Kanban first.",
					});
			}
		}
		if (node.kind === "task" || node.kind === "kanban-card") {
			if (!assignments.length && !node.sourceRef)
				issues.push({
					code: "NO_AGENT",
					severity: "warning",
					nodeId: node.id,
					message: "Assign an agent before making this step executable.",
				});
		}
		if (node.kind === "task" && !node.brief.trim())
			issues.push({ code: "NO_BRIEF", severity: "warning", nodeId: node.id, message: "The task brief is empty." });
	}
	if (workflow.edges.some((edge) => edge.kind === "message"))
		issues.push({
			code: "MESSAGE_DESIGN_ONLY",
			severity: "warning",
			message: "Message links are design references; no agent conversation is dispatched.",
		});
	return { valid: !issues.some((issue) => issue.severity === "error"), executionSupported: false, issues, order };
}
