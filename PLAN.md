# PLAN.md — Klerm: A2A routing on top of the Pi agent harness

## 0. Project Identity

- **Project name:** Klerm
- **Base direction:** fork `earendil-works/pi` and turn it into Klerm.
- **Logo:** `Logo/` folder
  - `Logo/Klerm_logo.png` — full logo with background.
  - `Logo/Klerm_logo_no_background.png` — transparent variant for CLI/TUI
    branding, Tauri window icon, and packaging assets.
- **Planning repo:** `https://github.com/huncijr/tset`
- **Target product repo:** `https://github.com/huncijr/Klerm` after the Pi fork
  is created.
- **Attribution:** Pi is MIT licensed. Keep the original copyright/license
  notices and clearly state that Klerm is a derived project.

## 1. Current State

- The Pi monorepo is imported under `harness/` in the Klerm product repo.
- The source and built CLI run as `klerm` with configuration under
  `~/.klerm/agent/`.
- The normal CLI prompt path supports direct, local, frontier, and automatic
  routing with deterministic JSONL decision events.
- Ollama, LM Studio, vLLM, standalone llama.cpp, and configurable local
  OpenAI-compatible discovery are integrated without automatic model downloads.
  The local model can use the full coding tool loop and delegate to frontier in
  the same session.
- `routerccode` was reviewed and rejected as a base.
- `opencode` was reviewed and kept as an architecture reference.
- `earendil-works/pi` was reviewed and selected as the best practical base.
- Interactive `/local`, `/frontier`, `/routing`, and `/klerm` controls are
  implemented. The local worker tool loop has been smoke-tested with Ollama and
  `qwen3.5:9b-q4_K_M`.
- Automatic routing always starts the local orchestrator. Deterministic task
  checks recommend frontier delegation for complex work without changing the
  initial route, and Klerm enforces an ignored recommendation after the first
  completed local response. The same assessment and enforcement apply when the
  persistent active-start policy forces a local start. Factors, policy triggers,
  and decision source are visible in the CLI and JSONL decision log.
- Local-owned tasks support repeated `local -> frontier -> local` transitions
  through native `delegate_frontier` and `return_to_local` tools. Frontier-owned
  tasks support the reverse `frontier -> local -> frontier` flow through
  `delegate_local` and `return_to_frontier`. Handback is enabled by default,
  controlled by a persistent per-task cycle budget that accepts any positive
  integer or an explicit unlimited mode, and logged with transition IDs and
  transcript hashes without storing worker response text.
- The persistent active-start policy can begin tasks in auto, local, frontier,
  or frontier-local mode. With handback enabled, normal frontier starts return
  to the local owner; explicit frontier task overrides remain frontier-owned.
- Trusted stdio, Streamable HTTP, and SSE MCP servers can contribute namespaced
  tools to CLI sessions; server lifecycle, status, and global/project
  configuration are available through `/mcp` and `/mcpset`. Empty `/mcpset` and
  `/mcpset add` open a guided setup wizard with Enter-to-skip optional fields
  and masked environment/header values. MCP tool execution shows a
  credential-free `mcp: <server>/<tool> used` notice before the remote call.
  The AI can persist credential-free MCP settings after an explicit request;
  trusted project enforcement and compatible stored credential preservation
  apply, with `/reload` required to load the resulting tools.
- Every finalized routed provider response writes one `MODEL_RESPONSE` event
  with provider/resolved-model attribution, token classes, total tokens,
  model-catalog USD cost, cost source, and deterministic usage availability.
  Keeping accounting separate from transition events prevents double-counting.
- Finalized Klerm TUI responses display their token classes, total tokens, and
  cost directly below the answer; text print mode does the same for its final
  answer, while JSON/RPC output remains structured and unchanged.

## 2. Goal

Build Klerm as an A2A (Agent-to-Agent) coding agent product where:

- A local model eventually acts as the router/orchestrator for small tasks.
- Complex tasks can be delegated to frontier models such as Codex, Claude,
  Qwen, or other configured providers.
- Delegation is bidirectional: local -> frontier and frontier -> local.
- Every routing decision is logged deterministically with the reason.
- The A2A backend is proven in the CLI first.
- A Tauri desktop app is built only after the CLI routing flow is stable.
- Desktop rollout order is Linux first, then Windows, then macOS.

### Desktop app source of truth

- The detailed Tauri desktop roadmap, UX scope, model controls, routing and
  delegation visualization, platform rollout, and app acceptance criteria live
  in [`APP_PLAN.md`](APP_PLAN.md).
- Before starting or changing any desktop-app work, read both `PLAN.md` and
  `APP_PLAN.md`. Keep checking `APP_PLAN.md` throughout implementation and
  verification so the active app milestone, scope, test requirements, and
  deferred work remain aligned.
- Update `APP_PLAN.md` when verified app work changes its status or materially
  changes the desktop design. Keep the high-level milestone status in this file
  consistent with it.
- The initial desktop implementation priority is the local-only foundation: a
  centered workspace, minimal navigation, Ollama discovery/model selection, and
  a complete local task flow. Add the richer tabs, frontier setup, routing and
  delegation cycle UI, and advanced animations incrementally afterward.
