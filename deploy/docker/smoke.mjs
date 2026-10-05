import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Real transport/lifecycle smoke. No model prompts, login, or provider calls.
const mode = process.argv[2];
if (mode !== "--native" && mode !== "--docker") {
	console.error("Usage: node deploy/docker/smoke.mjs --native|--docker");
	process.exit(1);
}

const docker = (...args) =>
	execFileSync("docker", args, { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();

async function waitForReady(url) {
	for (let attempt = 0; attempt < 120; attempt++) {
		try {
			const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1000) });
			if (response.ok && (await response.json()).ready) return;
		} catch {
			// Startup includes the bounded native harness scan.
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error("The server did not become ready within 60 seconds.");
}

async function stateRequest(url, token, requestId) {
	return fetch(`${url}/api/command`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({ id: requestId, type: "get_state" }),
		signal: AbortSignal.timeout(20_000),
	});
}

async function checkTransport(url, token, requestId) {
	if ((await fetch(`${url}/api/harnesses`)).status !== 401) throw new Error("Unauthenticated access was not rejected.");
	const page = await (await fetch(url)).text();
	if (!page.includes("Klerm Server") || page.includes(token)) throw new Error("Browser page or token isolation failed.");
	const response = await stateRequest(url, token, requestId);
	if (!response.ok || !(await response.json()).success) throw new Error("Real RPC state request failed.");
	console.log("Browser page, owner authentication and real RPC state: passed");
}

async function checkRestart(url, token, requestId) {
	await waitForReady(url);
	if ((await stateRequest(url, token, requestId)).status !== 409) throw new Error("Previously accepted request was not preserved after restart.");
	if (!(await (await stateRequest(url, token, randomUUID())).json()).success) throw new Error("New request failed after restart.");
	console.log("Restart, persistent token and request deduplication: passed");
}

async function nativeSmoke() {
	const data = join(import.meta.dirname, "data");
	await mkdir(data, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(join(data, "native-smoke-"));
	const socket = createServer();
	await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
	const port = socket.address().port;
	await new Promise((resolve) => socket.close(resolve));
	const url = `http://127.0.0.1:${port}`;
	const entry = fileURLToPath(new URL("../../harness/packages/coding-agent/dist/headless-entry.js", import.meta.url));
	let child;
	let exited;
	const start = () => {
		child = spawn(process.execPath, [entry], {
			cwd: directory,
			env: { ...process.env, KLERM_CODING_AGENT_DIR: join(directory, "agent"), KLERM_WORKSPACE: directory, KLERM_SERVER_STATE_DIR: join(directory, "server"), KLERM_SERVER_TOKEN_FILE: join(directory, "server", "owner.token"), KLERM_SERVER_HOST: "127.0.0.1", KLERM_SERVER_PORT: String(port), PI_OFFLINE: "1" },
			stdio: ["ignore", "ignore", "pipe"],
		});
		child.stderr.resume();
		exited = new Promise((resolve) => { child.once("error", resolve); child.once("close", resolve); });
	};
	const stop = async () => {
		if (!child) return;
		child.kill("SIGTERM");
		const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
		try { await exited; } finally { clearTimeout(timeout); child = undefined; }
	};
	try {
		start();
		await waitForReady(url);
		const token = (await readFile(join(directory, "server", "owner.token"), "utf8")).trim();
		const id = randomUUID();
		await checkTransport(url, token, id);
		await stop();
		start();
		await checkRestart(url, token, id);
	} finally {
		await stop();
		await rm(directory, { recursive: true, force: true });
	}
}

async function dockerSmoke() {
	const name = `klerm-smoke-${randomUUID()}`;
	const volume = `${name}-data`;
	try {
		docker("run", "--detach", "--name", name, "-p", "127.0.0.1::8787", "-v", `${volume}:/var/lib/klerm`, process.env.KLERM_SERVER_SMOKE_IMAGE ?? "klerm-server:local");
		const port = docker("port", name, "8787/tcp").split(":").at(-1);
		const url = `http://127.0.0.1:${port}`;
		await waitForReady(url);
		const token = docker("exec", name, "node", "-e", "process.stdout.write(require('node:fs').readFileSync('/var/lib/klerm/server/owner.token','utf8'))");
		const id = randomUUID();
		await checkTransport(url, token, id);
		docker("restart", name);
		// Docker may allocate a new host port after restarting an ephemeral mapping.
		const restartedPort = docker("port", name, "8787/tcp").split(":").at(-1);
		await checkRestart(`http://127.0.0.1:${restartedPort}`, token, id);
	} finally {
		try { docker("stop", "--time", "15", name); } catch { /* Only this smoke's own container is removed. */ }
		try { docker("rm", "--force", name); } catch { /* Startup may have failed before creating it. */ }
		try { docker("volume", "rm", volume); } catch { /* No volume exists when image startup failed. */ }
	}
}

try {
	if (mode === "--native") await nativeSmoke();
	else await dockerSmoke();
} catch (error) {
	console.error(error instanceof Error ? error.message : "Server smoke failed.");
	process.exitCode = 1;
}
