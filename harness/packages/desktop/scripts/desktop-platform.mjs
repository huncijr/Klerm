import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

export const NODE_VERSION = "24.21.0";
// Official Node distribution checksums; never bundle a Homebrew/system binary
// with machine-specific dynamic-library dependencies.
const nodeArchives = {
	"linux-x64": "6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff",
	"linux-arm64": "724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5",
	"darwin-x64": "1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097",
	"darwin-arm64": "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057",
	"win32-x64": "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541",
	"win32-arm64": "8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921",
};

export function desktopPlatform(platform = process.platform, arch = process.arch) {
	const checksum = nodeArchives[`${platform}-${arch}`];
	if (!checksum) throw new Error(`Unsupported desktop platform: ${platform}/${arch}`);
	const os = platform === "win32" ? "win" : platform;
	const name = `node-v${NODE_VERSION}-${os}-${arch}`;
	return {
		platform, arch, checksum, name,
		archive: `${name}.${platform === "win32" ? "zip" : "tar.gz"}`,
		node: platform === "win32" ? "node.exe" : "node",
		member: platform === "win32" ? `${name}/node.exe` : `${name}/bin/node`,
	};
}

export function npmInvocation(env = process.env, node = process.execPath) {
	const candidates = [env.npm_execpath,
		join(dirname(node), "node_modules/npm/bin/npm-cli.js"),
		join(dirname(node), "../lib/node_modules/npm/bin/npm-cli.js"),
		join(dirname(node), "../share/nodejs/npm/bin/npm-cli.js"),
	];
	const cli = candidates.find((path) => path && /npm-cli\.js$/.test(path) && existsSync(path));
	if (!cli) throw new Error("npm is unavailable. Install Node.js with npm, or run this command through npm run.");
	return { executable: node, args: [cli] };
}

export function run(command, args, cwd, env = process.env) {
	const result = spawnSync(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
}

export function runNpm(args, cwd) {
	const npm = npmInvocation();
	run(npm.executable, [...npm.args, ...args], cwd);
}

export async function assertDesktopDevPortFree(port = 1420) {
	await new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", () => reject(new Error(`Desktop port ${port} is already in use. Close the existing development app/server before restarting Klerm.`)));
		server.listen(port, "127.0.0.1", () => server.close(resolve));
	});
}
