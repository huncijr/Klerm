# Klerm self-hosted server — initial implementation

Klerm now has a single-owner, headless HTTP/SSE transport over its existing
coding-agent RPC backend and a small browser control page. The same backend owns
agent tasks, built-in Kanban, configuration, native sessions, and existing logs.
Closing the browser does not close the backend.

This is the first server slice, not the completed always-on/Hermes roadmap.

## Native Linux installation

Requirements: Git, Node 24 (the repository minimum is Node 22.19), npm, and a
configured native harness or Klerm provider for real prompts. Run from the
repository root:

```bash
npm --prefix harness ci --ignore-scripts
npm --prefix harness run hydrate:model-data
npm --prefix harness run build:offline
KLERM_WORKSPACE="$PWD" node harness/packages/coding-agent/dist/headless-entry.js
```

Open `http://localhost:8787`. First startup generates a private owner token at
`<workspace>/.klerm/server/owner.token`. Read it locally, paste it into Owner
token, and click Connect. The browser retains the token in page memory only;
reload requires signing in again. The service lock prevents a second process
from using the same server state directory.

Configuration:

| Variable | Default / purpose |
| --- | --- |
| `KLERM_WORKSPACE` | Process working directory; server-side project root |
| `KLERM_SERVER_HOST` | `127.0.0.1`; bind address |
| `KLERM_SERVER_PORT` | `8787` |
| `KLERM_SERVER_STATE_DIR` | `<workspace>/.klerm/server` |
| `KLERM_SERVER_TOKEN_FILE` | `<state-directory>/owner.token`; provide an existing private token file to override |
| `KLERM_SERVER_PUBLIC_ORIGIN` | Browser's exact origin when behind HTTPS/reverse proxy |

The token must contain at least 32 bytes. Rotate it by stopping the service,
replacing the token file with a new random token, and restarting. No browser
request can set a token or change the server listening configuration.

The RPC process reopens the latest workspace session using `--continue`.
Fresh builds restore the checked-in, checksummed public model catalog baseline;
hydration does not fetch mutable provider APIs or require provider credentials.
Existing transcript/configuration files persist. External agent sessions are
reused within the process; automatic native-session restoration after server
restart is not implemented, even though the Hermes adapter can explicitly load
a known native session ID. Inspect interrupted work before issuing a new prompt.

Verification checkpoint: Linux native startup, generated-token authentication,
the real RPC handshake/state request, Docker image build, container startup, and
restart with persistent token/request deduplication have passed locally. Hermes
v0.20.1 ACP initialize passed, but the installed Hermes returned `Internal error`
from native session creation. A direct native `hermes -z` smoke identified the
cause: **No inference provider configured**. Configure one with `hermes model`
before retrying; real prompt/reply and browser use remain blocked pending native
worker setup. The full repository check and 37 targeted tests passed; fake
adapter tests are not a real-session completion claim. DigitalOcean and a
24-hour soak have not been run.

## Docker installation

From the repository root:

```bash
cp deploy/docker/.env.example deploy/docker/.env
mkdir -p deploy/docker/workspaces/project
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml config
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml up -d --build
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml ps
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml logs --follow klerm
```

Set `KLERM_WORKSPACE_HOST` in `.env` to your project directory before starting.
The service runs as UID 1000 (`node`); the selected bind directory must be
writable by that UID for Build tasks. The named `klerm-data` volume stores the
server token/audit journal and native Klerm configuration/session files under
`/var/lib/klerm`. Project logs are inside the mounted repository's `.klerm`.

Retrieve the owner token locally:

```bash
docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yaml exec klerm node -e "process.stdout.write(require('node:fs').readFileSync('/var/lib/klerm/server/owner.token','utf8'))"
```

Open `http://localhost:8787` and connect. Only loopback is published. Changing the
published port also requires updating `KLERM_SERVER_PUBLIC_ORIGIN` to the exact
browser origin. `restart: unless-stopped` restarts the service after a reboot
when Docker itself starts at boot. `/healthz` reports both serving and backend
readiness; container health depends on a successful RPC handshake.

The initial image builds Pi/Klerm only. It does not install Hermes, Codex,
OpenCode, or Chromium. Installed host binaries are not visible in a container.
Use native Linux for the initial Hermes integration, or a separately prepared
worker image containing Hermes and its native dependencies/authentication.
Do not assume the base image can run Hermes/browser tools.

## DigitalOcean / remote Linux host

1. Clone the repository onto a supported Linux Droplet with Node/npm or Docker
   Compose installed, then follow the native or Docker commands above.
2. Set the project bind path and persist the data volume. Configure native
   harness/provider authentication on that machine; local PC authentication is
   not copied automatically.
3. Place an HTTPS reverse proxy in front of loopback port 8787 and set
   `KLERM_SERVER_PUBLIC_ORIGIN=https://<your-domain>`. Proxy `/api/events` with
   buffering disabled and a long stream read timeout. Preserve request Host.
4. Publish the proxy's HTTPS port and keep 8787 private. For an initial private
   connection without a domain, use `ssh -L 8787:127.0.0.1:8787 <droplet>` and
   open `http://localhost:8787` on your PC.
5. Connect with the locally retrieved owner token. Closing the tab or SSH tunnel
   does not stop server-owned tasks.

Droplet deployment, host reboot recovery, and a 24-hour availability soak remain
human verification steps. This implementation does not provision cloud accounts,
DNS, certificates, or a managed hosted service.

## Hermes

