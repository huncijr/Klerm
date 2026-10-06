import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { resolveAppearance } from "../src/lib/appearance.ts";

const css = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");
const dark = css.slice(css.indexOf("@theme {"), css.indexOf("@custom-variant"));
const light = css.slice(css.indexOf('html[data-theme="light"] {'), css.indexOf("\n\tbody {"));
function palette(source: string): Map<string, string> {
	return new Map([...source.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [match[1]!, match[2]!]));
}
function luminance(hex: string): number {
	const values = [1, 3, 5].map((offset) => {
		const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}
describe("independent desktop themes", () => {
	test("explicit preferences override the system and invalid stored values fall back safely", () => {
		expect(resolveAppearance("light", true)).toBe("light");
		expect(resolveAppearance("dark", false)).toBe("dark");
		expect(resolveAppearance("system", true)).toBe("dark");
		expect(resolveAppearance("system", false)).toBe("light");
		for (const value of [undefined, null, "invalid", {}, 1]) expect(resolveAppearance(value, false)).toBe("dark");
	});
	test("every palette token has a light counterpart without image inversion", () => {
		expect([...palette(light).keys()].sort()).toEqual([...palette(dark).keys()].sort());
		expect(css).not.toMatch(/filter:\s*invert|hue-rotate/);
	});
	test.each([
		["dark", dark],
		["light", light],
	])("%s text, actions and semantic statuses meet AA contrast", (_name, source) => {
		const colors = palette(source);
		const pairs: [string, string][] = [
			...["ink", "muted", "dim", "accent"].flatMap((text): [string, string][] =>
				["bg", "panel", "raised", "input"].map((background) => [text, background]),
			),
			["on-primary", "primary"],
			...["success", "danger", "warning", "info", "purple", "teal"].flatMap((status): [string, string][] => [
				[status, `${status}-soft`],
				[status, "panel"],
			]),
		];
		for (const [text, background] of pairs) {
			const a = luminance(colors.get(text)!),
				b = luminance(colors.get(background)!);
			expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `${text} on ${background}`).toBeGreaterThanOrEqual(
				4.5,
			);
		}
	});
});
