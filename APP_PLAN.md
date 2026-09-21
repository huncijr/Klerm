# APP_PLAN.md - Klerm desktop application plan

## 1. Purpose and scope

Build Klerm as an installable Tauri desktop application over the stable Klerm
CLI/backend. The app is a native desktop product for:

- Linux;
- Windows;
- macOS.

Klerm will not provide a browser-hosted web application. The frontend may use
web technologies inside Tauri, but it must not be deployed or supported as a
standalone website. Browser-only behavior, cloud-hosted sessions, and a public
web login flow are out of scope.

Delivery order remains:

1. Linux development and packaging.
2. Windows packaging and platform fixes.
3. macOS packaging, signing, and platform fixes.

## 2. Product principles

- Klerm is the bridge between independent coding agents, not a replacement for
  their native harnesses.
- Each agent keeps its own authentication, model choice, tools, memory, context
  policy, and native session.
- Reuse the proven Klerm session, provider, tool, and logging behavior as
  compatibility infrastructure, but do not make local/frontier lanes the future
  desktop abstraction.
- Prove two-agent structured communication before adding larger teams.
- Let the user temporarily join a live agent conversation and then hand control
  back without restarting it.
- Keep message order, delivery, cancellation, and state transitions deterministic
  and inspectable.
- Do not block bridge work on cloud, 24/7 autonomy, organization features,
  advanced tabs, or visual effects.
- Store secrets in platform-appropriate secure storage and never expose them in
  frontend logs or bridge events.
- Keep upstream Pi MIT attribution in the packaged app and its About view.
  Display the mixed-license notice and the Klerm Community Source License for
  any new Klerm-specific release material to which it is expressly applied.

## 3. Application layout

The main application should feel like a live collaboration workspace rather
than a generic monitoring dashboard.

- Center: the shared task conversation, including user prompts, directed
  agent-to-agent prompts, replies, tool activity, and artifact handoffs.
- Top bar: connected agents, bridge health, active task state, and concise
  token/cost information when available.
- Left panel: project sessions and collaboration threads. It is collapsible.
- Right panel: selected agent details, native session identity, current role,
  pending message, artifacts, and deterministic events. It is collapsible.
- Composer: normally starts a user prompt; during an intervention it clearly
  identifies the selected recipient or `all agents`.
- Bottom/status area: running, waiting, queued intervention, paused, stopped,
  failed, and completed states.

The center remains usable with both panels closed. Compact windows use temporary
drawers rather than squeezing the conversation.

## 4. Agent and bridge controls

### Connected agents

- Discover configured coding-agent adapters and show their health.
- Show the native harness, capability summary, authentication status, and active
  session without exposing credentials.
- Start with the existing Pi/Klerm runtime as the reference adapter, then add one
  external harness. Codex and Claude Code are the first feasibility candidates.
- Keep existing direct local/frontier model controls as a compatibility worker,
  not as the primary future workflow.

### Agent conversation

- Address a prompt to a specific agent and show its sender and recipient.
- Let agents ask each other questions, reply, hand off a task, and reference an
  artifact through the typed Klerm bridge.
- Show queued, delivered, accepted, replied, failed, and cancelled states.
- Enforce backend turn/time/budget limits; the UI must not create an independent
  conversation loop.

### User intervention

- An explicit `Intervene` action opens a temporary input mode for one minute by
  default.
- The user selects one agent or all active agents, submits a prompt, and sees
  delivery acknowledgement.
- If immediate interruption is unsafe, display that the prompt is queued for
  the next safe boundary.
- After delivery, agents continue their current native sessions with the new
  prompt in the collaboration context.
- Intervention, pause, and stop are separate controls.

## 5. Core views

### Workspace

- Start and continue a Klerm collaboration.
- Render the ordered multi-party conversation and streaming activity.
- Display native agent identity rather than only provider/model identity.
- Stop the whole task or one agent safely.
- Show artifacts, per-response usage, and cost when available.

### Agents

- Configure adapter commands and connection settings.
- Show capabilities, health, authentication state, and native sessions.
- Configure an agent's Klerm-visible name, role, and memory scope without
  replacing memory owned by its native harness.

### Collaboration

- Show prompts, replies, handoffs, correlation IDs, and delivery state.
- Show limits and why an exchange paused or stopped.
- Add three/four-agent task assignment only after the two-agent flow and user
  intervention are reliable.

### Event log

- Read and filter the same deterministic events produced by the backend.
- Filter by collaboration, task, agent, sender, recipient, and event type.
- Export credential-safe events without duplicating private native-agent data.

### Settings and About

- Backend/sidecar and adapter health, configuration locations, and diagnostics.
- Appearance, reduced-motion, and accessibility controls.
- Version, licenses, and Pi MIT attribution.

## 6. Collaboration visualization

Collaboration must remain understandable without animation.

- Connected agents appear as distinct participants, not local/frontier nodes.
- Each message displays its sender, recipient, delivery state, and reply link.
- Agent-to-agent prompts and handoffs appear in the shared timeline.
- User intervention is visually distinct and shows whether it is open, queued,
  delivered, or expired.
- Tool execution and artifact creation remain attributed to the native agent.
- Completion, pause, stop, and failure leave readable static states.
- Visual effects never delay backend events and honor reduced-motion settings.

## 7. Desktop architecture

- Tauri provides the native window, packaging, permissions, secure integration,
  and platform lifecycle.
- The Klerm CLI/server remains the source of truth for collaboration threads,
  adapter sessions, prompts, replies, artifacts, accounting, and bridge events.
- Prefer the most stable existing RPC boundary after a focused protocol audit.
- Define versioned, typed messages for agent discovery, native session identity,
  directed prompts, replies, intervention, artifacts, status, cancellation, and
  errors.
- The frontend consumes structured events; it must not parse human-readable CLI
  output.
- The sidecar must start, report readiness, restart after recoverable failure,
  and shut down with the app.
- Restrict Tauri commands and filesystem access to the minimum required scope.
- Preserve existing configuration compatibility under `~/.klerm/agent/` where
  practical, with platform-specific path handling.
- Continue writing deterministic decision events to
  `.klerm/router-decisions.jsonl` for project sessions unless the backend later
  defines a compatible platform-neutral location.

## 8. Implementation milestones

### App Milestone 0 - Protocol and shell spike

Goal: prove that a Linux Tauri window can communicate with the Klerm backend.

- Audit the inherited RPC/server/client boundary.
- Define the minimum desktop event contract.
- Create the Tauri shell with Klerm branding and icon.
- Start the backend sidecar and display readiness or a useful failure.
- Do not add provider setup, rich tabs, or decorative animation yet.

Acceptance criteria:

- Linux window opens and closes cleanly.
- Backend readiness is visible.
- One typed request/response smoke operation works.
- No browser-hosted build is documented or shipped.

Status: **completed**. The Linux development window starts with Klerm branding,
launches the JSONL stdio backend, checks protocol version 1 through a typed
handshake, displays readiness, and shuts the backend down through stdin EOF with
a forced-termination fallback. Agent checks and repeated human launches through
`klermapp` verified startup and basic interaction. The current backend remains
source-tree development infrastructure, not a bundled sidecar.

### App Milestone 1 - Local-only usable foundation

Goal: make the basic model and app operation work entirely locally.

- Build the centered workspace and minimal top-left navigation.
- Detect Ollama through the existing backend.
- List installed Ollama models and let the user select one.
- Persist the selected local model through backend configuration.
- Send a prompt, stream the local response, show tool activity, stop the task,
  and display clear errors.
- Show the final model identity, token usage, and cost metadata when available.
- Keep settings minimal; advanced tabs remain placeholders or absent.

Acceptance criteria:

- A user can open the Linux app, choose an already installed Ollama model, and
  complete a local Klerm task without using the CLI directly.
- Restarting the app restores the selected local model.
- Runtime unavailability never silently falls back to a frontier model.
- The corresponding decision and response events remain deterministic.

Status: **foundation implemented; no longer the next product priority**. The centered workspace,
local runtime/model discovery, persisted local-only selection, streaming text,
tool activity, abort, and error states are implemented. Custom local-model,
frontier-model, and routing selectors remain in a compact row below the stable
composer. Entering a draft keeps the empty-state hero visible; the hero
disappears only after a prompt is accepted. The conversation renders assistant
Markdown-lite headings, emphasis, lists, inline code, and fenced code blocks
with model identity directly above responses. The top bar shows the effective
current model read-only, and the
sidebar is reduced to sessions. A new session starts immediately in the current
workspace root; the native folder picker appears only from the explicit center
root selector and restarts the backend in the chosen directory. The prompt now grows only to a
viewport-relative limit and then scrolls internally so Send/Stop and the model
selectors remain visible in short windows. A human test with a real Ollama task,
restart persistence verification, and final usage/cost presentation remain
before completion.

Agent 1 and Agent 2 now also have independently persisted Plan/Build roles in a
compact composer popover. The typed backend config is the source of truth:
planner turns receive project read/search/list tools, restricted read-only shell,
read-only MCP tools, and Klerm handoff tools, while the executor rejects stale
mutating requests. Builder turns retain the configured coding and MCP tool set
and request approval before sensitive, broad, potentially modifying, or unknown
external actions. Four empty-state starter
chips fill the composer without submitting. Static checks and focused config,
routing-runtime, and RPC contract tests pass; real-model role enforcement and
desktop interaction still require a human smoke test.

After a successful Planner response, the composer offers a red inline
`Switch to Build mode` action for the agent that produced the plan. Its circular
progress indicator completes over 10 seconds; Cancel, a role change, another
prompt, Settings, or a session change dismisses it. Switching changes only the
role and never resubmits the previous prompt.

Project-improvement questions refer explicitly to the active session workspace
in Direct, Agent 1, and Agent 2 prompts. Plan mode is read-only in Direct routing
as well as routed lanes, inspects relevant project files before suggesting
changes, and avoids discussing Klerm internals unless Klerm is itself the opened
project or the user explicitly asks about it.

Workspace-change prompts now have a backend execution contract. Klerm snapshots
the Git workspace before and after the task, requires a real project-file diff
and subsequent relevant verification, sends one corrective turn after a
plan-only response, and logs deterministic `TASK_COMPLETED` or `TASK_FAILED`
evidence. The typed `agent_settled` event carries that outcome so the desktop
distinguishes implemented-and-verified work from blocked, plan-only, unverified,
and failed tasks instead of treating every normal model stop as completion.

The active agent's Plan/Build mode is visible above the prompt. Exact `/mode`
input opens the role popover on Enter, Send, or Ctrl/Cmd+Enter and is consumed
locally instead of being submitted to the model.

Checkpoint - Agent 1/Agent 2 role UI and CLI naming:

- CLI: `klerm mode` now documents and accepts `agent 1`, `agent 2`, `1`, and
  `2` role targets. Legacy `local` and `frontier` targets remain accepted as
  hidden compatibility aliases. Human output and JSON mode reporting use
  Agent 1/Agent 2 terminology.
