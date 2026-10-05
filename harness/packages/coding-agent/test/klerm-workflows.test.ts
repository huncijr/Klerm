import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkflowRevisionError, WorkflowStore } from "../src/klerm/workflow-store.ts";
import {
	type GraphCatalogItem,
	graphSourceKey,
	parseGraphSource,
	parseWorkflow,
	validateWorkflow,
	type WorkflowDefinition,
	type WorkflowNode,
	workflowEdgeAllowed,
} from "../src/klerm/workflows.ts";

function node(id: string, kind: WorkflowNode["kind"], sequence = 1): WorkflowNode {
	return { id, kind, title: id, createdSequence: sequence, position: { x: 0, y: 0 }, brief: "brief", note: "" };
}
function draft(root: string): WorkflowDefinition {
	return {
		version: 1,
		id: "workflow-one",
		revision: 0,
		name: "Existing work",
		workspaceRoot: root,
		createdAt: "",
		updatedAt: "",
		nodes: [node("start", "start"), node("task", "task", 2), node("end", "end", 3)],
		edges: [
			{ id: "e1", kind: "depends-on", source: "start", target: "task", label: "", createdSequence: 1 },
			{ id: "e2", kind: "depends-on", source: "task", target: "end", label: "", createdSequence: 2 },
		],
		viewport: { x: 0, y: 0, zoom: 1 },
	};
}

describe("graph draft contracts", () => {
	it("rejects malformed/oversized data and arbitrary filesystem source fields", () => {
		const value = draft("/tmp");
		expect(parseWorkflow(value)).toEqual(value);
		expect(() => parseWorkflow({ ...value, nodes: Array(51).fill(node("x", "task")) })).toThrow("50 nodes");
		expect(() => parseWorkflow({ ...value, viewport: { x: 0, y: 0, zoom: NaN } })).toThrow("zoom");
		expect(() => parseGraphSource({ kind: "personal-agent", botId: "bot", path: "/auth.json" })).toThrow(
			"Unexpected",
		);
		expect(() => parseWorkflow({ ...value, nodes: [node("x", "task"), node("x", "task")] })).toThrow("Duplicate");
	});
	it("does not confuse assignments, membership or history with control flow", () => {
		expect(workflowEdgeAllowed("assigned-to", "task", "personal-agent")).toBe(true);
		expect(workflowEdgeAllowed("depends-on", "personal-agent", "task")).toBe(false);
		expect(workflowEdgeAllowed("membership", "board", "kanban-card")).toBe(true);
		expect(workflowEdgeAllowed("depends-on", "history", "task")).toBe(false);
		expect(workflowEdgeAllowed("artifact", "history", "task")).toBe(true);
	});
	it("returns stable topology independent of layout and blocks cycles", () => {
		const value = draft("/tmp");
		value.nodes.reverse();
		value.nodes[0]!.position.x = -400;
		expect(validateWorkflow(value)).toMatchObject({
			valid: true,
			executionSupported: false,
			order: ["start", "task", "end"],
		});
		value.edges.push({
			id: "loop",
			kind: "depends-on",
			source: "task",
			target: "task",
			label: "",
			createdSequence: 3,
		});
		expect(validateWorkflow(value).issues.some((issue) => issue.code === "INVALID_EDGE")).toBe(true);
		value.nodes.push(node("other", "task", 4));
		value.edges.push(
			{ id: "out", kind: "depends-on", source: "task", target: "other", label: "", createdSequence: 4 },
			{ id: "back", kind: "artifact", source: "other", target: "task", label: "", createdSequence: 5 },
		);
		expect(validateWorkflow(value).issues.some((issue) => issue.code === "CYCLE")).toBe(true);
	});
	it("preserves missing references and rejects a graph trying to grant Kanban access", () => {
		const value = draft("/tmp");
		const card = {
			...node("card", "kanban-card"),
			sourceRef: { kind: "kanban-card" as const, boardId: "board", taskId: "card" },
		};
		const bot = { ...node("bot", "personal-agent"), sourceRef: { kind: "personal-agent" as const, botId: "bot" } };
		value.nodes.push(card, bot);
		value.edges.push({
			id: "assign",
			kind: "assigned-to",
			source: "card",
			target: "bot",
			label: "",
			createdSequence: 3,
		});
		const items = new Map<string, GraphCatalogItem>(
			[card, bot].map((node) => [
				graphSourceKey(node.sourceRef),
				{
					key: graphSourceKey(node.sourceRef),
					category: node.kind === "personal-agent" ? "agents" : "kanban",
					nodeKind: node.kind,
					title: node.title,
					subtitle: "",
					status: "saved",
					workspaceRoot: "/tmp",
					sourceRef: node.sourceRef,
					ownerBotId: "bot",
					available: true,
					kanbanEnabled: false,
				},
			]),
		);
		expect(
			validateWorkflow(value, (ref) => items.get(graphSourceKey(ref))).issues.some(
				(issue) => issue.code === "KANBAN_DISABLED",
			),
		).toBe(true);
		items.delete(graphSourceKey(card.sourceRef));
		expect(
			validateWorkflow(value, (ref) => items.get(graphSourceKey(ref))).issues.some(
				(issue) => issue.code === "MISSING_SOURCE",
			),
		).toBe(true);
	});
});

