# Klerm browser worker

This package is an isolated Python 3.12 JSONL worker for the Klerm Browser
Agent. It uses the MIT-licensed `browser-use==0.13.10` package with a local,
headed `Browser` and `ChatOpenAI` connected only to a supplied loopback
OpenAI-compatible endpoint.

The TypeScript backend owns this worker through a typed coordinator and exposes
its bounded state through the desktop RPC. The worker never receives provider
credentials: it talks only to a per-run loopback gateway with an ephemeral,
non-provider bearer token.

## Setup

Prerequisites:

- CPython 3.12
- `uv`
- Chromium installed in the form expected by browser-use

The committed `uv.lock` pins the full dependency graph. Install it from this
directory; `uv` can download the required CPython 3.12 runtime when it is not
already present:

```bash
uv sync --frozen
uv run --frozen browser-use --doctor
```

Start the worker:

```bash
uv run --frozen klerm-browser-worker
```

The process reads one JSON object per line from stdin and writes only normalized
JSON events to stdout. Third-party stdout and all stderr are redirected to the
null device so model tokens, browser logs, secrets, and page bodies cannot
corrupt or leak through the protocol. Operational failures are returned as
bounded, redacted events.

## Protocol version 1

Every command requires `version`, `command`, and `request_id`. Unknown fields,
duplicate JSON keys, malformed identifiers, non-loopback model endpoints, and
oversized input are rejected. One browser run may be active at a time; follow-up
starts on the same worker reuse its browser until shutdown. An empty
`allowed_origins` list starts without a chosen URL and requires approval for
the first navigation origin.

Start a read-only run:

```json
{"version":1,"command":"start","request_id":"req-1","run_id":"run-1","task_id":"task-1","correlation_id":"corr-1","agent_id":"agent-1","task":"Summarize the public documentation at the approved origin.","model":"local-model","base_url":"http://127.0.0.1:8080/v1","token":"local-token","allowed_origins":["https://example.com"],"max_steps":25}
```

Approve an origin requested by `origin_approval_required`:

```json
{"version":1,"command":"approve_origin","request_id":"req-2","run_id":"run-1","origin":"https://docs.example.com","scope":"allow_once"}
```

Use `current_run` instead of `allow_once` to allow the exact origin for the
remainder of this run. No approval is persisted.

Stop the active run:

```json
{"version":1,"command":"stop","request_id":"req-3","run_id":"run-1"}
```

Shut down the worker, stopping an active run first:

```json
{"version":1,"command":"shutdown","request_id":"req-4"}
```

Every event has `version`, a worker-wide monotonically increasing `sequence`,
`event`, `status`, and an RFC 3339 UTC `timestamp`. Run events also carry
`run_id`, `task_id`, `correlation_id`, and `agent_id`. Commands and events never
echo the task, token, model response, action arguments, page URL paths, or page
content. The completed event includes only final-result presence, length, and
SHA-256 metadata.

## Security defaults

- Browser-use telemetry and OpenTelemetry are disabled before browser-use is
  imported.
- Each worker uses an isolated temporary browser profile shared by successive
  runs in its Klerm conversation session. It is removed on worker shutdown or
  replaced after a runtime failure; approval scope is reset between runs,
  except for the origin already open in the reused page.
- Chromium is headed, sandboxing remains enabled, browser security remains
  enabled, default extensions are disabled, and permissions are empty.
- Downloads and automatic PDF downloads are disabled.
- Vision and cross-origin iframe processing are disabled.
- IP-address navigation blocking is enabled by browser-use.
- IP-address origins are rejected by the worker protocol as well as blocked by
  browser-use.
- The LLM endpoint must resolve syntactically to `localhost`, `127.0.0.0/8`, or
  IPv6 loopback. Remote OpenAI endpoints are rejected.
- Browser navigation is limited to explicitly supplied origins and origins
  approved for the current run. Planned new-origin actions pause in the
  browser-use pre-action step callback.
- The worker excludes known click, input, upload, download, form submission,
  credential, account-changing, purchase, publish, delete, clipboard, and file
  actions. A second pre-action allowlist rejects unknown or non-read-only action
  names.
- CAPTCHA, anti-bot, paywall, and other access-control bypass is prohibited in
  the enforced task instruction.
- Required browser-use security fields and hooks are checked at runtime. The run
  fails closed if the pinned package API cannot enforce them.

## Tests

The unit tests include a configuration smoke against the pinned browser-use API
but do not launch Chromium or call a model:

```bash
uv run --frozen python -m unittest discover -s tests -v
```

From the repository root, `npm run check` also verifies the TypeScript
coordinator, RPC contract, and desktop types.

## Limitations

- The TypeScript owner writes backend-global ordered events to the active
  workspace's `.klerm/browser-events.jsonl`; raw page content, prompts, tokens,
  and provider responses are excluded.
- Final browser-use text and page bodies are deliberately not emitted. Only
  result metadata is available until Klerm defines a separate reviewed content
  channel.
- Read-only mode excludes clicks and keyboard input, so sites that require UI
  interaction cannot be researched by this first worker.
- Origin approval depends on browser-use's pre-action callback plus its
  `allowed_domains` browser control. Redirect handling remains fail-closed at
  the browser layer, but a blocked redirect may fail the step without producing
  an approval request.
- A real headed run still needs a human smoke test with a usable Chromium and an
  authenticated Klerm model. Automated tests do not validate window-manager or
  Chromium packaging behavior.
- The Chromium window is still separate from the Tauri application. Native CEF
  hosting, in-app input forwarding, and browser-crash detection beyond worker
  failure are not implemented yet.
