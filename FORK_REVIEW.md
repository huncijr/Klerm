# FORK_REVIEW.md — fork candidates + `greedfinanace/routerccode` analysis

This is the second plan file: which forks could work, and — if we use
`routerccode` — **what needs to be fixed in it**.

---

## A) Fork candidates (for converting into our own harness)

| Repo | Language | License | Pros | Cons |
|---|---|---|---|---|
| **sst/opencode** | TS | MIT | modern CLI/TUI, plugin system, model-agnostic provider layer | TS; the plugin API changes fast |
| **cline/cline** | TS | Apache-2.0 | mature tool use, MCP support | VS Code extension — hard to port into a CLI harness |
| **AiderX/aider** | Python | Apache-2.0 | excellent edit formats, repo-map | single-model design, no orchestration |
| **block/goose** | Rust | Apache-2.0 | extension system, multi-provider | Rust; slower iteration |
| **All-Hands-AI/OpenHands** | Python | MIT | multi-agent out of the box | huge, hard to trim into "our own harness" |

**Conclusion:** if we fork, then **opencode** (TS, provider layer is
swappable) or **aider** (Python, we build the router on top). But none of
them ship A2A routing — we have to build that ourselves either way. That is
why the main direction is the **B+C hybrid** from `PLAN.md`: routerccode as
reference + our own minimal harness.

---

## B) State of `greedfinanace/routerccode` (repo review)

Reviewed: ~4000 lines of Python (`src/openrouter_agent/`), 4 test files
(26 test cases), Node wrapper (`bin/routercode.js`).

### What is usable
- `subagent.py`: fan-out orchestrator, role-based subagent configs
  (`test_writer`, `security_auditor`, `doc_writer`, `debugger`), git
  worktree integration, `model_override` for a cheaper model — **this is
  almost exactly the core of our router concept**.
- `context.py`: multi-layer context compression.
- `tools.py` + `lazy_tools.py`: tool implementations (read/write/search/run).
- `session.py`: continue/fork/rewind.
- `security.py`: basic protections.

### What is in BAD shape / needs fixing

**Architecture**
1. **Hard dependency on OpenRouter**: `api_client.py` targets a single
   endpoint (`openrouter.ai/api/v1`). There is no provider abstraction —
   wiring in a Claude API plan and Codex OAuth requires a common `Adapter`
   interface and 3 new adapters. This is the biggest piece of work.
2. **No router/triage logic**: the subagent system is role-based, but it
   does not decide by *size* (small task → local model, big task → cloud).
   We need a `router/` module + capability registry.
3. **`model_override` only means "cheaper model"** within one provider —
   there is no cross-provider delegation (Codex OAuth ↔ Claude API).
4. **`main.py` is an 871-line monolith**: REPL, commands, loop all in one.
   Needs splitting (cli / loop / commands).

**Quality / reliability**
5. **Weak test coverage**: 26 tests, none covering `main.py`, the
   `api_client`, or `subagent.py` (the part that matters most to us!).
   Needed: subagent fan-out tests with a mock client, provider adapter
   tests.
6. **Fragile Node wrapper**: `bin/routercode.js` looks for the
   `routercode` binary on PATH, with a `python -m ...` fallback — but many
   systems only have `python3`, not `python`. Fix: explicit
   `python3` / `sys.executable` logic, or drop the wrapper.
7. **`postinstall: pip install .`** from npm — fragile and suspicious as a
   security pattern; remove it.
8. **No CI** (GitHub Actions: pytest + ruff + type checking).
9. `pyproject.toml` has `requires-python >= 3.11`, which is fine, but the
   dependencies have no upper bounds; we need a lock file (uv).

**Missing features for our goal**
10. Capability registry (model profiles in YAML).
11. TaskPackage/TaskResult protocol (pydantic schemas).
12. OAuth flow (Codex) — currently only API key / keyring exists
    (`key_manager.py`).
13. Budget/circuit breaker for delegations (there is a partial self-heal
    breaker, but the subagent timeout is a fixed 120 s).
14. Decision log (JSONL): which task went to which model and why.

### Fix plan if we use routerccode (priority order)
1. Provider abstraction: `Adapter` interface + OpenRouter/Claude/Codex/
   Ollama adapters (issues 1–2).
2. Router module + capability registry (issues 2–3).
3. Extend `subagent.py` with cross-provider delegation,
   `model_override` → `provider_profile_id`.
4. Split up `main.py` (issue 4).
5. Tests + CI (issues 5, 8).
6. Fix or delete the Node wrapper (issues 6–7).

---

## C) Recommendation (summary)

- **No forking** in the first round: none of the forks ship A2A routing,
  and converting one is more work than building our own minimal harness.
- **routerccode**: reference + code to lift from (`subagent.py`,
  `context.py`, `tools.py`), but without the 6-point fix plan above it is
  not usable in production.
- The phase-0 spike will decide whether we actually fork routerccode (B)
  or only take inspiration and build greenfield (C).
