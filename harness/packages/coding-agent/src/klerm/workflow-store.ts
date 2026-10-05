import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { parseWorkflow, type WorkflowDefinition } from "./workflows.ts";

export interface WorkflowAuditEvent {
	version: 1;
	sequence: number;
	workflowId: string;
	revision: number;
	timestamp: string;
	kind: "WORKFLOW_SAVED" | "WORKFLOW_DELETED";
	sender: "user";
	recipient: "workflow-registry";
	reason: string;
	digest?: string;
}
interface Registry {
	version: 1;
	sequence: number;
	workflows: WorkflowDefinition[];
	pendingAudit?: WorkflowAuditEvent;
}
export type WorkflowSummary = Pick<
	WorkflowDefinition,
	"id" | "name" | "revision" | "workspaceRoot" | "createdAt" | "updatedAt"
> & { nodeCount: number; edgeCount: number };
export class WorkflowRevisionError extends Error {
	constructor() {
		super("Workflow changed in another window. Reload it before saving or deleting.");
		this.name = "WorkflowRevisionError";
	}
}

export class WorkflowStore {
	private readonly cwd: string;
	constructor(cwd: string) {
		this.cwd = cwd;
	}
	private async paths() {
		const root = await realpath(this.cwd);
		return {
			root,
			directory: join(root, ".klerm/workflows"),
			file: join(root, ".klerm/workflows/registry.json"),
			audit: join(root, ".klerm/workflow-events.jsonl"),
		};
	}
	private async read(path: string): Promise<Registry> {
		try {
			const input = JSON.parse(await readFile(path, "utf8")) as Registry;
			if (
				input.version !== 1 ||
				!Number.isSafeInteger(input.sequence) ||
				input.sequence < 0 ||
				!Array.isArray(input.workflows) ||
				input.workflows.length > 100
			)
				throw new Error("Invalid workflow registry; restore it before editing.");
			return { ...input, workflows: input.workflows.map(parseWorkflow) };
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return { version: 1, sequence: 0, workflows: [] };
			throw error;
		}
	}
	private async write(path: string, value: Registry): Promise<void> {
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
			await rename(temporary, path);
		} finally {
			await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
		}
	}
	private async flushAudit(paths: Awaited<ReturnType<WorkflowStore["paths"]>>, registry: Registry): Promise<void> {
		const pending = registry.pendingAudit;
		if (!pending) return;
		let lines = "";
		try {
			lines = await readFile(paths.audit, "utf8");
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
		}
		const last = lines.trim().split("\n").at(-1);
		const previous = last ? (JSON.parse(last) as WorkflowAuditEvent) : undefined;
		if (!previous || previous.sequence < pending.sequence)
			await appendFile(paths.audit, `${JSON.stringify(pending)}\n`, { mode: 0o600, flush: true });
		else if (JSON.stringify(previous) !== JSON.stringify(pending))
			throw new Error("Workflow audit sequence is inconsistent; edit rejected.");
		delete registry.pendingAudit;
		await this.write(paths.file, registry);
	}
	async list(): Promise<{ workspaceRoot: string; workflows: WorkflowSummary[]; executionSupported: false }> {
		const paths = await this.paths(),
			registry = await this.read(paths.file);
		return {
			workspaceRoot: paths.root,
			executionSupported: false,
			workflows: registry.workflows.map((workflow) => ({
				id: workflow.id,
				name: workflow.name,
				revision: workflow.revision,
				workspaceRoot: workflow.workspaceRoot,
				createdAt: workflow.createdAt,
				updatedAt: workflow.updatedAt,
				nodeCount: workflow.nodes.length,
				edgeCount: workflow.edges.length,
			})),
		};
	}
	async get(id: string): Promise<WorkflowDefinition> {
		const workflow = (await this.read((await this.paths()).file)).workflows.find((item) => item.id === id);
		if (!workflow) throw new Error("Workflow not found in this workspace.");
		return workflow;
	}
	async save(value: unknown, expectedRevision: number): Promise<WorkflowDefinition> {
		const draft = parseWorkflow(value);
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || draft.revision !== expectedRevision)
			throw new WorkflowRevisionError();
		const paths = await this.paths();
		if ((await realpath(draft.workspaceRoot)) !== paths.root)
			throw new Error("Workflow belongs to a different workspace.");
		await mkdir(paths.directory, { recursive: true, mode: 0o700 });
		const release = await lockfile.lock(paths.directory, {
			realpath: false,
			retries: { retries: 8, minTimeout: 20, maxTimeout: 100 },
		});
		try {
			const registry = await this.read(paths.file);
			await this.flushAudit(paths, registry);
			const previous = registry.workflows.find((item) => item.id === draft.id);
			if ((previous?.revision ?? 0) !== expectedRevision) throw new WorkflowRevisionError();
			if (!previous && registry.workflows.length >= 100)
				throw new Error("This workspace supports at most 100 workflows.");
			const now = new Date().toISOString();
			const saved: WorkflowDefinition = {
				...draft,
				revision: expectedRevision + 1,
				workspaceRoot: paths.root,
				createdAt: previous?.createdAt ?? now,
				updatedAt: now,
			};
			registry.workflows = [...registry.workflows.filter((item) => item.id !== draft.id), saved];
			registry.pendingAudit = {
				version: 1,
				sequence: ++registry.sequence,
				workflowId: saved.id,
				revision: saved.revision,
				timestamp: now,
				kind: "WORKFLOW_SAVED",
				sender: "user",
				recipient: "workflow-registry",
				reason: "Graph draft saved; no execution dispatched.",
				digest: createHash("sha256").update(JSON.stringify(saved)).digest("hex"),
			};
			await this.write(paths.file, registry);
			await this.flushAudit(paths, registry);
			return saved;
		} finally {
			await release();
		}
	}
	async delete(id: string, expectedRevision: number): Promise<void> {
		const paths = await this.paths();
		await mkdir(paths.directory, { recursive: true, mode: 0o700 });
		const release = await lockfile.lock(paths.directory, {
			realpath: false,
			retries: { retries: 8, minTimeout: 20, maxTimeout: 100 },
		});
		try {
			const registry = await this.read(paths.file);
			await this.flushAudit(paths, registry);
			const previous = registry.workflows.find((item) => item.id === id);
			if (!previous) throw new Error("Workflow not found.");
			if (previous.revision !== expectedRevision) throw new WorkflowRevisionError();
			registry.workflows = registry.workflows.filter((item) => item.id !== id);
			registry.pendingAudit = {
				version: 1,
				sequence: ++registry.sequence,
				workflowId: id,
				revision: previous.revision,
				timestamp: new Date().toISOString(),
				kind: "WORKFLOW_DELETED",
				sender: "user",
				recipient: "workflow-registry",
				reason: "Graph draft deleted; source agents, cards and sessions retained.",
			};
			await this.write(paths.file, registry);
			await this.flushAudit(paths, registry);
		} finally {
			await release();
		}
	}
}
