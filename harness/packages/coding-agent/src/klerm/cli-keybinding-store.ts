import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { KEYBINDINGS, KeybindingsManager, migrateKeybindingsConfig } from "../core/keybindings.ts";

export interface CliBinding {
	id: string;
	description: string;
	keys: string[];
	defaultKeys: string[];
}
const list = (value: string | readonly string[] | undefined): string[] =>
	typeof value === "string" ? [value] : [...(value ?? [])];
export function getCliKeybindings(agentDir: string): CliBinding[] {
	const config = KeybindingsManager.create(agentDir).getEffectiveConfig();
	return Object.entries(KEYBINDINGS).map(([id, definition]) => ({
		id,
		description: definition.description,
		keys: list(config[id]),
		defaultKeys: list(definition.defaultKeys),
	}));
}
export function validCliChord(value: string): boolean {
	const match = /^((?:(?:ctrl|alt|shift|super)\+)*)(.+)$/.exec(value);
	if (!match) return false;
	const mods = match[1]!.split("+").filter(Boolean),
		key = match[2]!;
	return (
		mods.length <= 4 &&
		new Set(mods).size === mods.length &&
		(/^[a-z0-9]$/.test(key) ||
			("`-=\\[];'.,/!@#$%^&*()_+|~{}:<>?".includes(key) && key.length === 1) ||
			/^(escape|esc|enter|return|tab|space|backspace|delete|insert|clear|home|end|pageUp|pageDown|up|down|left|right|f[1-9]|f1[0-2])$/.test(
				key,
			))
	);
}
export async function saveCliKeybindings(agentDir: string, input: unknown): Promise<CliBinding[]> {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("CLI keybindings must be an action-to-key-array object.");
	for (const [id, keys] of Object.entries(input)) {
		if (
			!Object.hasOwn(KEYBINDINGS, id) ||
			!Array.isArray(keys) ||
			keys.length > 8 ||
			!keys.every((key) => typeof key === "string" && key.length < 100 && validCliChord(key))
		)
			throw new Error(`Invalid CLI keybinding: ${id}`);
	}
	await mkdir(agentDir, { recursive: true, mode: 0o700 });
	const release = await lockfile.lock(agentDir, {
		realpath: false,
		lockfilePath: join(agentDir, ".keybindings-edit.lock"),
		retries: { retries: 5, minTimeout: 20 },
	});
	const path = join(agentDir, "keybindings.json"),
		temporary = `${path}.${randomUUID()}.tmp`;
	try {
		let previous: Record<string, unknown> = {};
		try {
			const parsed = JSON.parse(await readFile(path, "utf8"));
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
				throw new Error("CLI keybindings file is corrupt; edit rejected.");
			previous = migrateKeybindingsConfig(parsed).config;
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
		}
		const definitions = getCliKeybindings(agentDir);
		for (const [id, keys] of Object.entries(input)) {
			if (JSON.stringify(keys) === JSON.stringify(definitions.find((row) => row.id === id)!.defaultKeys))
				delete previous[id];
			else previous[id] = keys;
		}
		await writeFile(temporary, `${JSON.stringify(previous, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		await rename(temporary, path);
		return getCliKeybindings(agentDir);
	} finally {
		try {
			await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
		} finally {
			await release();
		}
	}
}
