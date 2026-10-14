# Klerm status and next steps

Checkpoint: October 8, 2026. This is the shared source of truth for current
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
| Adapter SDK | Generic IDs, correlated envelopes, ordered journal, fake and Pi/Klerm reference adapters; the same registry now backs live native dispatch | Mixed Klerm/external execution in one run; OpenClaw adapter |
| Native workers | Structured adapters exist for supported workers; a real Codex CLI 0.160.1 flow passed on Linux x64 before the account quota was exhausted | Complete per-worker/per-platform acceptance and mixed-runtime dispatch |
| Hermes | v0.20.1 ACP initialize and adapter implementation; native session startup is blocked here | Configure a native provider, then prove prompt/tools/Stop/resume; shared Kanban/cron/browser bridge |
| OpenClaw | Official Gateway-backed ACP interface audited | Klerm adapter, configured Gateway and real acceptance |
| Collaboration | Sequential coordinator/peer/finalizer flow and bounded Prompt Together implementation | Agent-authored continuous conversation, common budgets and user intervention |
| Graph | Saved drafts, source catalog, validation and editor | Execution, shared session/workspace admission, run history/recovery |
| Self-hosting | Linux/Docker HTTP/SSE backend, owner authentication and basic browser control page locally checked | Full browser workspace, backup/restore and durable native-task recovery |
| DigitalOcean | Deployment instructions and reusable Linux/Docker foundation | Actual target deployment, reboot/reconnect and 24-hour availability proof |
| Browser | Linux development CEF surface and browser worker; native interaction evidence | CEF release/non-Linux hosting, server headless delivery and private-input observation lock |

The latest platform evidence is [CI run 37792473866](https://github.com/huncijr/Klerm/actions/runs/37792473866)
for commit `ecb432045543d85a6758caa24b8923e6db77f862`. It proves startup,
not a real provider-backed coding task on those runners.

Working-tree follow-up: Windows-aware native launcher/user-PATH fixes, a live
harness acceptance command, and the shared-registry live-dispatch migration
passed local checks. They are not part of `ecb4320`;
their Windows/macOS result needs a new committed-revision CI run. The October
follow-up live Codex re-check was blocked by an exhausted account quota; the
adapter correctly reported the native usage-limit error instead of claiming
success.

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

1. Finish native launcher delivery and record its exact revision/platform proof.
2. ~~Put the common adapter registry behind live RPC/desktop/headless dispatch.~~
   Done in the working tree: `createCodingHarnessAdapters` returns
   registry-backed adapters; outer task/correlation flows into the shared
   journal. Remaining: mixed Klerm/external execution in one run.
3. Add the OpenClaw adapter against its documented ACP interface. Keep Gateway
   model/auth ownership native and reject unsupported roles/operations explicitly.
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
- [Platform setup and native acceptance](harness/packages/desktop/CROSS_PLATFORM.md)
- [Personal Agents and Kanban](harness/packages/desktop/PERSONAL_AGENTS.md)
- [Graph drafts](harness/packages/desktop/GRAPH_WORKSPACE.md)
- [Browser worker](harness/packages/browser-worker/README.md)
- [Private browser input design](harness/packages/browser-worker/PRIVATE_INPUT_PLAN.md)
- [Self-hosting and Docker](deploy/docker/README.md)

Keep this page and relevant usage docs aligned at each verified milestone.
Record revision, OS/architecture, worker version, actual behavior and log path;
keep implementation, contract checks and native acceptance separate.
