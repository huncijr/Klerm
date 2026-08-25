# Klerm Coding Agent

Klerm is an A2A terminal coding agent that routes work between a local model
and a configured frontier model. The CLI executable is `klerm` and its user
configuration is stored under `~/.klerm/agent/`.

The published workspace package currently retains the inherited
`@earendil-works/pi-coding-agent` package name for compatibility. User-facing
commands, configuration paths, routing behavior, and branding use Klerm.

## Start

From the Klerm source checkout:

```bash
cd harness
npm install --ignore-scripts
npm run build:offline
npm link --ignore-scripts --workspace=@earendil-works/pi-coding-agent
klerm
```

Run directly from source in any project directory:

```bash
/path/to/Klerm/harness/klerm-test.sh
```

## Models

Use `/model` for direct model selection or configure the two A2A lanes:

```text
/local model ollama/qwen3.5:9b-q4_K_M
/frontier model openai-codex/gpt-5.5
/routing auto
```

Useful commands:

```text
/local
/frontier
/routing off
/routing local
/routing frontier
/routing auto
/routing fallback on
/routing handback on
/routing cycles 3
/routing status
/klerm
```

One-task route overrides do not change the persisted routing mode:

```text
/local task <prompt>
/frontier task <prompt>
```

## Delegation

The local worker receives the `delegate_frontier` tool. It must use the tool
when the user explicitly asks it to consult Codex, the frontier worker, or the
other configured model. It may also delegate work that is too complex, risky,
or blocked locally.

In auto mode Klerm always starts the local orchestrator. Deterministic checks
mark broad, risky, multi-file, project-scaffolding, and build-setup tasks with
`delegationRecommended`. If the first completed local response ignores that
recommendation, Klerm enforces the frontier handoff and logs trigger
`recommended-enforcement` before returning completed frontier work to local.

For local-owned tasks, the frontier worker receives `return_to_local` and sends
a structured result back for local verification. This can repeat until the task
is complete or the configured delegation cycle budget is exhausted. Automatic
frontier routes return to local by default; explicit `/frontier task` and
`/routing frontier` tasks remain frontier-owned.

Example:

```text
/local task Tell the Codex worker which model you are using, then delegate and ask Codex to identify its own model.
```

Klerm preserves the session, working directory, transcript, and tool results
across the handoff. Provider-specific tool history is projected into neutral
context before another provider receives it.

For explicit frontier requests, the runtime also detects when a local model
prints a pseudo tool call instead of using the native tool interface. Klerm
enforces the requested handoff and records why it was enforced.

Interactive startup and agent work use small animated status spinners. A
`➤ Done` status replaces the spinner after the complete agent run settles.

## Local Runtime

Klerm discovers models from Ollama, LM Studio, vLLM, and standalone llama.cpp
servers without downloading them:

```bash
klerm local status
klerm local models
klerm providers
```

Default OpenAI-compatible probes use ports `1234` (LM Studio), `8000` (vLLM),
and `8080` (llama.cpp server). Override them with
`KLERM_LM_STUDIO_URL`, `KLERM_VLLM_URL`, or
`KLERM_LLAMA_CPP_SERVER_URL`. Configure another compatible endpoint with
`KLERM_OPENAI_LOCAL_URL`. Unsloth exports are detected through whichever
runtime serves them.

## Configuration And Logs

```text
~/.klerm/agent/settings.json
~/.klerm/agent/klerm.json
.klerm/router-decisions.jsonl
```

Inspect routing diagnostics:

```bash
klerm debug route "fix auth"
klerm debug decisions
klerm debug registry
```

## Harness Documentation

- [Models](docs/models.md)
- [Custom providers](docs/custom-provider.md)
- [Extensions](docs/extensions.md)
- [Skills](docs/skills.md)
- [Prompt templates](docs/prompt-templates.md)
- [Themes](docs/themes.md)
- [TUI](docs/tui.md)
- [Keybindings](docs/keybindings.md)
- [Environment variables](docs/environment-variables.md)
- [Containerization](docs/containerization.md)

## Security

Klerm coding tools run with the permissions of the user and process that
started the CLI. Review project instructions and third-party extensions, and
use a container or sandbox for untrusted work.

## License

Klerm is derived from `earendil-works/pi` under the MIT License. The original
copyright and license notice are preserved in the repository `LICENSE` file.
