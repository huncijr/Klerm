# Klerm status and next steps

Checkpoint: October 18, 2026. This is the shared source of truth for current
readiness and priority. Local roadmaps contain detailed designs and historical
checkpoints; an older checkbox or milestone label does not override this page.

## Readiness vocabulary

- **Implemented:** code exists; operational acceptance may still be open.
- **Locally verified:** the named flow ran on the stated local platform.
- **CI verified:** only the steps run by that CI revision are proved.
- **Blocked:** a named environment/configuration prerequisite is missing.
- **Planned:** the behavior is not delivered.

Discovery, authentication, session readiness and successful task completion are
different states. A passing fake-provider test is contract evidence, not a claim
that a native harness or an arbitrary OS/account combination works.

## Current product

| Area | Delivered / evidence | Still open |
| --- | --- | --- |
| CLI and built-in runtime | Provider/local-model tools, session history, routing and decision logs | Shared execution with external harnesses |
| Desktop | Projects, chat, Settings, Personal Agents, Kanban, files, shortcuts and semantic themes | Full native UI/task/Stop/restart acceptance on each OS |
| Platform packages | `ecb4320`: build, packaged backend and actual native-window startup passed on Linux x64, Windows x64, macOS Intel and Apple Silicon | Authenticated harness workflows, signing, notarization, updates |
| Adapter SDK | Generic IDs, correlated envelopes, ordered journal and shared live native dispatch; readiness uses declared adapter capabilities | Mixed Klerm/external execution in one run; durable recovery |
| Native workers | Current working-tree Codex CLI 0.160.1 check passed real prompt/reply, remembered follow-up and a native file tool on Linux x64 | Complete per-worker/per-platform acceptance and mixed-runtime dispatch |
| Hermes | v0.20.1 ACP initialize and adapter implementation; native session startup is blocked here | Configure a native provider, then prove prompt/tools/Stop/resume; shared Kanban/cron/browser bridge |
| OpenClaw | Gateway-backed ACP adapter, live registration/discovery/setup and isolated native session mapping; fake protocol contracts verified | Configured real Gateway, actual tool/Stop/resume and target-host acceptance |
| Collaboration | Sequential coordinator/peer/finalizer flow and bounded Prompt Together implementation | Agent-authored continuous conversation, common budgets and user intervention |
| Graph | Saved drafts, source catalog, validation and editor | Execution, shared session/workspace admission, run history/recovery |
| Self-hosting | Linux/Docker HTTP/SSE backend, owner authentication and basic browser control page locally checked | Full browser workspace, backup/restore and durable native-task recovery |
| DigitalOcean | Deployment instructions and reusable Linux/Docker foundation | Actual target deployment, reboot/reconnect and 24-hour availability proof |
| Browser | Linux development CEF surface and browser worker; native interaction evidence | CEF release/non-Linux hosting, server headless delivery and private-input observation lock |

