# Klerm Desktop RPC Contract Audit

This audit records which parts of the existing JSONL RPC protocol can support
the planned Tauri desktop application. The desktop frontend must consume typed
RPC responses and events. It must not parse human-readable CLI output.

## Current Contract

The existing protocol is a useful base for the workspace spike:

| Desktop need | Existing RPC surface | Status |
|---|---|---|
| Read current session and backend state | `get_state`, `get_messages`, `get_entries`, `get_tree`, `get_session_stats` | Available |
| Start, list, switch, delete, clone, fork, and rename sessions | `new_session`, `list_sessions`, `switch_session`, `rename_session`, `delete_session`, `clone`, `fork`, `set_session_name` | Available; direct active-session deletion and rename-by-token are rejected in favor of their active-session flows |
| Negotiate the desktop boundary | `desktop_handshake` | Available with protocol version, Klerm version, command/event capabilities, session state, and initial routing state |
| Discover local runtimes and update routing config | `get_local_runtimes`, `get_klerm_config`, `set_klerm_config` | Available for model, routing, active-start, and per-lane `planner`/`builder` controls; planner tool access is enforced by the backend |
| Read and safely edit the project workspace | `get_workspace_status`, `get_workspace_diff`, `read_workspace_file`, `write_workspace_file` | Available; paths are project-relative, existing text files are limited to 2 MiB, and binary/out-of-root writes are rejected |
| Discover/open editors and workspace processes | `get_available_editors`, `open_workspace_editor`, `get_running_services`, `open_local_url` | Available through allowlisted process arguments and localhost-only URL validation; Running always includes the current backend and limits Linux listeners to process cwd values inside the project |
| Run desktop terminal commands | `bash`, `abort_bash`, `bash_execution_update` | Available as a writable, streamable, stoppable fresh-shell command console in the selected workspace; full PTY semantics remain deferred |
| Show and configure MCP servers | `get_mcp_status`, `add_mcp_server`, `reload_mcp_servers` | Available for privacy-safe status, credential-free server writes, and explicit runtime reload; credential/header secrets are rejected or omitted |
| Submit and stop work | `prompt`, `steer`, `follow_up`, `abort` | Available |
| Stream responses and tool activity | `message_*`, `tool_execution_*`, `turn_*`, `agent_*` events | Available |
| Observe live Klerm routing state | Handshake state and `routing_changed` event | Available initially and after routing changes; no standalone query |
| Observe attributed file writes | `workspace_files_changed` event and `klerm-workspace-attribution` session entries | Available; observed Klerm writes include source, provider, model, lane, and timestamp, desktop saves are `manual`, and unmatched Git changes are `external` |
| List and select configured models | `get_available_models`, `set_model` | Available |
| Read and set thinking effort | `get_available_thinking_levels`, `set_thinking_level` | Available for the active model or an explicit `local`/`frontier` lane; lane values persist independently and are clamped to that model's supported levels |
| Approve risky Builder actions | `extension_ui_request` confirmation and matching `extension_ui_response` | Available; the backend pauses before execution, the desktop shows a centered Approve/Cancel dialog, timeout/cancel defaults to denial, and arguments are not included in persisted approval entries |
| Correlate requests and responses | Optional command `id`, echoed by responses | Available |
| Detect completion | `agent_settled` | Available |

`get_entries` exposes persisted `klerm-transition` custom entries. This is
enough to reconstruct an active session after reconnecting, but it is not a
replacement for a typed routing-history query or a decision-event stream.

`get_klerm_config` returns `localRole` and `frontierRole`. `set_klerm_config`
accepts either field as `planner` or `builder` while no task is active. The
desktop must treat these as backend policy, not reproduce tool filtering in the
frontend.

Planner is a backend-enforced structure-only role: only `find`, `ls`, and Klerm
handoff tools are exposed, and prior file/command results are redacted. Builder
retains the configured tool set. Sensitive file access, a fifth changed file,
potentially modifying shell commands, and unknown extension/MCP tools use the
confirmation sub-protocol before execution. Approval decisions are persisted as
credential-free `klerm-tool-approval` custom session entries.

## Remaining Desktop Operations

The following operations need typed RPC commands before their corresponding UI
milestones. The CLI equivalents added for diagnostics are not desktop APIs.

| Required operation | Earliest milestone | Required response/event data |
|---|---|---|
| Query current routing state | App 4 | Full `KlermRoutingState`, even before the next `routing_changed` event |
| Read/filter decision events | App 4 | Typed `KlermRouteDecision` records and deterministic filter fields |
| Subscribe to decision events | App 4 | Append-only event with task/session correlation and no response body content |
| Query provider authentication status | App 3 | Provider ID, configured boolean, auth method/source label; never credentials |

MCP desktop status is intentionally not a credential surface. `get_mcp_status`
returns server name, transport, enabled flag, lifecycle state, exposed tool names,
skipped tools, and sanitized error text. `add_mcp_server` supports global/project
stdio, Streamable HTTP, and SSE server definitions without secrets; the backend
rejects credential-like URLs and headers. `reload_mcp_servers` reloads extension
resources when no task is active and returns the same status snapshot.

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

The inherited RPC transport supports the Linux shell, core prompt lifecycle,
session management, model controls, project workspace, and MCP status/setup
through typed operations. Workspace attribution survives session rebinding without
entering LLM context. The desktop backend remains incomplete: a standalone
routing-state query, decision history/streaming, and provider auth status still
require explicit backend work. The Tauri frontend must not work around these gaps
by invoking diagnostic CLI commands and parsing text.