- TUI: `/mode` opens an Agent 1/Agent 2 Plan/Build selector, direct commands
  such as `/mode agent 1 planner` and `/mode 2 builder` work, slash-command
  help uses Agent labels, and the compact/expanded routing status renders
  Agent 1/Agent 2 labels while retaining backend lane values internally.
- Desktop: visible model, effort, routing, active mode, route-card, fallback,
  and file-attribution labels use Agent 1/Agent 2. The composer mode indicator
  follows the active routing lane first, falls back to the selected start route,
  closes with Escape, and closes automatically while disabled. The starter
  prompt chips now include icons.
- Verification: `npm run check`, focused config/TUI status tests, focused
  routing-runtime/tool-policy/RPC contract tests, and `git diff --check` pass.
  Remaining verification is a human desktop smoke with a real configured model.

Checkpoint - mixed Agent 1/Agent 2 model assignment and peer lookup:

- Backend: `resolveModel` no longer requires Agent 1 to be local or Agent 2 to
  be cloud. Assigning the same `provider/id` to both agents is rejected.
  `getSelectableModels` returns every available model except the other agent's
  current selection.
- Identity: both agents receive a `<klerm_identity>` peer lookup with runtime
  kind, strength band 1-5, context, reasoning, strengths, limits, and relative
  strength. Auto recommends Agent 2 only when that peer is stronger.
- CLI/TUI: `/local` and `/frontier` selectors list any available model except
  the other agent. `/routing 1` / `/routing 2` and `/active` aliases work.
  Status strings use Agent 1/Agent 2 labels.
- Desktop: Agent 1 and Agent 2 dropdowns share one catalog and hide the other
  agent's current model. Runtime status reports local runtimes separately from
  agent assignment.
- Verification: `npm run check` and focused model-profile, routing-runtime,
  interactive-command, and config-command tests pass. Remaining verification is
  a human smoke with two different models assigned.

### App Milestone 2 - Sessions and desktop reliability

Goal: make the local-only app safe for repeated everyday use.

- Add session list, resume, rename, and delete flows using existing semantics.
- Handle sidecar startup, cancellation, restart, and shutdown robustly.
- Add loading, empty, offline, and recoverable error states.
- Add keyboard navigation and reduced-motion support.
- Add automated contract tests and a Linux end-to-end smoke test.

Acceptance criteria:

- Local sessions survive app restarts.
- Sidecar failures produce recoverable UI states without losing saved sessions.
- Keyboard-only operation covers model selection, prompt submission, stop, and
  session navigation.

Status: **partially implemented ahead of milestone completion**. Session list,
resume, new-session, rename, and deletion flows exist. The current title and
sidebar rows support rename; inactive rows use a validated `rename_session`
token operation without switching the active runtime. Deletion uses a hover
ellipsis menu with a separate arrow submenu; the typed backend command validates
the listed session token, treats already-missing files as deleted, and the active
conversation is deleted through a new-session-then-delete flow. The composer
shows a square stop control in the send position and a working spinner during
active responses. The frontend was migrated to Svelte 5 (runes) with Tailwind
CSS v4 and `@lucide/svelte` icons; the RPC bridge and domain types remain plain
TypeScript under `src/lib/`. Messages, tool calls, MCP, routing, retry, error,
and outcome activity now render in one append-ordered feed instead of separate
conversation and timeline blocks. Reopened sessions rebuild the same active
branch order from `get_entries`. MCP calls use blue cards, routing transitions
use amber cards, writes use green cards, edits use expandable red/green diffs, and
provider failures surface as red cards via
`auto_retry_end` and `provider-failure` transitions, retries-in-flight as amber
cards via `auto_retry_start`, and Agent 2 fallback reasons as red routing
cards. Persisted `klerm-transition` entries restore delegation cards when
a session is reopened. Pending-request rejection on backend exit, graceful
shutdown, keyboard-operable custom model/routing selectors, reduced motion
styling, and an automated desktop RPC contract test also exist. At compact
widths the sidebar is an overlay drawer with a Workspace Menu control,
backdrop, outside click close, and Escape close. Short-height breakpoints
compact typography, branding, session rows, and optional hero decoration while
keeping the session list independently scrollable. These responsive rules are
agent-build-verified; human smoke tests at compact and short window sizes
remain. Prompt submission now requires Send or Ctrl/Cmd+Enter, prior prompts can
be recalled or restored from a user message for editing, and a backend-backed
compact thinking-effort slider is available below each Agent 1 and Agent 2 model
selector when that model supports effort. The two values persist independently,
expose each model's supported levels, and are restored as routing moves between
lanes. The routing control
updates active-start policy with routing mode so direct frontier and
frontier-local starts cannot be silently overridden by stale policy. Backend
restart/recovery, full accessibility verification, and a Linux
end-to-end test remain.

### App Milestone 2A - Project workspace, file changes, and editor shell

Goal: make the desktop app useful as a project workspace without bypassing the
typed backend boundary or losing model attribution.

Implementation checklist:

- [x] Change `New session` so it starts immediately in the current default root
  instead of opening the native folder picker.
- [x] Add a top-center workspace root selector. Folder selection happens only
  when the user explicitly changes the root, and the selected root starts a new
  backend session in that directory.
- [x] Detect the enclosing Git repository through the backend. Use its top-level
  directory for source-control status while retaining the explicitly selected
  workspace root when no repository exists.
- [x] Replace prompt recall-only behavior with a visible sent-prompt edit mode:
  `Edit`, `Save & rerun`, and `Cancel`. The original persisted prompt remains
  auditable; the corrected text is submitted as a new prompt. During an active
  task the action prepares the correction but does not submit until stopped.
- [x] Add typed workspace RPC operations for Git status, file diff, safe text
  preview, safe workspace-relative file writes, installed editor discovery,
  opening an allowlisted editor, and running localhost/process discovery.
- [x] Add deterministic file-change attribution metadata for Klerm tool writes:
  provider, model, active lane, source, and timestamp. Git changes without a
  matching Klerm event are labeled `external`; desktop saves are labeled
  `manual`.
- [x] Add a right-side File Changes panel with modified, added, deleted, renamed,
  staged, and unstaged state; actor badges; file selection; and expandable
  red/green diffs.
- [x] Keep a desktop session rail that can collapse to a square logo tile and
  expand again. Compact windows continue to use a drawer rather than squeezing
  three columns together.
- [x] Add a safe top-right project launcher for detected Zed, VS Code, and
  Vim-compatible commands. Paths are passed as process arguments, never shell
  command strings, and unavailable editors remain visibly disabled.
- [x] Add an optional large text editor for workspace files. It starts from the
  backend preview, rejects paths outside the workspace, saves through typed RPC,
  records `manual` attribution, and refreshes Git state after saving.
- [x] Add a collapsible bottom panel with Terminal, Running, and Logs tabs. It
	stays hidden on the empty first-prompt screen, then appears collapsed after a
	prompt is accepted. Tool and process activity must not expand it automatically.
	The Terminal runs streamable, stoppable commands in a fresh workspace shell;
	Running shows active commands, inline command approvals, Linux listeners whose
	process cwd is inside the project, and published Docker Compose ports. Klerm's
	own backend is not shown as a workspace process. Full PTY semantics for
	interactive/full-screen programs remain deferred.
- [x] Render command approval in the Running panel with the exact command and
	Approve/Cancel actions instead of a full-screen modal. Approval expands the
	panel because user action is required.
- [x] Poll running services during agent tasks and render listener URLs as
	directly clickable localhost actions. Builder prompts require runnable websites,
	services, and Docker applications to be started and listener-verified before
	completion.
- [x] Omit completion activity for answer-only turns with no tool execution.
	Tasks that used commands, file tools, MCP, or other tools retain their outcome
	card. `Task completed with errors` stores the concrete errors in its collapsed
	detail so the arrow reveals them.
- [x] Add contract tests, frontend type/browser checks, backend build checks,
  launcher smoke, and exact human test steps for the complete workspace flow.

Acceptance criteria:

- A new session accepts a prompt immediately in the default root without a
  folder dialog.
- The root selector can explicitly switch to another project and shows both the
  selected root and detected Git root when they differ.
- A corrected sent prompt can be edited and rerun without silently rewriting
  persisted history.
- The File Changes panel matches the repository working tree and shows the
  responsible model/lane when Klerm observed the write.
- A user can inspect a diff, open a text file, edit and save it, and see Git state
  refresh without granting arbitrary filesystem access.
- Installed allowlisted editors can open the selected project; unavailable
  editors produce a clear non-destructive status.
- The desktop session panel can collapse to a square rail or be dragged wider;
  File Changes is a small chip without an extra rule under it, and its open
  panel can be dragged; the bottom panel sits below the model selectors.

Status: **implemented; human flow verification remains**. The typed backend,
frontend type/browser checks, focused RPC tests, offline backend build, and Linux
`klermapp` startup smoke pass. File attribution is stored as privacy-safe custom
session metadata and restored when a session is rebound. Do not mark this
milestone complete until the UI and one real model write are tested manually.
The command console is writable; full PTY emulation remains explicitly deferred.

Human test steps:

```bash
mkdir -p /tmp/klerm-workspace-smoke
git -C /tmp/klerm-workspace-smoke init
git -C /tmp/klerm-workspace-smoke config user.email klerm@example.invalid
git -C /tmp/klerm-workspace-smoke config user.name "Klerm Smoke"
printf 'before\n' > /tmp/klerm-workspace-smoke/smoke.txt
git -C /tmp/klerm-workspace-smoke add smoke.txt
git -C /tmp/klerm-workspace-smoke commit -m initial
printf 'after\n' > /tmp/klerm-workspace-smoke/smoke.txt
cd /tmp/klerm-workspace-smoke
/home/abro/Desktop/Klerm/harness/klermapp
```

1. Confirm the app opens, shows the smoke project and Git root, and lists
	`smoke.txt` as an external unstaged change. No redundant `Backend connected`
	label or Klerm backend process card should appear.
2. Open `smoke.txt`; confirm Diff shows `before` in red and `after` in green.
   Open Edit, change the text, save, and confirm the actor badge becomes
   `manual` while Git state refreshes.
3. Select an installed editor from Open and confirm the project opens. Confirm
   missing editors remain disabled. Vim launching is supported on Linux through
   `x-terminal-emulator` only.
4. Send a prompt, click Edit on the sent prompt, change it, then use
   `Save & rerun`. Confirm both prompts remain in the transcript. During an
   active task, confirm the corrected prompt is prepared but not submitted.
5. With a configured model, ask it to edit `smoke.txt`. Confirm the refreshed
   actor badge shows its lane and provider/model. Reopen the session and confirm
   the attribution remains.
6. Confirm File Changes is a small chip under the topbar line on the right.
	Drag the session divider to widen or collapse the left rail. After sending a
	prompt, Terminal/Running/Logs appears collapsed below the model selectors.
	A command approval opens an inline Running card rather than a screen overlay.
	Click a session title to rename it. Delete opens a centered confirmation card.
7. Click New session and confirm no folder dialog opens. Use the center root
   selector and confirm that explicit action opens the folder dialog and starts
   the selected project.

