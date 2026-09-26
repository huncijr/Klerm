import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const executable = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri/target/debug/klerm-browser-host");
const fixture = createServer((_request, response) => {
	response.writeHead(200, { "content-type": "text/html" });
	response.end('<title>before</title><button style="position:absolute;left:10px;top:10px;width:100px;height:40px" onclick="document.title=\'clicked\'">Click</button>');
});
await new Promise((resolveListen) => fixture.listen(0, "127.0.0.1", resolveListen));
const host = spawn(executable, [], {
	env: {
		...process.env,
		LD_LIBRARY_PATH: [dirname(executable), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
	},
	stdio: ["pipe", "pipe", "ignore"],
});
let port;
let url = "";
let paints = 0;
let failure;
host.once("error", (error) => (failure = error));
host.once("exit", (code) => {
	if (code !== 0 && failure === undefined) failure = new Error(`CEF host exited: ${code}`);
});
void (async () => {
	let pending = "";
	for await (const chunk of host.stdout) {
		pending += chunk.toString("utf8");
		let end = pending.indexOf("\n");
		while (end !== -1) {
			try {
				const event = JSON.parse(pending.slice(0, end));
				if (event.type === "ready") port = event.port;
				else if (event.type === "url") url = event.url;
				else if (event.type === "frame") paints += 1;
			} catch {
				failure = new Error("CEF host returned invalid JSONL output.");
			}
			pending = pending.slice(end + 1);
			end = pending.indexOf("\n");
		}
	}
})();

async function waitFor(predicate) {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if (failure) throw failure;
		if (predicate()) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
	}
	throw new Error(`CEF browser did not respond in time (port=${port}, url=${url}, frames=${paints}).`);
}

try {
	await waitFor(() => Number.isInteger(port));
	const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;
	host.stdin.write(`${JSON.stringify({ type: "navigate", url: fixtureUrl })}\n`);
	await waitFor(() => url === fixtureUrl && paints > 0);
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	const page = targets.find((target) => target.type === "page");
	assert.ok(page?.webSocketDebuggerUrl, "CEF CDP page was not available");
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolveOpen, rejectOpen) => {
		socket.addEventListener("open", resolveOpen, { once: true });
		socket.addEventListener("error", rejectOpen, { once: true });
	});
	try {
		host.stdin.write(`${JSON.stringify({ type: "mouse", kind: "down", x: 30, y: 30, button: "left" })}\n`);
		host.stdin.write(`${JSON.stringify({ type: "mouse", kind: "up", x: 30, y: 30, button: "left" })}\n`);
		await new Promise((resolveWait) => setTimeout(resolveWait, 300));
		const result = new Promise((resolveResult, rejectResult) => {
			const timer = setTimeout(() => rejectResult(new Error("CEF CDP evaluation timed out.")), 5000);
			socket.addEventListener("message", (message) => {
				const payload = JSON.parse(message.data);
				if (payload.id !== 1) return;
				clearTimeout(timer);
				resolveResult(payload.result?.result?.value);
			});
		});
		socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "document.title", returnByValue: true } }));
		assert.equal(await result, "clicked");
		console.log("CEF OSR paint, native click, and CDP attachment passed.");
	} finally {
		socket.close();
	}
} finally {
	if (host.exitCode === null) host.stdin.write('{"type":"close"}\n');
	await Promise.race([
		new Promise((resolveExit) => host.once("exit", resolveExit)),
		new Promise((resolveWait) => setTimeout(resolveWait, 3000)),
	]);
	if (host.exitCode === null) host.kill();
	fixture.close();
}
