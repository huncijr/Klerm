import {
	type AgentAdapterJournal,
	type AgentDescriptor,
	type AgentRuntime,
	RuntimeAgentAdapter,
} from "./agent-adapter-contract.ts";

export interface FakeAgentTurn {
	text: string;
	waitForInterrupt?: boolean;
	failed?: boolean;
}

/** A deterministic worker for contract verification, never registered as a real harness. */
export class FakeAgentAdapter extends RuntimeAgentAdapter {
	constructor(descriptor: AgentDescriptor, turns: readonly FakeAgentTurn[], journal: AgentAdapterJournal) {
		let nextSession = 0;
		const sessions = new Map<string, { model?: string; turns: FakeAgentTurn[] }>();
		super(
			descriptor,
			async (request) => {
				const id = request.nativeSessionId ?? `fake-session-${++nextSession}`;
				if (request.nativeSessionId && !sessions.has(id)) throw new Error("Unknown fake native session.");
				const state = sessions.get(id) ?? { model: request.model, turns: structuredClone([...turns]) };
				sessions.set(id, state);
				const runtime: AgentRuntime = {
					nativeSessionId: id,
					model: state.model,
					async prompt(_text, signal) {
						const turn = state.turns.shift();
						if (!turn) throw new Error("Fake responses exhausted.");
						if (turn.waitForInterrupt && !signal.aborted)
							await new Promise<void>((resolve) => {
								signal.addEventListener("abort", () => resolve(), { once: true });
							});
						return { text: turn.text, failed: turn.failed };
					},
					async interrupt() {},
					async dispose() {},
				};
				return runtime;
			},
			journal,
		);
	}
}
