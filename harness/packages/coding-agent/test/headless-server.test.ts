import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HEADLESS_PAGE } from "../src/server/headless-page.ts";
import { createHeadlessServer } from "../src/server/headless-server.ts";
import type { HeadlessBackend } from "../src/server/rpc-process-backend.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(directory?: string) {
	const dir = directory ?? (await mkdtemp(join(tmpdir(), "klerm-server-test-")));
	if (!directory) cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const listeners = new Set<(event: Record<string, unknown>) => void>();
	const request = vi.fn(async (command: Record<string, unknown>) => ({
		type: "response",
		id: command.id,
		success: true,
		data: { accepted: command.type },
	}));
	const backend: HeadlessBackend = {
		request,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close: vi.fn(async () => {}),
	};
	const token = "test-owner-token-".repeat(4);
	const scan = vi.fn(async () => [{ kind: "klerm" as const, builtin: true, available: true, models: [] }]);
	const app = await createHeadlessServer({ backend, token, stateDirectory: dir, scan });
	await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
	cleanups.push(() => app.close());
	const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
	const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
	const command = (value: unknown, extra: Record<string, string> = {}) =>
		fetch(`${url}/api/command`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(value) });
	return { app, url, command, request, backend, listeners, dir, headers, scan };
}

describe("headless HTTP server", () => {
	test("worker form uses declared capabilities and preserves the chosen model across async configuration reload", async () => {
		interface Element {
			value: string;
			readOnly: boolean;
			disabled: boolean;
			textContent: string;
			children: Element[];
			onclick?: () => Promise<void>;
			onchange?: () => void;
			replaceChildren(...children: Element[]): void;
		}
		const elements = new Map<string, Element>();
		const element = (): Element => ({
			value: "",
			readOnly: false,
			disabled: false,
			textContent: "",
			children: [],
			replaceChildren(...children) {
				this.children = children;
				if (!children.some((child) => child.value === this.value)) this.value = children[0]?.value ?? "";
			},
		});
		const get = (id: string) => {
			if (!elements.has(id)) elements.set(id, element());
			return elements.get(id)!;
		};
		let slots = { externalHarnessesEnabled: false, agents: [] as Array<Record<string, unknown>> };
		const harnesses = [
			{
				kind: "runtime-native",
				available: true,
				adapterConnected: true,
				capabilities: { modelSelection: "native", executionProfiles: ["native"] },
			},
			{
				kind: "runtime-explicit",
				available: true,
				adapterConnected: true,
				capabilities: { modelSelection: "explicit", executionProfiles: ["native"] },
			},
		];
		const context = createContext({
			document: { getElementById: get, createElement: element },
			crypto: { randomUUID },
			fetch: async (_url: string, input: { body: string }) => {
				const request = JSON.parse(input.body) as { type: string; slots?: typeof slots };
				if (request.type === "set_coding_harness_slots") slots = request.slots!;
				return { ok: true, json: async () => ({ success: true, data: { slots, harnesses } }) };
			},
		});
		new Script(HEADLESS_PAGE.match(/<script>([\s\S]*)<\/script>/)![1]!).runInContext(context);
		await new Script("loadSlots()").runInContext(context);
		expect(get("model").value).toBe("native-default");
		expect(get("model").readOnly).toBe(true);
		expect(get("profile").children.map((child) => child.value)).toEqual(["native"]);
		get("harness").value = "runtime-explicit";
		get("harness").onchange?.();
		get("agent").value = "agent2";
		get("model").value = "Owner/Case Sensitive Model";
		await get("configureWorker").onclick?.();
		expect(slots.agents[0]).toMatchObject({
			id: "agent2",
			kind: "runtime-explicit",
			model: "Owner/Case Sensitive Model",
			executionProfile: "native",
		});
	});
	test("serves a browser page with valid JavaScript and no private owner token", async () => {
		const server = await setup();
		const page = await (await fetch(server.url)).text();
		expect(page).toContain("Configure worker");
		expect(page).not.toContain("test-owner-token-");
		const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
		expect(script).toBeDefined();
		expect(() => new Script(script!)).not.toThrow();
	});

	test("requires owner auth, enforces origin, validates command type and never dispatches invalid input", async () => {
		const server = await setup();
		expect((await fetch(`${server.url}/api/harnesses`)).status).toBe(401);
		expect(
			(await server.command({ id: "one", type: "prompt", message: "hello" }, { Origin: "https://foreign.invalid" }))
				.status,
		).toBe(403);
		expect((await server.command({ id: "one", type: "switch_session", sessionPath: "/etc/passwd" })).status).toBe(
			400,
		);
		expect(server.request).toHaveBeenCalledTimes(1); // readiness handshake only
	});

	test("dispatches an idempotent prompt once, detects conflicting reuse and journals no prompt contents", async () => {
		const server = await setup();
		const value = { id: "prompt-1", type: "prompt", message: "private task text" };
		const [first, second] = await Promise.all([server.command(value), server.command(value)]);
		expect(await first.json()).toEqual(await second.json());
		expect(server.request.mock.calls.filter(([command]) => command.type === "prompt")).toHaveLength(1);
		expect((await server.command({ ...value, message: "other" })).status).toBe(409);
		const journal = await readFile(join(server.dir, "server-events.jsonl"), "utf8");
		expect(journal).not.toContain("private task text");
		const events = journal
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { sequence: number });
		expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
	});

	test("never redispatches an accepted command after a service restart", async () => {
		const first = await setup();
		const value = { id: "persisted-request", type: "prompt", message: "work" };
		await first.command(value);
		await first.app.close();
		cleanups.pop();
		const second = await setup(first.dir);
		expect((await second.command(value)).status).toBe(409);
		expect(second.request.mock.calls.some(([command]) => command.type === "prompt")).toBe(false);
	});

	test("shares overlapping discovery scans and updates changed snapshots only", async () => {
		const server = await setup();
		await server.app.refresh();
		let release: (() => void) | undefined;
		server.scan.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve([{ kind: "klerm", builtin: true, available: true, models: [] }]);
				}),
		);
		const first = server.app.refresh(),
			second = server.app.refresh();
		expect(first).toBe(second);
		release?.();
		await first;
		const journal = await readFile(join(server.dir, "server-events.jsonl"), "utf8");
		expect(journal.split("HARNESS_REGISTRY_CHANGED")).toHaveLength(2);
	});

	test("replays SSE events, excludes responses, and leaves the backend alive on client disconnect", async () => {
		const server = await setup();
		await server.app.refresh();
		for (const listener of server.listeners) {
			listener({ type: "response", secret: "never-stream-this" });
			listener({ type: "agent_start", agentId: "agent1" });
		}
		const control = new AbortController();
		const response = await fetch(`${server.url}/api/events`, {
			headers: { ...server.headers, "Last-Event-ID": "expired:1" },
			signal: control.signal,
		});
		const reader = response.body!.getReader();
		const frame = new TextDecoder().decode((await reader.read()).value);
		expect(frame).toContain("stream_reset");
		expect(frame).toContain("agent_start");
		expect(frame).not.toContain("never-stream-this");
		control.abort();
		await reader.cancel().catch(() => undefined);
		expect(server.backend.close).not.toHaveBeenCalled();
		expect((await server.command({ id: "still-alive", type: "get_state" })).status).toBe(200);
	});
});
