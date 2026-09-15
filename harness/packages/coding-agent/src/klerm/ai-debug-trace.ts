import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const KLERM_AI_DEBUG_LOG_ENV = "KLERM_AI_DEBUG_LOG";

export type AiDebugTraceEventType =
	| "TRACE_STARTED"
	| "USER_PROMPT"
	| "ROSTER_SNAPSHOT"
	| "NATIVE_SESSION_READY"
	| "PROMPT_SENT"
	| "ADAPTER_RAW_EVENT"
	| "ADAPTER_EVENT"
	| "MODEL_RESPONSE"
	| "BRIDGE_EVENT"
	| "SESSION_EVENT"
	| "TRACE_STOPPED";

export interface AiDebugTraceEvent {
	type: AiDebugTraceEventType;
	sessionId?: string;
	taskId?: string;
	agentId?: string;
	phase?: string;
	data: unknown;
}

export interface AiDebugTraceWriter {
	append(event: AiDebugTraceEvent): void;
	flush(): Promise<void>;
}

export interface AiDebugTraceRecord extends AiDebugTraceEvent {
	version: 1;
	timestamp: string;
	sequence: number;
}

export class JsonlAiDebugTrace implements AiDebugTraceWriter {
	private readonly filePath: string;
	private sequence = 0;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	append(event: AiDebugTraceEvent): void {
		const record: AiDebugTraceRecord = {
			version: 1,
			timestamp: new Date().toISOString(),
			sequence: ++this.sequence,
			...event,
		};
		let line: string;
		try {
			line = `${JSON.stringify(record)}\n`;
		} catch (serializationError) {
			line = `${JSON.stringify({
				...record,
				data: {
					serializationError:
						serializationError instanceof Error ? serializationError.message : String(serializationError),
				},
			})}\n`;
		}
		this.writeQueue = this.writeQueue
			.catch(() => undefined)
			.then(async () => {
				await mkdir(dirname(this.filePath), { recursive: true });
				await appendFile(this.filePath, line, "utf8");
			});
	}

	async flush(): Promise<void> {
		await this.writeQueue;
	}
}

export function createAiDebugTraceFromEnvironment(
	environment: NodeJS.ProcessEnv = process.env,
): AiDebugTraceWriter | undefined {
	const filePath = environment[KLERM_AI_DEBUG_LOG_ENV]?.trim();
	return filePath ? new JsonlAiDebugTrace(filePath) : undefined;
}
