import type { AgentSession } from "../core/agent-session.ts";
import {
	type AgentAdapterJournal,
	type AgentCapability,
	type AgentStartRequest,
	RuntimeAgentAdapter,
} from "./agent-adapter-contract.ts";

/** The owner supplies a configured native session, including auth, tools and memory. */
export type PiAgentSessionFactory = (request: AgentStartRequest) => Promise<AgentSession>;

export class PiAgentAdapter extends RuntimeAgentAdapter {
	constructor(factory: PiAgentSessionFactory, journal: AgentAdapterJournal, capabilities: AgentCapability) {
		super(
			{ id: "klerm-runtime", harness: { id: "klerm", name: "Klerm (Pi runtime)" }, capabilities },
			async (request) => {
				const session = await factory(request);
				return {
					get nativeSessionId() {
						return session.sessionId;
					},
					get model() {
						return session.model ? `${session.model.provider}/${session.model.id}` : undefined;
					},
					async prompt(text, signal) {
						let result = "";
						let failed = false;
						const unsubscribe = session.subscribe((event) => {
							if (event.type !== "message_end" || event.message.role !== "assistant") return;
							result = event.message.content
								.flatMap((part) => (part.type === "text" ? [part.text] : []))
								.join("\n");
							failed = event.message.stopReason === "error" || event.message.stopReason === "aborted";
						});
						try {
							if (!signal.aborted) await session.prompt(text, { expandPromptTemplates: false });
							return { text: result, failed };
						} finally {
							unsubscribe();
						}
					},
					interrupt: () => session.abort(),
					async dispose() {
						session.dispose();
					},
				};
			},
			journal,
		);
	}
}
