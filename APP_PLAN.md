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

- Reuse the proven Klerm routing, delegation, provider, session, and logging
  behavior instead of reimplementing it in the frontend.
- Keep all routing decisions deterministic and inspectable.
- Start with the smallest useful local-only desktop flow.
- Do not block the first usable app on advanced tabs or visual effects.
- Add frontier providers and bidirectional delegation only after the local app
  path is stable.
- Store secrets in platform-appropriate secure storage and never expose them in
  frontend logs or decision events.
- Keep upstream Pi MIT attribution in the packaged app and its About view.
- Design desktop-first, but support both compact and large desktop windows.

## 3. Initial application layout

The main application should feel focused rather than like a generic dashboard.

- Center: the primary agent workspace with conversation history, streaming
  answer, tool activity, and a composer fixed near the bottom.
- Top left: Klerm logo plus a compact tab/navigation control.
- Top bar: current local model, current frontier model when enabled, routing
  mode, backend connection status, and active task state.
- Left panel: sessions at first; later it can also expose model and provider
  setup. It must be collapsible.
- Right panel: routing/delegation inspector showing the selected route, reason,
  cycle state, token usage, cost, and relevant decision events. It must be
  collapsible.
- Bottom/status area: concise runtime health, current operation, and errors.

The center workspace remains usable when both side panels are closed. A compact
window may replace side panels with temporary drawers instead of squeezing the
conversation.

## 4. Model and routing controls

### Local model selection

The user must be able to choose a discovered local runtime and model, beginning
with Ollama. Later supported choices should reflect the backend capabilities:

- Ollama local;
- LM Studio;
- vLLM;
- standalone llama.cpp;
- configured OpenAI-compatible local endpoints.

The selector must show runtime availability and model identity. Klerm must not
download a model automatically. Missing runtimes and empty model lists need
clear setup guidance rather than silent fallback.

### Frontier model selection

After the local-only foundation works, add a frontier provider/model selector.
Examples include OpenAI/ChatGPT-compatible models, Codex, Anthropic, Gemini,
Qwen, OpenRouter, and any other provider supported by the inherited provider
layer. The UI must distinguish a provider from a model and must not call every
OpenAI provider option "ChatGPT" internally.

Authentication status must be visible without revealing credentials. Provider
configuration should reuse backend configuration and secure desktop storage.

### Routing mode

The user can later select:

- Auto/local-first;
- Local;
- Frontier;
- Frontier-local.

The app must display the effective start lane, deterministic recommendation,
selected target, reason factors, delegation budget, and whether handback is
enabled. UI controls must map directly to existing backend behavior.

## 5. Core tabs

Tabs are introduced incrementally. The first app can expose only the workspace
and a minimal settings surface.

### Workspace

- Start and continue a Klerm session.
- Send prompts to the selected model.
- Stream model text and tool activity.
- Display local, frontier, routing, delegation, and return states.
- Stop an active task safely.
- Show per-response token and cost metadata when available.

### Models

- Discover and refresh local runtimes/models.
- Select and persist the default local model.
- Configure frontier providers and select a default frontier model.
- Show connection health, capability metadata, and actionable errors.
- Never auto-download or silently replace a selected model.

### Routing

- Select routing mode and active-start policy.
- Configure cycle budget, including supported unlimited mode.
- Show deterministic recommendation factors.
- Explain why a task remained local or was delegated.

### Delegation

- Visualize `local -> frontier -> local` and
  `frontier -> local -> frontier` cycles.
- Show the current owner, worker, transition ID, cycle count, and handback state.
- Show metadata and privacy-safe hashes without duplicating private response
  bodies in routing logs.

### Decision log

- Read and filter the same deterministic events produced by the backend.
- Filter by session, task, route, provider, model, and event type.
- Inspect reasons, usage, costs, and transition metadata.
- Export selected events with an explicit warning and credential-safe output.

### Settings and About

- Backend/sidecar health and configuration locations.
- Appearance, animation, reduced-motion, and accessibility controls.
- Provider authentication management.
- Version, update channel, diagnostics, licenses, and Pi MIT attribution.

## 6. Routing and delegation visualization

Routing must remain understandable without animation. Visual effects enhance
state changes but never replace labels, status text, or decision reasons.

- Local and frontier models appear as distinct nodes.
- The active owner has a persistent highlight.
- A routing recommendation briefly illuminates the proposed path.
- Delegation animates a task packet between nodes.
- Handback animates in the reverse direction and increments the visible cycle.
- Tool execution uses a restrained pulse and a textual activity entry.
- Completion settles into a static success state.
- Failure interrupts the path and leaves a readable error with retry guidance.

Animation requirements:

