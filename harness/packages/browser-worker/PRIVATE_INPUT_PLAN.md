# Private browser input — implementation contract

Status: design only; the current Take control feature is not a privacy boundary.

## Why ordinary pause is insufficient

The existing step callback runs after page observation and the model response.
Detecting a password/card field there cannot prevent the preceding screenshot or
DOM snapshot from reaching the provider. Resume can also rediscover field values,
validation errors, URLs, and page text that echo human input. Redacting logs does
not remove data already sent to a model.

## Required state machine

`ai -> privacy-locking -> private-human -> privacy-check -> fresh-observation -> ai`

1. Provide an explicit Private input button before any login/signup/card entry.
   Detect sensitive forms locally before model-bound observation as an additional
   trigger; heuristics alone must not be advertised as a guarantee.
2. Block model requests in the backend, abort any pending model request, and
   invalidate pending action batches before granting private input. Wait for
   dispatched actions to drain. User input must be withheld until lock acknowledgement.
3. Revoke worker CDP observation access through an enforcing broker or detach the
   worker. Keep CEF and native human input running. No screenshots, DOM, keyboard
   events, network bodies or field values enter the AI path while locked.
4. Do not resume on timeout or CAPTCHA disappearance. Continue requests a local
   privacy check. Remain locked if sensitive fields or echoed input remain visible.
5. Retain secret values only locally if needed for exact-value detection, never in
   logs or provider calls. Cover visible text, URL/query, attributes and DOM values;
   mask screenshot regions or keep vision disabled until a clean page is proved.
6. Discard worker observation caches and queued plans. Use a fresh Agent context
   containing only the original task and safe progress summary; preserve CEF cookies
   without exposing them to the agent. Inject only a freshly sanitized observation.
7. Log privacy transitions and acknowledgement, never input content. Treat browser
   or broker failure as locked, not as permission to resume.

## Credential vault rollout (not implemented)

1. Linux: integrate Secret Service (`secret-tool` using stdin or a reviewed
   native API); never pass secrets through process arguments, localStorage,
   model requests or JSONL. Other operating systems need their own keychains.
2. Use a dedicated UI to collect email/login data. Store opaque vault references
   only in typed settings. Payment/card values are excluded until separately
   reviewed storage, deletion and retrieval behavior exists.
3. An enforcing CDP broker must block worker screenshot/DOM observation before
   human input or vault retrieval. An OS keyring alone does not hide visible
   field values from the model while browser-use remains attached.
4. Clean-page verification and fresh-agent context are required on Continue;
   never silently unlock after a timeout. Test secret markers in every model
   request (including image input), debug file and audit event.

## Tests required before shipping a privacy claim

- Fixtures: login, signup, payment, OTP, CAPTCHA, confirmation and validation errors.
- Fake provider captures every request; synthetic secret markers must be absent
  from text, image input and logs, including concurrent navigation and pending calls.
- Native input is denied before lock acknowledgement and accepted after it.
- Continue on a still-sensitive page remains locked; clean-page continuation
  replans without stale element IDs or cached observations.
- Stop, crash, session switch and restart cannot reopen the observation channel.
- Human test: Private input -> type fixture secret -> submit -> Continue; inspect
  captured fake-provider requests and confirm no secret pixels/text were sent.

## Images and scrolling

Image-capable models currently receive viewport screenshots, not a promise that
every off-screen image or video has been inspected. Summaries must identify what
was actually visible and avoid inventing visual details. Privacy masking and
image-aware content coverage need separate tests.

Root-page AI scrolling now animates the actual CEF page for 650 ms before the next
observation. Indexed nested-scroll actions still use the upstream executor.