Known limitations: the built-in editor accepts existing text files up to 2 MiB;
binary files, new-file creation, and paths outside the detected project root are
rejected. Listener discovery uses Linux `ss` plus `/proc/<pid>/cwd` filtering
and Docker Compose's published-port status.
Terminal commands each use a fresh shell, so `cd` and exported variables do not
persist into the next command; interactive/full-screen PTY programs are not yet
supported.

### App Milestone 2B - MCP picker and rich response formatting

Goal: make MCP use discoverable in the desktop composer and make structured
assistant output readable enough for everyday project work, without parsing CLI
text or exposing credentials.

Implementation checklist:

- [x] Add typed desktop RPC for MCP status. The response must include server
  name, transport, connected/connecting/failed/closed state, enabled/disabled
  configuration, exposed tool names, skipped tool names, and privacy-safe error
  text. It must never include environment values, request headers, API keys, or
  OAuth tokens.
- [x] Add typed desktop RPC for adding or updating MCP server definitions.
  Support stdio, Streamable HTTP, and SSE fields that match the CLI `/mcpset`
  semantics. Stdio positional args can contain local credentials and are stored
  in plaintext settings; HTTP/SSE secret URLs and headers remain rejected.
- [x] Add a typed reload operation or explicit restart-required state after MCP
  changes so the desktop can refresh exposed tools without scraping CLI output.
- [x] Add a bottom-left MCP status control anchored beside the session sidebar.
  The compact display is a check/warning/error dot plus `MCP <tool-count>`. Green
  means at least one connected MCP tool, amber means MCP is configured but no
  connected tool is available, red means at least one configured server failed,
  and gray means no MCP server is configured.
- [x] Add an MCP popover opened from the status control. It lists current
  servers, their state, and exposed tools, then shows an `Add more` action at the
  bottom. The popover must fit compact and short desktop windows without hiding
  the composer.
- [x] Add an `Add more` form in the popover. Minimum fields: name, transport,
  command or URL, optional arguments for stdio, and optional non-secret headers
  for HTTP/SSE only if they pass the same credential-safety checks as CLI setup.
- [x] Add composer MCP completion. Typing `@` opens suggestions for connected MCP
  tools, typing more text filters by server/tool name, Tab or Enter inserts the
  selected tool reference, and Escape closes the suggestions. Insertion should
  produce normal prompt text such as `Use MCP tool mcp_server_tool`, so the
  existing backend tool-selection rules remain the source of truth.
- [x] Keep file `@` autocomplete separate if/when desktop file autocomplete is
  added later. Until then, desktop `@` completion is MCP-only and documented as
  such.
- [x] Render MCP tool activity as blue cards in the existing activity feed. The
  card label should say `MCP used`, the title should show `server / tool` when
  known, and errors should switch to the red error card style while preserving the
  same event order.
- [x] Improve assistant message formatting for structured web/app build reports.
  Markdown-lite rendering should cover headings, bullet/numbered lists, tables,
  inline code, fenced code blocks, file paths, and file-summary tables such as
  `index.html`, `styles.css`, and `script.js`. Do not use raw HTML injection;
  parse to safe Svelte-rendered blocks.
- [ ] Add focused frontend helpers/tests for MCP suggestion filtering, insertion,
  safe response-block parsing, and file-summary formatting. RPC contract tests
  now cover MCP status, MCP add/update validation, secret-header rejection, and
  reload state.

Acceptance criteria:

- The bottom-left MCP control accurately shows the number of currently exposed
  MCP tools and the highest-severity state color.
- Clicking the control opens a small, readable popover with current MCP servers,
  tools, failures, and an `Add more` path.
- An MCP server can be added from the desktop, refreshed or marked
  restart-required, and then appears in the MCP status list.
- Typing `@` in the composer lists connected MCP tools; Tab or Enter inserts the
  intended namespaced tool reference into the prompt without submitting it.
- When a prompt uses an MCP tool, the activity feed shows a blue `MCP used` card
  in order with the rest of the task activity.
- Assistant responses that contain file tables, lists, and code snippets render
  as readable formatted blocks instead of one flat paragraph.
- Compact-width and short-height windows keep the MCP popover, suggestions, and
  composer usable without covering Send/Stop controls.

Status: **implemented; human smoke pending**. Checkpoint 2026-09-02: backend
typed RPC commands `get_mcp_status`, `add_mcp_server`, and `reload_mcp_servers`
are implemented with credential-safe validation. The desktop sidebar shows MCP
status and an `Add more` popover, the composer supports `@` MCP suggestions with
Tab/Enter insertion, MCP tool events render as blue `MCP used` cards, and
Markdown-lite now renders tables/file-summary cards without raw HTML injection.
Verified by `npm run check`, desktop Svelte typecheck, and the focused RPC
contract test. Remaining checkpoint: add focused frontend unit tests or a Svelte
component test harness for picker/filtering/formatting behavior, then complete
the human smoke steps below.

Human test steps:

```bash
cd /tmp/klerm-workspace-smoke
/home/abro/Desktop/Klerm/harness/klermapp
```

1. Confirm the bottom-left MCP control appears next to the session sidebar and
   shows `MCP 0` or the current connected tool count.
2. Configure one credential-free MCP server through `Add more`, reload if the UI
   asks for it, and confirm the status changes to green with the new tool count.
3. Click the MCP control again and confirm the popover lists the server, state,
   and tool names without showing secrets or headers.
4. In the composer, type `@`, type part of a server or tool name, press Tab, and
   confirm the prompt receives a `Use MCP tool ...` reference without submitting.
5. Submit a prompt that asks Klerm to use the selected MCP tool. Confirm the feed
   shows a blue `MCP used` card and any error appears as a red card.
6. Paste or generate a response containing a `Files Created` table with
   `index.html`, `styles.css`, and `script.js`; confirm the assistant response
   renders as formatted blocks/cards with readable code and table styling.

Known limitations: secure credential storage remains deferred. Credential-bearing
stdio args are allowed for local MCP processes but are plaintext settings, not a
keychain-backed secret store. The first MCP completion implementation inserts
plain prompt text rather than rich chips so it remains compatible with existing
backend prompt handling. File autocomplete with `@` is intentionally deferred to
avoid mixing two different suggestion sources before MCP selection is stable.

### App Milestone 2C - MCP popover visibility, mentions, and appearance

Goal: make the desktop MCP control usable in the real sidebar layout, let `@`
discover configured servers by display name, and show each MCP with a chosen
color and name in the prompt.

User-reported problems:

- Clicking MCP clips the popover against the session sidebar, so the first rows
  and `Add more` are hard to see.
- Typing `@` in the composer does not reliably surface MCP servers, especially
  when the display name contains spaces such as `google maps`.
- There is no way to assign a human name and color, so `@google maps` cannot
  render as a green, slightly bolder mention.

Implementation checklist:

- [x] Reposition the MCP popover with a document-body portal and `position:
  fixed` anchored to the MCP button, opening to the right of the sidebar instead
  of inside the sidebar's `overflow-hidden` box.
- [x] Keep a sticky header (title, state, Refresh) and sticky footer (`Add
  more`, Save, Cancel) so those actions remain visible while the server list
  scrolls.
- [x] Close the popover with Escape and outside click. Compact/short windows
  must not cover Send/Stop.
- [x] Persist optional MCP `label` and `color` through `add_mcp_server` and
  return them from `get_mcp_status`. Server ids stay `[A-Za-z0-9_-]+`; labels
  may contain spaces. Colors are an allowlist: base, green, blue, amber, red,
  purple, teal. Omitted colors persist as gray `base`, including MCPs created by
  the AI.
- [x] Add display-name and color fields to the desktop `Add more` form.
- [x] Open composer `@` suggestions for configured servers, not only connected
  tools. Allow spaces in the query so `@google maps` matches a label.
- [x] Insert `@Display Name` or `@Display Name/tool` tokens in the composer.
  Overlay those tokens in the server color at semibold weight. Expand to
  `Use MCP server <id>` or `Use MCP tool <name>` only when sending to the
  backend; the visible transcript keeps the `@` mention.
- [x] Add focused tests for appearance RPC validation and mention
  filter/insert/expand helpers.
- [x] Anchor the portaled MCP panel above its MCP button and constrain scrolling
  to the panel body so the header and add/save controls remain unobstructed.
- [x] Use each MCP color for tinted picker, server, mention, and activity-card
  backgrounds. Keep the transport select and its options on the dark app surface.
- [x] Render sent user mentions with their MCP color and identify tool activity
  as `<server-id> MCP called` with the server display name and remote tool.
- [x] Let the AI continue creating credential-free MCP servers through
  `configure_mcp_server`; new desktop, CLI, and AI-created servers without an
  explicit color use gray `base`, while AI updates preserve existing appearance.
- [x] Allow desktop-created stdio MCP args to contain local credentials such as
  database URLs, keep HTTP/SSE secrets rejected, and redact common credential URL
  forms from MCP status and tool-failure text.

Additional follow-up plan (not required to close 2C):

- File Changes now starts at 280px. Plan/Build stays open until Escape or
  outside click. MCP Add more uses one name field and slugs it to the server id.
  Builder `configure_mcp_server` asks a dedicated approval and reloads MCP after
  the task settles.
- Edit label/color on an already saved server without re-entering command/URL.
- Add an explicit Reload control in the popover header when `reloadRequired`.
- Enable/disable or remove a server from the same popover.
- Keep file `@` autocomplete deferred until MCP mentions stay stable.
- Preserve `@` display names when editing/rerunning a sent prompt.

Acceptance criteria:

- Clicking MCP opens a fully readable panel beside the sidebar. Header, server
  rows, and `Add more` are visible.
- A server can be saved with id `google-maps`, label `Google Maps`, and color
  green.
- Typing `@` lists that server; `@google maps` filters to it; choosing it
  inserts a green, slightly bolder `@Google Maps` token.
- Sending the prompt expands the mention for the model without showing secrets.
- Compact sidebar/rail layouts still keep the popover on-screen.

Status: **implemented; human smoke pending**. Checkpoint 2026-09-07: the MCP
popover is anchored above its button with body-only scrolling and persistent
Refresh/Reload/`Add more` controls. Servers persist optional `label` and a
seven-value color including gray `base`; all creation paths default to `base`.
Composer suggestions, live mentions, sent user mentions, server rows, and MCP
activity cards use the selected tinted background. Model-facing mentions expand
to identify the called server and tool while the visible prompt keeps its
colored `@Display Name` token. Desktop stdio MCP args may contain local
credential strings and are stored in plaintext settings; HTTP/SSE secrets stay
rejected. The stale sidecar mismatch (`Unknown command: get_mcp_status`) remains
guarded by handshake capabilities and `klermapp` rebuilds
`coding-agent/dist/rpc-entry.js` from a source checksum. Remaining: run the human
smoke steps below.

