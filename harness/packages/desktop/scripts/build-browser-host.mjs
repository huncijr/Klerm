import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform === "linux") {
	const manifest = fileURLToPath(new URL("../src-tauri/Cargo.toml", import.meta.url));
	const result = spawnSync("cargo", ["build", "--manifest-path", manifest, "--bin", "klerm-browser-host"], {
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
