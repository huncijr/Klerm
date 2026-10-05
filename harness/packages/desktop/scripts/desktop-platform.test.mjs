import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "node:net";
import { assertDesktopDevPortFree, desktopPlatform, NODE_VERSION, npmInvocation } from "./desktop-platform.mjs";

for (const platform of ["linux", "darwin", "win32"]) for (const arch of ["x64", "arm64"]) {
	test(`official, checksummed runtime plan for ${platform}/${arch}`, () => {
		const target = desktopPlatform(platform, arch);
		assert.match(target.checksum, /^[a-f0-9]{64}$/);
		assert.ok(target.archive.includes(NODE_VERSION));
		assert.ok(target.member.startsWith(`${target.name}/`));
		assert.equal(target.node, platform === "win32" ? "node.exe" : "node");
		assert.equal(target.archive.endsWith(".zip"), platform === "win32");
	});
}
test("unsupported target cannot accidentally receive a Linux runtime", () => {
	assert.throws(() => desktopPlatform("darwin", "ia32"), /Unsupported/);
	assert.throws(() => desktopPlatform("freebsd", "x64"), /Unsupported/);
});
test("npm uses Node + argv instead of Windows shell interpolation, including spaces", () => {
	const root = mkdtempSync(join(tmpdir(), "Klerm npm test "));
	try {
		const npm = join(root, "node_modules/npm/bin/npm-cli.js");
		mkdirSync(join(root, "node_modules/npm/bin"), { recursive: true });
		writeFileSync(npm, "fixture");
		const node = join(root, "node.exe");
		assert.deepEqual(npmInvocation({ npm_execpath: npm }, node), { executable: node, args: [npm] });
		assert.deepEqual(npmInvocation({}, node), { executable: node, args: [npm] });
	} finally { rmSync(root, { recursive: true, force: true }); }
});
test("missing npm is reported before trying to start a build", () => {
	assert.throws(() => npmInvocation({}, join(tmpdir(), "missing-klerm-node/node.exe")), /npm is unavailable/);
});
test("all platform bundles use one hook and contain a runtime/backend resource root", () => {
	const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
	assert.equal(config.build.beforeBuildCommand, "node scripts/prepare-desktop.mjs");
	assert.equal(config.build.beforeDevCommand, "node scripts/prepare-desktop.mjs --dev");
	assert.deepEqual(config.bundle.resources, { ".assets/": "" });
	assert.ok(config.bundle.icon.some((path) => path.endsWith(".icns")));
});
test("a running foreign/stale dev server is not reused as Klerm's frontend", async () => {
	const server = createServer();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	try { await assert.rejects(assertDesktopDevPortFree(port), /already in use/); }
	finally { await new Promise((resolve) => server.close(resolve)); }
	await assertDesktopDevPortFree(port);
});
