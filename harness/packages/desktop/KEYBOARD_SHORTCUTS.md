# Keyboard shortcuts

Open **Settings → Shortcuts**, or press **Ctrl/Cmd+Alt+S**. The Desktop tab
controls Klerm's desktop UI; the CLI / TUI harness tab edits the native Klerm
terminal keybindings. External harnesses retain their own native configuration.

## Desktop defaults

`Mod` means Ctrl or Cmd; use Ctrl on Linux/Windows and Cmd on macOS. Alt is
Option on macOS. Settings displays `Ctrl/Cmd` for `Mod` bindings.

| Action | Default |
| --- | --- |
| Send from a focused chat/browser composer | Enter |
| Insert a line break in the coding composer | Shift+Enter |
| Save current view | Mod+S |
| Close/cancel current view or menu | Escape |
| New item in current view | Mod+Alt+N |
| Refresh current view | Mod+Shift+R |
| Run/send in current view | Mod+Shift+Enter |
| Stop current task | Mod+Shift+X |
| Agents & Routing | Mod+Alt+A |
| Personal Agents | Mod+Alt+P |
| Kanban | Mod+Alt+K |
| Workflows / Graph | Mod+Alt+G |
| Browser Agent | Mod+Alt+B |
| Settings | Mod+Comma |
| Shortcut settings | Mod+Alt+S |
| New coding session | Mod+N |
| Focus current composer | Mod+Alt+F |
| Toggle file changes | Mod+Shift+F |
| Toggle activity/terminal panel | Mod+Backquote |
| Validate graph draft | Mod+Alt+V |
| Fit graph | Mod+0 |
| Auto layout graph | Mod+Alt+L |
| Remove selected graph node/edge | Delete |
| Continue browser task | Mod+Alt+C |
| Take browser control | Mod+Alt+T |

Save, Run, Stop, Refresh and New act on the current view. Save persists the
visible file editor, graph, selected Kanban card, Personal Agent configuration,
or Settings context. Run submits the visible prompt or selected card; a focused
per-agent composer targets that agent, and a focused terminal command targets
the workspace console. A disabled foreground action consumes its binding rather
than falling back to a hidden editor/task. Graph Run remains disabled: a saved
graph is a draft, not an executable workflow.

Close retains view-specific cancel/discard checks. Shortcut navigation away from
dirty Settings or graph drafts requires saving or discarding first. Delete in a
text field edits text and does not remove a graph node. Removing a graph node
never deletes the source bot/card/attempt.

## Change bindings

1. Search by action, group or keys in the Desktop tab.
2. Choose **Record**, then press the desired chord. **Cancel** exits recording.
3. **Clear** disables the action; **Reset** restores its default.
4. Choose **Save Settings**, or use the currently saved Save shortcut. Changes
   become live after a successful backend save and survive app restart.

Duplicate desktop chords, including overlapping Ctrl/Cmd aliases, are rejected.
Ordinary unmodified typing keys cannot become application shortcuts. IME
composition, AltGraph text entry and held-key repeats do not dispatch shortcuts.
The recorder captures keys without firing application actions. Native Chromium
page surfaces keep their own keyboard input; move focus back to Klerm controls
before using application shortcuts. OS/window-manager reservations can prevent
a chord from reaching the app; choose another chord in that case.

Desktop overrides are written atomically to
`~/.klerm/agent/desktop-keybindings.json` (or the configured agent directory).
Only overrides are stored; Reset removes the override instead of pinning a
default. An empty string disables an action. The typed JSONL RPC commands are
`set_desktop_keybindings` and `set_cli_keybindings`; `get_desktop_settings`
returns the effective bindings for both tabs. These configuration operations
do not prompt models or create orchestration events.

## CLI / TUI harness

Each native action lists its ID, description, effective keys and defaults.
Enter one chord per line, for example `ctrl+alt+n`. An empty field disables the
action; **Reset to defaults** restores native defaults. Save changes, then use
`/reload` in an existing Klerm CLI session or restart it. Native CLI syntax uses
`ctrl`, `alt`, `shift` and `super`, not desktop `Mod` or `Cmd` aliases.

New session shortcuts are `ctrl+alt+n` (new), `ctrl+alt+h` (tree),
`ctrl+alt+j` (fork), and `ctrl+alt+r` (resume). The existing `ctrl+s` model-selector
save binding keeps its native meaning. CLI chords can legitimately repeat in
different TUI contexts and are not subject to the desktop conflict rule.

CLI overrides use `~/.klerm/agent/keybindings.json`. Saving preserves unknown
extension overrides and uses a directory lock plus atomic replacement. Terminal
emulators and keyboard protocols may not transmit every Ctrl+Alt/Shift chord;
choose supported alternatives when needed. The editor does not change Codex,
Claude Code or OpenCode's own native keybindings.

## How To Test

From `harness/packages/coding-agent`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/desktop-keybindings.test.ts test/desktop-shortcuts.test.ts test/rpc-keybindings.test.ts test/rpc-desktop-contract.test.ts
```

From `harness/packages/desktop`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/shortcuts.test.ts test/helpers.test.ts test/graph.test.ts
```

From `harness`:

```bash
npm run check
npm run app -- --foreground
```

The launcher prepares the changed backend/frontend before starting the app.
Expected automated results: conflict validation, atomic persistence, preservation
of extension overrides, effective RPC bindings with zero model calls, live
rebinding, foreground ownership, async error handling and keyboard boundaries.

Human acceptance:

1. Press Ctrl+Alt+B on Linux/Windows (Cmd+Option+B on macOS): Browser Task opens.
   Use Mod+Alt+G for Graph, then Mod+Alt+N for a new draft. Name it and press
   Mod+S: Save creates a revision in `.klerm/workflows/registry.json` and an
   ordered save event in `.klerm/workflow-events.jsonl`.
2. Edit the graph and press Mod+Alt+K: navigation is blocked until Save/Discard.
   In a graph label field, Delete changes text; on a selected canvas node,
   Delete removes only the graph reference.
3. Open shortcut settings, Record **F9** for Save, then Save changes using the
   current Mod+S binding. Reopen Graph: F9 saves and Mod+S no longer saves.
   Restart and confirm F9 persists. Reset Save and confirm Mod+S returns.
4. Record a chord already assigned to another desktop action: conflicts are
   highlighted and Save is rejected. Clear an action, save, and confirm it is
   disabled. Recording navigation/send chords must not switch views or send.
5. With a file editor open, open another foreground view and press Save/Run/Stop:
   no background file or task should be affected. In a per-agent composer, the
   configured Send and Run shortcuts must target only that agent, once.
6. In CLI / TUI harness, change `app.session.new` to `ctrl+alt+m`, save, then
   `/reload` or restart the CLI. Confirm the new session action works and
   existing extension overrides remain in `keybindings.json`.

Native keyboard interaction, restart rendering and Windows/macOS webview smoke
remain human acceptance checks. Automated tests use fake providers; no real
agent run or model billing is required for these checks.
