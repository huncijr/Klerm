# OpenClaw Gateway worker

Klerm now registers a native OpenClaw ACP adapter in the same live dispatch
registry as other supported native workers. It is available through discovery,
Settings → Agents, numbered CLI setup and the headless worker configuration form.
This is implemented and protocol-fixture verified; an installed/configured real
Gateway, full desktop/native acceptance and Droplet acceptance remain open.

## Native ownership

Klerm launches `openclaw acp` over JSON-RPC stdio. OpenClaw connects to its
Gateway using its own configuration/environment. Gateway model choice, provider
authentication, tools, memory and permission policy stay native. Klerm sends no
model-selection or permission-mode commands and does not copy Gateway secrets
into agent settings or process arguments.

Select **Native configuration (runtime-owned model)**. The stored
`native-default` value is a configuration selector, not a resolved model ID.
The shared adapter journal leaves model identity absent when it is unknown.
Build is supported under the Gateway's actual permissions. Plan/read-only,
Klerm Full access, reasoning overrides, tool overrides, image forwarding and
per-session MCP injection are not advertised as supported.
Klerm reasoning **Off** means no override; it does not disable the Gateway's
configured reasoning. This slice uses the Gateway's configured default agent;
per-slot native-agent/profile selection and arbitrary existing-session attachment
are not exposed.

The implementation was audited against [upstream ACP documentation](https://docs.openclaw.ai/cli/acp)
and source revision [`8c4ea360522c290cada727b04a09408457b44393`](https://github.com/openclaw/openclaw/tree/8c4ea360522c290cada727b04a09408457b44393/src/acp).
This source audit is not a supported-release/native acceptance claim.

## Sessions and Stop

- Every new participant gets a fresh `acp-bridge:klerm-<uuid>` Gateway key.
  Klerm supplies the key explicitly and requires matching
  `session_info_update._meta.sessionKey` acknowledgement. A different mapping
  fails startup; an unrelated/human/default session is never a fallback.
- The process-local ACP session ID is kept separately. Prompt/cancel/close use
  that ACP ID; saved native references use the stable isolated Gateway key.
- Explicit resume requires advertised ACP `session/resume`, an existing Gateway
  session and matching mapping. Missing or unsupported resume fails without
  `session/new`, `session/load` or reset fallback. Automatic backend-restart
  reconciliation is not implemented by this adapter.
- Native tool calls and text updates are attributed to the active participant.
  Completed tool notifications are deduplicated. Other-session updates and
  private reasoning/approximate usage are not treated as this worker's output.
- Stop requests native cancellation and waits for settlement. If the bridge
  does not acknowledge cancellation within five seconds, the bridge is closed,
  the request fails explicitly and Gateway work is marked potentially active.
  Inspect native work before retrying; bridge termination is not proof that a
  remote Gateway tool's side effects have stopped.
- Connection loss, a prompt timeout or an RPC failure before confirmed native
  completion also fails with `uncertain: true`, including disconnection immediately
  after Stop. Sending cancellation alone never proves that Gateway work stopped.
- Closing retires the ACP session when advertised and closes only Klerm's bridge
  process, not the shared Gateway daemon or another participant's session.

## Native approvals

This slice does not supply an interactive ACP permission relay. Requests for
native tool approval are denied/cancelled, and that turn fails visibly rather
than claiming completion. Operations already allowed by the Gateway's own
policy can run. Configure native policy or perform the approved action in the
native Gateway surface; Klerm does not select a thought mode as an authorization
mode or grant global approval based on a tool's title/kind.

## How To Test

First install and onboard OpenClaw using its official instructions, configure
the provider/model and Gateway workspace, then verify natively:

```sh
openclaw --version
openclaw gateway status
openclaw acp client
```

Native settings must target the intended local/remote Gateway. Use native
credential storage or token/password-file configuration rather than putting
credentials into Klerm's agent JSON. A Docker installation needs the worker
installed deliberately; the base Klerm image does not contain OpenClaw/Gateway.

From `harness`:

```sh
npm run app -- --foreground
```

1. Open Settings → Agents and Refresh discovery. OpenClaw must be installed and
   its ACP handshake must succeed; a version-only probe is not Gateway readiness.
2. Enable external dispatch, choose OpenClaw for a slot, select Native
   configuration, Build, reasoning Off and no Klerm tool overrides. Save.
3. Send a harmless prompt, then a follow-up referencing the previous turn.
   Verify the native Gateway key stays the same. Run an allowed file-reading
   task against the configured Gateway workspace and inspect attributed tools.
4. Request an operation requiring approval: expect visible denial/failure, not
   automatic approval or a false completion. Stop a longer harmless task and
   check acknowledgement or the explicit uncertain-cancellation error.
5. The server control page offers **Harness → Configure worker** using actual
   discovered capabilities. It no longer assumes one particular harness.

An opt-in direct adapter check is also available from `harness`:

```sh
node scripts/smoke-native-harness.mjs --live --harness openclaw --model native-default
```

It makes three real turns under the native account and may consume quota/tokens.
The random marker-file check requires that the Gateway's tools can access the
printed temporary project on the correct host. ACP `cwd` is context metadata,
not a remote mount, workspace assignment or filesystem-isolation guarantee.
Expect three `Passed:` lines and `status: passed`; denied/inaccessible tools fail
the check. App Stop/restart and target-host checks are additional acceptance.

Logs: `<workspace>/.klerm/agent-adapter-events.jsonl` for ordered shared native
decisions, `<workspace>/.klerm/bridge-events.jsonl` for collaboration lifecycle.
The direct check prints its own temporary workspace, `native-verification.json`
and decision paths. Normal audits contain identities/hashes and tool names,
not prompt/reply text, tool payloads or Gateway credentials.

Provider-free contracts from `harness/packages/coding-agent`:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/openclaw-adapter.test.ts test/registered-coding-harness-adapter.test.ts test/coding-harness-setup.test.ts test/rpc-coding-harness-setup.test.ts test/headless-server.test.ts
```

These use fake ACP/Gateway responses, not an installed OpenClaw or a paid model.
They cover session isolation/mapping, follow-ups, explicit safe resume, tools,
permission denial, cancellation/uncertainty, native model ownership and generic
worker configuration. CI runs the native adapter/launcher contracts on each OS;
that does not prove authenticated Gateway operation there.
