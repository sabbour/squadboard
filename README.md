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

[Squad](https://github.com/bradygaster/squad) gives you AI agents. Squadboard gives those agents a board, ceremonies, and live run tracking. Without Squad, Squadboard is empty. With Squad, it's a durable home for your agent workflows.

## Two ways to get started

### Option A — Desktop app (recommended)

Download the pre-built installer for your platform from [GitHub Releases](https://github.com/sabbour/squadboard/releases). Extract, install, and run. The app bundles everything — no Node.js, no Postgres, no external services needed.

| Platform | Download |
|----------|----------|
| macOS | `Squadboard-*.dmg` |
| Windows | `Squadboard-Setup-*.exe` |
| Linux | `Squadboard-*.AppImage` |

### Option B — CLI

```bash
npx @sabbour/squadboard-cli init
```

This scaffolds a local Squadboard project and starts the dev server on `http://localhost:5173`.

**Requires:** Node.js ≥ 20, pnpm ≥ 8

## First run

1. Create or link an existing Squad project (point to a folder with `.squad/`)
2. Squadboard imports your agents and workflows
3. Create a card → move it to Ready → watch your agent pick it up and run
4. After the run completes, close it with a ceremony to capture decisions

## Key capabilities

| Capability | What it does |
|---|---|
| Board-first UI | Drag cards through columns, see all agent work in one place |
| Ceremonies | Versioned, auditable workflow automations (code review, bug fix, RFC) |
| Live run viewer | Stream agent output in real-time, step by step |
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
