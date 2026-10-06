import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DesktopBinding, effectiveDesktopBindings, parseDesktopKeybindings } from "./desktop-keybindings.ts";

export async function getDesktopKeybindings(agentDir: string): Promise<DesktopBinding[]> {
	try {
		return effectiveDesktopBindings(
			parseDesktopKeybindings(JSON.parse(await readFile(join(agentDir, "desktop-keybindings.json"), "utf8"))),
		);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return effectiveDesktopBindings();
		throw error;
	}
}
export async function saveDesktopKeybindings(agentDir: string, input: unknown): Promise<DesktopBinding[]> {
	const overrides = parseDesktopKeybindings(input);
	await mkdir(agentDir, { recursive: true, mode: 0o700 });
	const path = join(agentDir, "desktop-keybindings.json"),
		temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(overrides, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		await rename(temporary, path);
	} finally {
		await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
	return effectiveDesktopBindings(overrides);
}