Checkpoint 2026-09-08: composer MCP mentions now travel through RPC as
structured server/tool selections in addition to the visible prompt text. The
backend resolves every selection against the live MCP runtime and the active
agent's exposed tools, rejects disconnected, stale, tool-less, or Plan-role
incompatible selections before model execution, and gives the model an exact
mandatory-use block for each selected server. Every configured MCP server and
its exact connected tool names are also included in a credential-free system
inventory. This applies to any configured MCP, not a provider-specific
integration. Builder agents retain the approved `configure_mcp_server` tool;
desktop reload continues automatically after the configuring task settles.
Focused mention, runtime, RPC, and profile persistence/injection tests pass;
real-model MCP invocation and profile-behaviour smoke testing remain required.

Human test steps:

```bash
cd /tmp/klerm-workspace-smoke
/home/abro/Desktop/Klerm/harness/klermapp
```

1. Click MCP. Confirm the panel sits beside the sidebar, not under it, and that
   Refresh plus `Add more` stay visible.
2. Add a server with id `google-maps`, display name `Google Maps`, and green.
   Save/reload if asked.
3. Type `@` in the composer and confirm `Google Maps` appears. Continue typing
   `google maps` and confirm it still matches.
4. Select it and confirm the prompt shows a green, bolder `@Google Maps` token
   without submitting.
5. Send a prompt using that mention. Confirm the model receives an expanded MCP
    instruction and the feed still shows the `@` mention.

### App Milestone 2D - Settings shell, models, MCP, and memory personas

Goal: add a desktop Settings view as the next Linux app step after MCP 2C.
Settings is a full workspace replacement with a top tab navbar, not a sidebar
popover and not a new browser window.

This is the current implementation priority. Do not start App Milestone 3 until
the Settings shell and first working tabs are usable.

Layout:

- Add a settings gear control at the top-left of the session sidebar, beside
  the Klerm logo. The collapsed square rail must keep a matching icon.
- Opening Settings replaces the center workspace (feed + composer). Session
  list, draft, feed, and routing state stay in memory and must not reset.
- The Settings header is a full-width horizontal tab navbar. The selected tab
  content fills the area below it and scrolls independently.
- Close Settings with the same gear (toggle), Escape, or an explicit back-to
  workspace control. Returning must restore the previous conversation and draft.
- Compact windows keep the tab row horizontally scrollable. File Changes and
  the bottom Terminal/Running/Logs panel stay hidden while Settings is open.

Tabs for the first Settings surface:

1. General
   - Backend readiness, Klerm/RPC version, workspace root, and config path
     (`~/.klerm/agent/`).
   - Appearance preference: Dark, Light, System. Persist the choice through
     typed backend settings. Do not implement a light theme or apply System
     in this milestone; the control is user preference storage only.
2. Models
   - List discovered and configured models the same way the CLI `/model` path
     does: built-in catalogs, local runtimes, and custom `models.json` entries.
   - Add, edit, and remove custom models (`provider/id`, display name, `api`,
     `baseUrl`, optional non-secret headers). Credential values stay out of
     frontend logs and decision events.
   - Assign Agent 1 and Agent 2 from this tab using the existing
     `set_klerm_config` path. Selecting the same `provider/id` for both remains
     rejected.
3. Shortcuts
   - Show a read-only keyboard shortcut table for desktop actions. Persist
     future binding names if needed, but do not honor custom bindings yet.
4. MCP
   - Show every configured MCP server, state, tools, label/color, Refresh,
     Reload, and Add more. Reuse the existing credential-safe RPC. One name
     field continues to slug the server id.
5. Memory
   - Users can create multiple named profiles. Faces come from a built-in small
     character set only (no custom avatar creator).
   - Each profile stores name, face, level, behaviour, work plan, plan-mode and
     build-mode prompts, and a memory format (`md` default, `html` optional).
     Legacy memory text and README migrate onto behaviour and work plan.
   - Built-in Scout (L1) and Sage (L3) profiles ship with default prompts;
     every field stays editable.
   - The Memory tab lists collapsed profiles with an arrow. Opening one shows
     only that profile with a Back control; Delete appears only when open.
   - Profile text is editable in Settings. Builder agents may update a
     profile's behaviour, work plan, or mode prompts through an explicit tool
     after approval.
   - The composer shows a profile control to the left of each Agent 1 and
     Agent 2 model selector (built-in face icon plus name). Selecting a profile
     assigns that personality and memory to that agent.
    - Assigned profile name, face, behaviour, work plan, and the active
      role's mode prompt are injected into that agent's identity prompt.
   - Shared task memory is persisted separately from profiles and injected into
     both lanes. Builder agents can update it through an approved backend tool;
     viewing and editing it in this tab remains to be implemented.

Implementation checklist:

- [ ] Add `workspace | settings` view state in `App.svelte`. Settings must not
      destroy the live session or start a new backend.
- [ ] Add `SettingsView.svelte` with a top tab navbar and one content pane.
- [ ] Place the settings gear beside the sidebar Klerm logo and on the collapsed
      rail.
- [ ] Persist General appearance preference without applying a light theme.
- [ ] Add typed RPC for listing/adding/updating/removing custom models that maps
      onto `~/.klerm/agent/models.json` without exposing secrets.
- [ ] Render Shortcuts as documentation-only rows.
- [ ] Move MCP management into the MCP tab while keeping the sidebar MCP status
      control for connected-tool count.
- [x] Add a Memory tab for creating/editing profiles with built-in faces,
      behaviour, work plan, plan/build mode prompts, and md/html format.
      Ship Scout/Sage defaults and an accordion list with Back and
      open-only Delete.
- [ ] Add a composer profile picker left of each Agent 1/Agent 2 model control.
- [ ] Inject the assigned profile into that agent's identity prompt and let
      builder update memory through an approved tool.
- [ ] Hide composer, File Changes, and the bottom panel while Settings is open.
- [x] Show `Back` in the Settings header while global drafts are unchanged.
      Replace it with `Save Settings` only after appearance, delegation-cycle,
      or shortcut drafts differ; Discard restores the Back state.
- [ ] Add focused tests for settings view state, model CRUD validation, and
      appearance-preference persistence. Add exact human smoke steps.

Acceptance criteria:

- Clicking the gear beside the Klerm logo opens Settings with the tab navbar
  visible across the top and content below.
- Switching tabs does not restart the backend or change the active session.
- Returning to the workspace restores the same conversation, draft, and MCP
  mentions.
- Custom models added in Settings appear in the Agent 1/Agent 2 selectors and
  in CLI `/model` after reload where required.
- Dark/Light/System can be chosen and persists across app restart, but the UI
  stays on the current dark theme.
- Shortcuts are visible and not active.
- MCP servers already configured remain listed and editable from the MCP tab.
- Memory can create profiles with built-in faces, persist behaviour/work
  plan/mode prompts, and assign a profile beside each agent model selector.
- Compact and short windows keep the tab navbar and back control usable.
- `npm run check` and the focused tests pass before human smoke.

Status: **implemented; human smoke pending**. Checkpoint 2026-09-08: Settings opens from a top-left gear. Collapsed rail uses the K mark and has no expand arrow. General contains the appearance controls and the persisted 3-100/Unlimited delegation-cycle slider. Models is a provider card grid plus custom-model overlay. Shortcuts are a two-column chord grid with conflict highlighting. Save Changes replaces Back. Profiles appear when hovering a model in the Agent 1/2 dropdown; clicking a model alone clears the profile. Memory profiles store behaviour, work plan, plan/build mode prompts, and md/html format with Scout/Sage defaults; the tab is an accordion with Back and open-only Delete.

Checkpoint 2026-09-10: the full repository check, desktop Svelte typecheck,
browser smoke, and focused desktop RPC contract tests pass. Automated 2D
verification is closed. Provider login, persisted appearance/profile interaction,
and real desktop model assignment still require the human steps below before the
milestone can be marked completed.

Checkpoint 2026-09-12: Settings persistence now awaits every changed backend
operation and reports partial failures instead of showing a false success. Agent
discovery refreshes preserve unsaved drafts. External-agent opt-in remains
setup-only until native adapters exist, but it no longer disables built-in Klerm
prompting. General, Agents, and composer summaries use compact Opt in/Opt out
controls with Claude Code and Codex marks. Focused desktop tests and the full
repository check pass; the interaction still requires the human steps below.

Human test steps:

```bash
cd /tmp/klerm-workspace-smoke
/home/abro/Desktop/Klerm/harness/klermapp
```

1. Confirm a gear appears beside the Klerm logo. Open it and confirm the chat
   composer is replaced by Settings with tabs across the top.
2. Switch General, Models, Shortcuts, MCP, and Memory without losing the
   previous session. Close Settings and confirm the draft/conversation return.
3. On General, choose Light or System, restart the app, and confirm the
   preference is still selected while the UI remains dark.
4. Set Max delegation cycles to 100, save, reopen Settings, and confirm 100 is
   retained. Move the slider to Unlimited, save, and confirm Unlimited is retained.
5. On Models, add a credential-free custom model, assign it to Agent 1, and
   confirm it appears in the composer selector.
6. On Shortcuts, confirm the list is visible and that pressing a listed chord
   does not change bindings yet.
7. On MCP, confirm existing servers appear and Add more still works.
8. On Memory, confirm Scout and Sage ship with filled Behaviour, Work plan,
   Plan mode, and Build mode texts. Open one with the arrow, confirm only it
   shows with Back and Delete, edit a field, and assign it beside Agent 1 in
   the composer to confirm the icon plus name appear.

Known limitations: light theme rendering, live shortcut customization, and
custom avatar creation are explicitly deferred past this milestone.

### App Milestone 2E - Image attachments and generation

Goal: let desktop tasks inspect attached images and display images produced by
tools without adding a frontend provider or secret path.

- [x] Add a `+` control beside the task description with multi-image selection,
  previews, individual removal, and image-only submission.
- [x] Send image content through the existing typed prompt RPC and independently
  validate count, decoded size, base64, MIME allowlist, and file signature in
  the backend before normalization and resize.
- [x] Restore user and tool-result images from persisted sessions and render
  them inline with download/open actions.
- [x] Add a Builder-only `generate_image` tool using the inherited OpenRouter
  image API, backend provider authentication, abort signal, usage, and normal
  tool-result persistence.
- [x] Ensure manual task cancellation displays exactly `Task stopped` even when
  the backend also reports a failed outcome.

Status: **implemented; human smoke pending**. Automated image validation,
generation-tool, desktop helper, RPC contract, browser-smoke, and Svelte
typechecks pass. Image generation currently uses
`google/gemini-2.5-flash-image` through a configured OpenRouter account; a
dedicated image-model selector and image editing are deferred.

Checkpoint 2026-09-10: the full repository check and focused image-extension,
image RPC, and desktop RPC contract tests pass. Automated 2E verification is
closed. Real model image inspection, persisted replay in the packaged desktop,
and OpenRouter generation still require the human steps below.

Human test steps:

1. Start `klermapp`, click `+`, select multiple supported images, remove one,
   and submit text plus images. Confirm the sent message shows the images.
