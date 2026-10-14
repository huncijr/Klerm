import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { probeAcpAgent } from "../src/klerm/acp-discovery.ts";
import { AcpConnection } from "../src/klerm/acp-connection.ts";
import { runProcess, spawnHarnessProcess, waitForChildProcess } from "../src/utils/child-process.ts";
import { nativeHarnessEnvironment } from "../src/utils/harness-environment.ts";

// Real OS processes and Windows .cmd transport, without a model or provider account.
test("native launcher handles version probes, pipe transport and ACP in paths with spaces", { timeout: 30000 }, async () => {
	const root = await mkdtemp(join(tmpdir(), "klerm native launcher "));
	try {
		const directory = join(root, "worker path");
		await mkdir(directory);
		const script = join(directory, "worker.mjs");
		await writeFile(script, `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("native-worker 1.0"); process.exit(0); }
if (args[0] === "--echo") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => console.log(JSON.stringify({ args: args.slice(1), input, cwd: process.cwd() })));
} else {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    input += chunk;
    let newline;
    while ((newline = input.indexOf("\\n")) >= 0) {
      const request = JSON.parse(input.slice(0, newline));
      input = input.slice(newline + 1);
      const result = request.method === "initialize"
        ? { protocolVersion: 1, agentInfo: { name: "native-worker", version: "1.0" } }
        : { echo: request.params };
      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    }
  });
}
`);
		const launcher = join(directory, process.platform === "win32" ? "native-worker.cmd" : "native-worker");
		await writeFile(launcher, process.platform === "win32"
			? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
			: `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
		assert.equal((await runProcess(launcher, ["--version"], 10000, 4096)).stdout.trim(), "native-worker 1.0");
		const args = ["two words", "a&b", "a|b", "(parentheses)", "literal>value", "árvíz"];
		const child = spawnHarnessProcess(launcher, ["--echo", ...args], { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		let output = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", chunk => output += chunk);
		child.stdin.end("native prompt\nsecond line");
		assert.equal(await waitForChildProcess(child), 0);
		assert.deepEqual(JSON.parse(output), { args, input: "native prompt\nsecond line", cwd: root });
		const scan = await probeAcpAgent(launcher, [], 10000);
		assert.equal(scan?.agentName, "native-worker");
		assert.equal(await probeAcpAgent(join(root, "missing-native-worker"), [], 10000), undefined);
		const connection = new AcpConnection(launcher, [], root, () => {});
		try {
			assert.equal((await connection.request("initialize", {})).protocolVersion, 1);
			assert.deepEqual(await connection.request("session/prompt", { text: "literal & | > prompt" }), { echo: { text: "literal & | > prompt" } });
		} finally { await connection.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("native command capture reports timeout and output limits", { timeout: 10000 }, async () => {
	await assert.rejects(runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 100, 1024), /timed out/);
	await assert.rejects(runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], 5000, 1024), /output exceeded/);
});

test("native GUI launch environment retains credentials and finds user CLI locations with one PATH key", () => {
	const home = join(tmpdir(), "native user home");
	const env = { Path: "existing-tools", APPDATA: join(home, "roaming"), NATIVE_ACCOUNT: "retained" };
	const effective = nativeHarnessEnvironment(env, home);
	assert.equal(effective.NATIVE_ACCOUNT, "retained");
	assert.equal(effective.Path, undefined);
	assert.deepEqual(effective.PATH.split(delimiter), [
		"existing-tools", join(home, ".npm-global", "bin"), join(home, ".local", "bin"),
		join(home, ".bun", "bin"), join(home, ".cargo", "bin"), join(home, "roaming", "npm"),
	]);
	assert.equal(env.Path, "existing-tools");
});
