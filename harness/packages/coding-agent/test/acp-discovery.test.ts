import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACP_AGENT_COMMANDS, probeAcpAgent } from "../src/klerm/acp-discovery.ts";

const fakeAgent = join(import.meta.dirname, "fixtures", "acp-fake-agent.mjs");

describe("ACP discovery", () => {
	it("completes the initialize handshake with a real subprocess", async () => {
		const scan = await probeAcpAgent(process.execPath, [fakeAgent]);
		expect(scan).toEqual({
			command: process.execPath,
			protocolVersion: 1,
			agentName: "fake-agent",
			agentTitle: "Fake Agent",
			agentVersion: "9.9.9",
			loadSession: true,
		});
	});

	it("returns undefined for a command that does not speak ACP", async () => {
		await expect(probeAcpAgent("definitely-not-a-real-acp-agent")).resolves.toBeUndefined();
	}, 15_000);

	it("keeps known ACP adapter commands per harness kind", () => {
		expect(ACP_AGENT_COMMANDS["claude-code"]).toContain("claude-code-acp");
		expect(ACP_AGENT_COMMANDS.codex).toContain("codex-acp");
		expect(Object.keys(ACP_AGENT_COMMANDS)).not.toContain("klerm");
	});
});
