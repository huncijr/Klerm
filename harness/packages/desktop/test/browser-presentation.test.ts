import { describe, expect, test } from "vitest";
import { mayAutoResumeBrowser, visibleBrowserActivity } from "../src/lib/browser-presentation.ts";

describe("browser activity visibility", () => {
	test("only transient pointer gestures resume automatically, never login or CAPTCHA", () => {
		expect(mayAutoResumeBrowser("human", "Pointer shake takeover gesture.", "running")).toBe(true);
		for (const reason of [
			"Human verification requires manual control.",
			"User requested browser navigation.",
			"Human input in the browser viewport.",
			"Login requires private input.",
		])
			expect(mayAutoResumeBrowser("human", reason, "running")).toBe(false);
		expect(mayAutoResumeBrowser("human", "Pointer shake takeover gesture.", "cancelled")).toBe(false);
	});
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
