import { describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { createHarness } from "./suite/harness.ts";

const io = vi.hoisted(() => ({ lines: [] as string[], input: undefined as ((line: string) => void) | undefined }));
vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		io.lines.push(line);
	},
}));
vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));
vi.mock("../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		io.input = onLine;
		return () => {};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));
async function send(command: Record<string, unknown>) {
	io.input?.(JSON.stringify(command));
	let value: Record<string, unknown> | undefined;
	await vi.waitFor(() => {
		value = io.lines
			.flatMap((line) => line.trim().split("\n"))
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.find((row) => row.id === command.id && row.type === "response");
		expect(value).toBeDefined();
	});
	return value!;
}
describe("live shortcut settings RPC", () => {
	it("returns effective desktop/CLI actions, saves overrides and rejects conflicts without model calls", async () => {
		const oldEnd = process.stdin.listeners("end"),
			signals = new Map((["SIGTERM", "SIGHUP"] as const).map((signal) => [signal, process.listeners(signal)]));
		const harness = await createHarness();
		vi.spyOn(harness.settingsManager, "getAgentDir").mockReturnValue(harness.tempDir);
		(harness.sessionManager as unknown as { cwd: string }).cwd = harness.tempDir;
		const runtime = {
			session: harness.session,
			setRebindSession: vi.fn(),
			newSession: vi.fn(async () => ({ cancelled: true })),
			dispose: vi.fn(),
			switchSession: vi.fn(),
			fork: vi.fn(),
		} as unknown as AgentSessionRuntime;
		try {
			void runRpcMode(runtime, { personalBotStorageDir: harness.tempDir, discoverCodingHarnesses: async () => [] });
			await vi.waitFor(() => expect(io.input).toBeDefined());
			expect(await send({ id: "settings", type: "get_desktop_settings" })).toMatchObject({
				success: true,
				data: {
					shortcuts: expect.arrayContaining([
						expect.objectContaining({ id: "save", keys: "Ctrl/Cmd+S" }),
						expect.objectContaining({ id: "view.browser", keys: "Ctrl/Cmd+Alt+B" }),
					]),
					cliKeybindings: expect.arrayContaining([
						expect.objectContaining({ id: "app.models.save", keys: ["ctrl+s"] }),
					]),
				},
			});
			expect(await send({ id: "change", type: "set_desktop_keybindings", overrides: { save: "F9" } })).toMatchObject(
				{
					success: true,
					data: { shortcuts: expect.arrayContaining([expect.objectContaining({ id: "save", keys: "F9" })]) },
				},
			);
			expect(
				await send({ id: "conflict", type: "set_desktop_keybindings", overrides: { save: "Ctrl+Alt+B" } }),
			).toMatchObject({ success: false, code: "INVALID_KEYBINDINGS" });
			expect(
				await send({
					id: "cli-change",
					type: "set_cli_keybindings",
					overrides: { "app.session.new": ["ctrl+alt+m"] },
				}),
			).toMatchObject({
				success: true,
				data: {
					cliKeybindings: expect.arrayContaining([
						expect.objectContaining({ id: "app.session.new", keys: ["ctrl+alt+m"] }),
					]),
				},
			});
			expect(
				await send({ id: "cli-invalid", type: "set_cli_keybindings", overrides: { "app.session.new": ["cmd+s"] } }),
			).toMatchObject({ success: false });
			expect(harness.faux.state.callCount).toBe(0);
		} finally {
			if (io.input) await send({ id: "cleanup", type: "new_session" });
			for (const listener of process.stdin.listeners("end"))
				if (!oldEnd.includes(listener)) process.stdin.off("end", listener as Parameters<typeof process.on>[1]);
			for (const [signal, previous] of signals)
				for (const listener of process.listeners(signal))
					if (!previous.includes(listener)) process.off(signal, listener as Parameters<typeof process.on>[1]);
			vi.restoreAllMocks();
			harness.cleanup();
			io.lines = [];
			io.input = undefined;
		}
	});
});