The last fully successful platform evidence is [CI run 37792473866](https://github.com/huncijr/Klerm/actions/runs/37792473866)
for commit `ecb432045543d85a6758caa24b8923e6db77f862`. It proves startup,
not a real provider-backed coding task on those runners.

Run [38573420931](https://github.com/huncijr/Klerm/actions/runs/38573420931) at
`96af208` succeeded on Windows x64/Linux x64. Both macOS jobs failed before build
because the launcher fixture compared `/var/...` and `/private/var/...` strings
instead of physical cwd identity. The local fix uses realpath and exercises
symlink/junction aliases; a fresh revision must prove macOS in CI again.

Native launcher/user-PATH fixes, direct live acceptance and shared-registry
dispatch shipped in `73291bf` / `96af208`. Current working-tree follow-up adds
OpenClaw, capability-driven admission/generic server setup and the CI fixture
fix. These are not yet target-platform/native-Gateway acceptance. An earlier
Codex re-check was quota-blocked; the current working-tree run succeeded again
across all three real turns. OpenClaw is not installed locally, so real Gateway
acceptance remains blocked.

The current OpenClaw follow-up fixes connection loss immediately after Stop
being treated as a confirmed abort. Missing native completion now reports failed,
uncertain execution through the shared reply/audit; connection-loss regressions
use protocol fixtures, not a real Gateway.

Hermes settlement now rejects incomplete native stop reasons as successful work
and preserves failed/uncertain execution on disconnect or unacknowledged Stop.
Regression coverage uses fake ACP through the shared registry; native provider
setup and real Hermes prompt/tools/Stop acceptance remain open.
Hermes observer isolation also protects native execution/tool attribution from
throwing or mutating callbacks; fake ACP tests exercise same-session follow-ups
after observer errors, incomplete turns and confirmed cancellation.

### October 18 live GPT-only acceptance (Linux x64, working tree)

| Native runtime / requested model | Actual result |
| --- | --- |
| Codex CLI 0.160.1 / `gpt-6.1-sol` | Three-turn prompt/reply, remembered token and native file read passed with one native session |
| Codex CLI 0.160.1 / `gpt-6.1-sol`, coding task | Native source/test creation passed; independent rerun passed 11 generated tests and five separate behavior assertions |
| Codex CLI 0.160.1 / `gpt-5.4` | Native rejection: model not supported with the current ChatGPT account; no replacement model |
| OpenCode v2.0.28 / `openai/gpt-6.1-sol` | Unsupported `run --dir` exposed an adapter bug; after using process cwd, the real native error is provider authentication `401` |

Local report roots under `/tmp/opencode/`: `klerm native acceptance 1wLfa0`
(Codex success), `klerm GPT build 7XQR5S` (coding success),
`klerm native acceptance 5U3k3h` (unsupported model), and
`klerm native acceptance 8x2XXV` (OpenCode after the cwd fix).
The reports are `native-verification.json` / `native-build-verification.json`;
ordered shared decisions are in each project's `.klerm/agent-adapter-events.jsonl`.
The coding task recovered from one failed native shell command before passing;
the report retains both failed and successful tool outcomes. No non-GPT model
was invoked. These are single-worker checks, not desktop/Stop/restart/two-agent
or target-platform acceptance. OpenClaw remains absent and Hermes native provider
setup remains blocked.

## Execution boundaries

- The generic SDK registry now backs live native dispatch through
  `createCodingHarnessAdapters`. RPC threads the outer task/correlation IDs
  through each native prompt. Existing native
  discovery/desktop choices still use explicit supported-harness metadata.
- Harness and model identity stay separate. No family-name quality ranking,
  invented role enforcement or automatic account/model replacement.
- Personal Agents reuse configuration for opted-in Browser/Kanban and linked
  built-in slots; their transcripts stay separate. External accounts/model
  namespaces are not converted into Personal Agents.
- Kanban workspace reservations currently protect one backend's Kanban runs,
  not other backend processes, ordinary harness tasks or external editors.
- Graph drafts do not dispatch work. Backend request deduplication and persisted
  transcripts do not imply restart-safe native execution.
- The base Docker image contains the built-in backend. External harnesses,
  their credentials and browser runtimes need deliberate worker installation.
- Browser Take control is a control handoff, not a private-input guarantee.

## Next implementation order

1. Deliver the macOS launcher-fixture fix and confirm the complete platform CI.
2. Shared native dispatch is implemented; complete mixed Klerm/external admission
   in one run before offering that combination as a team.
3. OpenClaw's adapter/setup is implemented in the working tree. Prove a real
   configured Gateway flow: native model/auth ownership, tools, Stop, explicit
   resume and workspace behavior. Protocol fixtures do not close this gate.
4. Prove a real bounded two-agent exchange with correlated replies and native
   session continuity, then add safe-boundary user intervention (60 seconds).
5. Persist task/session ownership and reconcile restart into resumable or
   interrupted/uncertain state without replaying unknown side effects. Extend
   shared writer admission before adding more execution surfaces.
6. Deploy the supervised backend on a real Droplet; verify Stop, reconnect,
   reboot, backup/restore and availability using the proven worker flow.
7. Deliver one executable Graph step, then reviewed handoffs. Persistent cron,
   isolated parallel writers and full browser delivery follow their prerequisites.

Native acceptance can happen earlier to unblock an adapter; it does not waive
the common-dispatch, conversation, intervention or recovery gates.

## Owner/environment prerequisites

| Work | Needed for real acceptance |
| --- | --- |
| Hermes | Native provider/model setup; native browser dependencies for browser work |
| OpenClaw | Installed bridge and running, configured Gateway with native authentication |
| DigitalOcean | Existing reachable Linux Droplet, SSH access and a selected workspace |
| Windows/macOS harness flows | Installed/authenticated worker on each target OS |
| Signed distribution | Owner-controlled signing accounts/configuration |

Without those environments, implementation and local contract checks can
progress, but the corresponding operational milestone stays open.

## Secondary backlog

The local app/server plans also retain full PTY/persistent terminal state,
platform credential storage, configurable image-generation selection, log
retention, richer browser controls and full browser workspace delivery. These
do not replace the adapter/conversation/recovery priority. Private browser input
and any new execution surface still require their explicit capability boundaries.

## Verification and guides

For real worker acceptance, from `harness` once the working-tree command is
included in the installed source revision:

```sh
node scripts/smoke-native-harness.mjs --live --harness "<installed-adapter-id>" --model "<native-model-id>"
```

Expect prompt/reply, remembered follow-up and a native file-tool check in the
same session, using the worker's own account (real quota/tokens). The command
prints the temporary workspace, `native-verification.json` and
`.klerm/bridge-events.jsonl` paths. Follow with app Stop/restart acceptance.
An unsupported adapter fails explicitly; this command does not add integrations.

- [Developer workflow](DEVELOPMENT.md)
- [Adapter contract and remaining gates](harness/packages/coding-agent/docs/agent-adapter-contract.md)
- [OpenClaw setup and real acceptance](harness/packages/coding-agent/docs/openclaw.md)
- [Platform setup and native acceptance](harness/packages/desktop/CROSS_PLATFORM.md)
- [Personal Agents and Kanban](harness/packages/desktop/PERSONAL_AGENTS.md)
- [Graph drafts](harness/packages/desktop/GRAPH_WORKSPACE.md)
- [Browser worker](harness/packages/browser-worker/README.md)
- [Private browser input design](harness/packages/browser-worker/PRIVATE_INPUT_PLAN.md)
- [Self-hosting and Docker](deploy/docker/README.md)

Keep this page and relevant usage docs aligned at each verified milestone.
Record revision, OS/architecture, worker version, actual behavior and log path;
keep implementation, contract checks and native acceptance separate.
