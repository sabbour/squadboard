---
title: Installation
description: Install dependencies, start the local app, and build the docs site.
---

# Installation

## Prerequisites

- Node.js 20 or newer
- pnpm 8 or newer
- Git
- Optional: GitHub CLI if you want GitHub sync and PR automation

## Install from source

```bash
git clone https://github.com/sabbour/squadboard.git
cd squadboard
pnpm install
```

## Start the app

```bash
pnpm run dev
```

This starts the Express/WebSocket backend and the React/Vite frontend. The frontend is available at `http://localhost:5173`.

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

Build the CLI, then point your MCP client at the local command:

```json
{
  "mcpServers": {
    "squadboard": {
      "command": "node",
      "args": ["/absolute/path/to/squadboard/packages/cli/dist/index.js", "mcp"],
      "env": {
        "SQUADBOARD_SQUAD_STORAGE_PROVIDER": "postgresql"
      }
    }
  }
}
```

Set `SQUADBOARD_DEFAULT_PROJECT_ID` if you want project-scoped tools to work without passing a project ID every time.

To create the Copilot CLI config from the CLI, run `squadboard init --write-mcp-config` in the repository. It writes `.copilot/mcp-config.json` with the default PostgreSQL provider; add `--squad-storage fs` if you want filesystem fallback.

## Next steps

- **[Quickstart](./quickstart.mdx)** — Create your first project and run a workflow in 10 minutes
- **[What is Squadboard?](./what-is-squadboard.md)** — Understand the core concepts
- **[Tutorials](./tutorials/index.mdx)** — Walk through complete end-to-end workflows
