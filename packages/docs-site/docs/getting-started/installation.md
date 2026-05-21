---
title: Installation
description: Install Squadboard using npm or download the desktop app.
---

# Installation

## Two ways to install

### Option A — Desktop app (recommended)

Download the pre-built installer from [GitHub Releases](https://github.com/sabbour/squadboard/releases):

- **macOS:** `Squadboard-*.dmg` (Intel + Apple Silicon)
- **Windows:** `Squadboard-Setup-*.exe`
- **Linux:** `Squadboard-*.AppImage`

Install and run — no Node.js required, no Docker, no config.

### Option B — npm CLI

```bash
npx @sabbour/squadboard-cli init
```

**Requirements:** Node.js 20 or newer, pnpm 8 or newer

This scaffolds a local project and starts the dev server at `http://localhost:5173`.

## Start the app

If you installed via npm:

```bash
pnpm run dev
```

This starts the Express/WebSocket backend and the React/Vite frontend. The frontend loads at `http://localhost:5173`.

Squad state uses PostgreSQL by default. Existing `.squad/` files are imported once into an empty DB-backed project. Use `pnpm run dev:fs` if you intentionally want repository `.squad/` files to remain the live state store.

## Start the docs site

```bash
pnpm docs:dev
```

The Docusaurus site is mounted with `baseUrl: /docs/`, so local links match the production shape used by the hosted docs.

## Production builds

Build everything:

```bash
pnpm build
```

Build only the docs site:

```bash
pnpm docs:build
```

Serve the built docs:

```bash
pnpm docs:serve
```

## Optional MCP setup

If you want Copilot CLI or VS Code to connect to Squadboard:

```json
{
  "mcpServers": {
    "squadboard": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

To generate the config automatically, run:

```bash
npx @sabbour/squadboard-cli init --write-mcp-config
```

## Use an external Postgres (optional)

For team state or persistence across restarts:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/squadboard pnpm run dev
```

## Next steps

- **[Quickstart](./quickstart.mdx)** — Create your first project and run a workflow in 10 minutes
- **[What is Squadboard?](./what-is-squadboard.md)** — Understand the core concepts
- **[Tutorials](./tutorials/index.mdx)** — Walk through complete end-to-end workflows
