import { mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertDesktopDevPortFree, npmInvocation, runNpm } from "./desktop-platform.mjs";

const script = fileURLToPath(import.meta.url);
const harness = resolve(dirname(script), "../../..");
if (process.argv.includes("--foreground")) {
	// The same Tauri hook rebuilds the shared backend and frontend on every OS.
	process.env.KLERM_DESKTOP_NODE ??= process.execPath;
	process.env.KLERM_DESKTOP_CWD ??= process.cwd();
	npmInvocation();
	await assertDesktopDevPortFree();
	runNpm(["run", "tauri:dev"], harness);
} else {
	const state = process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? homedir(), "Klerm/logs")
		: process.platform === "darwin" ? join(homedir(), "Library/Logs/Klerm")
		: join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "klerm");
	mkdirSync(state, { recursive: true });
	const log = join(state, "desktop-dev.log");
	const output = openSync(log, "a");
	const child = spawn(process.execPath, [script, "--foreground"], {
		cwd: process.cwd(), env: { ...process.env, KLERM_DESKTOP_NODE: process.execPath, KLERM_DESKTOP_CWD: process.cwd() },
		detached: true, windowsHide: true, stdio: ["ignore", output, output],
	});
	child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
	child.unref();
	closeSync(output);
	console.log(`Starting Klerm for ${process.cwd()}. Build/startup log: ${log}`);
}
