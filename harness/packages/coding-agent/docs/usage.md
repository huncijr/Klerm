# Using Pi

This page collects day-to-day usage details that do not fit on the quickstart page.

## Interactive Mode

<p align="center"><img src="images/interactive-mode.png" alt="Interactive Mode" width="600"></p>

The interface has four main areas:

- **Startup header** - shortcuts, loaded context files, prompt templates, skills, and extensions
- **Messages** - user messages, assistant responses, tool calls, tool results, notifications, errors, and extension UI
- **Editor** - where you type; border color indicates the current thinking level
- **Footer** - working directory, session name, token/cache usage, cost, context usage, and current model. Totals include assistant responses, usage reported by tools, and summary generation.

The editor can be replaced temporarily by built-in UI such as `/settings` or by custom extension UI.
The default startup view omits the basic shortcut list and keeps routing status to
three lines. Press Ctrl+O to expand or collapse shortcuts, routing details, the
full routing guide, and tool output together.

### Editor Features

| Feature | How |
|---------|-----|
| File reference | Type `@` to fuzzy-search project files |
| MCP tool reference | Type `/mcps` by itself or inside prompt text, then press Enter and select a connected tool |
| Path completion | Press Tab to complete paths |
| Multi-line input | Shift+Enter, or Ctrl+Enter on Windows Terminal |
| Copy response | Ctrl+X copies the last assistant message; in `/tree`, it copies the selected message |
| Images | Paste with Ctrl+V, Alt+V on Windows, or drag into the terminal |
| Shell command | `!command` runs and sends output to the model |
| Hidden shell command | `!!command` runs without sending output to the model |
| External editor | Ctrl+G opens `externalEditor`, `$VISUAL`, `$EDITOR`, Notepad on Windows, or `nano` elsewhere |

See [Keybindings](keybindings.md) for all shortcuts and customization.

## Slash Commands

Type `/` in the editor to open command completion. Extensions can register custom commands, skills are available as `/skill:name`, and prompt templates expand via `/templatename`.

| Command | Description |
|---------|-------------|
| `/login`, `/logout` | Manage OAuth or API-key credentials |
| [`/llama`](llama-cpp.md) | Download, load, and unload llama.cpp router models |
| `/model` | Switch models |
| `/active <auto|local|frontier|frontier-local>` | Set the Klerm initial worker lane (`/activ` is an alias) |
| `/routing handback on|off` | Return delegated work to the task's completion owner |
| `/routing cycles <count|unlimited>` | Set any positive per-task A2A cycle limit, or remove it with `unlimited`/`0` (default `3`) |
| `/mcp` | Select a connected tool and insert `Use MCP tool <name>` into the editor |
| `/mcp status [server]` | List configured MCP servers and exposed tools |
| `/mcps` | Select and insert a namespaced MCP tool name; also works inside prompt text |
| `/mcpset`, `/mcpset add` | Add an MCP server with a guided setup wizard |
| `/mcpset [--project] <name> ...` | Add, remove, enable, or disable an MCP server with a scripted command |
| `/token [on|off]` | Show or hide response token and cost lines; `/token` toggles the current state |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/settings` | Thinking level, theme, message delivery, transport |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set session display name |
| `/session` | Show session file, ID, messages, tokens, and cost |
| `/tree` | Jump to any point in the session and continue from there |
| `/trust` | Save project trust decision for future sessions |
| `/fork` | Create a new session from a previous user message |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact [prompt]` | Manually compact context, optionally with custom instructions |
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML or JSONL |
| `/import <file>` | Import and resume a session from a JSONL file |
| `/share` | Upload as private GitHub gist with shareable HTML link |
| `/reload` | Reload keybindings, extensions, skills, prompts, themes, and context files |
| `/hotkeys` | Show all keyboard shortcuts |
| `/changelog` | Display version history |
| `/quit` | Quit pi |

MCP tool calls display `mcp: <server>/<tool> used` before the remote call. Tool
arguments and configured credentials are not included in this notice.
Run `/mcp` to select a connected tool and prepare an explicit instruction such
as `Use MCP tool mcp_fake_echo_text`. To reference a tool inside an existing
prompt, type `/mcps`, press Enter, and select it; Klerm replaces that marker with
the namespaced tool name without sending the prompt. The `@` autocomplete remains
reserved for project files.

