<p align="center">
  <img src="assets/squadboard-horizontal.svg" alt="Squadboard" width="100%" />
</p>

<h1 align="center">Squadboard — The visual home for your Squad agents</h1>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="#"><img alt="Node.js Version" src="https://img.shields.io/badge/node-%3E%3D20-green.svg" /></a>
  <a href="#"><img alt="Self-Hosted" src="https://img.shields.io/badge/deployment-self--hosted-orange.svg" /></a>
  <a href="#"><img alt="Project Status" src="https://img.shields.io/badge/status-pre--alpha-purple.svg" /></a>
</p>

---

> **Pre-alpha:** Squadboard is under active development. Sharp edges, breaking changes, and incomplete flows ahead. Keep humans in the review loop.

## What is it?

Squadboard is the visual command center for [Squad](https://github.com/bradygaster/squad) AI agents — built on top of Squad, not instead of it.

- **Durable workflows** — workflows that survive, are tracked, and can be resumed across sessions
- **Live visualization** — see all your agent work in one place, with real-time run tracking and board state
- **Project templates** — Squadboard apps and project templates that give agents structure and context
- **App extensibility** — apps that run on top of Squadboard to extend capabilities

Squad handles agent orchestration. Squadboard gives it a home — a live board where every run, workflow, and project is visible, trackable, and resumable. Without Squad, Squadboard is empty. With Squad, it's where your agent work lives.

## Quickstart

### Fork 1 — Already running Squad?

If you have Squad agents running, connect them to Squadboard:

1. **Install Squadboard** — Download from [GitHub Releases](https://github.com/sabbour/squadboard/releases), or via CLI:
   ```bash
   npx @sabbour/squadboard-cli init
   ```

2. **Connect to the board** — Wire up MCP so Copilot CLI can talk to Squadboard:
   ```bash
   squadboard connect
   ```

3. **Launch the UI** — Open Squadboard at `http://localhost:5173`:
   ```bash
   squadboard start
   ```
   (or use the desktop app if you downloaded it)

4. **Run an agent from the CLI and watch it on the board:**
   ```bash
   squad run --workflow my-workflow
   ```
   The run will stream to Squadboard in real-time.

5. **From the UI**, drag cards through columns to manage work, and click into runs to see live output.

### Fork 2 — Starting fresh?

1. **Download Squadboard** — Grab the desktop app from [GitHub Releases](https://github.com/sabbour/squadboard/releases) for your platform:
   - macOS: `Squadboard-*.dmg`
   - Windows: `Squadboard-Setup-*.exe`
   - Linux: `Squadboard-*.AppImage`

   Or use CLI:
   ```bash
   npx @sabbour/squadboard-cli init
   ```

2. **Launch** — The desktop app or web UI opens automatically at `http://localhost:5173`.

3. **Create your first project and board** — Use the UI to set up a new board.

4. **Install Squad CLI** to unlock agent execution:
   ```bash
   npx @bradygaster/squad-cli init
   ```

5. **Connect Squadboard and Squad**:
   ```bash
   squadboard connect
   ```

6. **Run your first agent** from the CLI and watch it flow onto the board:
   ```bash
   squad run --workflow my-workflow
   ```

## Key capabilities

| Capability | What it does |
|---|---|
| Durable workflows | Workflows survive across sessions, tracked and resumable |
| Live visualization | Board view with real-time agent output, all work in one place |
| Project templates | Squadboard apps and templates that structure agent work |
| Live run viewer | Stream agent output in real-time, step by step |
| Ceremonies | Optional versioned, auditable workflow automations (code review, bug fix, RFC) |
| Squad sync | State flows bidirectionally between board and `.squad/` files |
| MCP broker | Connect Copilot CLI, VS Code, or any MCP client — agents can read/write the board |
| Zero setup | Embedded PGlite (WASM Postgres) — no Docker, no cloud account |
| GitHub sync | Link a repo → issues and PRs flow in automatically |

## Documentation

Full docs → **[sabbour.me/squadboard](https://sabbour.me/squadboard/)**

- [Getting Started](https://sabbour.me/squadboard/getting-started/)
- [MCP Installation & Configuration](https://sabbour.me/squadboard/setup/mcp-install/)
- [REST API Reference](https://sabbour.me/squadboard/reference/api/)
- [WebSocket Protocol](https://sabbour.me/squadboard/reference/websocket/)
- [Ceremonies Guide](https://sabbour.me/squadboard/ceremonies/)
- [Squad Apps](https://sabbour.me/squadboard/user-guide/squad-apps/)

## Contributing

Squadboard is built with pnpm workspaces. The repo contains:

| Package | Role |
|---|---|
| `packages/server` | Express + WebSocket API, PGlite, MCP server |
| `packages/client` | React + Fluent 2 UI |
| `packages/cli` | `squadboard` CLI (`init`, `mcp`, `start`) |
| `packages/docs-site` | Docusaurus docs at http://localhost:3002 |

```bash
pnpm test              # unit tests
pnpm test:e2e          # Playwright E2E (starts dev server automatically)
pnpm build             # production build
```

## License

MIT
