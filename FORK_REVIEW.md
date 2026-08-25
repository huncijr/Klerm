# FORK_REVIEW.md — Klerm base review and fork decision

## 1. Final Decision

Selected and implemented base: **`earendil-works/pi`**.

Klerm is a derived project of Pi, not a greenfield harness and not a
`routerccode` fork. The Pi monorepo is imported under `harness/` in the Klerm
product repository at `https://github.com/huncijr/Klerm`.

Implementation status and strategy:

- Pi has been imported into the Klerm product repo;
- the harness installs, passes its checks, and the source CLI works;
- real local/frontier routing and bounded bidirectional handoffs are implemented;
- routing decisions are written to `.klerm/router-decisions.jsonl`;
- automatic routing starts locally and enforces deterministic frontier
  recommendations for complex tasks;
- local discovery supports Ollama and common OpenAI-compatible runtimes without
  automatic model downloads;
- continue stabilizing and calibrating CLI A2A before building a desktop app;
- build a Tauri app after the CLI A2A flow is stable;
- target Linux desktop first, then Windows and macOS.

## 2. Candidate Review Summary

| Candidate | Decision | Reason |
|---|---|---|
| `earendil-works/pi` | **Selected base** | MIT, real agent harness, multi-provider LLM package, agent runtime, protocol/server/client split, TUI, sessions, useful for Tauri sidecar architecture. |
| `sst/opencode` / `anomalyco/opencode` | Reference only | Mature CLI/TUI/provider concepts and desktop app ideas, but large TS/Bun monorepo and not an A2A router out of the box. |
| `greedfinanace/routerccode` | Reference only | Small and has subagent/worktree/context ideas, but too OpenRouter-specific and weakly tested. |
| Greenfield | Rejected for now | Too much unnecessary time: harness, CLI, providers, sessions, protocol, and app shell would all need to be built from scratch. |

## 3. Pi Review

Repo: `https://github.com/earendil-works/pi`

License: MIT.

What makes Pi a good base:

- `packages/ai` — unified multi-provider LLM layer.
- `packages/agent` — agent runtime with tool calling and state management.
- `packages/agent/src/harness` — harness-level abstractions.
- `packages/coding-agent` — interactive coding agent CLI.
- `packages/protocol` — protocol/schema layer.
- `packages/server` and `packages/client` — useful for a future Tauri app.
- `packages/tui` — existing terminal UI package.
- Existing provider files include Anthropic, OpenAI, OpenAI Codex, OpenRouter,
  HuggingFace, Qwen-related providers, and others.
- Has build/test/release scripts and supply-chain hardening practices.

Important Pi files to audit after forking:

- `packages/agent/src/agent-loop.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/harness/agent-harness.ts`
- `packages/agent/src/harness/types.ts`
- `packages/agent/src/harness/tools/`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/core/model-runtime.ts`
- `packages/coding-agent/src/core/model-resolver.ts`
- `packages/coding-agent/src/core/model-registry.ts`
- `packages/coding-agent/src/core/provider-composer.ts`
- `packages/coding-agent/src/modes/rpc/`
- `packages/coding-agent/src/server/create-harness.ts`
- `packages/protocol/src/schemas.ts`
- `packages/server/src/server.ts`
- `packages/client/src/client.ts`

Risks / things to handle:

- Pi is TypeScript/Node, not Python.
- Node requirement is modern (`>=22.19.0`).
- No strong built-in permission sandbox according to the README; Klerm must add
  or clearly document sandbox behavior.
- Full rebrand can be noisy, so start with minimal rebrand only.
- Need to keep MIT attribution.

## 4. Routerccode Review

Repo: `https://github.com/greedfinanace/routerccode`

Decision: **do not fork as Klerm base**.

Usable ideas:

- `subagent.py` fan-out pattern.
- Git worktree integration idea.
- Context compression ideas.
- Basic read/edit/search/run tool shapes.

Reasons it is not a good base:

- Hard dependency on OpenRouter in `api_client.py`.
- No real provider abstraction.
- No local router / task triage layer.
- `model_override` only changes an OpenRouter model name; it is not
  cross-provider A2A routing.
- Large monolithic `main.py`.
- Weak tests around the most important parts.
- Fragile npm wrapper and `postinstall: pip install .` pattern.

Use routerccode only as a reference for subagent fan-out/worktree concepts.

## 5. Opencode Review

Repos observed during review: `sst/opencode` / `anomalyco/opencode`.

Decision: **reference only**.

Useful ideas:

- Mature CLI/TUI architecture.
- Provider abstraction patterns.
- Tool layer organization.
- Session model ideas.
- Desktop app packaging/release ideas.

Reasons not to use as the base right now:

- Large TypeScript/Bun monorepo.
- More desktop-product oriented than harness-protocol oriented.
- Would still require building Klerm's A2A routing layer.
- If used as a direct fork, Tauri may be less natural because existing desktop
  architecture is already opinionated.

## 6. Required Human Test Policy

Every significant implementation response must end with **How To Test**.

The test section should include:

- exact commands when the milestone is CLI/build/test related;
- exact UI actions when the milestone is desktop related;
- what output or behavior the user should expect;
- where logs are written, especially decision logs;
- current limitations if the feature is still a mock or partial path.

No milestone is considered complete until both automated checks and human test
steps are documented.

## 7. Current Completion Status

- [x] Reviewed `routerccode`.
- [x] Reviewed `opencode`.
- [x] Reviewed `earendil-works/pi`.
- [x] Selected Pi as the Klerm base.
- [x] Decided CLI A2A first, Tauri later.
- [x] Decided Linux desktop first, then Windows/macOS.
- [x] Import Pi into the Klerm product repo under `harness/`.
- [x] Install, check, and smoke-test the Pi harness locally.
- [x] Minimal Klerm rebrand with the `klerm` CLI, help text, config path, and README attribution.
- [x] CLI A2A mock router skeleton with deterministic JSONL decision logs.
- [x] CLI command for inspecting routing decisions.
- [x] Real frontier provider routing through the normal Klerm CLI prompt path.
- [x] Local model runtime with Ollama discovery, tool use, routing, and a real local edit smoke test.
- [x] LM Studio, vLLM, standalone llama.cpp, and generic OpenAI-compatible local discovery.
- [x] Bounded local-to-frontier-to-local handoffs with native tools and privacy-safe transition logs.
- [x] Local-first deterministic recommendation and ignored-handoff enforcement in auto mode.
- [x] Interactive startup/working animation and successful-completion indicator.
- [ ] Tauri Linux app.
- [ ] Windows/macOS packaging.
