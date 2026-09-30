import { describe, expect, test } from "vitest";
import { visibleBrowserActivity } from "../src/lib/browser-presentation.ts";

describe("browser activity visibility", () => {
	test("hides policy-origin decisions but keeps manual approvals and messages", () => {
		const base = { sequence: 1, timestamp: "2026-09-30T00:00:00.000Z" };
		for (const event of ["APPROVAL_REQUESTED", "APPROVAL_RESOLVED"]) {
			expect(
				visibleBrowserActivity({ ...base, event, details: { decidedBy: "policy", origin: "https://reddit.com" } }),
			).toBe(false);
			expect(visibleBrowserActivity({ ...base, event, details: { actionId: "action-1", action: "click" } })).toBe(
				true,
			);
		}
		expect(visibleBrowserActivity({ ...base, event: "ASSISTANT_MESSAGE", reason: "Most görgetek." })).toBe(true);
		expect(visibleBrowserActivity({ ...base, event: "APPROVAL_REQUESTED" })).toBe(true);
	});
});