Audited interface: Hermes Agent v0.20.1, `hermes acp`, ACP protocol version 1.
Verify native installation and configure authentication using Hermes itself:

```bash
hermes --version
hermes acp --check
hermes setup
```

On the Klerm browser page:

1. Connect and click Refresh discovery. Hermes is probed via ACP initialize,
   with the fixed version command as fallback. Scans also run every 60 seconds
   through the same backend registry; overlapping scans share one operation.
2. Select an agent, keep model `native-default` to use Hermes's own configured
   model, select Native or Full access, and click Configure Hermes.
3. Submit a short prompt using Send to selected agent. Hermes owns the native
   tools, authentication, and history. Tool activity and final replies appear
   in the event feed, and the existing bridge logs record task attribution.
4. Submit a follow-up to reuse the same native Hermes session. Stop requests
   native ACP cancellation, with bounded process termination as fallback.

Full access selects Hermes's `dont_ask` edit mode and answers native ACP
permission requests with `allow_once`. It applies to the worker's actual OS and
container permissions. Native profile answers permission requests with denial
because an interactive Hermes approval UI is not included in this slice.
Changing the profile affects the next run and reconstructs the adapter session;
it does not change an active turn's captured profile.

Hermes's ACP does not enforce a read-only Plan role. Klerm excludes Hermes Plan
slots and rejects their startup rather than describing a prompt as enforcement.
Native effort/toolset overrides are not forwarded in this slice. ACP's current
`hermes-acp` toolset exposes native browser/file/shell tools but excludes Hermes
cron/Kanban tools. Native Hermes browser use also requires its own browser setup:

```bash
hermes acp --setup-browser
```

This downloads native browser dependencies after Hermes's confirmation. A real
browser-use prompt is still a separate verification step. Hermes native
Kanban/cron and Klerm Kanban-linked cron are not connected yet; they must not be
advertised as available through this adapter. Follow SERVER_PLAN H2–H5 for the
shared tool bridge, external-agent card assignment, persistent cron, and browser
takeover surface.

## API and logs

- `GET /healthz`: serving/readiness, no authentication.
- `GET /`: browser control page, no private state.
- `GET /api/harnesses`: current discovery snapshot.
- `POST /api/refresh`: rescan installed harnesses.
- `POST /api/command`: supported existing RPC command with a stable request ID.
- `GET /api/events`: authenticated SSE with `Last-Event-ID` replay cursor.

API requests require `Authorization: Bearer <owner-token>`; JSON commands also
require `Content-Type: application/json`. No token is accepted in a URL. Use the
same ID and identical payload for an uncertain HTTP retry during one process
lifetime. A conflicting ID is rejected. Previously accepted IDs are journaled;
after restart or response-cache eviction they return HTTP 409 rather than
repeating execution. A fresh ID is an explicit new command.

The SSE replay buffer holds at most 1000 events/8 MiB and is process-local. An
expired cursor/restart emits `stream_reset`; refresh messages/state instead of
resubmitting a prompt. Responses, which may contain settings, are not broadcast
to the event stream. Closing an SSE connection never aborts the backend.

Logs:

- `<state-directory>/server-events.jsonl`: ordered operational/command audit,
  request IDs and digests; no command body or response body.
- `<workspace>/.klerm/bridge-events.jsonl`: existing agent bridge lifecycle.
- `<workspace>/.klerm/router-decisions.jsonl`: existing routing decisions.
- `<workspace>/.klerm/kanban-runs.jsonl`: existing built-in Kanban attempts.
- `<workspace>/.klerm/browser-events.jsonl`: existing browser coordinator events
  when that worker is actually used; Hermes native browser tools remain native.

## Verification / How To Test

From `harness/packages/coding-agent`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/headless-server.test.ts test/hermes-adapter.test.ts test/coding-harness-adapter.test.ts test/coding-harness-setup.test.ts
```

The tests use fake workers/backends and no provider credentials. They cover
auth/origin rejection, duplicate suppression including restart, ordered audit,
SSE replay/disconnect, scan overlap, native session reuse/load, Full access
permissions, Plan rejection, tool attribution, cancellation, and setup failure.

Repeat the real server lifecycle checks from the repository root:

```bash
node deploy/docker/smoke.mjs --native
docker build -f deploy/docker/Dockerfile -t klerm-server:local .
node deploy/docker/smoke.mjs --docker
```

Both smokes verify the browser page, authentication, a real RPC state request,
restart, persistent token, and previously accepted request rejection. They use
isolated temporary state and remove their own container/volume or test directory.
They make no model prompts or provider-authentication changes.

Human smoke: launch natively, connect, configure Hermes, ask for a short answer,
send a follow-up, inspect the bridge log, close/reopen the browser, then Stop an
isolated longer task. Load/edit the shared agent/board JSON using the page's
controls and inspect the exact RPC response. Built-in Kanban scheduling retains
its existing `scheduledAt`/`repeatMinutes` behavior while the backend is alive;
calendar cron and a restart-safe workspace-wide writer policy remain future work.

Restart and confirm the latest workspace transcript, slot settings, token, and
audit sequence survive. Do not expect interrupted external work to auto-resume.
Repeat with Docker for the base backend and on the target Droplet before claiming
those environments verified.

Back up the project and persistent volume only after stopping the service for a
consistent snapshot; include native harness state separately when used. Do not
run `docker compose down -v` unless intentionally deleting persistent data.
Upgrade by stopping the service, backing up, rebuilding the pinned revision,
then starting again. Automated migration/rollback/retention and restore tests
are not implemented by this first slice.
