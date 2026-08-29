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
/active auto
/active local
/active frontier
/active frontier-local
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
a structured result back for local verification. A frontier-owned task can use
`delegate_local` for focused local work; the local worker then uses
`return_to_frontier` so the frontier owner can review and finalize. Klerm
enforces the required return if either delegated worker finishes without the
native return tool.

Each delegation away from the completion owner starts one A2A cycle. The
default `3` cycle budget is a per-task loop-safety limit, not a model limit; set
it from `1` to `20` with `/routing cycles <count>`. The matching return does not
consume another cycle.

With handback enabled and a configured local model, normal `/routing frontier`
and `/active frontier` starts run frontier first but keep local completion
ownership. Explicit `/frontier task` remains frontier-owned and can delegate
focused work to local. For local-owned delegation, disabling handback transfers
ownership to frontier instead of requiring a return.

`/active` controls the initial worker independently from the routing mode.
`frontier-local` always starts at the frontier worker and keeps local ownership,
even when the persisted handback setting is off, so the frontier worker must
call `return_to_local` before Klerm completes the task.
`/activ` is an alias for `/active`.

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

## MCP

Klerm exposes tools from configured MCP servers as
`mcp_<server>_<tool>`. Configure and inspect servers interactively:

```text
/mcpset
/mcpset add
/mcpset filesystem stdio npx -y @modelcontextprotocol/server-filesystem /home/user/project
/mcpset remote http https://example.com/mcp Authorization="Bearer token"
/mcpset legacy-sse sse https://example.com/sse X-API-Key=token
/mcp
/mcp status
/mcps
/mcpset filesystem disable
/mcpset filesystem enable
/mcpset filesystem remove
```

Run `/mcpset` without arguments for a guided setup. It asks for scope, server
name, transport, transport-specific connection fields, optional credentials or
headers, and enabled state. Optional fields can be skipped with Enter; type
`back`, `cancel`, or `?` during the flow for navigation.

Scripted commands write global settings by default. Add `--project` immediately
after `/mcpset` to write `.klerm/settings.json`; project MCP servers start only
after the project is trusted. Configuration changes reload the session so old
connections close before the tool registry is rebuilt. Klerm supports stdio,
Streamable HTTP, and SSE tool transports. Prompts, resources, MCP tasks, and
automatic server-side tool-list refresh are not implemented in this milestone;
server-side tool-list changes require `/reload`.

Run `/mcp` to select a connected tool and insert `Use MCP tool <name>` into the
editor. Run `/mcp status [server]` for connection details. Type `/mcps` alone or
inside prompt text to select a tool and insert only its namespaced name, such as
`mcp_filesystem_read_file`; `@` remains reserved for project files.

When an AI invokes an MCP tool, Klerm displays a notice before the remote call,
for example `mcp: github/search_issues used`. The notice includes only the MCP
server and tool names, never tool arguments, environment values, or headers.

You can also ask the AI to configure a server, for example: `Configure a stdio
MCP server named filesystem using npx -y @modelcontextprotocol/server-filesystem
/home/user/project`. The AI uses `configure_mcp_server` to persist stdio,
Streamable HTTP, or SSE settings and displays `mcp: <name> configured`. Run
`/reload` afterward to load the new tools. For safety, the AI tool cannot accept
credential values; add required environment values or HTTP headers through
`/mcpset`. Compatible credentials already stored for a server are preserved
when the AI updates it.

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

Each finalized routed provider response adds one `MODEL_RESPONSE` event to
`.klerm/router-decisions.jsonl`. It records provider, resolved model, input,
output, cache-read, cache-write, reasoning and total tokens, plus calculated USD
cost. `costSource` is `model-catalog` when token metadata is available and
`unavailable` for all-zero usage. One response produces one accounting event,
so transition events cannot double-count delegated work.

Klerm also shows the same response accounting directly below each finalized
assistant response in the TUI and below the final response in `-p` text mode:

```text
Klerm usage: input 11 | output 5 | cache read 3 | total 19 | cost $0.012
```

The line is hidden while a response is streaming. When no token metadata is
available it displays `Klerm usage: unavailable | cost unavailable`.

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
use a container or sandbox for untrusted work. Stdio MCP servers are executable
child processes with the same host permissions, and HTTP/SSE MCP servers can
receive tool arguments and configured headers, so only configure servers you
trust.

## License

Klerm is derived from `earendil-works/pi` under the MIT License. The original
copyright and license notice are preserved in the repository `LICENSE` file.
