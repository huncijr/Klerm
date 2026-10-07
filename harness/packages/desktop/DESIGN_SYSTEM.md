# Klerm desktop design system

## Direction

Quiet, functional desktop software: warm neutral surfaces, a restrained copper
accent, readable system typography and explicit workspace navigation. Design
principles were informed by [Wholiver's SwiftUI Design Skill](https://github.com/Wholiver/swiftui-design-skill)
(Wholiver, MIT), adapted to the existing Svelte/Tauri application. Existing Klerm
and provider assets remain original, unfiltered files.

The sidebar exposes the five workspaces directly. Collapsed/short windows keep
the workspace menu. The initial workspace uses a compact editorial heading and
plain task suggestions. Chat, file changes, terminal activity, Personal Bots,
Kanban, Browser, Settings and the graph use the same semantic color system.

## Tokens

`src/app.css` owns the palette. Dark defaults are in `@theme`; Light overrides
are on `html[data-theme="light"]`. There is no whole-app color inversion.

| Token | Dark | Light | Purpose |
| --- | --- | --- | --- |
| `bg` | `#191918` | `#f7f6f2` | Workspace/chrome |
| `panel` | `#20201e` | `#fefdfb` | Content surfaces |
| `raised` | `#292927` | `#efede7` | Hover/selection/insets |
| `ink` | `#eeede8` | `#262622` | Primary text |
| `muted` | `#b7b5ac` | `#5c5b54` | Secondary text |
| `dim` | `#a29f95` | `#6b685f` | Metadata/placeholder text |
| `primary` | `#ece9e1` | `#2d2c28` | Primary action background |
| `on-primary` | `#232320` | `#fefdfb` | Text on primary actions |
| `accent` | `#e2a580` | `#985132` | Selection/focus/brand emphasis |

Success, danger, warning, info, purple and teal each have matching foreground
and soft-background tokens. Statuses, diffs, MCP colors and graph source types
retain their meaning across themes. Images, screenshots and native Chromium
page pixels are never recolored. Surface borders are neutral; color should
communicate a state rather than decorate every card.

Use `bg-panel`, `text-ink`, `border-line`, etc. in Tailwind and
`var(--color-…)` for inline/SVG/scoped styles. Do not add hardcoded dark-only
colors to a component or append hex alpha suffixes to a CSS variable.

- Body: platform system sans serif; code/commands: platform monospace.
- Display: local Iowan/Palatino/Georgia fallback, restricted to the initial
  workspace heading. No network font dependency.
- Text: 14px body, 12–13px controls, minimum 11px compact metadata.
- Spacing: 4/8/12/16/24/32px; restrained 6–8px control radii and small shadows.
- Keyboard focus has a shared visible outline, including outline-reset controls.
- Scrollbars remain visible when scrolling; reduced-motion preferences apply.

## Appearance behavior

Settings → General → Dark / Light / System → **Save Settings** persists the
preference through the existing backend settings API. System tracks live OS
appearance changes. The cached preference is applied before app mount and in
the HTML startup shell to avoid a dark-only startup flash. Invalid cached values
fall back to Dark. Theme changes do not restart agent sessions.

## Personal Bots layout

The Personal Bots view gives the conversation the most space: a searchable
agent list on the left, a centered chat column, and agent details in a panel
that opens on demand. Agent creation and personality editing use a tabbed
Identity & access / Model / Reasoning dialog with visible focus and
keyboard-trapped tab order. The layout shares the semantic tokens above, so no
separate Personal Bots palette exists.

Real-UI smoke coverage (no backend, no model calls) runs from `harness`:

```bash
node packages/desktop/scripts/smoke-personal-bots.mjs
```

It checks both themes for chat rendering, agent search, the details panel,
profile editing, agent creation with the selected model and reasoning effort,
compact drawer behavior, and absence of model requests. Add `--screenshots`
for review images. This reuses the same no-backend design fixture described
below.

## How To Test

From `harness/packages/desktop`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/appearance.test.ts test/helpers.test.ts test/graph.test.ts test/shortcuts.test.ts
```

From `harness/packages/coding-agent`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/desktop-empty-copy.test.ts test/desktop-shortcuts.test.ts test/mcp-mentions.test.ts
```

The 39 targeted tests and repository check passed, including Svelte diagnostics
with zero errors/warnings. WebKit fixture checks also verified that direct
navigation cannot discard dirty Settings, and that saved theme changes update
both the visible palette and local-storage preference.

From `harness`:

```bash
npm run check
npm run app -- --foreground
```

1. In Settings → General, save Light, then Dark. Visit all five workspaces,
   open shortcut/model/MCP/memory settings, and inspect file diffs. Text,
   inputs, menus and status colors should remain readable in both themes.
2. Save System and change the OS appearance while Klerm is open. The palette
   should update without restarting the backend. Restart with Light saved;
   the startup shell and restored workspace should use Light.
3. Tab through navigation, model selectors, composer and Settings. Focus should
   be visible. Reduce the window width/height: navigation and content remain
   scrollable; the graph canvas and seven-column Kanban board scroll internally.
4. Check an attachment/provider logo or embedded page: its original colors
   should remain intact. Confirm red/green diff meaning and MCP colors survive
   switching themes.
5. Exercise existing Save/Run/Stop shortcuts and graph Save/Validate. Agent
   actions still use the backend and their existing audit logs.

For visual review without credentials or real workers, from
`harness/packages/desktop` run:

```bash
npm run dev -- --port 1431
```

Open these development-only fixture URLs:

- `http://127.0.0.1:1431/test/design-preview.html?theme=light`
- `http://127.0.0.1:1431/test/design-preview.html?theme=dark`
- Add `&conversation=1` to inspect the rendered chat and code block.

This mounts the real App with Tauri's official IPC mocks and representative
in-memory sessions, cards, profiles and a graph. It does not start a backend,
write real project/config files, connect to providers, or execute browser/agent
work. Appearance saves update fixture memory and browser local storage only.
Browser execution is explicitly disabled. Production uses `index.html`, not
the fixture entry point.

Palette tests check AA contrast (4.5:1) for normal text, primary actions and
semantic status text in both themes; disabled controls are outside that claim.
Linux WebKit fixture checks cover all five workspaces, the Settings tabs,
theme save/local-storage updates and absence of whole-page overflow/inversion.
Workspace, Settings, Kanban and graph screenshots were also reviewed; the
WebDriver screenshot path became unreliable on later captures, so remaining
views were checked through rendered DOM/computed styles instead. Actual Tauri restart,
real worker/browser interaction and Windows/macOS acceptance remain human checks.

Configuration is still under `~/.klerm/agent/`. Visual-only changes add no
orchestration log stream. Existing work logs remain authoritative, including
`.klerm/workflow-events.jsonl`, `.klerm/kanban-runs.jsonl`,
`.klerm/bridge-events.jsonl` and `.klerm/browser-events.jsonl`.
