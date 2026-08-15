# AGENTS.md — instructions for coding agents working in this repo

## Project goal
Build an **A2A (Agent-to-Agent) routing system** into our own coding agent harness:
- A **small/local model** (the router) handles small tasks.
- For larger tasks the router **autonomously delegates to a stronger model**
  (Qwen, Codex, Claude).
- The router **knows the capabilities of every wired-in model**
  (capability registry) and decides based on that.
- It also works **between two clouds**: e.g. **Claude API plan** +
  **Codex OAuth**.

## Repo structure
- `PLAN.md` — the full project plan (phases, decisions).
- `FORK_REVIEW.md` — fork candidates + analysis of the
  `greedfinanace/routerccode` repo and the fix list.
- Later: `harness/` (our own code), `docs/`.

## Rules for agents
1. Read `PLAN.md` and `FORK_REVIEW.md` before changing anything.
2. Small, reviewable commits; commit messages in English, imperative mood.
3. Never commit secrets (API keys, OAuth tokens) — see `.gitignore`.
4. Python code: `>=3.11`, type hints, formatted with `ruff` + `black`.
5. New features require tests (pytest). No merging without green tests.
6. Router decisions must always be deterministically logged
   (why a given task went to a given model).

## Environment
- Termux (Android). No Docker guaranteed; prefer local Python/Node toolchain.
- Git remote: `https://github.com/huncijr/tset` (private).
