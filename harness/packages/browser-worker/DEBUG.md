# Browser debugging

## Current findings

- The Hungarian `lepj fel youtube` prompt was not recognized by the explicit
  start-navigation matcher. `lépj fel`, `lepj fel`, and `menj fel` now start on
  YouTube; negated requests do not. Other sites still use agent navigation and
  the origin-approval flow.
- browser-use 0.13.10 paints its own startup animation on `about:blank`, including
  a remote logo. A pinned worker-local shim now suppresses only that animation
  before attachment, preserving tab recovery and the other watchdogs.
- `Agent.run()` returning did not prove task success. The worker now checks
  `history.is_done()` and `history.is_successful()` before emitting completion.
  Exhausted/unsuccessful runs fail and preserve the browser for a follow-up.
- A `done` action on `about:blank` now returns a corrective action error so the
  next bounded agent step can navigate rather than claim success.

## Files to inspect after a user prompt

Paths are relative to the **workspace selected in Klerm**, not necessarily this
source checkout:

- `.klerm/browser-debug.jsonl`: automatic append-only run/model/action diagnostics.
- `.klerm/browser-events.jsonl`: authoritative ordered audit and approval events.

The debug file is created on the first accepted task in the updated backend.
Each line includes timestamp, run ID, model, event, and normalized metadata.
Sequence is local to each coordinator; correlate by run ID, not sequence alone.
Prompts, model text, page screenshots, field values and provider credentials are
not recorded. This is an execution trace, not private model reasoning.
Debug writes are best effort; audit writes retain their stricter failure behavior.

Typical flow:

`RUN_REQUESTED → RUN_STARTED → NAVIGATION → MODEL_REQUEST → MODEL_RESPONSE →
ACTION → [APPROVAL_REQUESTED → APPROVAL_RESOLVED] → ACTION_DISPATCHED →
ACTION_COMPLETED → … → RUN_COMPLETED`

Navigation can occur after the first model response when no start URL is inferred.

To diagnose the newest run:

1. Find its `RUN_REQUESTED` and follow the same `runId` through both files.
2. `hasStartUrl: false` means no explicit initial navigation was inferred.
3. `MODEL_REQUEST` without `MODEL_RESPONSE` means the provider call has not
   returned yet; inspect subsequent `GATEWAY_ERROR` or cancellation events.
4. `GATEWAY_ERROR` records a bounded code (for example `unsupported_field`,
   `upstream_error`, `request_aborted`), never the provider's raw error body.
5. `APPROVAL_REQUESTED` without resolution means user input is required.
6. `ACTION_DISPATCHED` without an outcome locates an in-flight browser action.
7. `ACTION_FAILED` followed by another model call is a retry, not completion.
8. `RUN_FAILED` with incomplete-task reason means the runtime returned without
   confirmed success. It does not prove whether the cause was a step budget,
   repeated action errors, or the model reporting failure.

## How To Test

From `harness/packages/browser-worker`:

```bash
uv run --frozen python -m unittest discover -s tests -v
```

From `harness/packages/coding-agent`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/browser-debug.test.ts test/browser-run-coordinator.test.ts test/openai-compatible-chat.test.ts
```

From `harness`:

```bash
npm run check
./klermapp
```

Close the old application first so the launcher starts the updated backend.
Open Browser Task, choose an authenticated model, and submit:

`Lépj fel a YouTube-ra, írd be a keresőbe: jazz, majd indítsd el a keresést.`

Expected: YouTube navigation, real input into the search field, a separate
approval for Enter/submission, and visible results after approval. Handle any
consent/challenge through the existing approval or human takeover UI. Then ask
`Mi látható ezen az oldalon?` and confirm the page is reused. Check both log files.

Automated tests use fake models and do not establish that every real model can
complete this flow. A real Tauri/model run is still an acceptance requirement.

## References reviewed

- browser-use 0.13.10 installed source: agent history success contract, tool
  execution, BrowserSession watchdog attachment, AboutBlankWatchdog animation.
- https://github.com/browserbase/stagehand — observe/act/extract and retained
  browser sessions. Its Codex integration is through MCP; replacing the current
  CEF/CDP worker is not needed to fix the confirmed integration defects.
- https://github.com/browser-use/browser-use/issues/5881 — repeated Agent.run
  step-budget issue. Klerm creates a new Agent each run and retains only the
  browser, so that particular reuse bug does not explain this startup failure.