The AI can create or update MCP settings with its `configure_mcp_server` tool
when asked in natural language. It supports stdio, Streamable HTTP, and SSE,
respects project trust, and cannot accept credential values. Add credentials
with `/mcpset`, then run `/reload` to load tools from the new configuration.

With handback enabled, `/routing frontier` and `/active frontier` start with the
frontier model and return to the configured local completion owner. An explicit
`/frontier task <prompt>` is frontier-owned: it can call `delegate_local`, and
the local worker returns with `return_to_frontier`. Local-owned delegation uses
`delegate_frontier` and `return_to_local`. One cycle is one delegation away from
the owner plus its return; the return itself does not consume a second cycle.
The default per-task limit is three cycles. Use `/routing cycles <count>` to set
any positive integer, or `/routing cycles unlimited` (equivalent to `0`) to
remove the limit. Cycle counts and transitions remain visible in decision logs
when unlimited mode is active.

Successful delegation and return transitions are also stored as privacy-safe
session entries. Reopening a session with `--session`, `--continue`, or
`--resume` renders the same `called other model` and `returned to` markers that
were shown during the live run. Sessions created before these entries existed
reconstruct the markers from their persisted Klerm handoff messages, routing
tool results, and model changes. This reconstruction does not copy worker
response bodies into routing metadata.

Routed provider responses are recorded once each as `MODEL_RESPONSE` entries in
`.klerm/router-decisions.jsonl`. These entries include provider/model attribution,
token class counts, total tokens, calculated USD cost, and deterministic usage
availability. All-zero usage is marked unavailable because provider adapters do
not expose a separate usage-provenance flag.

In Klerm interactive mode, each finalized assistant response shows a dim
`Klerm usage:` line directly underneath it with response token classes, total
tokens, and cost. Text print mode (`-p`) prints the same line after the final
answer. This display is on by default; use `/token off`, `/token on`, or
`/token` to persistently hide, show, or toggle it. Streaming output does not
show provisional usage, and JSON/RPC output remains structured without an
added human-readable line.

## Message Queue

You can submit messages while the agent is still working:

- **Enter** queues a steering message, delivered after the current assistant turn finishes executing its tool calls.
- **Alt+Enter** queues a follow-up message, delivered after the agent finishes all work.
- **Escape** aborts and restores queued messages to the editor.
- **Alt+Up** retrieves queued messages back to the editor.

On Windows Terminal, Alt+Enter is fullscreen by default. Remap it as described in [Terminal setup](terminal-setup.md) if you want pi to receive the shortcut.

Configure delivery in [Settings](settings.md) with `steeringMode` and `followUpMode`.

## Sessions

Sessions are saved automatically to `~/.pi/agent/sessions/`, organized by working directory.

```bash
pi -c                  # Continue most recent session
pi -r                  # Browse and select a session
pi --no-session        # Ephemeral mode; do not save
pi --name "my task"    # Set session display name at startup
pi --session <path|id> # Use a specific session file or session ID
pi --fork <path|id>    # Fork a session into a new session file
```

Useful session commands:

- `/session` shows the current session file and ID.
- `/tree` navigates the in-file session tree and can summarize abandoned branches.
- `/fork` creates a new session from an earlier user message.
- `/clone` duplicates the current active branch into a new session file.
- `/compact` summarizes older messages to free context.

See [Sessions](sessions.md) and [Compaction](compaction.md) for details.

## Context Files

Pi loads `AGENTS.md` or `CLAUDE.md` at startup from:

- `~/.pi/agent/AGENTS.md` for global instructions
- parent directories, walking up from the current working directory
- the current directory

If a directory contains `AGENTS.override.md`, Pi loads it instead of `AGENTS.md` or `CLAUDE.md` from that directory. Context files from other directories still layer normally.

Use context files for project conventions, commands, safety rules, and preferences. Disable loading with `--no-context-files` or `-nc`.

### System Prompt Files

Replace the default system prompt with:

- `.pi/SYSTEM.md` for a project
- `~/.pi/agent/SYSTEM.md` globally

Append to the default prompt without replacing it with `APPEND_SYSTEM.md` in either location.

### Project Trust

On interactive startup, pi asks before trusting a project folder that contains project-local settings, resources, or project `.agents/skills` and has no saved decision for the folder or a parent folder in `~/.pi/agent/trust.json`. Trusting a project allows pi to load `.pi/settings.json` and `.pi` resources, install missing project packages, and execute project extensions.

