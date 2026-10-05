import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeTar } from "./native-tar.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ai = join(root, "packages/ai");
const data = join(ai, "src/providers/data");
const snapshot = join(ai, "model-data");
const archive = join(snapshot, "baseline.tar.gz");
const digest = join(snapshot, "baseline.sha256");
const check = () => spawnSync(process.execPath, [join(ai, "scripts/check-model-data.ts")], { cwd: root, stdio: "inherit" }).status === 0;
const tar = (args) => {
	const result = spawnSync(nativeTar(), args, { cwd: root, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error("Model-data snapshot archive operation failed.");
};

if (process.argv.includes("--capture")) {
	if (!check()) throw new Error("Only a validated public model catalog can be captured.");
	mkdirSync(snapshot, { recursive: true });
	tar(["-czf", archive, "-C", data, "."]);
	writeFileSync(digest, `${createHash("sha256").update(readFileSync(archive)).digest("hex")}\n`);
	console.log("Captured reproducible public model-data baseline. Review and commit the archive and checksum together.");
} else if (existsSync(join(data, ".manifest.json")) && check()) {
	console.log("Existing model data is valid; no live provider API is required.");
} else {
	const expected = readFileSync(digest, "utf8").trim();
	const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
	if (!/^[a-f0-9]{64}$/.test(expected) || actual !== expected) throw new Error("Model-data baseline checksum mismatch.");
	mkdirSync(data, { recursive: true });
	tar(["-xzf", archive, "-C", data]);
	if (!check()) throw new Error("Model baseline does not match this source revision. Regenerate and capture it before release.");
	console.log("Restored and validated the public model-data baseline without provider API requests.");
}
