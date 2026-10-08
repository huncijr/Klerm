# Agent adapter contract: first backend slice

This SDK foundation separates the agent, adapter, harness and model identities.
`AgentDescriptor.harness.id` and adapter IDs are strings, not a closed brand enum.
The native model reference is optional and opaque: no brand-based model choice,
renaming, family ranking or assumed capabilities. A native default may remain
unnamed. An explicitly requested model must match the runtime's reported model.

## Implemented

- `AgentAdapterRegistry`: explicit registration, duplicate rejection and stable
  descriptor discovery. Discovery here lists registered descriptors; it does not
  check installations, authentication or readiness.
- `RuntimeAgentAdapter`: start, attributed prompt/reply, native-session identity,
  idle/running/stopped state, interrupt, stop and disposal.
- `PiAgentAdapter`: wraps a configured `AgentSession` supplied by its owner. The
  session retains its native auth, tools, memory and provider loop. The factory
  owns model selection, workspace setup and optional native resume; the adapter
  rejects replacement sessions or models. Advertise only capabilities actually
  enforced by that factory/runtime, including read-only roles.
- `FakeAgentAdapter`: scripted native-default/custom-model turns and cancellation,
  for contract tests only. Never registered as an installed real harness.
- `AgentAdapterJournal`: ordered decisions, observer subscription and in-process
  replay. Share one journal between all participants. Audit-write failure blocks
  execution. Observer failure cannot change persisted events.

Types and adapters are exported from the coding-agent SDK. To add a harness,
implement `AgentAdapter` or supply its real structured runtime through
`RuntimeAgentAdapter`, then explicitly register it. Registering a name alone is
not an integration. No commands/protocols are guessed for an unconnected harness.

## Ordering and logs

Every prompt has a version, message/task/correlation IDs, sender, recipient,
monotonic per-session sequence, timestamp, reason and optional reply-to ID.
Replies preserve task/correlation IDs and reverse sender/recipient, with a
reply-to link, journal sequence, timestamp, settlement status and artifacts.
Duplicate/out-of-order prompts are rejected before native execution. Rejected
envelopes on known sessions are logged without copying their invalid payload.

`agentAdapterEventSink(workspace)` writes
`<workspace>/.klerm/agent-adapter-events.jsonl`. Decisions contain native identity
and content hashes, not prompt/reply text, auth objects or tool payloads. Callers
must keep metadata (IDs, model references and reason) credential-free too.
Existing UI/RPC collaboration still writes `.klerm/bridge-events.jsonl`; these
streams describe different implementation slices.

## Selection fixes applied to current routing

The current external roster no longer infers model quality or task strengths
from names. Peer ordering uses configured roles/specialties and stable agent
order. The built-in router also stops family/parameter-count ranking and assumed
privacy/latency claims. Catalog metadata remains attributed as declared metadata;
missing metadata is unknown. Legacy numeric band fields are neutral placeholders,
not used for peer selection. Auto complexity recommendations use configured peer
availability, not an assertion that Agent 2 is stronger. Unrelated harness brands
are no longer aliases for the second built-in model.

## How To Test

From `harness/packages/coding-agent`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/agent-adapter-contract.test.ts test/coding-harness-setup.test.ts test/coding-harness-bridge.test.ts test/coding-harness-adapter.test.ts test/klerm-model-profile.test.ts test/klerm-routing-runtime.test.ts
```

Expected: all selected tests pass. The same basic contract runs against the fake
worker and the actual Pi/Klerm session with the faux provider. Additional checks
exercise native tools/cancellation/follow-up context, arbitrary harness/model
IDs, envelope rejection, exact identity, audit failure and ordered JSONL writes.
No real providers, credentials or paid tokens are used. Test logs use temporary
directories and are removed after verification.

From `harness`:

```bash
npm run check
```

## Remaining gates

This is a backend SDK slice, not a new desktop harness picker. The existing
desktop/discovery/native-adapter supported-harness lists are still explicit.
Migrating the existing native adapters and the live RPC dispatcher onto the common
registry, exposing custom registered adapters, mixed runtime dispatch,
agent-authored directed conversation, budgets, timed intervention and durable
restart reconciliation remain subsequent milestones. Journal replay is an
in-process projection; it does not restore sessions or repeat native actions.
