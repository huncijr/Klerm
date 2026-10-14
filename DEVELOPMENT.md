# Developing Klerm

Start with [STATUS.md](STATUS.md) for current readiness, blockers and priority.
Klerm coordinates independent native runtimes through structured adapters;
each worker retains its own authentication, model namespace, tools and memory.
For a fresh clone, follow [source setup](README.md#start-from-source) and the
linked platform prerequisites before starting development.

## Documentation map

- `STATUS.md`: shared current state and next implementation order.
- Package usage/acceptance guides: exact commands, UI actions and limitations.
- Changelogs: shipped/unreleased code changes, not proof of native acceptance.
- Root `AGENTS.md`, `PLAN.md`, `APP_PLAN.md`, `SERVER_PLAN.md`, `GRAPH_PLAN.md`
  and `harness/AGENTS.md`: local/ignored agent instructions and detailed planning
  notes when present. Read relevant plans in a maintainer checkout; they are not
  required files in a fresh public clone. Their old checkpoints are historical.

## Working rules

1. Make small, reviewable milestones. Prove common backend contracts before UI
   dispatch, two-agent exchange before larger teams, and intervention/recovery
   before unattended work. Follow the ordered gates in `STATUS.md`.
2. Keep shared orchestration generic. Use explicitly registered adapter
   capabilities; native-specific protocol/command handling belongs to that adapter.
   Model/harness names alone never prove quality, auth, permissions or readiness.
3. Read affected files before changing them. Follow existing TypeScript tooling;
   no new Python outside the already planned isolated browser worker.
4. Use explicit types, top-level imports and erasable TypeScript. New dependencies
   stay version-pinned and are installed with `--ignore-scripts` after review.
5. Native tools/permissions and workspace ownership must survive handoff. Do not
   silently replace an unavailable worker, model or session.
6. Every bridge decision has sender, recipient, ordering and reason. Keep secrets
   out of source, frontend events and normal logs; retain native credential ownership.
7. Treat other unstaged/untracked changes as potential user or parallel-session
   work. Stage explicit paths; commit/push only when requested. Never force-push,
   mass-stage, discard unrelated edits or bypass hooks.
8. Preserve upstream attribution and license notices. Review Klerm release targets
   before publishing; inherited Pi release commands are not automatic permission
   to publish or announce an upstream release.

## Verification cadence

Batch checks at a coherent implementation boundary. Run modified targeted tests,
then the repository check once for completed code work. Do not repeatedly build
or run the full suite after every edit. From `harness`:

```sh
npm run check
```

For documentation-only work, verify links, claims and `git diff --check`; code
builds/model calls are not needed. Fake/faux-provider tests exercise contracts;
real acceptance is explicit and uses the selected native account. Never silently
enable paid-provider tests in a unit suite.

## Reporting completion

Include exact human commands/UI actions, expected behavior, revision/platform,
log locations, mocks and skipped/blocked checks. Mark only the proved slice
complete. Update `STATUS.md`, relevant local plans and published usage guides
together; do not turn a successful build or startup into a full compatibility claim.