2. Submit an image without text and confirm the selected model can inspect it.
3. Reopen the session and confirm attached images remain visible.
4. With OpenRouter configured and the active agent in Build mode, ask Klerm to
   generate an illustration. Approve the tool if requested and confirm the
   result appears inline and can be downloaded.
5. Stop an active task and confirm the completion card reads exactly
   `Task stopped`.

### App Milestone 3 - Agent bridge setup

Goal: make two independent coding harnesses easy to discover, configure, and
use through one Klerm backend before enabling agent-to-agent conversation.

Product rules:

- Klerm plus discovered Pi, Claude Code, Codex, OpenCode, and Cline are selectable harnesses for a dynamic stable-ID
  agent registry that starts with Agent 1. Agent configuration is not permanently
  tied to local/frontier model lanes; runnable Agent 3+ slots participate
  sequentially after the coordinator rather than writing concurrently.
- General has one `Connect to external coding harnesses` On/Off switch. When it
  is Off, prompts use the normal Klerm path and no external harness receives
  them. When it is On, the Klerm backend acts as the orchestrator and forwards
  accepted prompts to the enabled configured agent or agents.
- Each agent has its own On/Off control. Turning an agent Off excludes it from prompting and
  routing without deleting its harness, model, authentication, profile, or
  native-session configuration. Turning it On makes it eligible again after
  backend health validation.
- The CLI remains one chat. It does not split into terminal panes. It starts
  with Agent 1; `/add` creates the next stable number, `/remove agent N` does not
  renumber survivors, `/view agent N` shows complete setup, and `/agent N`
  configures harness, model, role, effort, tools, and On/Off state.
- The desktop is the visual two-agent workspace. It will show Agent 1 and Agent
  2 side by side, while a combined chronological view remains available.
- Both surfaces use one typed backend contract, one persisted slot
  configuration, and the same deterministic event order. The desktop never
  parses human-readable CLI output.
- Each external harness keeps its own authentication, model selection, tools,
  memory, context policy, and native session. Klerm stores only credential-safe
  setup and native-session references.

Implementation stages:

1. Harness setup and discovery
   - Persist a dynamic registry with Klerm as the default Agent 1 choice.
   - Detect the built-in Klerm runtime and probe `claude` and `codex` without a
     shell, using fixed version arguments, bounded output, and a timeout.
   - Add an Agents Settings tab with dynamic cards, availability/version
     state, Refresh, and an Advanced executable override.
   - Persist harness, model, role, effort, tools, and enabled state independently
     for each agent. A configured but Off agent stays visible and retains its setup, but the orchestrator must never
     send a prompt to it.
   - Do not infer authentication from executable discovery and do not claim a
     native session is connected before a real adapter starts it.
2. Shared adapter contract
   - Define versioned adapter descriptor, capability, health, native-session,
     prompt, reply, artifact, cancellation, and error types.
   - Add a deterministic fake adapter and conformance tests before real external
     processes are connected.
   - Add a Pi/Klerm reference adapter over the existing `AgentSession`; do not
     duplicate its model, profile, MCP, memory, image, tool-policy, or workspace
     verification behavior.
3. External adapters
   - Implement Codex first when its machine-readable protocol passes a focused
     feasibility check, then Claude Code against the same conformance suite.
   - Start, prompt, stream, stop, reconnect, and dispose native sessions without
     scraping terminal UI text.
   - Launch native authentication when required, but never copy its secrets into
     Klerm settings or frontend events.
4. CLI and desktop control
   - Route the numbered `/agent N` setup syntax to the
     shared adapter controller. Existing model commands remain compatibility
     controls for a Klerm agent.
   - Add typed RPC for discovery, slot updates, health, start, stop, reconnect,
     and native-session status with handshake capability negotiation.
   - Add setup presets for Klerm + Claude Code, Klerm + Codex, and Codex +
     Claude Code. Detailed command/path controls stay under Advanced.

External harness enablement and routing:

- The General switch is the master gate. `Off` means no external orchestration
  and the existing Klerm prompt path remains active. `On` means the backend uses
  the enabled slots as the available worker set.
- Every slot has a visible On/Off switch. `On` means the agent may receive the
  user prompt or an orchestrator handoff. `Off` means it receives nothing and
  cannot be selected by routing.
- Keep the existing Direct, Agent 1, Agent 2, Agent 2 to Agent 1, and Auto
  routing control visible below the composer. The external master gate controls
  whether harness chips are shown; it does not erase or replace Klerm routing.
- When the master gate is On, show every configured agent as a compact harness
  chip above the prompt. The first two agents receive model controls below the
  composer, while later agents expose model and harness controls from their
  chip. New agents start enabled with Klerm and use stable increasing IDs.
- If a selected harness becomes unavailable, the backend marks that slot
  inactive before routing. The UI shows why the effective mode changed from
  `Auto` to `None` instead of silently sending work elsewhere.
- Klerm remains the orchestrator even when neither visible worker is Klerm, for
  example Codex + Claude Code or Codex + Codex. It owns ordering, routing,
  cancellation, limits, and deterministic logs, while each harness owns its
  native session and authentication.

Safety rules:

- Two agents may inspect and reason over one workspace concurrently.
- Only one Builder may write to the main workspace at a time.
- Two concurrent Builders require isolated Git worktrees, separate diffs,
  conflict detection, successful verification, and explicit integration.
- Non-Git projects do not allow two concurrent writers in the first release.
- Timeout, cancellation, turn/budget limits, and process cleanup are backend
  responsibilities, never frontend orchestration.

Acceptance criteria:

- A new user can detect and assign installed harnesses without editing JSON or
  entering executable paths in the normal flow.
- The CLI accepts the documented single-chat `/agent` commands and reports
  unavailable, setup-only, connected, stopped, and failed states truthfully.
- The desktop Agents tab shows every persisted agent and the same backend
  discovery state as the CLI.
- The General master switch and all per-agent setup states persist across app
  restart without deleting an Off agent's setup.
- With the master switch Off, no external adapter starts or receives a prompt.
- With it On and at least two healthy agents enabled, effective routing is `Auto / Agent
  1 first`; reducing the active set to one immediately changes effective routing to
  `None` and sends subsequent prompts only to the remaining active agent.
- With all agents disabled or unhealthy, Send is blocked with a clear reason.
- Pi/Klerm and one real external adapter can be started, prompted, stopped, and
  reconnected through typed backend operations.
- Adapter state and native-session references match after restart.
- Credentials, raw environment values, and private native state never appear in
  bridge logs or frontend events.
- No frontend component parses human-formatted agent terminal output.

First implementation slice acceptance criteria:

- Klerm, Pi, Claude Code, Codex, OpenCode, and Cline discovery is deterministic and testable without
  the real executables.
- Agent 1 and every dynamically added agent persist globally with stable IDs.
- The desktop Agents tab and CLI `/agent ... connect|status|disconnect` commands
  use the same setup state and explicitly report that external session bridging
  is pending until the corresponding adapter exists.

Status: **3A dynamic external harness configuration and sequential adapter bridge implemented; human smoke pending**.
Checkpoint 2026-09-13: a global stable-ID agent registry, safe built-in and
external executable discovery, typed capability-advertised RPC, a responsive
desktop Settings > Agents tab, and single-chat CLI `/add`, `/remove`, `/view`,
and explicitly numbered `/agent N` controls are implemented. `/view` chooses
from existing agents, while bare `/agent N` opens all setup categories. Harness
choices are filtered to successful fixed `--version` probes. General now
has the persisted external-harness master switch. Each slot persists its own
On/Off state, model, role, effort, and tools; changing harness clears an incompatible
model. The backend derives `Auto` for at least two available enabled agents, `None` for
one, and `Disabled` for zero or master Off. Klerm models come from the existing
runtime catalog. Pi, Codex, and OpenCode models are refreshed on harness
selection through their native non-interactive listing interfaces; discovery errors
remain visible and do not replace the last successful catalog. Claude Code and
Cline model lists remain empty until a documented native interface can report
account-specific values. When the master switch is On, the
composer shows a responsive `External Agents` summary above the prompt and
blocks Send with a concrete adapter-required reason. Focused domain, RPC,
parser, handler, autocomplete, persistence, and compatibility tests and desktop
typechecking pass. Agent 3+ configuration is not an execution claim; authentication, native session start/resume, external
prompting, and the split live response workspace remain unimplemented.

The desktop now supports at most four configured agents, reuses the smallest
free display number, and preserves array order as creation order. Agent 1 may be
removed when at least three agents are configured. Work together starts with
the earliest available configured Klerm agent and applies its saved thinking
effort. Live RPC message and tool events carry the selected stable agent ID;
the desktop uses that attribution for eye-toggleable one-to-four agent context
  views showing status, model, thinking effort, and an editable next-task
  Plan/Build role. When Work together is active,
at least one visible agent context replaces the central EmptyState and shared
feed, splitting that workspace evenly between the selected agents. Closing a
  view does not stop or remove the agent. Native OpenCode and Codex prompting is
  connected through the typed adapter bridge.

### App Milestone 3B - Unified team roles, bridge tasks, and observable handoffs

Goal: make enabled Klerm and external coding agents form one truthful runnable
team, require useful sequential collaboration for broad tasks, and make every
assignment visible without introducing concurrent workspace writers.

Implementation order and task checker:

- [x] Keep external-agent roles out of the composer. Configure each agent's
  Plan/Build role only under Settings > Agents; there is no `All Plan` / `All
  Build` override beside Send.
- [x] Keep individual role configuration under Settings > Agents. Hide the
  timed Planner-to-Builder offer in team mode and never claim an external
  harness is read-only unless its adapter enforces that role.
- [x] Derive one ordered runnable-agent roster for setup, routing, prompts, and
  desktop activity. Only master-enabled, slot-enabled, discovered,
  model-configured, adapter-capable agents may appear in an AI-visible roster or
  receive a handoff.
- [x] Add credential-safe capability metadata for each runnable agent: stable
  id, harness, model, role, adapter operations, model strength/limits, configured
  tools, and optional user-defined specialties. Mark inferred and unknown
  capability data explicitly.
- [x] Add versioned bridge task/event contracts with task, parent, correlation,
  sender, recipient, sequence, assignment reason, status, artifact, and native
  session references. Do not parse terminal-formatted output.
- [x] Replace lowest-ID external prompt ownership with deterministic sequential
  collaboration. Start one coordinator, assign one focused child task to every
  eligible peer in deterministic capability order when useful, carry prior peer
  results forward, and let the coordinator finalize all results. Keep one active
  main-workspace writer.
- [x] For broad or multi-part tasks require either a real handoff or a structured
  no-delegation reason. If a model ignores a required handoff, preserve the
  deterministically selected target instead of falling back to the legacy Agent
  2 model.
- [x] Persist append-ordered, credential-safe bridge lifecycle events to
  `.klerm/bridge-events.jsonl`, correlated with
  `.klerm/router-decisions.jsonl`, and replay them without duplicating work.
- [x] Show per-agent assigned/running/waiting/returned/failed/cancelled task
  state and handoff cards in the desktop. Show native subagents only when an
  adapter supplies structured child-task events; never infer them from prose.
