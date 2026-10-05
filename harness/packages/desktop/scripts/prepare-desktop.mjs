import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeTar } from "../../../scripts/native-tar.mjs";
import { assertDesktopDevPortFree, desktopPlatform, NODE_VERSION, npmInvocation, run, runNpm } from "./desktop-platform.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harness = resolve(desktop, "../..");
const assets = join(desktop, "src-tauri/.assets");
const development = process.argv.includes("--dev");
const target = desktopPlatform();
if (development && !process.argv.includes("--no-server")) await assertDesktopDevPortFree();

async function json(path) { return JSON.parse(await readFile(path, "utf8")); }

async function packageBackend() {
	const lock = await json(join(harness, "packages/coding-agent/install-lock/package-lock.json"));
	const workspaceLock = await json(join(harness, "package-lock.json"));
	const workspaces = new Map(Object.entries(workspaceLock.packages)
		.filter(([path, value]) => path.startsWith("packages/") && !path.includes("node_modules") && value.name)
		.map(([path, value]) => [value.name, path]));
	const output = join(assets, "backend");
	await mkdir(output, { recursive: true });
	for (const [path, value] of Object.entries(lock.packages)) {
		if (!path) continue;
		if (!path.startsWith("node_modules/") || path.split("/").includes("..")) throw new Error(`Invalid dependency path: ${path}`);
		const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
		const workspace = workspaces.get(name);
		const destination = join(output, path);
		if (workspace) {
			const source = join(harness, workspace);
			if (!existsSync(join(source, "dist"))) throw new Error(`${workspace} must be built before desktop packaging.`);
			await mkdir(destination, { recursive: true });
			for (const file of ["dist", "package.json", "README.md", "CHANGELOG.md", "LICENSE", "docs"]) {
				if (existsSync(join(source, file))) await cp(join(source, file), join(destination, file), { recursive: true, dereference: true });
			}
		} else {
			const source = join(harness, path);
			if (!existsSync(source)) {
				if (value.optional) continue;
				throw new Error(`Production dependency ${path} is missing; run npm ci --ignore-scripts on this platform.`);
			}
			const installed = await json(join(source, "package.json"));
			if (installed.version !== value.version) throw new Error(`Dependency version mismatch: ${name}`);
			await cp(source, destination, { recursive: true, dereference: true });
		}
	}
	await writeFile(join(output, "package.json"), JSON.stringify({ private: true, type: "module" }));
}

async function packageNode() {
	const cache = join(desktop, ".cache/node");
	await mkdir(cache, { recursive: true });
	const archive = join(cache, target.archive);
	if (!existsSync(archive)) {
		const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${target.archive}`, { signal: AbortSignal.timeout(120_000) });
		if (!response.ok) throw new Error(`Node runtime download failed: HTTP ${response.status}`);
		await writeFile(archive, Buffer.from(await response.arrayBuffer()));
	}
	const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
	if (checksum !== target.checksum) {
		await rm(archive);
		throw new Error("Node runtime checksum mismatch; retry the download.");
	}
	const extracted = join(cache, target.name);
	await mkdir(extracted, { recursive: true });
	run(nativeTar(), ["-xf", archive, "-C", cache, target.member, `${target.name}/LICENSE`], desktop);
	await mkdir(join(assets, "runtime"), { recursive: true });
	await cp(join(cache, target.member), join(assets, "runtime", target.node));
	await cp(join(extracted, "LICENSE"), join(assets, "runtime/LICENSE"));
	if (process.platform !== "win32") await chmod(join(assets, "runtime", target.node), 0o755);
}

// Always rebuild the same shared frontend/backend; never publish a cached RPC
// sidecar from a different revision. This hook is used by dev and every OS build.
const npm = npmInvocation();
const modelData = spawnSync(npm.executable, [...npm.args, "run", "check:model-data"], { cwd: harness, stdio: "ignore" });
if (modelData.status !== 0) runNpm(["run", "hydrate:model-data"], harness);
runNpm(["run", "build:desktop-backend"], harness);
await mkdir(assets, { recursive: true });
const icons = join(assets, "icons");
run(process.execPath, [join(harness, "node_modules/@tauri-apps/cli/tauri.js"), "icon", join(desktop, "src-tauri/icons/icon.png"), "--output", icons], desktop);
for (const entry of await readdir(icons)) if (entry !== "icon.icns") await rm(join(icons, entry), { recursive: true, force: true });

if (development) {
	run(process.execPath, [join(desktop, "scripts/build-browser-host.mjs")], desktop);
} else {
	await rm(join(assets, "backend"), { recursive: true, force: true });
	await rm(join(assets, "runtime"), { recursive: true, force: true });
	await packageBackend();
	await packageNode();
	runNpm(["run", "build"], desktop);
}
let revision = "source-tree";
try { revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: harness, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* Source archives have no Git metadata. */ }
await writeFile(join(assets, "desktop-build.json"), JSON.stringify({ version: (await json(join(desktop, "package.json"))).version, revision, platform: target.platform, arch: target.arch, nodeVersion: NODE_VERSION, nodeArchiveSha256: target.checksum, development }, null, 2));
for (const [source, destination] of [[join(harness, "LICENSE"), "PI-LICENSE"], [resolve(harness, "../LICENSE"), "KLERM-LICENSE"]]) {
	if (existsSync(source)) await cp(source, join(assets, destination));
}
if (existsSync(resolve(harness, "../LICENSES"))) await cp(resolve(harness, "../LICENSES"), join(assets, "LICENSES"), { recursive: true });
if (development && !process.argv.includes("--no-server")) runNpm(["run", "dev"], desktop);
