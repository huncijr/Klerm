# Reusable Personal Agents

Personal Agents own their Klerm model, reasoning effort and personality profile.
Browser tasks, Kanban cards and built-in Klerm harness slots refer to their stable
Personal Bot ID rather than maintaining another editable model selection.
Every new run resolves the current agent configuration. Removing or disabling an
agent does not silently select a replacement. Changing an agent does not change
an already-started run's captured model.

The Browser and Kanban access switches are independent and off by default.
They are checked in the backend as well as the UI. Chat sessions remain separate
from Browser and Kanban task sessions; reusing configuration does not merge
conversation histories.

## Browser sessions

The Browser workspace has its own left session list: New, rename with Enter and
delete. These operations do not create or switch ordinary coding sessions.
Each browser session owns a different CEF surface/worker and its selected
Personal Agent. Names are stored in settings; recent chat text and selection are
stored under the browser session ID in desktop local storage. Current page,
cookies and worker state survive view/session switches while the app is open.
Browser state after app exit/restart is not promised to survive.

Enable Browser access on a Personal Agent to expose browser_task in its chat.
A compact browser card then appears below the chat, with Expand/Minimize,
Take control, Continue, Stop and pending action approval. The tool executes
through the same browser coordinator as the Browser workspace, under a separate
personal-<bot-id> owner. The model sees only its task/profile and allowed browser
observations, not other bots' or coding sessions' transcripts.

## Kanban and harness assignments

Kanban cards select a Personal Agent with Kanban access enabled. The latest model,
effort and profile are captured when a run starts; attempt records retain the
effective model/effort. Enabling Kanban access also exposes kanban_list,
kanban_create and kanban_run in the agent's chat. Created cards are Planned and
assigned to that agent in the current workspace; creation does not execute work.
Chat-triggered runs accept only cards assigned to that same agent.

Settings > Agents can link a Klerm slot to a Personal Agent. Its model selector
becomes read-only and the backend resolves model/effort from the agent. Slot
Plan/Build role and tools remain workspace-specific. Native external harnesses
retain their own model namespaces and authentication; selecting a Klerm Personal
Agent binds a Klerm slot, not an external harness's account.

Existing standalone configuration and historical Kanban attempts are retained.
New Browser/Kanban UI assignments use Personal Agents; old scheduled cards should
be assigned explicitly before depending on this configuration source.

## Sources

Sources are compact favicon/link chips without the HTTP scheme. Clicking one
opens the External browser tab, including when the same URL was already selected.
Both the main Sources list and the preview's Source list navigate inside Klerm.
Full URLs remain available in the chip tooltip and underlying navigation target.

## How To Test

```bash
cd /home/abro/Desktop/Klerm/harness
./klermapp
```

1. Open Personal Bots, choose/create an agent, and select its model and effort.
   In AI settings enable Browser access and Kanban access, then save.
2. In its chat ask: "Use browser_task to open YouTube and search for jazz."
   Confirm the small browser appears, Expand enlarges it, and action approval,
   human takeover, Continue and Stop apply to this bot's browser.
3. Open Browser workspace. Select the agent, run a task, create another Browser
   session and verify it starts with a separate page/chat. Switching back should
   restore the first page while the app stays open. Rename a session with Enter;
   verify the ordinary coding-session list is unchanged.
4. Ask the agent to create a planned Kanban card. Open Kanban and verify the card
   is assigned to that agent. Choose it on another card, run it, and inspect the
   captured model/effort in its attempt. Disable Kanban access and verify a new
   run or chat tool request is rejected rather than falling back.
5. Settings > Agents: bind a Klerm slot to the Personal Agent. Change the agent's
   model in Personal Bots and verify the next harness task uses the new model.
   Personal chat history should not appear in the harness task.
6. In Agents & Routing fetch two sites, click a Sources chip, and confirm the
   External browser tab opens that site with compact side-by-side source chips.

Logs: .klerm/browser-events.jsonl includes browser owner/run and personalBotId;
.klerm/kanban-runs.jsonl records Kanban attempts; .klerm/personal-bot-events.jsonl
records personal-chat lifecycle. Native Personal Bot sessions retain ordered tool
calls/results. No private-input observation lock is provided by this work; the
separate PRIVATE_INPUT_PLAN.md still describes that future boundary.

Automated registry, RPC and coordinator checks use fake providers/workers,
including personal-chat card creation, opt-in browser tool invocation and
independent Browser owner IDs. Real desktop rendering and live-provider workflows
remain human smoke checks.
