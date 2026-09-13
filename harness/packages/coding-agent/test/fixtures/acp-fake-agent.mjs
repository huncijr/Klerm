// Minimal fake ACP agent: answers the initialize handshake over ndjson stdio.
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, index).trim();
		buffer = buffer.slice(index + 1);
		if (!line) continue;
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			process.stdout.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: message.id,
					result: {
						protocolVersion: 1,
						agentCapabilities: { loadSession: true },
						agentInfo: { name: "fake-agent", title: "Fake Agent", version: "9.9.9" },
						authMethods: [],
					},
				})}\n`,
			);
		}
	}
});
