import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { desktopPlatform } from "./desktop-platform.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(desktop, "src-tauri/.assets");
const target = desktopPlatform();
const directory = await mkdtemp(join(tmpdir(), "Klerm desktop smoke "));
const cwd = join(directory, "workspace with spaces");
await mkdir(cwd);
const report = join(directory, "startup.json");
const env = { ...process.env, KLERM_CODING_AGENT_DIR: join(directory, "agent"), KLERM_DESKTOP_CWD: cwd, KLERM_DESKTOP_SMOKE_REPORT: report };
delete env.KLERM_DESKTOP_NODE;
delete env.KLERM_DESKTOP_RPC_ENTRY;
let child;
let timeout;
try {
	const executable = process.argv.find((arg) => arg.startsWith("--app="))?.slice(6);
	if (executable) {
		child = spawn(resolve(executable), ["--startup-smoke"], { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
	} else {
		// No repository, system Node/PATH or user auth state is used by the packaged backend.
		env.PATH = join(assets, "runtime");
		child = spawn(join(assets, "runtime", target.node), [join(assets, "backend/node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js"), "--no-approve"], { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	}
	let diagnostics = "";
	child.stderr.on("data", (chunk) => { diagnostics = `${diagnostics}${chunk}`.slice(-4000); });
	const exited = new Promise((resolveExit, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => code === 0 ? resolveExit() : reject(new Error(`Desktop startup exited ${code}: ${diagnostics}`)));
		timeout = setTimeout(() => { child.kill(); reject(new Error(`Desktop startup smoke timed out: ${diagnostics}`)); }, 60_000);
	});
	if (!executable) {
		const lines = createInterface({ input: child.stdout });
		const response = new Promise((resolveResponse, rejectResponse) => {
			lines.on("line", (line) => {
				try {
					const event = JSON.parse(line);
					if (event.id === "packaged-backend-smoke") resolveResponse(event);
				} catch { rejectResponse(new Error("The packaged backend emitted invalid JSONL.")); }
			});
		});
		child.stdin.write(`${JSON.stringify({ id: "packaged-backend-smoke", type: "desktop_handshake" })}\n`);
		const handshake = await Promise.race([response, exited.then(() => { throw new Error("Backend exited before handshake."); })]);
		assert.equal(handshake.success, true);
		assert.equal(handshake.data.protocolVersion, 1);
		child.stdin.end();
		await exited;
		lines.close();
	} else {
		await exited;
		const startup = JSON.parse(await readFile(report, "utf8"));
		assert.equal(startup.ready, true, startup.error);
		assert.equal(startup.nativeWindow, true);
		assert.equal(startup.protocolVersion, 1);
	}
	console.log(`Desktop ${executable ? "native window + packaged backend" : "packaged Node + backend"} startup passed (${target.platform}/${target.arch}).`);
} finally {
	clearTimeout(timeout);
	if (child && child.exitCode === null) child.kill();
	await rm(directory, { recursive: true, force: true });
}
