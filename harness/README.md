<p align="center">
  <img alt="Klerm logo" src="../Logo/Klerm_logo_no_background.png" width="192">
</p>

# Klerm Agent Harness

Klerm is an A2A coding agent and routing system built on the Pi agent harness.
It keeps Pi's provider, agent, session, protocol, and TUI foundations while
adding Klerm routing and product behavior.

Klerm is derived from `earendil-works/pi` under the MIT license. Original Pi
copyright and license notices are preserved.

* **[@earendil-works/pi-coding-agent](packages/coding-agent)**: Interactive coding agent CLI
* **[@earendil-works/pi-agent-core](packages/agent)**: Agent runtime with tool calling and state management
* **[@earendil-works/pi-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)

For upstream Pi documentation:

* [Visit pi.dev](https://pi.dev), the project website with demos
* [Read the documentation](https://pi.dev/docs/latest), but you can also ask the agent to explain itself

## Try Klerm Locally

Install dependencies and build the local CLI:

```bash
npm install --ignore-scripts
npm run build:offline
npm link --ignore-scripts --workspace=@earendil-works/pi-coding-agent
```

Open a new folder and start the interactive Klerm CLI:

```bash
mkdir -p /tmp/klerm-smoke
cd /tmp/klerm-smoke
klerm
```

Enter a task in the interactive prompt, for example:

```text
Create a small website with a hero section and three pricing cards.
```

Use `/model` inside the interactive CLI to open the model selector. You can
also select a model at startup or run one non-interactive prompt:

```bash
klerm --list-models
klerm --model google/gemini-3.5-flash-lite
klerm --model google/gemini-3.5-flash-lite -p "Say exactly: ok"
```

The selected provider must be authenticated. Set its API key before starting
Klerm, or run `klerm`, enter `/login`, and select a supported subscription
provider. Klerm stores its user configuration under `~/.klerm/agent/`.

## Local Worker And A2A Routing

Klerm discovers installed Ollama models without downloading them. Install the
model yourself, then verify the local runtime:

```bash
ollama pull qwen3.5:9b-q4_K_M
klerm local status
klerm local models
klerm providers
```

Start Klerm from any project directory. During source development, invoke the
source launcher by absolute path so the current project remains the working
directory:

```bash
cd ~/Desktop/my-project
klerm

# Or run the current checkout without rebuilding/linking it:
~/Desktop/Klerm/harness/klerm-test.sh
```

The startup screen includes a routing quick guide. Configure both A2A lanes and
the routing mode inside the interactive CLI:

```text
/local model ollama/qwen3.5:9b-q4_K_M
/frontier model openai-codex/gpt-5.5
/routing fallback on
/routing auto
/klerm
```

| Command | Purpose |
|---|---|
| `/local` or `/local model` | Open the local Ollama/llama.cpp model selector. |
| `/local model <provider/model>` | Persist the local router/worker model. |
| `/frontier` or `/frontier model` | Open the frontier model selector. |
| `/frontier model <provider/model>` | Persist the frontier worker model. |
| `/model <provider/model>` | Set the direct model used when routing is `off`. |
| `/routing auto` | Let the local model route small work locally and difficult work to frontier. |
| `/routing local` | Send every normal prompt to the local worker. |
| `/routing frontier` | Send every normal prompt directly to frontier. |
| `/routing off` | Disable Klerm A2A routing and use `/model` directly. |
| `/routing fallback on\|off` | Allow or deny explicit frontier fallback when auto routing cannot start locally. |
| `/local task <prompt>` | Force one task to start locally without changing the saved routing mode. |
| `/frontier task <prompt>` | Force one task to start on frontier without changing the saved routing mode. |
| `/klerm` or `/routing status` | Show the current Klerm configuration and routing state. |

The persistent status block directly above the chat input keeps the selected
models and routing mode visible together. It marks the model currently serving
the task with a green inline label:

```text
Local model: ollama/qwen3.5:9b-q4_K_M (currently active)
Frontier model: openai-codex/gpt-5.5
Routing: auto
Active route: local · ollama/qwen3.5:9b-q4_K_M
```

Missing selections are shown as `none`. When a second model participates in the
same task, the footer keeps the A2A handoff visible until the next task starts:

```text
Local model: ollama/qwen3.5:9b-q4_K_M
Frontier model: openai-codex/gpt-5.5 (currently active)
Routing: auto
Active route: frontier · openai-codex/gpt-5.5
+ ollama/qwen3.5:9b-q4_K_M called for this task: <original task>
handoff reason: <reason supplied by the local worker>
```

The local worker has the normal read/edit/write/bash tool loop and can call the
`delegate_frontier` control tool. Klerm then switches models between agent turns
while preserving the same session, transcript, working directory, and tool
results. Provider-specific tool history is projected into provider-neutral
handoff context, so Ollama, Codex, Gemini, and other providers do not need to
understand each other's private tool metadata.

Deterministic safeguards can also escalate local work after provider failure,
repeated tool errors, repeated calls, or the configured local turn limit.

Force each lane independently without changing the persisted routing mode:

```text
/local task Say exactly: local-ok
/frontier task Say exactly: frontier-ok
```

For a real local-to-frontier smoke test:

```text
/local task Create a directory named a2a-smoke and write spec.txt inside it containing exactly handoff-required. Read it back, then call delegate_frontier and do not finish the task yourself. Tell the frontier worker to read spec.txt, create result.json containing {"success":true,"completedBy":"frontier"}, and reply exactly A2A-SMOKE-PASSED.
```

Expected lifecycle:

```text
local router/worker
→ local tool use
→ delegate_frontier
→ frontier worker continues the same session
→ A2A-SMOKE-PASSED
```

Inspect the result from inside the TUI with `!cat a2a-smoke/result.json`.

The same setup can be supplied for one CLI invocation:

```bash
klerm --routing auto \
  --local-model ollama/qwen3.5:9b-q4_K_M \
  --frontier-model openai-codex/gpt-5.5 \
  --allow-frontier-fallback
```

Routing configuration is stored in `~/.klerm/agent/klerm.json`. Per-project
decisions are written to `.klerm/router-decisions.jsonl`. A successful A2A
handoff contains `INITIAL_ROUTE`, `LOCAL_STARTED`, `DELEGATE_FRONTIER`,
`FRONTIER_STARTED`, and `TASK_COMPLETED` events.

Router diagnostics are separate from the normal chat workflow:

```bash
klerm debug route "fix auth"
klerm debug decisions
klerm debug registry
```

## All Packages

| Package | Description |
|---------|-------------|
| **[@earendil-works/pi-telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas |
| **[@earendil-works/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@earendil-works/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@earendil-works/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@earendil-works/pi-tui](packages/tui)** | Terminal UI library with differential rendering |

For Slack/chat automation and workflows see [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat).

## Permissions & Containerization

Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox Pi. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `pi` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `pi` process in a local container for simple isolation.
- **OpenShell**: run the whole `pi` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).  Longer term plans for Pi can also be found in [RFCs](https://rfc.earendil.com/keyword/pi/).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./klerm-test.sh      # Run Klerm from sources (can be run from any directory)
```

## Building standalone binaries from release source

GitHub releases include a versioned source archive covered by the release's `SHA256SUMS` file. Extract it and run the same build script used for the official standalone binaries:

```bash
VERSION="<release-version>"
tar -xzf "pi-${VERSION}-source.tar.gz"
cd "pi-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

The source archive includes the generated provider model data used for the release. `--offline-model-data` builds with that snapshot instead of refreshing it from live provider catalogs. The script still installs dependencies, builds the monorepo, compiles the Bun executable, and stages its runtime assets. Package maintainers who provide dependencies separately can pass `--skip-install --skip-deps`.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `pi update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## Share your OSS coding agent sessions

If you use Pi or other coding agents for open source work, please share your sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `pi-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where I show how I publish my `pi-mono` sessions.

I regularly publish my own `pi-mono` work sessions here:

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## License

MIT

<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
