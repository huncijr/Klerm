import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });

function send(id, result) {
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

input.on("line", (line) => {
	const message = JSON.parse(line);
	if (message.method === "initialize") {
		send(message.id, {
			protocolVersion: message.params.protocolVersion,
			capabilities: { tools: {} },
			serverInfo: { name: "fake-mcp", version: "1.0.0" },
		});
		return;
	}
	if (message.method === "tools/list") {
		if (message.params?.cursor === "page-2") {
			send(message.id, {
				tools: [
					{
						name: "required-task",
						description: "Skipped task tool",
						inputSchema: { type: "object" },
						execution: { taskSupport: "required" },
					},
				],
			});
			return;
		}
		send(message.id, {
			tools: [
				{
					name: "echo-text",
					description: "Echo text",
					inputSchema: {
						type: "object",
						properties: { text: { type: "string" } },
						required: ["text"],
					},
				},
			],
			nextCursor: "page-2",
		});
		return;
	}
	if (message.method === "tools/call") {
		send(message.id, {
			content: [{ type: "text", text: `echo:${message.params.arguments.text}` }],
			structuredContent: { echoed: message.params.arguments.text },
		});
	}
});
