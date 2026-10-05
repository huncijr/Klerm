import { describe, expect, test } from "vitest";
import { type GraphCatalogItem, validateWorkflow } from "../../coding-agent/src/klerm/workflows.ts";
import {
	addGraphNode,
	blankWorkflow,
	connectGraphNodes,
	graphDropPosition,
	removeGraphNode,
} from "../src/lib/graph.ts";

describe("graph editing without execution", () => {
	test("adding an existing attempt creates only a reference, not a copied result or runnable task", () => {
		const item: GraphCatalogItem = {
			key: "key",
			title: "Earlier attempt",
			subtitle: "",
			category: "history",
			nodeKind: "history",
			status: "succeeded",
			workspaceRoot: "/project",
			sourceRef: { kind: "kanban-attempt", boardId: "board", taskId: "task", attemptId: "attempt" },
			available: true,
		};
		const empty = blankWorkflow("/project", "graph");
		const value = addGraphNode(empty, "history", "history", { x: 25, y: 30 }, item);
		expect(empty.nodes).toEqual([]);
		expect(value.nodes[0]).toMatchObject({ sourceRef: item.sourceRef, brief: "", note: "" });
		expect(value.nodes[0]?.sourceRef).not.toBe(item.sourceRef);
		expect(validateWorkflow(value).executionSupported).toBe(false);
	});
	test("connections obey port semantics, and deleting a node only removes graph edges", () => {
		let value = addGraphNode(blankWorkflow("/project", "graph"), "task", "task", { x: 0, y: 0 });
		value = addGraphNode(value, "agent", "personal-agent", { x: 250, y: 0 });
		value = connectGraphNodes(value, "assign", "assigned-to", "task", "agent");
		expect(() => connectGraphNodes(value, "invalid", "depends-on", "agent", "task")).toThrow("ports");
		expect(() => connectGraphNodes(value, "duplicate", "assigned-to", "task", "agent")).toThrow("already exists");
		const removed = removeGraphNode(value, "agent");
		expect(removed.nodes.map((node) => node.id)).toEqual(["task"]);
		expect(removed.edges).toEqual([]);
		expect(value.nodes).toHaveLength(2);
	});
	test("drop coordinates respect zoom and scroll rather than screen position", () => {
		expect(graphDropPosition({ x: 300, y: 200 }, { left: 100, top: 50 }, { x: 400, y: 100 }, 2)).toEqual({
			x: 190,
			y: 95,
		});
		expect(graphDropPosition({ x: 0, y: 0 }, { left: 0, top: 0 }, { x: 0, y: 0 }, 1)).toEqual({ x: 24, y: 24 });
	});
});
