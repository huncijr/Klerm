# Workflow graph workspace — initial G0/G1 slice

The Workflows / Graph view edits private graph drafts and visualizes existing
Personal Agents, native harness slots, Kanban boards/cards/attempts and stored
Personal Bot conversations. It uses shared browser-safe TypeScript contracts
and Svelte/SVG, with no new graph library or platform-specific graph logic.

**Execution is not enabled.** Every metadata API advertises
`executionSupported: false`. Adding sources, drawing connections, Validate and
Save do not create cards, prompt agents, acquire native sessions or replay work.
Graph Run, agent-to-agent dispatch, conditions/joins, intervention, worktrees,
budgets and server graph delivery remain G2+ work from the local GRAPH_PLAN.

## Using the graph

Keyboard navigation, Save, Validate, Fit, Layout and selection removal can be
configured in Settings → Shortcuts; see [Keyboard shortcuts](KEYBOARD_SHORTCUTS.md).

1. Open the workspace menu → **Workflows / Graph**.
2. Choose **New**, name the workflow, and use the right-side Add existing work
   catalog. Add buttons also support keyboard use; sources can be dragged onto
   the canvas. Blocks contains Start, Task, Condition, Join, Human review and End
   as design nodes, not executed steps.
3. On an agent choose **Bot's cards** to filter by actual `personalBotId`
   assignment. On a card choose **Attempts** to find its saved attempts.
   Shared boards are not fabricated as separate per-bot boards.
4. Drag a node title to move it, or edit X/Y in Inspect. Pan the canvas background,
   scroll, zoom, Fit or Layout. A minimap shows the graph's placement.
5. Choose the relationship, click a node's **Out**, then the target's **In**:
   - assigned-to: Task/Card → agent;
   - depends-on: execution-step design dependency;
   - artifact: saved history or task output → step input;
   - message: agent → agent design reference;
   - membership: Board → Card, a visual relationship only.
   Incompatible/self/duplicate links are rejected by the editor; backend Validate
   also detects cycles, missing references, conflicting assignments and disabled
   Kanban access. Drafts may retain semantic validation errors for later editing.
6. Select a node/connection to edit its graph label/note. Inspect and the bottom
   Timeline/Report/Changes panel show real source data, recorded model, folder,
   activity, changed files and check evidence. Current chat references are mutable
   conversations, not invented immutable native task attempts.
7. Save creates a new revision. Save/discard before changing workflows or opening
   source views. Open source opens the existing bot conversation, Kanban board/card
   or agent-settings view. Removing a node only removes its graph reference/edges.

Existing Kanban and Personal Bot events refresh source statuses/details while
the graph is open. Refresh also reloads the searchable catalog. There is no native
harness task history import if that history has no durable existing source ID.
Unavailable/disabled harnesses show their real configuration/capability status;
“configured” does not assert authentication or session readiness.

## Metadata API / persistence

Desktop JSONL RPC commands added:

- `list_workflows`, `get_workflow`;
- `save_workflow` with `expectedRevision`, `delete_workflow` with `expectedRevision`;
- `get_graph_catalog` with category/search/ownerBotId/offset/limit;
- `get_graph_source_details` with a typed existing-source reference;
- `validate_workflow` (structural design validation, not permission to run).

Graph definitions/layout are scoped to the backend's current canonical workspace
at `.klerm/workflows/registry.json`. The returned list identifies the actual
storage root; it need not be the enclosing Git root. Files are private, writes
are atomic and serialized with a directory lock, and stale edits return
`WORKFLOW_REVISION_CONFLICT`. A corrupt registry is not replaced by an empty one.

Audit: `.klerm/workflow-events.jsonl` records monotonically ordered saves/deletes
with workflow/revision IDs and content digests, not raw briefs/transcripts.
Registry mutation and its pending audit event are persisted together; a later
mutation reconciles pending audit publication without duplicate events.
Existing Kanban/Personal Bot/bridge logs remain authoritative for actual work.

Bounds: 100 drafts/workspace, 50 nodes and 100 edges/draft, finite 6000×4000 canvas,
zoom 20–250%, 8,000-character task briefs and 2,000-character notes. Catalog pages
are bounded to 100 results; source detail reads return retained source history,
not a new unbounded transcript channel. Other workspace/card folders remain
explicitly visible, and importing a reference does not change the active folder.

The new graph UI is desktop-only in this slice. The current headless HTTP command
allowlist/browser page has not been extended with graph commands or UI.

## How To Test

From `harness/packages/coding-agent`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/klerm-workflows.test.ts test/graph-catalog.test.ts test/rpc-workflows.test.ts
```

From `harness/packages/desktop`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/graph.test.ts
```

From `harness`:

```bash
npm run check
npm run app -- --foreground
```

The launcher rebuilds the changed backend before opening the app. If using the
existing Linux cached launcher, rebuild its backend (`npm run build:desktop-backend`)
before starting it. Expected automated behavior: round-trip persistence,
stale-write rejection across store instances, DAG/port/ref validation, source
ownership filtering, saved evidence retrieval and **zero model calls** through
the RPC metadata flow. The fake-provider tests do not claim a new native-agent run.

Human checks:

1. Create a draft, add a Personal Agent, use Bot's cards, add a saved card and one
   of its attempts. Confirm the old attempt's report/model/folder appear unchanged.
2. Add Start/Task/End and connections. Try an agent → Task depends-on link;
   it should be rejected. Add a control/artifact cycle and Validate; expect CYCLE,
   while the editable draft remains available.
3. Move nodes, zoom/pan, Save and restart. Reopen the workflow: labels, references,
   connections, positions and viewport must survive.
4. Open the same saved graph in a second client/window. Save in one, then try
   saving the stale revision in the other: expect a conflict and retained edits.
5. Delete a graph node and then the draft: original bots/cards/attempts/files stay.
   No new Kanban attempt, prompt or worker action should be recorded.
6. Observe a card already running elsewhere: graph status/timeline refreshes;
   drawing another connection neither steals the run nor starts another one.
7. Open source after saving: the selected bot/card is focused. Save a source-card
   edit: its drawer still closes normally rather than being reopened by focus.

UI appearance, pointer interactions, restart rendering and real Windows/macOS
webview smoke remain human checks. The backend/pure editor tests and desktop
typecheck are automated; this is not completion of executable workflows.