- Klerm is supported as a Tauri desktop app on Linux, Windows, and macOS only;
  no standalone website/browser product is planned.

## 3. Base Decision — CLOSED: Fork Pi

Selected base: `earendil-works/pi`.

Reasoning:

- MIT license.
- Already an agent harness, not just a small CLI.
- Has separated packages for AI providers, agent runtime, protocol, server,
  client, TUI, sessions, and coding-agent behavior.
- Has a multi-provider LLM layer in `packages/ai`.
- Has `packages/agent/src/harness`, which is close to the level where Klerm's
  A2A router belongs.
- Has protocol/server/client/RPC pieces that can later support a Tauri app.
- Better base than `routerccode`, which is too OpenRouter-specific and weakly
  tested.
- More suitable than `opencode` for a custom Tauri app because Pi already has
  a clean protocol/server/client split and does not force us to inherit a full
  desktop app stack.

## 4. Core Rule: Slow Milestones, No Skipping

Every large change must be done in small, reviewable milestones.

Do not jump directly to:

- real local model routing before mock routing works;
- Tauri UI before CLI A2A works;
- Windows/macOS packaging before Linux packaging works;
- full rebrand before the fork builds cleanly.

Each milestone must include:

- what changed;
- how it was verified by the agent;
- **Human Test Steps**: exact commands or app actions the user can run;
- current limitations and next step.

After every significant solution, the final assistant response must include a
short **How To Test** section for the user.

## 5. Milestones

### Milestone 0 — Fork + Build Smoke

Goal:

- Fork `earendil-works/pi` into the Klerm product repo.
- Clone the fork locally.
- Verify that the unmodified fork builds and the CLI starts.

Implementation steps:

- Create/fetch the Klerm fork.
- Install dependencies without lifecycle scripts.
- Build with offline mode first if possible.
- Run the source CLI smoke command.

Suggested human test:

```bash
npm install --ignore-scripts
npm run build:offline
./klerm-test.sh
```

Acceptance criteria:

- Install completes without running package lifecycle scripts.
- Build completes.
- CLI launches and can show help/version or an interactive prompt.
- No Klerm-specific code changes yet.

Status: **completed**.

### Milestone 1 — Minimal Klerm Rebrand

Goal:

- Make the fork visibly Klerm without destabilizing the codebase.

Implementation steps:

- Add Klerm logo assets.
- Update README title/intro.
- Add attribution that Klerm is derived from Pi under MIT.
- Introduce a `klerm` CLI alias while keeping Pi internals mostly unchanged.
- Do not mass-rename every internal symbol yet.

Suggested human test:

```bash
klerm --help
klerm --version
```

Acceptance criteria:

- CLI can be invoked as `klerm`.
- Basic help/version works.
- Existing Pi smoke behavior still works.
- Build/test remains green.

Status: **completed**.

### Milestone 2 — A2A Router Skeleton in CLI

Goal:

- Prove routing decisions in CLI without real model routing yet.

Implementation steps:

- Add a small router module in the fork, likely under
  `packages/coding-agent/src/core/router/` or a dedicated package.
- Define routing decisions:
  - `SELF`
  - `DELEGATE_FRONTIER`
  - `DELEGATE_LOCAL`
- Add a simple task package/result shape using existing Pi protocol patterns.
- Add deterministic JSONL decision logging.
- Add mock router and mock worker tests.

Suggested human test:

```bash
klerm debug route "read this file"
klerm debug decisions
```

Acceptance criteria:

- CLI prints a clear routing decision.
- A JSONL decision log is written.
- Log contains timestamp, task id, selected route, selected target, reason, and
  registry/profile snapshot or hash.
- No real Ollama/Codex/Claude dependency required yet.

Status: **completed**. The mock diagnostic route remains available, and the
normal prompt path now uses the real session/runtime integration.

### Milestone 3 — Real CLI A2A Flow with Mock/Existing Providers

Goal:

- Prove the full A2A path in CLI: task -> router -> worker -> result.

Implementation steps:

- Connect the router to Pi's existing agent/session runtime.
- Run a delegated task against a mock worker or a harmless configured provider.
- Return a structured result.
- Log both the route decision and the worker result.

Suggested human test:

```bash
klerm --routing frontier --frontier-model google/gemini-3.5-flash-lite -p "explain this repo structure"
klerm debug decisions
```

Acceptance criteria:

- A user task passes through the router.
- The selected worker receives a structured package.
- A result returns to the CLI.
- Decision and result are inspectable.

Status: **completed**. A real frontier prompt and structured decision/result
events have been smoke-tested through the normal CLI.

### Milestone 4 — Frontier Provider Routing

Goal:

- Route to real frontier providers through Pi's existing provider layer.

Implementation steps:

- Inspect and reuse Pi provider modules in `packages/ai/src/providers`.
- Verify available provider support for Anthropic, OpenAI/Codex-like flows,
  Qwen, HuggingFace, and OpenRouter.
