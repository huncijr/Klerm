import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

export interface KanbanWorkspaceOwner {
	readonly boardId: string;
	readonly taskId: string;
}

export interface KanbanWorkspaceReservation extends KanbanWorkspaceOwner {
	readonly workspaceRoot: string;
	readonly access: "read" | "write";
	/** Idempotent; true only when this call released the reservation. */
	release(): boolean;
}

export class KanbanWorkspaceBusyError extends Error {
	readonly owner: KanbanWorkspaceOwner;
	readonly workspaceRoot: string;

	constructor(reservation: KanbanWorkspaceReservation) {
		super(
			`Task folder is busy: task "${reservation.taskId}" on board "${reservation.boardId}" is using ${reservation.workspaceRoot}. Wait for it to finish or stop it before starting conflicting work.`,
		);
		this.name = "KanbanWorkspaceBusyError";
		this.owner = { boardId: reservation.boardId, taskId: reservation.taskId };
		this.workspaceRoot = reservation.workspaceRoot;
	}
}

function containsFolder(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Cooperative admission for Kanban runs owned by one backend, not an OS/filesystem lock. */
export class KanbanWorkspaceReservations {
	private readonly active = new Map<symbol, KanbanWorkspaceReservation>();

	async acquire(
		cwd: string,
		owner: KanbanWorkspaceOwner,
		access: "read" | "write",
	): Promise<KanbanWorkspaceReservation> {
		const workspaceRoot = await realpath(cwd);
		if (!(await stat(workspaceRoot)).isDirectory()) throw new Error("Kanban task folder is not a directory.");
		// No await between conflict detection and insertion: simultaneous starts
		// cannot both pass admission after resolving their real paths.
		for (const reservation of this.active.values()) {
			const sameTask = owner.boardId === reservation.boardId && owner.taskId === reservation.taskId;
			const overlaps =
				containsFolder(reservation.workspaceRoot, workspaceRoot) ||
				containsFolder(workspaceRoot, reservation.workspaceRoot);
			if (sameTask || (overlaps && (access === "write" || reservation.access === "write"))) {
				throw new KanbanWorkspaceBusyError(reservation);
			}
		}
		const token = Symbol();
		const reservation: KanbanWorkspaceReservation = {
			...owner,
			workspaceRoot,
			access,
			release: () => this.active.delete(token),
		};
		this.active.set(token, reservation);
		return reservation;
	}
}
