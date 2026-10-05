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

Decision/activity logs remain in the selected workspace's `.klerm/` directory,
including `kanban-runs.jsonl`, `router-decisions.jsonl` and `personal-bot-events.jsonl`.
The packaged Node runtime and upstream Pi license notices are included in resources.

## Verification and limits

Linux local checks passed: platform-plan tests, Rust runtime tests, packaged
backend handshake with no system Node, release DEB build, native-window startup,
and startup of the extracted installer outside the checkout in a path with spaces.
Windows/macOS runners and hardware were not available in the Linux development
environment; the added CI must pass before claiming native verification.

The embedded CEF Browser remains Linux development functionality. Its optional
Cargo binary is excluded from ordinary Windows/macOS builds; those platforms
return an explicit unsupported-feature message instead of Unknown command.
CEF/runtime release packaging and Windows/macOS browser hosting remain future work.
This CI builds unsigned/development app packages: Apple notarization, Windows
code signing, full UI/provider workflows and an auto-updater remain unverified.
