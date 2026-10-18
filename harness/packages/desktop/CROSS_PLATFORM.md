# Klerm desktop: Windows, macOS and Linux

All platforms use the same Svelte frontend, coding-agent RPC backend and Tauri
source. There are no platform-specific copies of Personal Agents or Kanban.
Both Tauri development and release builds run `scripts/prepare-desktop.mjs`,
which rebuilds the shared backend. Release builds rebuild the frontend, package
the locally built workspace modules and locked production dependencies, and
include an official SHA-256-verified Node 24.21.0 runtime. A source change is
included in the next build on each platform; installed apps need the new package
installed. An automatic updater/signing service is not provided by this slice.

## Supported build targets

- Windows 10/11 x64; native ARM64 packaging is available but not in the CI matrix.
- macOS 13.5+ on Apple Silicon and Intel. The minimum matches bundled Node's
  official deployment target. Homebrew Node binaries are not copied into apps.
- Linux x64 (native ARM64 packaging is available but not in the CI matrix).

Build on the target OS with matching native Node/Rust architecture. The root
`.github/workflows/desktop.yml` builds Linux x64, Windows x64, macOS ARM64 and
macOS x64 from one commit whenever shared source changes on main/PRs. Every job
tests packaged-backend and native-window startup before uploading installers
and `desktop-build.json` as `Klerm-<platform>-<commit>` artifacts.

The manifest records revision, platform, architecture and bundled runtime hash.
Fresh builds restore a checksummed public model-data baseline rather than
depending on mutable provider APIs. Refreshing model metadata is an explicit
`npm run generate:models` / `npm run snapshot:model-data` change.
Generated resources and downloads are ignored; `.assets`/`.cache` are excluded
from Kanban source evidence so rebuilding an app does not count as implementation.

## Development

Install Node.js with npm (22.19+; CI uses 24.21.0), Rust, and the native Tauri
build tools. macOS needs Xcode Command Line Tools (`xcode-select --install`).
Windows needs Visual Studio C++ Build Tools and WebView2. Existing
`setup-windows.ps1 -Desktop -InstallTools` remains available; UNC/WSL builds
must use its local Windows build directory rather than reuse Linux dependencies.

From the `harness` directory on any platform:

```sh
npm ci --ignore-scripts
npm run hydrate:model-data
npm run app -- --foreground
```

The foreground command shows build/startup output and can be stopped with Ctrl+C.
`npm run app` launches in the background and prints the log path. Close an existing
development app/server before starting another instance on port 1420; the new
launcher rejects a stale/unrelated frontend instead of attaching to it.

Platform convenience commands, also from `harness`:

```powershell
# Windows
.\klermapp.ps1 -Foreground
# Alternatively: klermapp.cmd --foreground
```

```sh
# macOS: portable launcher without GNU realpath/sha256sum/setsid
./klermapp --foreground
```

Linux's existing cached/background `./klermapp` path and explicit native rebuild
flag remain available. Use `npm run app -- --foreground` for the shared fresh
Tauri development pipeline. The current source's frontend/backend are rebuilt
on launch; backend-source hot reload during an existing session is not promised.

Development logs:

- Windows: `%LOCALAPPDATA%\Klerm\logs\desktop-dev.log`
- macOS: `~/Library/Logs/Klerm/desktop-dev.log`
- Shared Linux launcher: `${XDG_STATE_HOME:-~/.local/state}/klerm/desktop-dev.log`
- Existing Linux launcher: the same state folder's `app.log` / `vite.log`

## Installable app builds

From `harness`, on the target OS:

```sh
npm run tauri:build
```

Output is under `packages/desktop/src-tauri/target/release/bundle/`:

- Windows: NSIS installer / MSI.
- macOS: `macos/Klerm.app` and DMG.
- Linux: native installer bundles (e.g. DEB).

Installers contain backend dependencies and Node; the installed user does not need
npm, Rust, a checkout or system Node. First startup uses a writable per-user
application-data `workspace` folder unless a saved/explicit workspace is selected.
Provider configuration stays in `~/.klerm/agent/` (Windows: `%USERPROFILE%\.klerm\agent`);
no provider credentials are shipped. Select a project using the app's folder picker.
`KLERM_DESKTOP_NODE`, `KLERM_DESKTOP_RPC_ENTRY` and `KLERM_DESKTOP_CWD` remain explicit
advanced overrides. A missing packaged runtime/backend is reported, not replaced
with a path from the build machine. Child tools receive bundled Node on PATH.

## How To Test

Automated local checks from `harness`:

```sh
node --test packages/desktop/scripts/desktop-platform.test.mjs scripts/native-tar.test.mjs
cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml --lib
npm run check
```

After building a release, test the packaged backend outside the checkout with an
isolated auth directory and a PATH containing only the bundled runtime:

```sh
node packages/desktop/scripts/smoke-desktop.mjs
```

Expect `Desktop packaged Node + backend startup passed`. It performs a real RPC
handshake, makes no model request, and shuts down through stdin EOF.

Test the actual native window plus its packaged backend:

```powershell
# Windows, from harness
node packages/desktop/scripts/smoke-desktop.mjs --app=packages/desktop/src-tauri/target/release/klerm-desktop.exe
```

```sh
# macOS, from harness
node packages/desktop/scripts/smoke-desktop.mjs --app=packages/desktop/src-tauri/target/release/bundle/macos/Klerm.app/Contents/MacOS/klerm-desktop
# Linux, from harness (use xvfb-run -a on a headless machine)
node packages/desktop/scripts/smoke-desktop.mjs --app=packages/desktop/src-tauri/target/release/klerm-desktop
```

Expect `Desktop native window + packaged backend startup passed`. The native app
creates its webview, performs protocol-v1 readiness, writes a temporary report
and exits. The fixture isolates provider state and requires no paid model call.

Human checks on each OS:

1. Install the package and launch it from Start Menu / Applications / desktop menu.
   Confirm that the main window opens and Backend ready appears without a checkout.
2. Choose a project folder, configure your own provider/local model, send a small
   prompt, and verify streaming and Stop. Open Personal Agents and Kanban.
3. Restart the app and verify workspace/provider settings survive.
4. Rebuild from a changed shared source revision, install the new package, and
   verify the changed control/behavior on both Windows and macOS. CI artifacts and
   `desktop-build.json` identify the source commit.

### Real native harness acceptance

From `harness`, with the selected native harness already installed and signed in:

```sh
node scripts/smoke-native-harness.mjs --live --harness "<installed-adapter-id>" --model "<native-model-id>"
```

Use the actual adapter/model IDs from your configured harness; the script does
not assume a model family or select a provider. `--live` explicitly runs three
real model turns under the harness's own account in a new temporary Git project:
prompt/reply, remembered follow-up token in the same native session, then an
attributed native tool reading a file. This is not a fake-provider test. It may
consume account quota/tokens. `--profile full-access` is available for a native
adapter that implements that profile; native permissions remain in effect.

Expected: three `Passed:` lines and a report with `status: passed`. The script
prints the retained temporary workspace, `native-verification.json` report and
`.klerm/bridge-events.jsonl` audit path. These are separate from the user's real
project/configuration. Unsupported adapters and failed native turns return a
failure rather than claiming readiness.

After this adapter check, complete the app actions above with the same harness,
including Stop and restart. A transport or startup check alone is not evidence
that every harness/tool/OS combination works.

Decision/activity logs remain in the selected workspace's `.klerm/` directory,
including `kanban-runs.jsonl`, `router-decisions.jsonl` and `personal-bot-events.jsonl`.
The packaged Node runtime and upstream Pi license notices are included in resources.

## Verification and limits

Linux local checks passed: platform-plan tests, Rust runtime tests, packaged
backend handshake with no system Node, release DEB build, native-window startup,
and startup of the extracted installer outside the checkout in a path with spaces.
CI run `37608473016` at revision `a8b0913` passed native builds, packaged-backend
readiness and actual native-window startup on Windows x64, macOS x64/ARM64 and
Linux x64. At revision `ecb4320`, run `37792473866` has also passed Windows x64,
macOS ARM64, macOS x64 and Linux x64; all four jobs completed successfully. This
proves packaged startup, not authenticated native-harness work on those runners.

The local October 8 native adapter check passed prompt/reply, follow-up memory,
same-session reuse and a real file tool with the installed authenticated Codex CLI worker
on Linux x64. The installed Hermes worker still fails session creation; direct
native launch reports no configured inference provider. Configure it through its
own model/provider setup before repeating acceptance. Hermes prompt/tool support
is not marked verified, and Windows/macOS native-harness flows remain unverified.

Native harness discovery, model commands and adapter launch now use the shared
platform process launcher, including Windows `.exe`/`.cmd`/`.bat` entry points.
Discovery and adapter launch share user-level CLI locations, including Windows
Roaming npm binaries; GUI launch does not require Finder's PATH to include them.
CI has a real child-process/version/JSONL/ACP launcher check on every OS (a local
fixture worker, not an authenticated AI harness). The launcher change needs a
fresh CI run before its Windows/macOS result can be claimed.

Current readiness, revision-scoped evidence and implementation order are in
[STATUS.md](../../../STATUS.md). The launcher changes shipped in `73291bf` /
`96af208`. CI run `38573420931` passed Windows/Linux, but both macOS jobs stopped
at the launcher fixture: `/var/...` and `/private/var/...` were compared as raw
strings even though they name the same physical directory. The local correction
compares realpaths and exercises an explicit symlink/Windows junction. A fresh
CI run must verify the complete macOS build/startup again; the earlier successful
`ecb4320` result does not prove the new adapter code on every platform.

The embedded CEF Browser remains Linux development functionality. Its optional
Cargo binary is excluded from ordinary Windows/macOS builds; those platforms
return an explicit unsupported-feature message instead of Unknown command.
CEF/runtime release packaging and Windows/macOS browser hosting remain future work.
This CI builds unsigned/development app packages: Apple notarization, Windows
code signing, full UI/provider workflows and an auto-updater remain unverified.