- Add Klerm capability registry metadata on top of Pi's model/provider data.
- Wire one real frontier route first, preferably the lowest-friction provider
  already authenticated on the machine.

Suggested human test:

```bash
klerm --routing frontier --frontier-model google/gemini-3.5-flash-lite -p "summarize this project"
klerm debug decisions
```

Acceptance criteria:

- One real frontier route works from CLI.
- Decision log explains why it selected that provider/model.
- Token/cost metadata is captured when available.

Status: **completed**. Real frontier routing works, and each finalized routed
provider response records model-attributed token and model-catalog cost metadata
in a single accounting event.

### Milestone 5 — Local Model Runtime

Goal:

- Add the local router/worker model after the routing interface is stable.

Implementation steps:

- Add or verify local provider support.
- Support Ollama and OpenAI-compatible runtimes that serve LM Studio, vLLM,
  llama.cpp, or Unsloth-exported models.
- Add a local router profile.
- Benchmark small routing decisions before trusting the local model.

Suggested human test:

```bash
ollama list
klerm local status
klerm --routing local --local-model ollama/qwen2.5-coder:7b -p "small edit task"
```

Acceptance criteria:

- Klerm detects local runtime availability.
- Local route can be selected.
- If every configured local runtime is unavailable, Klerm reports a clear error and does
  not silently fall back without logging.

Status: **completed**. Runtime detection, model discovery, local/full-tool
worker routing, auto routing, and provider-neutral frontier handoff are
implemented. A real Ollama model completed an isolated file edit and delegated
a second task to Gemini, with both route lifecycles recorded in the
deterministic decision log. Local-first deterministic recommendation and
post-response enforcement are covered by mock-provider regression tests;
real-model delegation calibration remains an ongoing benchmark task.

### Milestone 6 — Tauri App on Linux

Goal:

- Build the first desktop app only after CLI A2A works.

Implementation steps:

- Follow the detailed, continuously maintained app roadmap in
  [`APP_PLAN.md`](APP_PLAN.md); check it before and throughout desktop work.
- Add Tauri shell.
- Use Klerm backend/CLI/server as sidecar.
- Connect UI to backend via RPC/HTTP/WebSocket depending on what the Pi fork
  already supports best.
- Implement initial views: chat, model registry, decision log, status/cost.
- Use `Logo/Klerm_logo_no_background.png` as the app/window icon.
- Implement the local-only Ollama model selection and task flow before adding
  the complete tab set, frontier providers, delegation visualization, or rich
  animation.
- Do not ship or support the frontend as a standalone website.

Suggested human test:

```bash
npm run tauri:dev
```

Acceptance criteria:

- Linux desktop window opens.
- User can send a task from the app.
- Backend route decision is visible in the UI.
- Decision log matches CLI output.

Status: **not started**.

### Milestone 7 — Windows and macOS Packaging

Goal:

- Package only after Linux Tauri app works.

Implementation steps:

- Add Windows installer target.
- Add macOS dmg target.
- Verify sidecar behavior and auth/config paths on each OS.

Suggested human tests:

```bash
npm run tauri:build -- --target x86_64-pc-windows-msvc
npm run tauri:build -- --target x86_64-apple-darwin
```

Acceptance criteria:

- App installs/opens on the target OS.
- Backend sidecar starts.
- User can run the same basic A2A task as on Linux.

Status: **not started**.

## 6. Completed Steps

- [x] Planning repo cloned with push access.
- [x] Roadmap, fork review, and coding-agent workflow documentation are tracked
  with the product repository.
- [x] Project identity chosen: Klerm.
- [x] Logo assets added locally under `Logo/`.
- [x] `routerccode` reviewed.
- [x] `opencode` reviewed.
- [x] `earendil-works/pi` reviewed and selected as the base.
- [x] Decision made: CLI A2A first, Tauri later.
- [x] Decision made: Linux desktop first, Windows/macOS later.
- [x] Pi harness imported, built, and smoke-tested as Klerm.
- [x] Real local and frontier routing with deterministic JSONL lifecycle logs.
- [x] Owner-preserving local-frontier and frontier-local delegation with bounded cycle limits.
- [x] Local-first auto routing with deterministic recommendation enforcement.
- [x] Multi-runtime local model discovery without automatic downloads.
- [x] Interactive startup, working, and successful-completion status feedback.
- [x] Persistent active start-lane controls with mandatory frontier-local handback.
- [x] Trusted stdio, Streamable HTTP, and SSE MCP tool bridge and interactive server configuration.
- [x] Guided MCP setup wizard for stdio, Streamable HTTP, and SSE server configuration.
- [x] Visible credential-free notices for MCP tool execution.
- [x] AI-facing credential-safe MCP server configuration tool.
- [x] Per-response provider/model token and cost metadata in deterministic decision logs.
- [x] Per-response token and cost display below Klerm TUI and text-mode answers.

## 7. Open Questions

- Which real local task set should calibrate deterministic recommendation
  thresholds before the Tauri milestone?
- Which stable CLI/RPC boundary should the Linux Tauri frontend use?