Before the trust decision, pi loads only context files, user/global extensions, and CLI `-e` extensions so they can handle the `project_trust` event. Project-local extensions, project package-managed extensions, and project settings are loaded only after the project is trusted. This split also applies when switching to a session from a different cwd whose trust has not been resolved in the current process.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask` (default) and `never` ignore those project resources, while `always` trusts them. Pass `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

If no extension or saved decision applies, `defaultProjectTrust` controls the fallback behavior. Set it to `"ask"`, `"always"`, or `"never"` in `~/.pi/agent/settings.json`, or change it with `/settings`.

`pi config` and package commands use the same project trust flow, except `pi update` never prompts. Pass `--approve` to trust project-local settings for one command or `--no-approve` to ignore them.

Use `/trust` in interactive mode to save a project trust decision for future sessions, including trust for the immediate parent folder. It writes `~/.pi/agent/trust.json` only; the current session is not reloaded, so restart pi for changes to take effect.


## Exporting and Sharing Sessions

Use `/export [file]` to write a session to HTML.

Use `/share` to upload a private GitHub gist with a shareable HTML link.

If you use pi for open source work and want to publish sessions for model, prompt, tool, and evaluation research, see [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). It publishes sessions to Hugging Face datasets.

## CLI Reference

```bash
pi [options] [@files...] [messages...]
```

### Package Commands

```bash
pi install <source> [-l]     # Install package, -l for project-local
pi remove <source> [-l]      # Remove package
pi uninstall <source> [-l]   # Alias for remove
pi update [source|self|pi]   # Update pi only, or one package source
pi update --all              # Update pi and packages; reconcile pinned git refs
pi update --extensions       # Update packages only; reconcile pinned git refs
pi update --models           # Refresh model catalogs only
pi update --self             # Update pi only
pi update --extension <src>  # Update one package
pi list                      # List installed packages
pi config                    # Enable/disable package resources
```