describe("backend-owned workflow persistence", () => {
	it("persists drafts, prevents lost updates across store instances and logs only digests", async () => {
		const root = await mkdtemp(join(tmpdir(), "Klerm graph "));
		try {
			const first = new WorkflowStore(root),
				other = new WorkflowStore(root);
			expect((await first.list()).workflows).toEqual([]);
			const value = draft(root);
			value.nodes[1]!.brief = "private user brief";
			const saved = await first.save(value, 0);
			expect((await other.get(saved.id)).nodes[1]?.brief).toBe("private user brief");
			const results = await Promise.allSettled([
				first.save({ ...saved, name: "First edit" }, 1),
				other.save({ ...saved, name: "Other edit" }, 1),
			]);
			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
			expect(results.find((result) => result.status === "rejected")).toMatchObject({
				reason: expect.any(WorkflowRevisionError),
			});
			expect((await first.list()).workflows[0]?.revision).toBe(2);
			const audit = await readFile(join(root, ".klerm/workflow-events.jsonl"), "utf8");
			expect(audit).not.toContain("private user brief");
			expect(
				audit
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line).sequence),
			).toEqual([1, 2]);
			await expect(first.delete(saved.id, 1)).rejects.toBeInstanceOf(WorkflowRevisionError);
			await first.delete(saved.id, 2);
			expect((await first.list()).workflows).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("retains corrupt data rather than replacing it with an empty registry", async () => {
		const root = await mkdtemp(join(tmpdir(), "klerm-graph-corrupt-"));
		try {
			const store = new WorkflowStore(root);
			await store.save(draft(root), 0);
			const path = join(root, ".klerm/workflows/registry.json");
			await writeFile(path, "broken");
			await expect(store.save(draft(root), 0)).rejects.toThrow();
			expect(await readFile(path, "utf8")).toBe("broken");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	it("reconciles a published-but-not-cleared audit event without publishing it twice", async () => {
		const root = await mkdtemp(join(tmpdir(), "klerm-graph-audit-"));
		try {
			const store = new WorkflowStore(root),
				saved = await store.save(draft(root), 0);
			const registryPath = join(root, ".klerm/workflows/registry.json"),
				auditPath = join(root, ".klerm/workflow-events.jsonl");
			const registry = JSON.parse(await readFile(registryPath, "utf8"));
			registry.pendingAudit = JSON.parse((await readFile(auditPath, "utf8")).trim());
			await writeFile(registryPath, JSON.stringify(registry));
			await store.save({ ...saved, name: "After recovery" }, 1);
			expect(
				(await readFile(auditPath, "utf8"))
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line).sequence),
			).toEqual([1, 2]);
			expect(JSON.parse(await readFile(registryPath, "utf8"))).not.toHaveProperty("pendingAudit");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
