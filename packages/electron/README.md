# `packages/electron` — Squadboard Desktop

Electron shell for the Squadboard app. Built on **electron-vite** with a three-entry architecture: main process, context-isolated preload, and the existing React client as the renderer.

## Architecture

```
packages/electron/
├── src/
│   ├── main/
│   │   ├── index.ts          — Main process, BrowserWindow, app lifecycle
│   │   ├── server-launcher.ts — Spawns @sabbour/squadboard server out-of-process
│   │   ├── ipc.ts            — IPC handler registry (v1 stubs)
│   │   ├── ipc-channels.ts   — Allowlist of valid IPC channels
│   │   └── menu.ts           — Native application menu
│   └── preload/
│       └── index.ts          — context-isolated preload; exposes window.squadboard
├── electron-vite.config.ts   — Main/preload/renderer entry points
├── electron-builder.yml      — Build config stub (full packaging: L7)
└── README.md
```

## Running

### Dev (no Electron display — WSL / CI)

> **Note**: Electron requires a display (X11/Wayland). In WSL without an X server or on a headless CI runner, `pnpm dev` will exit with `DISPLAY` errors. Use a machine with a display (Brady's machine) or forward X11 (`DISPLAY=:0`).

```bash
# From repo root — starts client Vite dev server + electron-vite main watcher
pnpm electron:dev

# Or from the workspace directly
pnpm --filter @sabbour/squadboard-electron dev
```

The server must be built first:

```bash
pnpm --filter @sabbour/squadboard build
```

### Build

```bash
# From repo root
pnpm electron:build

# Or from the workspace
pnpm --filter @sabbour/squadboard-electron build
```

Produces:
- `dist/main/index.js` — compiled main process
- `dist/preload/index.js` — compiled preload script
- `dist/renderer/` — copied/built client assets (in prod builds)

### Typecheck

```bash
pnpm --filter @sabbour/squadboard-electron typecheck
```

## Server: out-of-process design

The embedded squadboard server runs as a **child process** spawned by the main process (not in-process). See `src/main/server-launcher.ts` for the full rationale.

**TL;DR**: The server's `main()` registers its own `process.on('SIGTERM')` handler that calls `process.exit()`. Running it in-process would kill Electron. Out-of-process gives crash isolation and is the natural foundation for L4 (bundled PG) and L5 (MCP children).

In dev, the server binary is expected at `packages/server/dist/index.js`.  
In production, electron-builder copies it to `resources/server/dist/` (L7 configures this).

## IPC channel allowlist

The preload exposes `window.squadboard.invoke(channel, ...args)`. Only these channels are permitted:

| Channel | Handler (L2 status) |
|---|---|
| `health.check` | ✅ stub — returns `{ status: 'ok', source: 'electron-stub' }` |
| `projects.list` | ✅ stub — returns `[]` (L3: real API call) |
| `projects.create` | ✅ stub — logs payload, returns stub (L3: real API call) |
| `app.version` | ✅ live — `app.getVersion()` |
| `app.openExternal` | ✅ live — `shell.openExternal(url)` |
| `dialog.openFolder` | ✅ live — `dialog.showOpenDialog` |
| `system.openDevTools` | ✅ dev-only — `win.webContents.openDevTools()` |

Renderer push channels (main → renderer):

| Channel | Trigger |
|---|---|
| `menu.newProject` | File > New Project menu item |
| `menu.about` | Help > About Squadboard |

## Node version compatibility

- Repo requires `node >=20.0.0` (root `engines` field)
- Current environment: Node 22.22.1
- Electron 42 bundles Node ~22.x — **no mismatch**

## Known TODOs (L3–L14)

- **L3** — Wire renderer to real `/api/*` endpoints; replace IPC stubs with actual fetch calls
- **L4** — Bundle embedded PostgreSQL (PGlite stays for now)
- **L5** — MCP child process management; add MCP IPC channels
- **L6** — First-run UX wizard; add first-run IPC channels
- **L7** — Full electron-builder packaging (real icons, installers, extraResources)
- **L8** — Auto-update (electron-updater)
- **L9** — Code signing (Apple notarization, Windows EV cert)
- **L10** — Distribution (GitHub Releases, Homebrew, winget)
- **L11** — Dock/tray icon integration
- **L12** — Deep-link protocol handlers (`squadboard://`)
- **L13** — CLI handoff (`squadboard open`)
- **L14** — End-to-end tests + docs
