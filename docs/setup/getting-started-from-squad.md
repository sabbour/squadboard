# Getting Started with Squadboard (for Squad users)

> Already using Squad CLI? This guide adds Squadboard as a visual companion without changing your existing workflow.

## What you get

- **Visual kanban board** — see your `.squad/` work, ceremonies, and agent runs in one place
- **Run history** — all agent executions with status, output, and cost
- **MCP integration** — Squad agents can capture cards and mark work done automatically
- **Ceremonies editor** — view and run `.squad/ceremonies/` workflows visually
- **Persistent storage** — optional PostgreSQL or built-in PGlite database

## Choose your setup

### Option A: Local-only (PGlite — zero config)

Start Squadboard server locally. Data stays in a `.squadboard/` file in your project directory.

```bash
# From the repo root
cd /path/to/squadboard
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The board is running. No database setup required.

### Option B: PostgreSQL (cloud/shared/persistent)

For teams or persistent data across deploys:

```bash
export DATABASE_URL="postgresql://user:pass@host/squadboard"
pnpm install
pnpm dev
```

Squadboard applies migrations automatically on startup.

## Wire the MCP (optional but recommended)

Without MCP wired, Squad agents still work as normal — they write to `.squad/decisions/inbox/` as usual. The board shows what's there, but agents don't know about the visual state.

With MCP wired, agents can:
- **capture** — drop a card in the board's inbox
- **done:** — close a card when work finishes
- See their runs in the board's Run History view

### Steps to wire MCP

1. **Start Squadboard server:**
   ```bash
   pnpm dev
   ```

2. **Find your project ID** — open http://localhost:5173, look at the URL or board header. It's a UUID like `550e8400-e29b-41d4-a716-446655440000`.

3. **Add to `~/.copilot/mcp-config.json`:**
   ```json
   {
     "mcpServers": {
       "squadboard": {
         "command": "node",
         "args": ["/absolute/path/to/squadboard/packages/cli/dist/index.js", "mcp"],
         "env": {
           "SQUADBOARD_SQUAD_STORAGE_PROVIDER": "postgresql",
           "SQUADBOARD_DEFAULT_PROJECT_ID": "550e8400-e29b-41d4-a716-446655440000"
         }
       }
     }
   }
   ```
   Replace `/absolute/path/to/squadboard` and the project ID with your values.

4. **Restart Copilot CLI** and Squad agents.

## Keep both modes working

The board doesn't replace your `.squad/` directory — it works alongside it:

| Setting | Where Squad writes | Board enabled? |
|---------|-------------------|---|
| `SQUADBOARD_SQUAD_STORAGE_PROVIDER=fs` | `.squad/decisions/inbox/` files | No (fallback only) |
| `SQUADBOARD_SQUAD_STORAGE_PROVIDER=postgresql` | Squadboard database | Yes |
| **Not set (default)** | `.squad/decisions/inbox/` files | No |

- **Switch anytime:** Change the env var and restart. Your `.squad/` directory is always safe — it's the git-native record.
- **The board is additive:** It shows more detail (UI, status, history), but doesn't replace the files.
- **Team workflows:** Some devs keep CLI-first; others use the board. Both work in the same project.

## Verify it's working

Quick smoke test:

```bash
# 1. Squadboard server is running
pnpm dev &

# 2. Run a Squad agent with MCP wired
copilot --agent squad

# 3. Ask it to capture something
# "Can you capture a quick todo?"

# 4. Check the board at http://localhost:5173
# A card should appear in the inbox
```

## What Squad agents do automatically (with MCP)

If your `.squad/agents/agent.md` file includes a `squad.agent.md` automation rule, agents wired to the MCP will:

1. **On start:**
   - `capture "Working on: <task>"` — drops a card in the inbox

2. **On completion:**
   - `done: <task> (sha=abc123)` — closes the matching card

3. **On error:**
   - `capture "Error: <message>"` — logs failure to the board

No code changes required. The routing is driven by your `squad.agent.md` automation rules.

## Next steps

- **MCP reference:** See [`docs/setup/mcp-install.md`](./mcp-install.md) for full tool documentation and troubleshooting
- **Ceremonies:** Learn to author workflows in [`docs/ceremonies/`](../ceremonies/)
- **Concepts:** Understand the dogfood loop in [`docs/concepts/dogfood-loop.md`](../concepts/dogfood-loop.md)
