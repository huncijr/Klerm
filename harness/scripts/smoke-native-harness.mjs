/** Real configured harness acceptance; never run automatically in provider-free CI. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingHarnessAdapters } from "../packages/coding-agent/src/klerm/coding-harness-adapter.ts";
import { appendCodingHarnessBridgeEvent, bridgeResponseHash } from "../packages/coding-agent/src/klerm/coding-harness-bridge.ts";

const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index++) {
	const arg = args[index];
	if (arg === "--live") options.set(arg, true);
	else if (["--harness", "--model", "--profile"].includes(arg) && args[index + 1] && !args[index + 1].startsWith("--")) options.set(arg, args[++index]);
	else throw new Error(`Unknown or incomplete option: ${arg}`);
}
if (!options.get("--live") || !options.get("--harness") || !options.get("--model")) {
	console.log("Usage: node scripts/smoke-native-harness.mjs --live --harness <installed-adapter-id> --model <native-model-id> [--profile native|full-access]");
	console.log("Uses your harness's configured account for three real turns in an isolated temporary Git project.");
	process.exit(2);
}
const harness = options.get("--harness");
const adapter = [...createCodingHarnessAdapters().values()].find((candidate) => candidate.kind === harness);
if (!adapter) throw new Error(`No connected native adapter for ${harness}.`);
const profile = options.get("--profile") ?? "native";
if (!["native", "full-access"].includes(profile)) throw new Error("Invalid execution profile.");
const cwd = await mkdtemp(join(tmpdir(), "klerm native acceptance "));
execFileSync("git", ["init", "--quiet"], { cwd, stdio: "ignore" });
const memoryToken = `memory-${randomUUID()}`;
const fileToken = `file-${randomUUID()}`;
await writeFile(join(cwd, "marker.txt"), `${fileToken}\n`);
const correlationId = randomUUID();
let sequence = 0;
let session;
let turnEvents = [];
const unsubscribe = adapter.subscribe((event) => { turnEvents.push(event); });
const report = { harness, model: options.get("--model"), platform: process.platform, arch: process.arch, cwd, checks: [], status: "running" };

async function record(event, taskId, status, reason, text) {
	await appendCodingHarnessBridgeEvent(cwd, {
		version: 1, timestamp: new Date().toISOString(), event, taskId, correlationId, sequence: ++sequence,
		sender: event === "TASK_RETURNED" ? "agent1" : "user",
		recipient: event === "TASK_RETURNED" ? "user" : "agent1",
		status, reason, agentId: "agent1", harness, model: report.model,
		...(session?.nativeSessionId ? { nativeSessionId: session.nativeSessionId } : {}),
		...(text !== undefined ? { responseHash: bridgeResponseHash(text) } : {}),
	});
}
async function turn(name, prompt, expected, requireTool = false) {
	const taskId = `${correlationId}-${report.checks.length + 1}`;
	turnEvents = [];
	await record("TASK_STARTED", taskId, "running", name);
	await adapter.prompt(session, prompt);
	const failure = turnEvents.find((event) => event.type === "error");
	if (failure) throw new Error(`${name}: ${failure.message}`);
	const text = turnEvents.filter((event) => event.type === "message").map((event) => event.text).join("\n");
	assert.ok(turnEvents.some((event) => event.type === "settled" && event.status === "completed"), `${name}: native turn did not complete.`);
	assert.ok(text.includes(expected), `${name}: expected native reply missing.`);
	if (requireTool) assert.ok(turnEvents.some((event) => event.type === "tool-end" && !event.isError), `${name}: no successful attributed native tool.`);
	await record("TASK_RETURNED", taskId, "returned", name, text);
	report.checks.push(name);
	console.log(`Passed: ${name}`);
}
console.log(`Isolated workspace: ${cwd}`);
try {
	session = await adapter.startSession({ id: "agent1", kind: harness, enabled: true, model: report.model, role: "builder", effort: "off", tools: [], executionProfile: profile }, cwd);
	await turn("native prompt/reply", `Remember this token for my next turn: ${memoryToken}. Reply exactly NATIVE_OK. Do not use tools.`, "NATIVE_OK");
	assert.ok(session.nativeSessionId, "Native session identity missing.");
	const nativeId = session.nativeSessionId;
	await turn("follow-up context", "What exact token did I ask you to remember in my previous message? Reply only with that token. Do not use tools.", memoryToken);
	assert.equal(session.nativeSessionId, nativeId, "Follow-up replaced the native session.");
	await turn("native file tool", "Use your native tools to read marker.txt in the current project and reply with its exact contents. Do not modify files.", fileToken, true);
	assert.equal(session.nativeSessionId, nativeId, "Native tool turn replaced the session.");
	report.status = "passed";
} catch (error) {
	report.status = "failed";
	report.reason = error instanceof Error ? error.message : "Native execution failed.";
	await record("TASK_FAILED", correlationId, "failed", "Native acceptance failed.");
	process.exitCode = 1;
} finally {
	unsubscribe();
	if (session) await adapter.closeSession(session);
	await writeFile(join(cwd, "native-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report, null, 2));
	console.log(`Report: ${join(cwd, "native-verification.json")}`);
	console.log(`Decisions: ${join(cwd, ".klerm", "bridge-events.jsonl")}`);
}
