# @sabbour/squadboard

Pre-alpha local-first kanban + workflow board for Squad agents. Runs as an MCP server and web application.

## What is Squadboard?

Squadboard is a unified workspace for agents to coordinate work. It combines:

- **Local-first kanban** — Project boards, task columns, and issue cards
- **Workflows** — Multi-step agent ceremonies (spawn, checkpoint, closeout)
- **Ceremonies** — Scheduled and triggered team events (standups, planning, retrospectives)
- **Agent mesh** — Route work to agents based on skills and availability
- **Squad storage** — PostgreSQL or filesystem-based project state

It exposes APIs for agents to read/write projects, issues, workflows, and to participate in ceremonies via the Model Context Protocol (MCP).

## Installation

```bash
npm install @sabbour/squadboard
```

Or use the CLI:

```bash
npx @sabbour/squadboard-cli init
```

## Usage

### Start the Server

```bash
squadboard init          # Start server + web UI on :3000
squadboard mcp           # Start MCP server (stdio protocol)
```

### As MCP Server

Add to your Claude Desktop `claude_desktop_config.json` or Cursor MCP config:

```json
{
  "mcpServers": {
    "squadboard": {
      "command": "squadboard",
      "args": ["mcp"],
      "env": {
        "SQUADBOARD_SQUAD_STORAGE_PROVIDER": "postgresql"
      }
    }
  }
}
```

Then invoke from an MCP client:

```typescript
import { McpClient } from '@modelcontextprotocol/sdk/client/index.js';

const client = new McpClient();
// Call Squadboard tools and resources…
```

### REST API

The server exposes REST endpoints on `http://localhost:3000/api`:

| Endpoint | Description |
|----------|-------------|
| `/api/health` | Server health check |
| `/api/projects` | CRUD project operations |
| `/api/squad` | Squad sync and config |
| `/api/agents` | Agent registry and routing |
| `/api/issues` | Issue and deliverable management |
| `/api/workflows` | Workflow definitions and runs |
| `/api/ceremonies` | Ceremony scheduling and execution |
| `/api/consult` | Consult/review process |
| `/api/models` | LLM model configuration |

See source code in `src/routes/` for detailed endpoint signatures.

## Storage

### PostgreSQL (Default)

Stores squad state in a PostgreSQL database. Uses local **PGlite** by default; set `DATABASE_URL` to use a remote instance:

```bash
DATABASE_URL=postgresql://user:pass@host/db squadboard init
```

### Filesystem

Alternative storage using `.squad/` files in the repository:

```bash
squadboard init --squad-storage fs
```

## Environment

- `PORT` — HTTP server port (default: `3000`)
- `DATABASE_URL` — PostgreSQL connection string (optional; uses PGlite if not set)
- `SQUADBOARD_SQUAD_STORAGE_PROVIDER` — `postgresql` or `fs` (default: `postgresql`)

## Development

```bash
pnpm build         # Build TypeScript to dist/
pnpm dev           # Watch mode (file system storage)
pnpm dev:fs        # Watch mode with fs storage
pnpm dev:postgresql # Watch mode with PostgreSQL
pnpm test          # Run tests
pnpm test:cost-drift # Test for rate-limit drift

# Database
pnpm db:generate   # Generate Drizzle schema migrations
pnpm db:push       # Push schema to database
pnpm db:studio     # Open Drizzle Studio UI

# Migrations
pnpm migrate       # Run pending migrations
pnpm migrate:dry   # Preview migrations
pnpm migrate:verify # Verify migration state
```

## Architecture

- **Express** — REST API and web routing
- **WebSocket** — Real-time updates for kanban, workflows, and ceremonies
- **Drizzle ORM** — Type-safe database queries
- **PGlite** — Embedded PostgreSQL or remote connection
- **MCP** — Model Context Protocol server for agent integration
- **MCP HTTP Transport** — Bridge between stdio and HTTP for testing

## Notes

- **Pre-alpha** — Expect breaking changes
- **Monorepo internal package** — Requires `@sabbour/squadboard-sdk` from the same monorepo
- **Local-first design** — State syncs to `.squad/` files or PostgreSQL; agents pull work from the board
- **Ceremonies-centric** — Workflows are driven by ceremonies (spawn → work → checkpoint → closeout)
