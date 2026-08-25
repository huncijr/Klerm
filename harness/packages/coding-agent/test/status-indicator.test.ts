import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CompletedStatusIndicator,
	IdleStatus,
	RetryStatusIndicator,
	StartupStatusIndicator,
} from "../src/modes/interactive/components/status-indicator.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("status indicators", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps idle status at the same height as status indicators", () => {
		const idleStatus = new IdleStatus();

		const lines = idleStatus.render(20);
		expect(lines).toHaveLength(2);
		expect(lines).toEqual([" ".repeat(20), " ".repeat(20)]);
	});

	it("disposes retry countdown updates", () => {
		initTheme("dark");
		vi.useFakeTimers();
		const requestRender = vi.fn();
		const tui = { requestRender } as unknown as TUI;
		const indicator = new RetryStatusIndicator(tui, 1, 3, 1000);
		const callsBeforeDispose = requestRender.mock.calls.length;

		indicator.dispose();
		vi.advanceTimersByTime(2000);

		expect(requestRender).toHaveBeenCalledTimes(callsBeforeDispose);
	});

	it("renders startup animation and a static completion icon", () => {
		initTheme("dark");
		vi.useFakeTimers();
		const requestRender = vi.fn();
		const tui = { requestRender } as unknown as TUI;
		const startup = new StartupStatusIndicator(tui);
		const completed = new CompletedStatusIndicator(tui);

		expect(stripAnsi(startup.render(40).join("\n"))).toContain("Starting Klerm...");
		expect(stripAnsi(completed.render(40).join("\n"))).toContain("➤ Done");
		const animatedRenderCalls = requestRender.mock.calls.length;
		vi.advanceTimersByTime(500);
		expect(requestRender.mock.calls.length).toBeGreaterThan(animatedRenderCalls);

		startup.dispose();
		const staticRenderCalls = requestRender.mock.calls.length;
		vi.advanceTimersByTime(500);
		expect(requestRender).toHaveBeenCalledTimes(staticRenderCalls);
		completed.dispose();
	});
});
