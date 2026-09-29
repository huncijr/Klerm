# Browser debugging

## Current findings

- Final answers previously reused the 500-character error sanitizer, truncating
  the ten-post Reddit summary despite complete result metadata. Final answers
  now retain paragraphs up to 32,000 characters; intermediate next_goal updates
  and error messages retain the shorter bound. Root-page scrolling animates
  the actual page for 650 ms before the next observation; indexed nested scroll
  still uses the upstream executor. Private input is planned separately in
  PRIVATE_INPUT_PLAN.md and is not yet an enforced observation boundary.
- Reddit scrolling protocol failure: step_planned accepted click/input cursors
  but rejected scroll, although action_dispatched already accepted it. Both
  now accept scroll; a worker-process regression covers planning through
  dispatch and settlement. New public origins are DNS-validated and allowed
  automatically for the current run, with ordered policy decision events.
  The desktop displays user-facing narration as text bubbles, without an
  ASSISTANT MESSAGE heading. The worker requests first-person next_goal updates
  in the user's language, based on actual observations.
- Takeover now records pausing before sending the worker command, so an
  immediate CONTROL_GRANTED cannot be overwritten by a late pausing update.
  Stop cancels pending model/observation waits when no browser action is in
  flight; dispatched actions drain first. The pausing panel hides on settlement.
  Each step's next_goal is forwarded as a bounded user-facing message, without
  private model reasoning. Visible human-verification text also triggers
  takeover for wait/done plans; Continue discards that plan and observes again.
  Challenge detection is best-effort and currently recognizes English text.
- Successful browser runs now emit a bounded, credential-redacted
  ASSISTANT_MESSAGE immediately before RUN_COMPLETED. The activity timeline
  displays the agent's actual final user-facing answer between ordered events.
  This answer is intentionally recorded in the audit, unlike private reasoning
  and intermediate model text; it is limited to 500 characters.
- Live probes of `openai-codex/gpt-6-sol` and `openai-codex/gpt-6.1-sol`
  returned provider errors stating that the model is unsupported for the
  current ChatGPT account. The gateway now identifies this separately as
  `model_account_unsupported`, rather than `request_rejected`. This is an
  account/model access failure, not evidence of unsupported browser actions.
- Additional alternatives reviewed: Browserbase Stagehand (MIT), including
  `packages/extension/llm/aisdk.ts` provider-option and prompt-JSON fallback
  handling; Vercel agent-browser (Apache-2.0 license checked). Neither is
  integrated by this diagnostic correction. A CEF/CDP adapter must preserve
  current-page ownership, approval boundaries, action verification, and audit
  ordering before an alternative runtime can be offered as working.
- In the `teszt` workspace, the September 29 `openai-codex/gpt-6-luna` runs
  reached `MODEL_REQUEST` six times each, but every response was
  `stopReason:error` with zero tokens and `GATEWAY_ERROR upstream_error`.
  No DOM action was planned or dispatched. Navigation and the missing cursor
  were consequences, not the provider failure's cause. The gateway now
  classifies known authentication, unavailable-model, rate-limit, and
  rejected-request errors without logging raw provider responses. Rejected
  requests are not proof of intrinsic model incompatibility. Model selection
  now performs a separate small, potentially billable tool-schema request
  for each selected model and reasoning level before browser work. Changing
  either selection invalidates the old check; the same reasoning is pinned to
  the subsequent browser gateway. Passing establishes only that this request succeeded,
  not that a complete browser-use run will work. A provider response is
  still required before any autonomous search interaction can happen.
- A planned DOM target now appears as an AI cursor before dispatch, with a
  short cancellable preview before automatic interactions. The search query
  remains excluded from audit events. Enter/submission still requires user
  approval.
- A real Grok 4.7 / CEF / browser-use run identified the original HTTP 400:
  Klerm forwarded tool_choice=auto on a turn with no tools. The gateway now
  omits tool choice on such turns. On retest, the model planned and executed
  input into the YouTube search field; independent CEF CDP inspection found
  the value jazz. The next click paused for user approval. The worker emits
  ACTION_VERIFIED only after checking the targeted field on the live page by
  ID or unique name, without logging its contents. This verifies an executed
  action, not an unstarted probe or an unapproved search submission.
- The later `teszt` workspace `openai-codex/gpt-6-luna` run used medium
  reasoning and failed immediately after NAVIGATION with request_rejected.
  A live provider diagnostic isolated the difference from its passing model
  probe: browser-use adds temperature=0.2, but the Codex Responses endpoint
  rejects temperature for this model. The browser gateway now omits this
  parameter for Codex Responses (and the probe includes browser-use's default
  temperature). A follow-up live CEF run reached ACTION and ACTION_VERIFIED
  for search input. It did not submit the search: the model repeatedly proposed
  done before results appeared. The worker now rejects premature done for an
  explicit YouTube search submission request. A completed results-page flow
  still requires a subsequent model action and, where requested, real user approval.
  A final isolated CEF run with the same model and medium reasoning then
  completed the whole flow: input, ACTION_VERIFIED, click with a test-only
  auto-approval, results page with 20 results, and RUN_COMPLETED.
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
