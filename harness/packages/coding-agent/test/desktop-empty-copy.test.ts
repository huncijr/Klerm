import { describe, expect, it } from "vitest";
import { EMPTY_HEADLINES, EMPTY_SUBTITLE, pickHeadline } from "../../desktop/src/lib/empty-copy.ts";

describe("empty state copy", () => {
	it("has a fixed subtitle and a headline pool", () => {
		expect(EMPTY_SUBTITLE).toContain("More agents, one mission.");
		expect(EMPTY_HEADLINES.length).toBeGreaterThan(1);
	});

	it("never repeats the previous headline", () => {
		for (let previous = 0; previous < EMPTY_HEADLINES.length; previous++) {
			for (let round = 0; round < 20; round++) {
				expect(pickHeadline(previous)).not.toBe(previous);
			}
		}
		expect(pickHeadline(undefined)).toBeGreaterThanOrEqual(0);
	});
});
