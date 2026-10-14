import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** Finder/desktop launch environments may omit user-installed native CLI tools. */
export function nativeHarnessSearchDirectories(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
	const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
	return [
		...new Set(
			[
				...(pathKey ? (env[pathKey] ?? "") : "").split(delimiter),
				join(home, ".npm-global", "bin"),
				join(home, ".local", "bin"),
				join(home, ".bun", "bin"),
				join(home, ".cargo", "bin"),
				...(env.APPDATA ? [join(env.APPDATA, "npm")] : []),
			].filter(Boolean),
		),
	];
}

export function nativeHarnessEnvironment(env: NodeJS.ProcessEnv = process.env, home = homedir()): NodeJS.ProcessEnv {
	const result = { ...env };
	// Windows environment names are case-insensitive; do not pass both Path and PATH.
	for (const key of Object.keys(result)) if (key.toLowerCase() === "path") delete result[key];
	result.PATH = nativeHarnessSearchDirectories(env, home).join(delimiter);
	return result;
}