These commands manage pi packages and `pi update` can update the pi CLI installation. To uninstall pi itself, see [Quickstart](quickstart.md#uninstall). `pi config` and project package commands accept `--approve`/`--no-approve` to trust or ignore project-local settings for one command. `pi update` never prompts for project trust.

See [Pi Packages](packages.md) for package sources and security notes.

### Klerm Diagnostics Commands

```bash
klerm doctor [--json]                # Health check: storage, config, decision log, runtimes, providers
klerm session timeline <session>     # Structured timeline of one session (id, prefix, or file path)
klerm routing status [--json]        # Show the persisted routing configuration
klerm config get [key] [--json]      # Read persisted Klerm routing config
klerm config set <key> <value>       # Update persisted Klerm routing config
klerm debug decisions [flags]        # Print, filter, or summarize routing decisions
```

`klerm doctor` checks that the agent and session storage is writable, the Klerm
config parses, `.klerm/router-decisions.jsonl` contains valid JSONL, at least
one local model is reachable, at least one frontier provider is configured, and
routing is not disabled. Exit codes: `0` all pass, `2` warnings only, `1`
failure. It never calls models, providers, or prints credentials.

`klerm session timeline` prints model changes, Klerm transitions (including
reconstructed legacy handoffs), and messages. Tool output is hidden by default;
use `--with-tools`, `--with-cost`, `--compact`, or `--json` for structured
output.

`klerm debug decisions` accepts `--event <type>`, `--route <route>`,
`--task-id <id>`, `--since <ISO date>`, `--limit <count>`, and `--summary`
(total events, event/route counts, token and cost sums).

### Modes

| Flag | Description |
|------|-------------|
| default | Interactive mode |
| `-p`, `--print` | Print response and exit |
| `--mode json` | Output all events as JSON lines; see [JSON mode](json.md) |
| `--mode rpc` | RPC mode over stdin/stdout; see [RPC mode](rpc.md) |
| `--export <in> [out]` | Export a session to HTML |

In print mode, pi also reads piped stdin and merges it into the initial prompt:

```bash
cat README.md | pi -p "Summarize this text"
```

### Model Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider, such as `anthropic`, `openai`, or `google` |
| `--model <pattern>` | Model pattern or ID; supports `provider/id` and optional `:<thinking>` |
| `--api-key <key>` | API key, overriding environment variables |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling |
| `--list-models [search]` | List available models |

### Session Options

| Option | Description |
|--------|-------------|
| `-c`, `--continue` | Continue the most recent session |
| `-r`, `--resume` | Browse and select a session |
| `--session <path\|id>` | Use a specific session file or partial UUID |
| `--fork <path\|id>` | Fork a session file or partial UUID into a new session |
| `--session-dir <dir>` | Custom session storage directory |
| `--no-session` | Ephemeral mode; do not save |
| `--name <name>`, `-n <name>` | Set session display name at startup |

### Tool Options

| Option | Description |
|--------|-------------|
| `--tools <list>`, `-t <list>` | Allowlist specific built-in, extension, and custom tools |
| `--exclude-tools <list>`, `-xt <list>` | Disable specific built-in, extension, and custom tools |
| `--no-builtin-tools`, `-nbt` | Disable built-in tools but keep extension/custom tools enabled |
| `--no-tools`, `-nt` | Disable all tools |

Built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.

### Resource Options

| Option | Description |
|--------|-------------|
| `-e`, `--extension <source>` | Load an extension from path, npm, or git; repeatable |
| `--no-extensions` | Disable extension discovery |
| `--skill <path>` | Load a skill; repeatable |
| `--no-skills` | Disable skill discovery |
| `--prompt-template <path>` | Load a prompt template; repeatable |
| `--no-prompt-templates` | Disable prompt template discovery |
| `--theme <path>` | Load a theme; repeatable |
| `--no-themes` | Disable theme discovery |
| `--no-context-files`, `-nc` | Disable `AGENTS.md` and `CLAUDE.md` discovery |

Combine `--no-*` with explicit flags to load exactly what you need, ignoring settings. Example:

```bash
pi --no-extensions -e ./my-extension.ts
```

### Other Options

| Option | Description |
|--------|-------------|
| `--system-prompt <text>` | Replace default prompt; context files and skills are still appended |
| `--append-system-prompt <text>` | Append to system prompt |
| `--tui-mode <mode>` | TUI mode: `regular` (default) or experimental `fullscreen` |
| `--use-theme <name[/name]>` | Set the initial interactive theme for this run without changing settings |
| `--verbose` | Force verbose startup |
| `-a`, `--approve` | Trust project-local files for this run |
| `-na`, `--no-approve` | Ignore project-local files for this run |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

In `fullscreen` mode, the transcript scrolls inside the terminal viewport while queued messages, working status, extension widgets, editor, and footer remain fixed at the bottom. Mouse/trackpad input scrolls the region under the pointer; keyboard viewport actions always remain available. Inline images work in terminals that support the Kitty graphics protocol, including Kitty and Ghostty. In iTerm2 they render as text placeholders because its inline-image protocol cannot delete or crop placements during application-owned scrolling. In `regular` mode, pi uses the main screen and terminal-owned scrollback, and iTerm2 inline images continue to render normally. See [Terminal setup](terminal-setup.md) for terminal-specific settings and workarounds.

Set **TUI mode** in `/settings` to switch between `regular` and `fullscreen` immediately and choose the default for future sessions. **Fullscreen exit output** controls whether exiting fullscreen prints the final transcript or restores the previous screen and prints only the session resume hint.

### File Arguments

Prefix files with `@` to include them in the message:

```bash
pi @prompt.md "Answer this"
pi -p @screenshot.png "What's in this image?"
pi @code.ts @test.ts "Review these files"
```

### Examples

```bash
# Interactive with initial prompt
pi "List all .ts files in src/"

# Non-interactive
pi -p "Summarize this codebase"

# Non-interactive with piped stdin
cat README.md | pi -p "Summarize this text"

# Named one-shot session
pi --name "release audit" -p "Audit this repository"

# Different model
pi --provider openai --model gpt-4o "Help me refactor"

# Model with provider prefix
pi --model openai/gpt-4o "Help me refactor"

# Model with thinking level shorthand
pi --model sonnet:high "Solve this complex problem"

# Limit model cycling
pi --models "claude-*,gpt-4o"

# Read-only mode
pi --tools read,grep,find,ls -p "Review the code"

# Disable one extension or built-in tool while keeping the rest available
pi --exclude-tools ask_question
```

## Design Principles

Pi keeps the core small and pushes workflow-specific behavior into extensions, skills, prompt templates, and packages.

Upstream Pi intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash. Klerm adds a built-in MCP tool bridge for stdio, Streamable HTTP, and SSE CLI servers; the other workflows remain available through extensions or packages, or external tools such as containers and tmux.

For the full rationale, read the [blog post](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/).
