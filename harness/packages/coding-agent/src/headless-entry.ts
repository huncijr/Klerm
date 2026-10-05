#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import lockfile from "proper-lockfile";
import { createHeadlessServer } from "./server/headless-server.ts";
import { RpcProcessBackend } from "./server/rpc-process-backend.ts";

async function main(): Promise<void> {
	if (process.argv.includes("--help")) {
		console.log(
			"Klerm headless server\nConfiguration: KLERM_SERVER_HOST (127.0.0.1), KLERM_SERVER_PORT (8787), KLERM_WORKSPACE, KLERM_SERVER_STATE_DIR, KLERM_SERVER_TOKEN_FILE, KLERM_SERVER_PUBLIC_ORIGIN.\nRequires built rpc-entry.js beside this entry. Owner token is generated on first start with private file permissions.",
		);
		return;
	}
	const cwd = resolve(process.env.KLERM_WORKSPACE ?? process.cwd());
	const stateDirectory = resolve(process.env.KLERM_SERVER_STATE_DIR ?? `${cwd}/.klerm/server`);
	await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
	const release = await lockfile.lock(stateDirectory, { realpath: false, retries: 0 });
	try {
		const tokenPath = resolve(process.env.KLERM_SERVER_TOKEN_FILE ?? `${stateDirectory}/owner.token`);
		let token: string;
		try {
			token = (await readFile(tokenPath, "utf8")).trim();
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
			await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 });
			token = randomBytes(32).toString("hex");
			await writeFile(tokenPath, `${token}\n`, { mode: 0o600, flag: "wx" });
		}
		const port = Number(process.env.KLERM_SERVER_PORT ?? "8787");
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid KLERM_SERVER_PORT.");
		const backend = new RpcProcessBackend(fileURLToPath(new URL("./rpc-entry.js", import.meta.url)), cwd, [
			"--continue",
		]);
		const app = await createHeadlessServer({
			backend,
			token,
			stateDirectory,
			publicOrigin: process.env.KLERM_SERVER_PUBLIC_ORIGIN,
		});
		try {
			await new Promise<void>((resolveListening, reject) => {
				app.server.once("error", reject);
				app.server.listen(port, process.env.KLERM_SERVER_HOST ?? "127.0.0.1", resolveListening);
			});
		} catch (error) {
			await backend.close();
			throw error;
		}
		console.log(`Klerm server listening on port ${port}. Owner token file: ${tokenPath}`);
		let stopping = false;
		const stop = () => {
			if (stopping) return;
			stopping = true;
			void app
				.close()
				.finally(release)
				.then(
					() => process.exit(0),
					() => process.exit(1),
				);
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	} catch (error) {
		await release();
		throw error;
	}
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : "Klerm server failed.");
	process.exitCode = 1;
});
