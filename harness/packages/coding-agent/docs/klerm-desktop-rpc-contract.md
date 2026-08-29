# Klerm Desktop RPC Contract Audit

This audit records which parts of the existing JSONL RPC protocol can support
the planned Tauri desktop application. The desktop frontend must consume typed
RPC responses and events. It must not parse human-readable CLI output.

## Current Contract

The existing protocol is a useful base for the workspace spike:

| Desktop need | Existing RPC surface | Status |
|---|---|---|
| Read current session and backend state | `get_state`, `get_messages`, `get_entries`, `get_tree`, `get_session_stats` | Available |
| Start, switch, clone, fork, and rename the active session | `new_session`, `switch_session`, `clone`, `fork`, `set_session_name` | Partially available; no session listing or deletion |
| Submit and stop work | `prompt`, `steer`, `follow_up`, `abort` | Available |
| Stream responses and tool activity | `message_*`, `tool_execution_*`, `turn_*`, `agent_*` events | Available |
| Observe live Klerm routing state | `routing_changed` event | Available after a routing change; no initial query |
| List and select configured models | `get_available_models`, `set_model` | Available |
| Correlate requests and responses | Optional command `id`, echoed by responses | Available |
| Detect completion | `agent_settled` | Available |

`get_entries` exposes persisted `klerm-transition` custom entries. This is
enough to reconstruct an active session after reconnecting, but it is not a
replacement for a typed routing-history query or a decision-event stream.

## Missing Desktop Operations

The following operations need typed RPC commands before their corresponding UI
milestones. The CLI equivalents added for diagnostics are not desktop APIs.

| Required operation | Earliest milestone | Required response/event data |
|---|---|---|
| Backend handshake and capability negotiation | App 0 | Protocol version, Klerm version, supported command/event names, readiness |
| List sessions | App 2 | Stable session ID, path token, name, cwd, created/modified timestamps, message count |
| Delete a session | App 2 | Session ID and deterministic success/error result |
| Query local runtime health and models | App 1 | Runtime ID, endpoint metadata, availability, models, privacy-safe error |
| Get and update Klerm routing configuration | App 1 for local model; App 4 for full routing | Typed config, validation errors, persisted/effective values |
| Query current routing state | App 4 | Full `KlermRoutingState`, even before the next `routing_changed` event |
| Read/filter decision events | App 4 | Typed `KlermRouteDecision` records and deterministic filter fields |
| Subscribe to decision events | App 4 | Append-only event with task/session correlation and no response body content |
| Query provider authentication status | App 3 | Provider ID, configured boolean, auth method/source label; never credentials |
| Query MCP server status | Later tooling milestone | Server ID, transport, connected/error state, tool count |

## Protocol Requirements

- Add an explicit protocol version before the Tauri sidecar is treated as a
  stable application boundary. Klerm package versions alone are not sufficient
  for capability negotiation.
- Keep JSONL framing and request IDs. The frontend must tolerate unrelated
  events between a command and its response.
- Return machine-readable error codes in new desktop commands. Human error text
  remains useful for logs but must not drive frontend behavior.
- Use stable IDs instead of requiring the frontend to construct or inspect
  filesystem paths. `switch_session` currently requires `sessionPath`, so a
  session-list command must provide an opaque value accepted by the backend or
  a new switch-by-ID command.
- Emit a complete state snapshot after sidecar startup or expose commands that
  return it. Event-only state is insufficient after reconnects.
- Never include API keys, OAuth tokens, provider auth files, prompt bodies, tool
  output, or model response bodies in health, capability, routing-decision, or
  authentication-status payloads.
- Preserve deterministic decision fields and ordering. Desktop filtering must
  use backend fields rather than reclassifying decisions in the frontend.

## Recommended App 0 Boundary

The protocol and shell spike can use the current RPC mode for one proof request:

1. Start `klerm --mode rpc` as a sidecar.
2. Send `get_state` with a request ID.
3. Treat the correlated successful response as temporary readiness.
4. Send a no-provider smoke operation such as `get_entries`.
5. Shut down the sidecar through normal process termination.

Before App 0 is marked complete, replace the temporary `get_state` readiness
probe with a versioned backend handshake and add contract tests for framing,
capability negotiation, process shutdown, and incompatible protocol versions.

## Audit Conclusion

The inherited RPC transport is suitable for the Linux shell spike and the core
prompt-stream-abort workspace flow. It is not yet a complete desktop backend:
session discovery, local runtime discovery, routing configuration/query,
decision history/streaming, provider auth status, MCP status, and protocol
version negotiation remain explicit backend work. The Tauri frontend must not
work around these gaps by invoking diagnostic CLI commands and parsing text.
