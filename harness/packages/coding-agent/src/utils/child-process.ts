import {
	type ChildProcess,
	type ChildProcessByStdio,
	type ChildProcessWithoutNullStreams,
	spawn as nodeSpawn,
	spawnSync as nodeSpawnSync,
	type SpawnOptions,
	type SpawnOptionsWithStdioTuple,
	type SpawnSyncOptionsWithStringEncoding,
	type SpawnSyncReturns,
	type StdioNull,
	type StdioPipe,
} from "node:child_process";
import type { Readable } from "node:stream";
import crossSpawn from "cross-spawn";
import { nativeHarnessEnvironment } from "./harness-environment.ts";

const EXIT_STDIO_GRACE_MS = 100;

export function spawnProcess(
	command: string,
	args: readonly string[],
	options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
): ChildProcessByStdio<null, Readable, Readable>;
export function spawnProcess(
	command: string,
	args: readonly string[],
	options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
): ChildProcessWithoutNullStreams;
export function spawnProcess(command: string, args: readonly string[], options: SpawnOptions): ChildProcess;
export function spawnProcess(command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
	return process.platform === "win32" ? crossSpawn(command, args, options) : nodeSpawn(command, args, options);
}

export function spawnHarnessProcess(
	command: string,
	args: readonly string[],
	options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>,
): ChildProcessWithoutNullStreams {
	return spawnProcess(command, args, { ...options, env: nativeHarnessEnvironment(options.env) });
}

/** Bounded native command capture, including Windows npm/Python launcher shims. */
export async function runProcess(
	command: string,
	args: readonly string[],
	timeoutMs: number,
	maxOutputBytes: number,
): Promise<{ stdout: string; stderr: string }> {
	const child = spawnProcess(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
	let stdout = "";
	let stderr = "";
	let bytes = 0;
	let failure: Error | undefined;
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	const terminate = (error: Error) => {
		if (failure) return;
		failure = error;
		child.kill("SIGTERM");
		killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
	};
	const timer = setTimeout(() => terminate(new Error("Native command timed out.")), timeoutMs);
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	const capture = (chunk: string, stream: "stdout" | "stderr") => {
		if (failure) return;
		bytes += Buffer.byteLength(chunk, "utf8");
		if (bytes > maxOutputBytes) {
			terminate(new Error("Native command output exceeded its limit."));
			return;
		}
		if (stream === "stdout") stdout += chunk;
		else stderr += chunk;
	};
	child.stdout.on("data", (chunk: string) => capture(chunk, "stdout"));
	child.stderr.on("data", (chunk: string) => capture(chunk, "stderr"));
	try {
		const code = await waitForChildProcess(child);
		if (failure) throw failure;
		if (code !== 0) throw new Error(`Native command exited with code ${code ?? "unknown"}.`);
		return { stdout, stderr };
	} finally {
		clearTimeout(timer);
		if (killTimer) clearTimeout(killTimer);
	}
}

export function spawnProcessSync(
	command: string,
	args: string[],
	options: SpawnSyncOptionsWithStringEncoding,
): SpawnSyncReturns<string> {
	return process.platform === "win32"
		? crossSpawn.sync(command, args, options)
		: nodeSpawnSync(command, args, options);
}

/**
 * Wait for a child process to terminate without hanging on inherited stdio handles.
 *
 * A short-lived child can `exit` while a detached descendant keeps its stdout/stderr
 * pipe open. We must not resolve and destroy the streams on a fixed deadline measured
 * from `exit`, or output still being written past that deadline is silently lost
 * (earendil-works/pi#5303). Instead, after `exit` we wait for the pipes to fall idle:
 * the grace timer is re-armed on every chunk, so an actively writing descendant keeps
 * us reading, while a quiet inherited handle (e.g. a Windows daemonized descendant
 * that never lets `close` fire) still releases us after the grace elapses.
 */
export function waitForChildProcess(child: ChildProcess): Promise<number | null> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let exited = false;
		let exitCode: number | null = null;
		let postExitTimer: NodeJS.Timeout | undefined;
		let stdoutEnded = child.stdout === null;
		let stderrEnded = child.stderr === null;

		const cleanup = () => {
			if (postExitTimer) {
				clearTimeout(postExitTimer);
				postExitTimer = undefined;
			}
			child.removeListener("error", onError);
			child.removeListener("exit", onExit);
			child.removeListener("close", onClose);
			child.stdout?.removeListener("end", onStdoutEnd);
			child.stderr?.removeListener("end", onStderrEnd);
			child.stdout?.removeListener("data", onData);
			child.stderr?.removeListener("data", onData);
		};

		const finalize = (code: number | null) => {
			if (settled) return;
			settled = true;
			cleanup();
			child.stdout?.destroy();
			child.stderr?.destroy();
			resolve(code);
		};

		const maybeFinalizeAfterExit = () => {
			if (!exited || settled) return;
			if (stdoutEnded && stderrEnded) {
				finalize(exitCode);
			}
		};

		const armIdleTimer = () => {
			if (postExitTimer) clearTimeout(postExitTimer);
			postExitTimer = setTimeout(() => finalize(exitCode), EXIT_STDIO_GRACE_MS);
		};

		const onData = () => {
			// Output is still arriving after exit; defer finalizing so we don't
			// destroy the stream mid-write and truncate the tail.
			if (exited && !settled) armIdleTimer();
		};

		const onStdoutEnd = () => {
			stdoutEnded = true;
			maybeFinalizeAfterExit();
		};

		const onStderrEnd = () => {
			stderrEnded = true;
			maybeFinalizeAfterExit();
		};

		const onError = (err: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(err);
		};

		const onExit = (code: number | null) => {
			exited = true;
			exitCode = code;
			maybeFinalizeAfterExit();
			if (!settled) {
				armIdleTimer();
			}
		};

		const onClose = (code: number | null) => {
			finalize(code);
		};

		child.stdout?.once("end", onStdoutEnd);
		child.stderr?.once("end", onStderrEnd);
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.once("error", onError);
		child.once("exit", onExit);
		child.once("close", onClose);
	});
}
