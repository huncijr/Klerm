# External browser in Agents & Routing

The Files panel contains an External browser tab next to Changes.
Explicit web-tool URL activity updates the preview to the latest observed URL.
The Sources control below the main Files button reveals distinct observed URLs on hover or
keyboard focus, newest first, with site favicons and compact side-by-side URL chips.
Clicking a chip opens that source inside the External browser tab; the full URL
remains in its tooltip, while the visible label omits the HTTP scheme.
Failed favicon loads keep a globe fallback. Favicon requests use the website's
origin only and do not send the visited URL as a referrer.

History is scoped to the Klerm conversation session and rebuilt from replayed
web-tool calls where the session retains structured tool arguments. Repeated
URLs move to the latest position instead of creating duplicate source rows.

Built-in Klerm sessions expose a read-only webfetch tool for public text pages
in Plan and Build roles. Its start event has a separate Web fetch card; a
successful response updates the current preview to its final redirected URL.
The External browser surface forwards native mouse clicks and wheel scrolling.
Switching back to Changes preserves the source list. Desktop Direct prompts
use the configured Agent 1 model and effort rather than a stale session model.

This is a preview of explicit web-tool activity, not a mirror of an external
harness's private native browser. Mentioning a URL in chat, shell output, or a
file does not prove a visit and does not add a source. A requested URL can still
fail to load, redirect, or encounter an access challenge. Harnesses that do not
emit structured web-tool names and URL arguments cannot populate this panel.

## How To Test

From `harness`:

```bash
./klermapp
```

1. Open Agents & Routing and the Files panel. Confirm External browser appears
   beside Changes, initially with an empty-state message.
2. Select an Agent 1 model, then ask the AI to use webfetch to read two public pages.
   Confirm the response model matches the selection, a Web fetch card appears,
   and External browser shows the latest page.
3. Hover Sources below Files or focus it with Tab. Confirm rows show a favicon/globe,
   compact URL labels. Click a source and confirm External browser opens it.
   In External browser, scroll and click an ordinary page link to verify input.
4. Read the first URL again. Confirm no duplicate row appears and it moves to
   the top of Source. Switch sessions and confirm histories are separate.
5. Reopen a session with recorded web-tool calls and confirm replay restores
   its sources. Private external harness sessions without URL events are not
   included.

Automated verification:

```bash
# From harness/packages/desktop
node ../../node_modules/vitest/dist/cli.js --run test/web-activity.test.ts
# From harness
npm run check
```

The panel reads existing typed tool events/session replay and writes no new
browser-action audit. Browser Task's dedicated worker and logs are separate.
Automated helper/type checks pass; real desktop visual interaction remains a
human smoke requirement.