- Target smooth rendering without delaying backend events.
- Use short, intentional transitions rather than continuous decoration.
- Provide a reduced-motion mode and honor the operating-system preference.
- Avoid flashing effects and communicate every state through color-independent
  icons and text.
- Defer expensive visual polish until the full local task flow is reliable.

## 7. Desktop architecture

- Tauri provides the native window, packaging, permissions, secure integration,
  and platform lifecycle.
- The existing Klerm CLI/server remains the source of truth for sessions,
  providers, tools, routing, delegation, accounting, and decision events.
- Prefer the most stable existing RPC boundary after a focused protocol audit.
- Define versioned, typed messages for task input, streamed output, runtime
  status, routing events, model discovery, cancellation, and errors.
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

Status: **not started**.

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

Status: **not started; first implementation priority**.

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

Status: **not started**.

### App Milestone 3 - Frontier model setup

Goal: add one real frontier provider without changing routing semantics.

- Add provider authentication status and secure credential setup.
- Add provider/model selection, beginning with one already proven backend path.
- Send direct frontier tasks and show provider/model attribution, tokens, and
  cost.
- Expand only after the first provider path is stable.

Acceptance criteria:

- A configured frontier model completes a task from the desktop app.
- Credentials never appear in frontend logs or decision events.
- Provider/model attribution matches the CLI/backend record.

Status: **not started**.

### App Milestone 4 - Routing and delegation cycle

Goal: expose the complete existing A2A lifecycle.

- Add routing mode, start-lane, handback, and cycle-budget controls.
- Add routing and delegation inspectors.
- Stream deterministic route, transition, recommendation, and accounting events.
- Visualize both owner-preserving delegation directions.
- Keep the event stream consistent with CLI behavior.

Acceptance criteria:

- Local-first and frontier-first tasks complete from the app.
- The UI shows every delegation and return transition in order.
- Displayed reasons and cycle counts match `.klerm/router-decisions.jsonl`.
- No UI-only routing decision exists.

Status: **not started**.

### App Milestone 5 - Full tabs and visual polish

Goal: expand the app after the core lifecycle is stable.

- Add Models, Routing, Delegation, Decision Log, Settings, and About tabs.
- Add collapsible side inspectors and compact-window drawers.
- Add polished route, packet, handback, tool, completion, and failure animations.
- Add themes and accessible contrast states.
- Profile rendering and event-list performance on long sessions.

Acceptance criteria:

- The app remains fully understandable with animation disabled.
- Long decision logs remain responsive.
- Main workflows function at compact and large desktop window sizes.

Status: **not started**.

### App Milestone 6 - Linux release

Goal: produce the first supported desktop package.

- Build and test Linux bundles supported by Tauri.
- Verify clean-machine installation, sidecar launch, model discovery, and logs.
- Add diagnostics and release documentation.
- Complete security and attribution review.

Acceptance criteria:

- A clean Linux machine can install and launch Klerm.
- An installed Ollama model can complete the local flow.
- Config, sessions, logs, icons, and uninstall behavior are verified.

Status: **not started**.

### App Milestone 7 - Windows release

Goal: bring the proven Linux desktop behavior to Windows.

- Add Windows bundles and installer behavior.
- Verify WebView/runtime dependencies, paths, sidecar lifecycle, and Ollama
  discovery.
- Add signing and update-channel work when release infrastructure is ready.

Acceptance criteria:

- The same local, frontier, routing, and delegation smoke flows work on Windows.
- Installation and removal do not damage user configuration unexpectedly.

Status: **not started**.

### App Milestone 8 - macOS release

Goal: bring the proven behavior to macOS last.

- Add universal or explicitly supported architecture bundles.
- Verify signing, notarization, entitlements, paths, sidecar, and Ollama
  discovery.
- Verify Apple Silicon first if hardware availability requires an order.

Acceptance criteria:

- The same smoke flows work on supported macOS hardware.
- The app passes signing/notarization checks required for distribution.

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
steps are both verified. Linux must pass before Windows work starts, and Windows
must pass before macOS release work starts.

## 10. Deferred ideas

These are intentionally outside the first local-only app milestone:

- multiple simultaneous agents or graph editing;
- plugin marketplace;
- cloud account synchronization;
- mobile apps;
- browser-hosted website version;
- automatic local model downloads;
- elaborate animation before functional routing/delegation visibility;
- Windows or macOS packaging before the Linux flow is stable.

## 11. Open decisions before implementation

- Which existing Pi/Klerm RPC transport is the smallest stable desktop boundary?
- Which frontend stack best fits the imported monorepo without adding avoidable
  tooling?
- Should the sidecar be bundled as a single executable or launched through the
  installed Node runtime during development only?
- Which secure credential storage approach is appropriate across all three
  desktop platforms?
- Which Linux packaging formats are required for the first public release?
