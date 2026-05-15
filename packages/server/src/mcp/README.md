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
| `list_agents`    | List agents in a project, filterable by status (active, disabled, retired, or all).               |
| `run_agent`      | Trigger an `agent_run` on an issue.                                                              |
| `get_run_status` | Read status, output, cost, tokens for an issue run.                                              |
| `get_routing`    | Return the project's `.squad/routing.md` contents.                                               |
| `slash_command`  | Execute a `/squadboard …` slash command and get markdown back.                                   |

### Tool Reference

#### `list_agents` — Agent lifecycle & status (Wave 10 / B9)

List agents in a project. Filter by agent status:
- `active` (default) — agents currently enabled for assignment and runs
- `disabled` — paused agents; can be re-enabled without re-importing
- `retired` — archived agents; typically hidden from UI but discoverable via this tool
- `all` — return every agent regardless of status

Example:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "list_agents",
    "arguments": {
      "projectId": "7a9cc07a-d463-4f8c-864a-c733342aa8a8",
      "status": "disabled"
    }
  }
}
```

The distinction between `disabled` and `retired` lets teams:
- **Disable** agents mid-workflow without losing configuration (e.g., "this skill is broken, suppress it pending D8 fix")
- **Retire** agents for good (e.g., "this v1 team is superseded by v2")

#### `capture` — MCP-driven dogfood loop (Wave 10 / A4)

Drop a free-form prompt into Squadboard's inbox. The Conjure classifier decides
the intent (`issue | project | team | agent | skill | tool`). When `intent = 'issue'`
AND a `projectId` is in scope, the tool creates a card immediately. Otherwise,
it returns a draft classification so the caller can confirm routing.

Used by the Copilot CLI coordinator to capture directives, bug reports, and
feature requests as cards — see [Dogfood Playbook](../../../.squad/dogfood.md)
for the full loop.

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
      ],
      "env": {
        "SQUADBOARD_DEFAULT_PROJECT_ID": "${SQUADBOARD_DEFAULT_PROJECT_ID}"
      }
    }
  }
}
```

The repo's own `.copilot/mcp-config.json` ships the `tsx` form pre-wired
so this Copilot CLI can dogfood squadboard immediately — see
[Wave 10 Stream A](../../../.squad/dogfood.md) for the full loop.

### `SQUADBOARD_DEFAULT_PROJECT_ID` (Wave 10 / A3)

Stdio MCP transport reads `SQUADBOARD_DEFAULT_PROJECT_ID` at boot and
uses it as the project-id fallback for every project-scoped tool
(`capture`, `list_inbox`, `list_issues`, `list_agents`, `update_issue`,
`get_routing`). The resolution order is:

1. `projectId` argument on the tool call (always wins).
2. `x-project-id` HTTP request header (HTTP transport only).
3. `SQUADBOARD_DEFAULT_PROJECT_ID` env var (stdio + HTTP fallback).

This lets a desktop / CLI client drop `capture: "fix the hover resize"`
into the tool with no extra plumbing — the env var picks the project.
HTTP clients that already pass `x-project-id` are unaffected.

### HTTP transport URL

If you'd rather use the Streamable HTTP transport (e.g. from VS Code,
which doesn't spawn child processes for MCP servers), boot the main
server (`pnpm dev`) and point the client at:

```
http://localhost:3000/mcp
```

The route is mounted in `packages/server/src/index.ts` at
`app.use('/mcp', createMcpHttpRouter())`. Health check + tool listing:
`GET http://localhost:3000/mcp/health`.

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
