# External browser in Agents & Routing

The Files panel contains an External browser preview beneath the file workspace.
Explicit web-tool URL activity updates the preview to the latest observed URL.
The Source control below the preview reveals distinct observed URLs on hover or
keyboard focus, newest first, with a site favicon and clickable full URL.
Failed favicon loads keep a globe fallback. Favicon requests use the website's
origin only and do not send the visited URL as a referrer.

History is scoped to the Klerm conversation session and rebuilt from replayed
web-tool calls where the session retains structured tool arguments. Repeated
URLs move to the latest position instead of creating duplicate source rows.

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
   below the file workspace, initially with an empty-state message.
2. With a configured web-reading tool, ask the AI to read two public pages.
   Confirm the latest page is previewed and Source shows two distinct URLs.
3. Hover Source or focus it with Tab. Confirm both rows show a favicon/globe,
   hostname and URL. Open a source link and confirm it opens the requested URL.
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
