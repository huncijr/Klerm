# PLAN.md — A2A routing system for our own coding agent harness

## 1. Goal

A coding agent harness where:

- A **small, local model** (router/orchestrator) runs the small tasks
  (file reads, small edits, grep, simple refactors).
- When a task is **large or complex**, the router **delegates on its own**
  to a stronger model: **Qwen**, **Codex** (OpenAI), or **Claude**.
- The router **knows which models are wired in** and their capabilities
  (context window, strengths, cost, auth type) — and decides based on that.
- It also works **cloud-to-cloud**: e.g. a Claude API plan as the main
  worker + Codex OAuth as a secondary worker (or the other way around).

## 2. Principles

1. **Router first**: every task goes to the local model first. It decides:
   `SELF` / `DELEGATE(model_id, reason)`.
2. **Capability registry**: every wired-in model has a declarative profile
   (name, provider, auth, context limit, tool support, cost, what it is
   good at). The router prompt receives this registry.
3. **Task handoff protocol**: delegation needs a structured package
   (goal, context files, acceptance criteria, budget/token limit,
   response format). The worker returns a result; it does not "take over"
   the session.
4. **Cost and token control**: every delegation has a max-token /
   max-step limit; the router summarizes and validates.

## 3. Architecture

```
            ┌──────────────────────────────┐
 user ───▶  │  Router (small local model)   │
            │  - task triage                │
            │  - capability registry        │
            └───────┬──────────────┬───────┘
                    │ SELF         │ DELEGATE
                    ▼              ▼
             local tools      Provider adapters
             (read/edit/sh)   ├─ Anthropic API (Claude plan / API key)
                              ├─ Codex OAuth (OpenAI)
                              ├─ Qwen (API or local)
                              └─ Ollama / llama.cpp (local)
```

Components:
- `router/` — triage logic, decision prompt, logging.
- `registry/` — model profiles (YAML/JSON), auth configuration.
- `adapters/` — one adapter per provider, common interface:
  `run_task(task_pkg) -> TaskResult`.
- `protocol/` — TaskPackage / TaskResult schemas (pydantic).
- `tools/` — read/edit/bash/search tools usable by both the router and
  the workers.
- `harness_cli/` — the TUI/CLI layer.

## 4. Path decision: fork vs. routerccode vs. greenfield

Detailed analysis: **`FORK_REVIEW.md`**. In short:

- **A) Fork** (opencode / cline / aider / goose) → strong base, but hard
  to convert into "our own harness", and we still have to build the A2A
  layer ourselves.
- **B) Fix routerccode** → small (~4k LOC), has a subagent module,
  but needs many fixes (see FORK_REVIEW.md).
- **C) Our own minimal harness** → only the 5 components above, with the
  provider adapter pattern. The fan-out/worktree logic from routerccode's
  `subagent.py` can be lifted.

**Proposal:** B+C hybrid — use routerccode as a reference base, build our
own harness with our own protocol, and port whatever is good there
(session, tools, context compression). Final decision at the end of
phase 0.

## 5. Phases

### Phase 0 — setup and decision (now)
- [x] Repo, agent .md files, .gitignore.
- [x] Plan (this file) + fork/repo review (`FORK_REVIEW.md`).
- [ ] Spike: run routerccode locally on Termux, list concrete issues.
- [ ] Decision: B vs. C (based on the spike).

### Phase 1 — Router core + registry
- [ ] Capability registry schema (YAML), 2 example profiles (Claude, Codex).
- [ ] Router decision prompt + test set (small/large task examples).
- [ ] Decision log (JSONL): task → decision → reason.

### Phase 2 — Provider adapters
- [ ] Common `Adapter` interface: auth, run_task, token accounting.
- [ ] Anthropic adapter (API key / Claude plan).
- [ ] Codex adapter (OAuth token flow; reuse Codex CLI if available).
- [ ] Local adapter (Ollama / llama.cpp) for small Qwen and the router.

### Phase 3 — Delegation protocol
- [ ] TaskPackage/TaskResult pydantic schemas.
- [ ] Context packaging: router selects the relevant files.
- [ ] Budget enforcement (max tokens, max iterations, circuit breaker).
- [ ] Result validation: the router verifies the worker's output
      (diff review, running tests).

### Phase 4 — Cloud-cloud mode
- [ ] Wire up Claude API plan + Codex OAuth simultaneously.
- [ ] Fallback chain: if one worker's auth expires / is rate limited,
      hand off to the other.
- [ ] Cost dashboard (per-session token/cost report).

### Phase 5 — Hardening
- [ ] Tool sandbox (bash allowlist), secret-leak protection.
- [ ] Session continue/rewind, parallel subagent fan-out (with worktrees).
- [ ] CI: pytest + ruff; e2e tests with a mocked provider.

## 6. Open questions
- Which form of Qwen: via OpenRouter, its own API, or a local GGUF?
- Codex OAuth token refresh: use the official Codex CLI as the token
  source, or our own OAuth flow?
- Router model size: is 3B–8B enough for triage? (benchmark on the
  decision test set)
- License compatibility if we fork (opencode: MIT, cline: Apache-2.0).