- [x] Add `Clear terminal` to every visible agent panel as a UI-only output
  boundary. It must not clear the shared conversation, native session, or JSONL
  logs. Keep the separate workspace Terminal clear action.
- [x] Preserve the built-in file editor's Edit mode while selecting another
  project file and retain unsaved drafts per file until save or explicit
  discard.
- [x] Suppress the desktop webview context menu so right click cannot open
  Inspect. Treat this as product UX, not a security boundary.
- [ ] Add focused roster, bridge ordering/replay, Agent 6/7
  handoff, cancellation, task-view clear, editor-draft, and context-menu tests.
  Run desktop typecheck, focused package tests, the repository check, and a
  human two-agent smoke before marking this milestone complete.

Acceptance criteria:

- With external harnesses Off, normal Klerm routing continues to support one or
  two configured models. Three or four Klerm workers may use the same bridge
  only after they pass the runnable roster checks.
- With external harnesses On, one runnable agent receives the task directly;
  two or more runnable agents use the sequential coordinator/all-peers flow when
  the task benefits from delegation.
- Disabled, unavailable, model-less, and adapter-less agents are absent from
  every AI-visible roster and cannot receive a prompt, while their saved setup
  remains visible in Settings.
- A broad task using Agent 6, Agent 7, and additional runnable agents visibly
  records the coordinator choice, each focused peer assignment and correlated
  return, and coordinator completion in both the desktop and deterministic
  bridge log.
- Role changes are saved per agent under Settings and affect only later tasks.
- Each agent activity view can be cleared independently without losing audit
  history, and switching project files while editing does not require clicking
  Edit again or discard unsaved drafts.

Status: **automated implementation verified; human two-agent smoke pending**.
This checklist remains the implementation source of truth; the final verification
item stays open until the real desktop flow below passes.

Checkpoint 2026-09-16: the backend now derives an adapter-capable runnable
roster with explicit exclusions and inferred capability metadata. External
OpenCode/Codex prompts use a versioned sequential coordinator, all eligible
capability-ranked peers, coordinator-finalization flow for broad tasks, and record structured
no-delegation reasons for direct tasks. Focused tests prove Agent 6 to Agent 7
  multi-peer handoff and return, native coordinator session reuse, disabled-agent exclusion,
  per-agent Personal Memory and Plan/Build prompt snapshots, deterministic event
  ordering, cancellation, workspace/verification evidence, JSONL append behavior, and the
  two-agent Work together threshold. Desktop state tests cover live/replayed
  bridge card identity, per-agent output boundaries,
project-scoped editor drafts, and context-menu suppression. The full repository
check passes; a real two-agent desktop smoke is still required.

Checkpoint 2026-09-19: directed user prompts and external replies persist
explicit sender/recipient session metadata, while agent-to-agent assignments
persist the actual handoff text as ordered shared-chat entries. Per-agent views
filter that durable conversation instead of owning transient output, and legacy
sessions recover user recipients and handoff reasons from bridge events.
Bridge lifecycle cards are append-only by event sequence. External routing no
longer mutates the main Klerm routing or Plan/Build configuration. OpenCode now
starts its native `plan` or `build` agent for the configured role, providing
real edit denial in Plan mode. Focused adapter, RPC bridge, replay/filter, and
desktop tests pass; a reopened real-session smoke remains required.

Human test steps for the first slice:

```bash
cd /home/abro/Desktop/Klerm/harness
./klerm-test.sh
```

1. Run `/agent 1 status` and confirm Klerm is reported as built-in and
   configured for setup only.
2. Run `/view` and confirm only existing agents are listed. Run `/add`, then
   `/agent 2`, and confirm Harness, Model, Role, Thinking effort, Tools, On/Off,
   Status, and Remove are available.
3. Run `/agent 2 connect codex`. If Codex is on `PATH`, confirm its version and
   setup-only warning appear; otherwise confirm the command rejects it without
   changing Agent 2.
4. Run `/agent 1 connect claude code` and verify the same available/not-found
   behavior for Claude Code.
5. Run `/agent 2 disconnect`, restart the CLI, and confirm `/agent 2 status`
   falls back to the existing model status because no harness is assigned.
6. Start `./klermapp`, open Settings > Agents, and confirm Agent 1 shows the
   saved choice and detected version. Select `+ Add agent`, configure Agent 2,
   change its role, effort, and tools, then Save Changes and reopen
   Settings and confirm it persists. Resize narrowly and confirm the cards
   stack vertically.
7. In Settings > General, turn `Connect to external coding harnesses` On and
   save. Confirm the workspace shows `External Agents` above the prompt with
   both slots and the derived routing label.
8. With two available slots On, confirm the label is `Auto / Agent 1 first`.
   Turn either slot Off and save; confirm it becomes `None`. Turn both Off and
   confirm it becomes `Disabled`.
9. Confirm Send is disabled while the master switch is On and the warning says
   that a native harness adapter is required. Turn the master switch Off and
   confirm the normal Klerm composer can send again.

Setup is persisted globally in `~/.klerm/agent/settings.json`.

Human two-agent bridge test:

```bash
cd /home/abro/Desktop/Klerm/harness
./klermapp
```

1. In Settings > Agents, enable at least three installed adapter-backed agents,
   preferably Agent 6 as OpenCode and Agent 7 plus Agent 8 as Codex, choose
   models for all, and save.
2. Enable Work together, confirm each participating agent has the intended role
   under Settings > Agents, and submit a broad prompt covering frontend,
   backend, security, and tests.
3. Confirm the shared feed and agent panels show the root task moving from
   running to waiting, sequential indented peer tasks on Agent 7 and Agent 8,
   both returns to Agent 6, and final completion by Agent 6. Disabled agents must not appear in the
   coordinator roster or receive activity.
4. Confirm there is no global Plan/Build control beside Send. Change one
   agent's role under Settings > Agents after the task settles and confirm only
   the next submitted prompt uses the changed role.
5. Stop an active peer pass and confirm both the peer task and root task become
   cancelled without restarting either native session.
6. Use Clear on one agent panel. Confirm only that panel's visible output is
   cleared; the shared feed and audit log remain intact.
7. Open two project files in Edit mode, leave different unsaved changes in each,
   switch between them, and confirm both drafts remain until Save or Discard.
8. Right-click the desktop background and confirm no webview context menu opens.
9. Inspect `<workspace>/.klerm/bridge-events.jsonl`. Confirm each line has one
   ordered event with task, correlation, sender, recipient, status, reason, and
   no prompt body, model response body, environment value, or credential.

Known limitations: collaboration is sequential and allows only one active
main-workspace writer. External image forwarding is unavailable, native child agents are not shown because the
current adapters do not emit structured child-task events, and native external
sessions are not yet restored after a backend restart.

### App Milestone 3C - Shared collaboration memory

Goal: give every active external agent the same explicit task-start context
without replacing memory owned by its native harness.

- Persist one editable default shared-memory text, one active selection, and up
  to 20 globally named presets in Klerm settings. Selecting or deleting a preset
  must not overwrite the retained default. Presets contain no credentials and
  are separate from per-agent persona/profile memory.
- Generate the default context dynamically from the runnable roster at task
  start. Include stable agent id, harness, model, role, effort, availability,
  strengths, limits, tools, specialties, native-session resume support, and role
  enforcement support.
- Snapshot the dynamic roster and active user memory once when the prompt is
  accepted. Inject the exact snapshot into coordinator, peer, and coordinator
  finalization prompts. Editing memory later must not mutate an active task.
- Keep Shared Memory editing out of the composer. Let the user edit and save the
  default text, select named memories, and return to the retained default only
  under Settings > Memory.
- Show the editable Default Shared Memory first under Settings > Memory, with a
  separate `Add New Memory` action below it and saved-memory cards with active,
  select, and delete controls. Display the exact active task-start shared prompt,
  including the current runnable roster, in a read-only preview. Put individual
  agent profile context in a visually separate `Personal Memory` section and keep
  agent roles under Settings > Agents.
- Record only the selected preset id and a SHA-256 context digest in normal
  orchestration diagnostics. Full prompt/context text is allowed only in the
  explicitly enabled AI debug trace.
- Add persistence, normalization, prompt-content, task-snapshot, RPC capability,
  and desktop interaction tests.

Acceptance criteria:

- Every agent participating in one external bridge task receives byte-identical
  shared context even when the active preset changes during the run, plus its
  own task-start Personal Memory and Plan/Build instructions.
- Disabled or unrunnable agents never appear in the dynamic roster.
- The default text and presets survive restart, can be selected from Settings,
  and selecting or deleting a preset does not overwrite the retained default.
- Normal bridge logs do not contain the user-authored memory body.
- The composer has no team-wide Plan/Build action in external mode.

Status: **automated implementation verified; human external-team smoke pending**.
Checkpoint 2026-09-16: the editable default memory and shared-memory presets
persist separately through normalized Klerm settings and typed
capability-advertised RPC. Legacy custom active text migrates to the retained
default. The desktop composer has no Shared Memory editor; Settings > Memory
shows the default editor, a separate `Add New Memory` flow, and selectable
saved-memory cards. It also shows the exact active shared prompt beneath the
default editor and separates agent profiles under `Personal Memory`. External
coordinator, peer, and finalization prompts receive one unchanged task-start
roster/memory snapshot. Normal route decisions contain
only its SHA-256 digest and optional preset id. Focused persistence, prompt, and
bridge integration tests plus the full repository check pass.

Human test steps:

```bash
cd /home/abro/Desktop/Klerm/harness
./klermapp
```

1. Enable two adapter-backed external agents under Settings > Agents and assign
   each role there. Confirm the composer has no `All Plan` / `All Build` action.
2. Confirm there is no Shared Memory editor beside Send. Open Settings > Memory,
   enter a project rule in Default Shared Memory, save it, then use
   `Add New Memory` to create and select a named memory. Return to
   Default and confirm the original default text is still present. Confirm
   `Prompt used by all agents` shows the default collaboration instructions, the
   runnable agents, and the active memory text. Confirm agent profiles appear in
   a clearly separate `Personal Memory` section.
3. While that task runs, change the active memory. Confirm the active peer and
   finalizer retain the original snapshot, then submit another task and confirm
   it receives the changed memory.
4. Select the saved memory, create another one, delete the active one, and
   confirm Klerm returns to the retained default. Restart the app and confirm the
   default and remaining saved memories persist.
5. Inspect `<workspace>/.klerm/router-decisions.jsonl`. Confirm the external
   route has `sharedContextDigest` and optional `sharedMemoryPresetId`, but does
   not contain the shared-memory text.

Known limitation: presets and the active memory are global Klerm settings, not
project-scoped. Native harness memory remains separate and is not replaced.

Checkpoint - persistent Projects:

- A versioned backend registry creates `My New Project`, stores membership by
  stable session ID, assigns new sessions to the default, and keeps sessions
  when projects are deleted.
