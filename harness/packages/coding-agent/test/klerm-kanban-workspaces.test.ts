import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KanbanWorkspaceBusyError, KanbanWorkspaceReservations } from "../src/klerm/kanban-workspaces.ts";

describe("Kanban workspace admission", () => {
	let root: string;
	let workspaces: KanbanWorkspaceReservations;
	const owner = { boardId: "board", taskId: "first" };
	const other = { boardId: "another-board", taskId: "second" };
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "klerm-kanban-workspaces-"));
		await mkdir(join(root, "app"));
		await mkdir(join(root, "app", "src"));
		await mkdir(join(root, "app-other"));
		workspaces = new KanbanWorkspaceReservations();
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("admits only one of two simultaneous writers, including across boards", async () => {
		const results = await Promise.allSettled([
			workspaces.acquire(root, owner, "write"),
			workspaces.acquire(root, other, "write"),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(KanbanWorkspaceBusyError);
	});
	it.each([true, false])(
		"blocks nested-folder conflicts in either direction (parent first: %s)",
		async (parentFirst) => {
			const parent = join(root, "app");
			const child = join(parent, "src");
			await workspaces.acquire(parentFirst ? parent : child, owner, "write");
			await expect(workspaces.acquire(parentFirst ? child : parent, other, "read")).rejects.toBeInstanceOf(
				KanbanWorkspaceBusyError,
			);
		},
	);
	it("allows overlapping readers but holds the writer until the final reader releases", async () => {
		const first = await workspaces.acquire(root, owner, "read");
		const second = await workspaces.acquire(join(root, "app"), other, "read");
		first.release();
		await expect(workspaces.acquire(root, owner, "write")).rejects.toBeInstanceOf(KanbanWorkspaceBusyError);
		second.release();
		expect((await workspaces.acquire(root, owner, "write")).access).toBe("write");
	});
	it("does not confuse a common filename prefix with a nested folder", async () => {
		await workspaces.acquire(join(root, "app"), owner, "write");
		expect((await workspaces.acquire(join(root, "app-other"), other, "write")).taskId).toBe("second");
	});
	it.skipIf(process.platform === "win32")(
		"canonicalizes symlinks and relative path components before admission",
		async () => {
			await symlink(join(root, "app"), join(root, "alias"));
			await workspaces.acquire(join(root, "alias"), owner, "write");
			await expect(workspaces.acquire(join(root, "app", "src", ".."), other, "write")).rejects.toMatchObject({
				workspaceRoot: join(root, "app"),
				owner,
			});
		},
	);
	it("makes release idempotent without releasing a later reservation", async () => {
		const first = await workspaces.acquire(root, owner, "write");
		expect(first.release()).toBe(true);
		await workspaces.acquire(root, other, "write");
		expect(first.release()).toBe(false);
		await expect(workspaces.acquire(root, owner, "read")).rejects.toBeInstanceOf(KanbanWorkspaceBusyError);
	});
	it("rejects duplicate read admission for the same task", async () => {
		await workspaces.acquire(root, owner, "read");
		await expect(workspaces.acquire(join(root, "app-other"), owner, "read")).rejects.toBeInstanceOf(
			KanbanWorkspaceBusyError,
		);
	});
	it("does not retain a claim when folder validation fails", async () => {
		await writeFile(join(root, "file"), "content");
		await expect(workspaces.acquire(join(root, "file"), owner, "write")).rejects.toThrow("not a directory");
		expect((await workspaces.acquire(root, owner, "write")).taskId).toBe("first");
	});
});
