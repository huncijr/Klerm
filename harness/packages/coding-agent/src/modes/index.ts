/**
 * Run modes for the coding agent.
 */

export { InteractiveMode, type InteractiveModeOptions } from "./interactive/interactive-mode.ts";
export type { JsonAgentSessionEvent } from "./json-event.ts";
export { type PrintModeOptions, runPrintMode } from "./print-mode.ts";
export {
	type ModelInfo,
	RpcClient,
	type RpcClientOptions,
	type RpcEventListener,
	RpcResponseError,
} from "./rpc/rpc-client.ts";
export { type RunRpcModeOptions, runRpcMode } from "./rpc/rpc-mode.ts";
export type {
	RpcCommand,
	RpcDesktopHandshake,
	RpcDesktopSessionInfo,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcKlermConfigUpdate,
	RpcResponse,
	RpcSessionState,
} from "./rpc/rpc-types.ts";
export { KLERM_DESKTOP_RPC_PROTOCOL_VERSION } from "./rpc/rpc-types.ts";
