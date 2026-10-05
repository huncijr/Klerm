import {
	type GraphCatalogItem,
	type WorkflowDefinition,
	type WorkflowEdgeKind,
	type WorkflowNodeKind,
	workflowEdgeAllowed,
} from "../../../coding-agent/src/klerm/workflows.ts";

export const GRAPH_NODE_WIDTH = 220;
export const GRAPH_NODE_HEIGHT = 132;
export function blankWorkflow(root: string, id: string): WorkflowDefinition {
	return {
		version: 1,
		id,
		revision: 0,
		name: "New workflow",
		workspaceRoot: root,
		createdAt: "",
		updatedAt: "",
		nodes: [],
		edges: [],
		viewport: { x: 0, y: 0, zoom: 1 },
	};
}
export function addGraphNode(
	workflow: WorkflowDefinition,
	id: string,
	kind: WorkflowNodeKind,
	position: { x: number; y: number },
	item?: GraphCatalogItem,
): WorkflowDefinition {
	if (workflow.nodes.length >= 50) throw new Error("A graph supports at most 50 nodes.");
	return {
		...workflow,
		nodes: [
			...workflow.nodes,
			{
				id,
				kind,
				title: item?.title ?? kind.replaceAll("-", " "),
				createdSequence: Math.max(0, ...workflow.nodes.map((node) => node.createdSequence)) + 1,
				position,
				brief: "",
				note: "",
				...(item ? { sourceRef: { ...item.sourceRef } } : {}),
			},
		],
	};
}
export function connectGraphNodes(
	workflow: WorkflowDefinition,
	id: string,
	kind: WorkflowEdgeKind,
	source: string,
	target: string,
): WorkflowDefinition {
	const first = workflow.nodes.find((node) => node.id === source),
		second = workflow.nodes.find((node) => node.id === target);
	if (!first || !second || source === target || !workflowEdgeAllowed(kind, first.kind, second.kind))
		throw new Error("These node ports cannot be connected with this relationship.");
	if (workflow.edges.length >= 100) throw new Error("A graph supports at most 100 connections.");
	if (workflow.edges.some((edge) => edge.source === source && edge.target === target && edge.kind === kind))
		throw new Error("This connection already exists.");
	return {
		...workflow,
		edges: [
			...workflow.edges,
			{
				id,
				kind,
				source,
				target,
				label: kind,
				createdSequence: Math.max(0, ...workflow.edges.map((edge) => edge.createdSequence)) + 1,
			},
		],
	};
}
export function removeGraphNode(workflow: WorkflowDefinition, id: string): WorkflowDefinition {
	return {
		...workflow,
		nodes: workflow.nodes.filter((node) => node.id !== id),
		edges: workflow.edges.filter((edge) => edge.source !== id && edge.target !== id),
	};
}
export function graphDropPosition(
	client: { x: number; y: number },
	box: { left: number; top: number },
	scroll: { x: number; y: number },
	zoom: number,
): { x: number; y: number } {
	return {
		x: Math.max(24, (client.x - box.left + scroll.x) / zoom - GRAPH_NODE_WIDTH / 2),
		y: Math.max(24, (client.y - box.top + scroll.y) / zoom - 30),
	};
}
export function graphNodeColor(kind: WorkflowNodeKind): string {
	if (kind === "personal-agent" || kind === "harness-agent") return "#70b5f0";
	if (kind === "history") return "#b999f1";
	if (kind === "kanban-card" || kind === "board") return "#e3b76b";
	return "#b9e67f";
}
