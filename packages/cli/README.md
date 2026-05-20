# @sabbour/squadboard-cli

Start Squadboard server locally or run it as an MCP server for Claude Desktop, Cursor, and other MCP hosts.

## Installation

```bash
npm install @sabbour/squadboard-cli
```

Or use the binary directly:

```bash
npx @sabbour/squadboard-cli init
```

## Usage

### Start the Squadboard UI

```bash
squadboard init [--squad-storage postgresql|fs] [--write-mcp-config]
```

This starts the Squadboard server and automatically opens the web UI at `http://localhost:3000`.

**Storage options:**
- `postgresql` (default) — Store squad state in Squadboard's local PGlite database (or remote PostgreSQL via `DATABASE_URL`)
- `fs` — Fallback to filesystem-based `.squad/` file storage

**Config options:**
- `--write-mcp-config` — Automatically merge the MCP server config into `.copilot/mcp-config.json`

### Start as MCP Server

```bash
squadboard mcp [--squad-storage postgresql|fs] [--print-mcp-config]
```

Starts Squadboard as an MCP server on stdio. Useful for:
- **Claude Desktop** — Add to your `claude_desktop_config.json`
- **Cursor** — Add to your MCP configuration
- **VS Code with Copilot CLI** — Direct stdio integration

**Config options:**
- `--print-mcp-config` — Print the MCP config JSON block and exit (useful for copy-paste setup)

## API

### Binary Commands

| Command | Description |
|---------|-------------|
| `init` | Start the Squadboard server and open the web UI |
| `mcp` | Start the MCP server (stdio protocol) |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--squad-storage postgresql\|fs` | `postgresql` | Where to store squad state |
| `--print-mcp-config` | — | Print MCP config and exit |
| `--write-mcp-config` | — | Merge MCP config into `.copilot/mcp-config.json` |

## Development

```bash
pnpm build    # Build the CLI into dist/
pnpm dev      # Run directly without building (for testing)
pnpm start    # Run the built CLI
```

## Notes

- Requires the `@sabbour/squadboard` server package to be built
- Spawns the server as a child process and monitors its health
- Auto-opens the browser on startup (requires `open` dependency)
- Handles graceful shutdown on SIGINT/SIGTERM
