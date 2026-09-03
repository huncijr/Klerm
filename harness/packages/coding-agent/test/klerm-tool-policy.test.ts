import { describe, expect, it } from "vitest";
import { requiresBuilderApproval } from "../src/klerm/tool-policy.ts";

describe("Klerm builder tool policy", () => {
	it("allows routine reads, edits, checks, and builds", () => {
		expect(requiresBuilderApproval("read", { path: "src/app.ts" }, 0)).toBeUndefined();
		expect(requiresBuilderApproval("edit", { path: "src/app.ts" }, 1)).toBeUndefined();
		expect(requiresBuilderApproval("bash", { command: "git diff -- src/app.ts" }, 0)).toBeUndefined();
		expect(requiresBuilderApproval("bash", { command: "npm run check" }, 0)).toBeUndefined();
		expect(requiresBuilderApproval("bash", { command: "cargo build" }, 0)).toBeUndefined();
	});

	it("requires approval for sensitive files and broad edits", () => {
		expect(requiresBuilderApproval("read", { path: ".env" }, 0)?.category).toBe("sensitive-file");
		expect(requiresBuilderApproval("write", { path: "src/fifth.ts" }, 5)?.category).toBe("bulk-edit");
	});

	it("requires approval for modifying shell and unknown external tools", () => {
		expect(requiresBuilderApproval("bash", { command: "rm -rf dist" }, 0)?.category).toBe("shell-mutation");
		expect(requiresBuilderApproval("bash", { command: "git status && git push" }, 0)?.category).toBe(
			"shell-mutation",
		);
		expect(requiresBuilderApproval("bash", { command: "find . -delete" }, 0)?.category).toBe("shell-mutation");
		expect(requiresBuilderApproval("mcp_remote_publish", {}, 0)?.category).toBe("external-tool");
		expect(requiresBuilderApproval("configure_mcp_server", { name: "google-maps" }, 0)).toMatchObject({
			category: "external-tool",
			title: "Allow configuring an MCP server?",
		});
	});
});