- The session sidebar supports project creation, rename, deletion, session move
  and removal. Clicking a project opens a dedicated central workspace with one
  grounded prompt, explicit AI and reasoning selection, concise summary refresh,
  and the project's resumable sessions below it. Project questions use bounded
  labeled extracts without activating source sessions and continue in the active
  project session, or the first project session when another project is active.
- Directed project prompts validate the selected runnable external agent or
  configured Klerm Agent 1/2, preserve the normal native session flow, and do not
  silently start a Work Together peer pass. The selected effort is persisted as
  that agent's next-task reasoning setting before submission.
- Legacy `klerm-projects` and `klerm-session-projects` browser state imports once
  through typed RPC and is removed only after a successful import.
- Focused registry, desktop RPC, and directed-routing tests plus coding-agent
  typecheck and desktop Svelte diagnostics pass. A final full repository check
  and human desktop smoke remain required.

### App Milestone 3D - Bounded Prompt Together iteration

Goal: let three or four runnable external agents iterate beyond one response
without allowing an unbounded autonomous loop or concurrent workspace writers.

- Add an explicit one-shot `Prompt Together` action when at least three external
  agents are runnable. Keep normal Send and the existing Work together flow.
- Temporarily assign the first agent as Planner, one capability-ranked peer as
  Builder, and all remaining peers as read-only Reviewers for the task snapshot.
- Run Planner -> Builder -> all Reviewers. A strict structured reviewer verdict
  either finalizes the task or starts a Builder repair and another review round.
- Stop after at most three review iterations. Missing verdicts count as repair;
  unresolved findings at the limit produce a failed outcome rather than a false
  success.
- Reuse native sessions when the effective role is unchanged and safely restart
  a native session when temporary role enforcement requires a role switch.
- Preserve task-start Shared Memory, Personal Memory, roster, and role snapshots,
  deterministic cancellation, Git/verification evidence, and append-only bridge
  logging throughout the workflow.

Acceptance criteria:

- Fewer than three runnable external agents cannot start Prompt Together and
  receive a concrete backend reason.
- Three or four agents visibly execute planning, implementation, review, repair,
  and finalization in deterministic order with one active writer.
- All reviewers must return `KLERM_VERDICT: APPROVED` in the same iteration to
  finalize successfully.
- Three unresolved review iterations end as failed and remain inspectable in
  `.klerm/bridge-events.jsonl`.
- Stop cancels the active child and root task without silently continuing.

Status: **automated implementation verified; human external-team smoke pending**.

Human test steps:

1. Enable three adapter-backed external agents and enter a broad task.
2. Confirm `Prompt Together` replaces Routing and normal Send remains available.
3. Start Prompt Together and confirm Planner, Builder, Reviewer, and finalizer
   activity appears in order.
4. Use a task that triggers a reviewer repair and confirm the same Builder gets
   the targeted repair before review repeats.
5. Stop during a review and inspect `<workspace>/.klerm/bridge-events.jsonl` for
   ordered child/root cancellation.

### App Milestone 3E - Workspace navigation, Personal Bots, and Kanban

Goal: turn the desktop shell into a multi-view personal orchestration workspace
without moving task execution, persistence, or scheduling policy into the
frontend.

#### Navigation and view ownership

- Add a workspace menu beside Settings in the expanded and collapsed sidebar.
- Use one explicit center-view state for Workspace, Project, Agents & Routing,
  Personal Bots, Kanban, and Settings. Opening one view closes the previous view
  without restarting the backend or losing the active session, composer draft,
  feed, or project selection.
- Keep File Changes and Terminal/Running/Logs visible only in the normal session
  workspace. Compact windows open navigation through the existing drawer.
- Agents & Routing becomes the primary surface for harness, model, role,
  reasoning, routing, native-session, and bridge status. Settings retains
  application, provider, MCP, and Shared Memory configuration.

#### Personal Bot model

- Keep reusable personality profiles separate from bot identity. A Personal Bot
  has a stable id, display name, face, profile reference, selected harness/model,
  role, reasoning effort, enabled state, and deterministic creation order.
- Persist Personal Bots in a versioned backend registry. Do not use browser
  local storage as the source of truth.
- Ship three editable defaults: Scout for research and repository discovery,
  Sage for architecture and synthesis, and Builder for implementation and
  verification. A default bot without an available model remains configured but
  visibly unavailable; it never silently falls back to another agent.
- Add typed CRUD RPC before the desktop editor. Validation must reject duplicate
  ids, missing profile references, unsupported harnesses, invalid effort, and
  oversized fields.
- Give every bot one durable, continuous conversation. The conversation owns its
  transcript, selected bot, Klerm session id, native adapter session reference
  where supported, status, task sequence, and latest work summary. Bot messages
  must not be reconstructed by parsing the normal shared session feed.
- Show a bot list and the selected bot's independent chat. The header displays
  bot name, face, harness/model, role, reasoning, availability, and native
  session state.
- When a bot is explicitly linked as an agent personality, request one bounded
  summary in the same bot personality/session after every third successful task
  completed by an agent linked to that bot. Keep immutable summary history with
  delete but no edit. Store
  completed work, decisions, changed files, verification, blockers, and next
  action. Summary failure does not change the original task outcome.
- At the next task boundary, a bot may receive bounded, labeled summaries from
  the other bots in the same project. Treat those summaries as untrusted agent
  output, enforce count/character limits, and store only digests in normal
  decision logs.
- Each Agents & Routing slot can explicitly select one Personal Bot personality
  or `None`. The stable bot id and its existing profile id are persisted on the
  slot; bot transcripts and summary text remain outside the routing session.
- Move Personal Memory/profile creation and editing from Settings to Personal
  Bots. Settings > Memory is reduced to Shared Memory, named shared presets, and
  the exact effective shared prompt preview.

#### Kanban and scheduled execution

- Add a backend-owned, versioned Kanban registry scoped to an explicit project
  and workspace root. Cards contain stable id, title, task body, selected agent,
  due time, status, creation sequence, project/session ownership, immutable
  execution snapshot, attempts, outcome, and summary reference.
- Use truthful statuses: Backlog, Scheduled, Starting, Running, Completed,
  Failed, Blocked, Cancelled, and Interrupted. Do not add Pause until an adapter
  can prove safe pause/resume behavior.
- The first board supports create, edit, assign, schedule, Run now, cancel, and
  explicit retry. A selected agent is revalidated immediately before dispatch;
  unavailable agents become Blocked and never fall back.
- Run at most one writer task per workspace. Scheduled cards always target one
  agent and never implicitly enable Work Together or Prompt Together.
- Persist an append-only `.klerm/kanban-events.jsonl` stream with card id,
  attempt id, bridge task/correlation id, sequence, status transition, selected
  agent snapshot, reason, and prompt/context digests. Do not store prompt or
  response bodies in this log.
- Phase 1 persists and edits cards without automatic execution. Phase 2 adds a
  foreground scheduler that runs only while the Klerm backend is open. Closing
  the app leaves future cards Scheduled and marks claimed/running attempts
  Interrupted; it never retries them automatically.
- True app-independent scheduling is a separate Linux-first service milestone.
  A `systemd --user` service owns the durable task ledger and local authenticated
  socket; the Tauri child sidecar cannot truthfully provide background execution
  because it terminates when the application closes.

#### Typed backend contracts

- Personal Bots: `get_personal_bots`, `upsert_personal_bot`,
  `delete_personal_bot`, conversation read/prompt/reset commands, and
  `delete_personal_bot_summary`. Agent-side bot links use the existing typed
  coding-harness slot contract.
- Kanban: `get_kanban_board`, `create_kanban_card`, `update_kanban_card`,
  `schedule_kanban_card`, `run_kanban_card`, `cancel_kanban_card`,
  `retry_kanban_card`, and `get_kanban_attempts`.
- Events: `bot_conversation_changed`, `bot_summary_updated`,
  `kanban_card_changed`, and `kanban_attempt_changed` with stable ids,
  monotonically increasing sequence, status, timestamp, and reason.
- Extend adapters with explicit native-session reconstruction before claiming
  bot conversation resume survives a sidecar restart.

Implementation order:

1. Add explicit center navigation and workspace menu.
2. Add persistent Personal Bot registry, three defaults, typed CRUD, and first
   bot-list/editor view.
3. Move profile editing into Personal Bots and leave only Shared Memory in
   Settings.
4. Add isolated bot conversations and bot-attributed task events.
5. Add same-personality post-task summaries and bounded cross-bot awareness.
6. Add explicit per-agent Personal Bot personality assignment.
7. Add persistent Kanban CRUD and manual Run now.
8. Add foreground due-time dispatch, interruption recovery, and workspace lock.
9. Add a separately supervised scheduler only after native-session recovery and
   sidecar packaging are proven.

Acceptance criteria for the first slice:

- The sidebar menu opens Personal Bots without changing the active chat session.
- Scout, Sage, and Builder exist after first start and survive restart.
- Bot create/edit/delete is backend-persisted and validated through typed RPC.
- No bot is presented as runnable unless its configured harness/model is
  actually available.
- Focused registry/RPC tests, desktop typecheck, browser smoke, and the full
  repository check pass.

Status: **first slice complete**. The sidebar workspace menu, persistent
Scout/Sage/Builder defaults, validated typed CRUD, and the initial Personal Bots
list/editor are implemented. Focused registry/RPC tests, desktop typecheck,
browser smoke, and the full repository check pass.

Current follow-up: **isolated Personal Bot chat implemented**. Agents & Routing
maps to the existing shared prompt and agent workspace and is the default view.
Personal Bots uses a vertical bot list, central private chat, compact right-side
conversation information, separate on-demand AI, model, and reasoning settings, one durable
conversation per bot, built-in Klerm model sessions, bounded previous-session
context refreshed by digest, and ordered `.klerm/personal-bot-events.jsonl`
lifecycle records. Personal Bots always run through Klerm; they do not expose a
runtime or enabled-state selector. Their sessions are tool-free so concurrent
Personal Bot chats cannot modify the workspace. Personal Bots are
discussion-only planners, and persisted builder roles migrate to planner.

Profile creation and editing in Personal Bots is now implemented through the
existing typed profile RPC. The bot configuration can create a reusable profile
or edit its behaviour, workflow, read-only guidance, reusable build guidance,
level, face, and memory format. Editing an assigned profile preserves the one
continuous bot transcript and reloads the native Klerm session with the updated
profile prompt on the next message. Model selection and reasoning effort each
have their own settings surface, remain separate from AI identity, and may
change without replacing the continuous transcript. Focused RPC tests verify
continuation after profile and reasoning updates.

Same-personality conversation summaries and bounded cross-bot awareness are now
implemented for Klerm Personal Bots. Summary generation is enabled only while a
bot is explicitly selected as an Agents & Routing personality, and runs after
every third successful normal coding-agent task linked to that bot. Summaries are immutable Markdown
records with deterministic prompt ranges, digests, and ordered create/delete
events in `.klerm/personal-bot-events.jsonl`; users can view and delete each
record but cannot edit it. On a later prompt, a bot may receive the newest
remaining summaries from at most four other bots in the same workspace, capped
at 4000 characters total and explicitly labeled as untrusted. Summary failure
does not change the completed user response. The desktop safely renders
headings, emphasis, lists, code, and tables.

