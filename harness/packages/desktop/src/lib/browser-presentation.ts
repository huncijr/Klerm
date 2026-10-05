import type { BrowserActivityEvent } from "./model.ts";

export function visibleBrowserActivity(event: BrowserActivityEvent): boolean {
	if (event.event !== "APPROVAL_REQUESTED" && event.event !== "APPROVAL_RESOLVED") return true;
	const details = event.details;
	if (!details || typeof details !== "object" || Array.isArray(details)) return true;
	return (details as Record<string, unknown>).decidedBy !== "policy";
}

/** Only transient pointer-shake takeover may resume after a grace period. */
export function mayAutoResumeBrowser(
	control: string | undefined,
	reason: string | undefined,
	status: string | undefined,
): boolean {
	return control === "human" && status === "running" && reason === "Pointer shake takeover gesture.";
}
