# Squadboard MCP Server

A Model Context Protocol (MCP) server that exposes Squadboard's project,
inbox, issue, and agent surface to external CLIs and AI clients
(Copilot CLI, Claude Desktop, Cursor, etc.).

Two transports ship out of the box from the same `createMcpServer()`
factory:

| Transport | Entry point                                | Use it from                                  |
|-----------|--------------------------------------------|----------------------------------------------|
| **stdio** | `packages/server/dist/mcp/index.js`        | Desktop clients that spawn child processes (Claude Desktop, Cursor, Copilot CLI). |
| **HTTP**  | Mounted on the running server at `/mcp`    | Anything that prefers Streamable HTTP / SSE. Boot the main server (`pnpm dev`) and POST JSON-RPC at `http://localhost:3000/mcp`. |

## Tools

11 tools are registered (Phase 18 dropped the `squadboard_` prefix — the
server name `squadboard` already namespaces).

| Tool             | What it does                                                                                     |
|------------------|--------------------------------------------------------------------------------------------------|
| `list_projects`  | List every Squadboard project + resolved `.squad/` path.                                         |
| `list_inbox`     | List Conjure / quick-capture inbox items. Filterable by `status` and `projectId`.                |
| `capture`        | Drop a free-form prompt → Conjure classifier → if `intent='issue'` AND `projectId`, create card. |
| `list_issues`    | List board cards, optionally filtered by column status.                                          |
| `create_issue`   | Create a card directly (no Conjure classification; honors `idempotencyKey`).                     |
| `update_issue`   | Patch title / body / status / assignee / labels.                                                 |
| `list_agents`    | List active agents in a project.                                                                 |
| `run_agent`      | Trigger an `agent_run` on an issue.                                                              |
| `get_run_status` | Read status, output, cost, tokens for an issue run.                                              |
| `get_routing`    | Return the project's `.squad/routing.md` contents.                                               |
| `slash_command`  | Execute a `/squadboard …` slash command and get markdown back.                                   |

### Project ID resolution

Project-scoped tools accept `projectId` either as an argument or via the
`x-project-id` HTTP request header (HTTP transport only — stdio has no
headers, so args are required there). Use `list_projects` first to
discover the right ID.

## Install — Copilot CLI

Add this entry to `~/.copilot/mcp-config.json` (or your project-local
`.copilot/mcp-config.json`):

```jsonc
{
  "mcpServers": {
    "squadboard": {
      "command": "node",
      "args": ["/abs/path/to/squadboard/packages/server/dist/mcp/index.js"]
    }
  }
}
```

For local development (no build step required) you can point at
`tsx` instead:

```jsonc
{
  "mcpServers": {
    "squadboard": {
      "command": "npx",
      "args": [
        "tsx",
        "/abs/path/to/squadboard/packages/server/src/mcp/index.ts"
      ]
    }
  }
}
```

## Install — Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent on your platform:

```jsonc
{
  "mcpServers": {
    "squadboard": {
      "command": "node",
      "args": ["/abs/path/to/squadboard/packages/server/dist/mcp/index.js"]
    }
  }
}
```

Restart Claude Desktop. The Squadboard tools should appear in the tools
sidebar.

## Build

```bash
cd packages/server
pnpm build
# → dist/mcp/index.js  (the stdio entry point)
```

The first launch boots embedded Postgres in-process, runs migrations,
then starts the MCP server on stdio. Logs go to **stderr** to keep
**stdout** clean for JSON-RPC.

## HTTP transport — quick smoke test

```bash
# Start the main server first:
pnpm --filter @sabbour/squadboard-server dev

# Then in another shell:
curl -s http://localhost:3000/mcp/health | jq .
# {
#   "ok": true,
#   "transport": "streamable-http",
#   "sdkVersion": "1.x.y",
#   "tools": ["list_issues", "create_issue", ..., "get_routing"],
#   "sessions": 0
# }
```

## What's NOT in scope (yet)

- **Auth.** HTTP transport is local-only; no bearer tokens.
- **Multi-project routing in stdio.** Each stdio child binds to its own
  embedded Postgres — pass `projectId` explicitly on every call.
- **Write tools beyond `create_issue` / `update_issue` / `capture` /
  `run_agent`.** Templates, agents, MCP-server CRUD, etc. stay in the
  REST surface for now.
- **Prompts and resources** (the other two MCP primitives) — deferred.