Agents & Routing now owns Personal Bot personality assignment. Every agent slot
can select one bot or `None`; the backend validates the stable bot id and keeps
its profile id synchronized. Compact agent cards and Settings show the active
personality. Non-contiguous agent ids use slot-specific model catalogs, and
top-right notifications report completed bot replies outside Personal Bots and
settled agent work outside Agents & Routing.

Kanban persistence and foreground execution are now implemented. New boards
and new cards are blank: no starter cards, empty title/brief/folder, Auto
model and Auto time, scheduling off. Run and scheduling require title, brief,
and folder, and the drawer names the missing fields. The desktop supports
per-card folders, an explicit model or the current workspace model,
model-specific reasoning, automatic or custom target time, optional
first-run/repeat scheduling, drag/drop status, manual Run/Stop/Retry, elapsed
time, per-attempt history, and a live bounded activity view. Each run appends
a persistent attempt with model snapshot, provider error or result, and a
short execution checklist rendered under its own card. The backend preserves
the real provider error instead of reporting a generic empty result, runs
cards in isolated sessions outside the normal session list, persists ordered
lifecycle records in `.klerm/kanban-runs.jsonl`, dispatches due work while the
sidecar is open, reschedules repeats, and marks stale running work
interrupted after restart. Tauri development and package builds rebuild the
coding-agent sidecar before launch so the typed Kanban RPC cannot silently lag
behind the frontend. True app-independent/background scheduling and a durable
workspace-wide writer lock remain later milestones.

### App Milestone 3b - Browser Agent workspace

Goal: after the persistent Kanban workflow is proven, let a selected Klerm
agent use a visible, dedicated Chromium browser for research and browser tasks
without turning the Tauri webview into an uninspectable automation target.

- Use the open-source `browser-use/browser-use` Python library under MIT as the
  first autonomous browser-agent runtime. Pin its package and Python runtime
  versions, and launch it as a separate worker owned by the Klerm backend.
- Communicate with that worker over a Klerm-defined JSONL protocol. Python owns
  the browser-use `Agent` and headed Chromium process; the TypeScript backend
  owns task identity, cancellation, approvals, event ordering, and audit logs.
- Do not use the Tauri webview as the automated browser. It is platform-native,
  not a portable Chromium target. Do not add CEF in this milestone: its native
  integration, packaging, Chromium security updates, and third-party notices
  are not justified for the first browser workflow.
- Build a sessionless Browser Task UI first. It replaces the normal session rail,
  project list, Files panel, and normal composer while open. It provides a task
  prompt, agent/model selectors, AI response area, browser preview, stop control,
  and left/center/right prompt placement. Closing it discards the UI transcript;
  it must not create or modify a Klerm chat session.
- Add a backend-owned typed RPC contract only after that UI is reviewed. Commands
  cover availability, launch, attach, close, navigate, inspect, screenshot,
  click, fill, select, keypress, download, and stop. The Svelte UI never talks
  directly to Chromium.
- Every browser run and action carries browserRunId, taskId, correlationId,
  agentId, ordering sequence, reason, status, and timestamp. Append ordered,
  credential-safe events under the active workspace `.klerm/` directory.
- Browser use requires a trusted workspace and explicit Browser Agent enablement.
  Navigation to a new origin, upload, download, form submit, account-changing
  action, purchase, publish, delete, clipboard read, and credential handling
  require explicit approval. Allow-once and current-run domain allowance are the
  initial choices; no domain trust is persisted in the first implementation.
- Configure the first browser-use worker for read-oriented tasks and expose its
  documented step hooks, action history, final result, pause, and cancellation
  through normalized Klerm events. Add state-changing browser actions only
  behind the approval contract. Do not bypass CAPTCHA, anti-bot, paywall, or
  other access controls.
- Stagehand or direct Playwright may be evaluated later for deterministic browser
  tools, but they are not the selected first autonomous runtime. Do not embed
  AGPL browser-agent projects such as Skyvern.

Acceptance criteria:

- A user can write a temporary browser task, select an available agent/model,
  choose left/center/right prompt placement, and review the response/browser
  layout without starting a browser in the UI-only slice.
- The subsequent backend slice can launch a visible dedicated Chromium window,
  return its URL/title/screenshot metadata, and close it cleanly.
- Browser actions are deterministic, inspectable, ordered, and credential-safe.
- Sensitive browser actions cannot execute without the specified approval.
- Browser crash or stop leaves a truthful run state and does not affect existing
  Klerm sessions or unrelated agent tasks.

Status: **UI foundation implemented; browser runtime not started**. The Browser
Task view is ephemeral, hides the normal session/project/file surfaces, offers
agent/model and left/center/right layout selection, and clearly labels its local
preview response. It does not create a Klerm session or launch Chromium.

### App Milestone 4 - Continuous two-agent conversation

Goal: let two coding agents keep prompting and replying to each other through
Klerm until they reach a verified result or a deterministic stop condition.

- Keep one composer. In `Auto`, the backend starts with Agent 1 and orchestrates
  Agent 2 when needed. In `None`, the prompt goes directly to the only enabled
  agent without an agent-to-agent handoff.
- Keep one chat in the CLI, using target commands rather than terminal panes.
- In the desktop, provide a `Split` view with one live column per agent and a
  `Combined` view ordered by backend sequence.
- Each desktop column shows its harness, health, native session, streaming
  response, tool/file activity, artifacts, and Stop/Reconnect actions when the
  adapter exposes those capabilities.
- Add a shared collaboration thread with explicit sender and recipient labels.
- Show queued, delivered, accepted, replied, failed, and cancelled states.
- Display handoffs and artifact references inline.
- Show conversation turn/time/budget limits and stop either agent or the task.
- Keep all sequencing and limits in the backend.
- Replace the fixed coordinator-peer-finalizer recipe with typed agent-authored
  directed messages. An agent may ask the other agent a question, request a
  review or implementation, return an artifact, challenge a result, or declare
  completion; Klerm validates and delivers the request instead of inventing a
  semantic route from prose.
- Require every directed message to carry task id, parent/correlation id,
  sender, recipient, monotonically increasing sequence, message kind, reason,
  and expected response kind. Log accepted and rejected delivery decisions.
- Continue each participant's existing native session so follow-up prompts retain
  native harness context. If resume is unavailable, stop truthfully instead of
  silently starting an unrelated replacement conversation.
- End the loop on explicit verified completion, user stop, adapter failure,
  timeout, maximum turns, token/cost budget, repeated-message detection, or no
  progress. Surface the exact stop reason in the timeline and JSONL log.
- Keep one main-workspace writer. Planner/reviewer turns may overlap only after
  read-only capability is enforced; multiple Builders require isolated
  worktrees and remain a later milestone.
- Queue user intervention at a safe turn boundary and resume the same agent
  sessions afterward; the one-minute intervention UI remains Milestone 5.
- Do not add separate Collaborate, Compare, or Parallel routing presets yet.
  Keep the first flow limited to On/Off agent participation plus `Auto` or
  `None`. Parallel writers remain disabled until isolated worktrees are active.

Acceptance criteria:

- A user can watch Agent A send a prompt to Agent B and receive its correlated
  reply.
- Agent B can issue a correlated follow-up to Agent A without a new user prompt,
  and this may repeat within configured limits.
- Both agents continue using their own native sessions, tools, and memory.
- The visible thread exactly matches the ordered backend bridge events.
- A loop that reaches its turn limit stops once, reports the reason, and leaves
  both native sessions resumable.

Status: **not started**.

### App Milestone 5 - Live user intervention

Goal: let the user briefly join an active agent conversation and then return it
to the agents.

- Add an `Intervene` action with a one-minute input window by default.
- Let the user target one selected agent or all active agents.
- Show immediate delivery or queued delivery at the next safe boundary.
- Show recipient acknowledgement and resume the existing collaboration after
  delivery.
- Keep intervention, pause, and stop visibly distinct.

Acceptance criteria:

- A user prompt entered during collaboration reaches the selected recipients in
  deterministic order.
- The collaboration continues without restarting native agent sessions.
- Expiry, cancellation, queued delivery, pause, and stop are understandable and
  recoverable from the UI.

Status: **not started**.

### App Milestone 6 - Small multi-agent workspace

Goal: expand the proven flow to three or four agents without turning the app
into a speculative graph editor.

- Show configurable agent roles and assigned task nodes.
- Show isolated worktrees for parallel writers and artifact handoffs between
  implementer, reviewer, and tester roles.
- Add per-agent intervene, pause, retry, reassign, and stop controls.
- Surface dependency and conflict state before integration.
- Preserve a readable chronological collaboration thread alongside task state.

Acceptance criteria:

- Three agents can complete separate task nodes and exchange artifacts.
- The user can follow who requested, performed, reviewed, and verified each
  change.
- Conflicting writes cannot be integrated silently.

Status: **not started**.

## 9. Testing requirements

Every app milestone must include:

- automated backend/contract tests where practical;
- exact Tauri development and build commands;
- exact UI actions for a human smoke test;
- expected visible behavior;
- expected backend and decision-log events;
- platform and model/runtime versions used;
- known limitations, mocked paths, and skipped checks.

Do not mark an app milestone complete until its implementation and human test
steps are both verified. Do not start a larger agent-team milestone until the
preceding bridge and conversation behavior works through the backend and app.

## 10. Deferred ideas

These are intentionally not scheduled. Revisit them only after the local
multi-agent bridge, conversation, intervention, and small-team flow are useful:

- cloud control plane, account synchronization, and hosted execution;
- 24/7 unattended operation;
- plugin or adapter marketplace;
- organization, billing, and multi-tenant features;
- mobile apps or a browser-hosted product;
- automatic local model downloads;
- elaborate animation before collaboration state is clear;
- Windows or macOS packaging before the revised Linux flow is stable.

## 11. Desktop decisions and open questions

- Development uses the existing JSONL stdio RPC transport with an explicit
  desktop protocol version and typed commands/events.
- The frontend was migrated from vanilla TypeScript to Svelte 5 (runes) with
  Tailwind CSS v4 and `@lucide/svelte` icons, built by Vite inside Tauri. The
  RPC bridge and domain types stay as plain TypeScript modules under `src/lib/`;
  views are Svelte components. This keeps a typed, testable core while giving
  the growing tab/inspector surface a component model.
- Klerm owns the collaboration thread and deterministic bridge events; each
  adapter owns its native agent process, authentication, tools, and memory.
- Should Codex or Claude Code be the first external adapter after Pi/Klerm?
- Should `all agents` be the default intervention recipient or require an
  explicit selection every time?
- How should a native agent acknowledge that it consumed an intervention rather
  than only receiving it?
- Should the sidecar be bundled as a single executable or launched through the
  installed Node runtime during development only?
- Which secure credential storage approach is appropriate across all three
  desktop platforms?
- Which Linux packaging formats are required for the first public release?
