# AGENTS.md — instructions for coding agents working on Klerm

## Project Identity

- Project name: **Klerm**.
- Logo assets are in `Logo/`:
  - `Logo/Klerm_logo.png`
  - `Logo/Klerm_logo_no_background.png`
- Planning repo: `https://github.com/huncijr/Klerm`.
- Target product repo after fork: `https://github.com/huncijr/Klerm`.
- Klerm will be derived from `earendil-works/pi` under the MIT license.
  Keep upstream license/copyright attribution.

## Project Goal

Build an **A2A (Agent-to-Agent) routing system** on top of the Pi agent
harness:

- A local model eventually acts as the router/orchestrator for small tasks.
- For larger tasks, Klerm delegates to a frontier model such as Codex, Claude,
  Qwen, or another configured provider.
- Delegation must be bidirectional: local -> frontier and frontier -> local.
- Klerm must know model capabilities through a registry/profile layer.
- Every routing decision must be deterministically logged with the reason.
- CLI A2A must work before building the Tauri app.
- Linux desktop comes before Windows/macOS packaging.

## Repo Structure

- `PLAN.md` — current roadmap, milestones, state, and human test policy.
- `FORK_REVIEW.md` — fork/base review and final Pi decision.
- `Logo/` — Klerm branding assets.
- Later product repo after Pi fork:
  - `packages/ai` — inherited Pi provider layer.
  - `packages/agent` — inherited Pi agent/harness runtime.
  - `packages/coding-agent` — CLI and Klerm routing integration.
  - `packages/protocol`, `packages/server`, `packages/client` — backend/API
    surface for the later Tauri app.

## Mandatory Workflow

1. Read `PLAN.md` and `FORK_REVIEW.md` before changing anything.
2. Work slowly in small milestones. Do not skip straight to real models or
   Tauri before CLI A2A works.
3. Prefer the smallest correct change.
4. Keep commits small and reviewable; commit messages in English, imperative
   mood.
5. Never commit secrets (API keys, OAuth tokens, provider auth files).
6. For TypeScript code inherited from Pi, follow the existing repo tooling and
   style. Do not introduce Python unless a later plan explicitly requires it.
7. New behavior needs tests where practical.
8. Router decisions must always be logged deterministically.
9. Preserve upstream MIT attribution from Pi.
10. At natural milestone boundaries and before a commit or push, review the
    relevant Markdown roadmap, status, usage, and test documentation. When the
    implementation and verification prove that a documented step is complete,
    update its status in the same change. Do not mark work complete based only
    on intent, and do not rewrite unrelated inherited Pi documentation.

## Human Test Requirement

After every significant implementation or large fix, the final assistant
response must include a **How To Test** section.

The section must explain how the user can verify the work themselves:

- exact CLI commands for build/test/CLI milestones;
- exact UI actions for Tauri milestones;
- expected output or behavior;
- where decision logs or other relevant logs are written;
- any known limitations, mocks, or skipped checks.

Do not claim a milestone is done if the user cannot test it or if the test
instructions are missing.

## Current Direction

1. Keep the CLI A2A lifecycle stable and deterministically logged.
2. Calibrate local-first delegation recommendations with real local models.
3. Add richer provider token/cost metadata to decision events.
4. Build Tauri Linux app as a frontend over the stable CLI/backend.
5. Package Windows and macOS after Linux works.

## Environment Notes

- Current planning repo remote was cloned from `https://github.com/huncijr/tset`.
- The intended product repo name is `Klerm`.
- Local machine already has `codex` CLI auth available, but no implementation
  should assume secrets can be committed.
