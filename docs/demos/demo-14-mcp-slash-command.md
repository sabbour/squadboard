# Demo 14 — MCP + Slash Command

> **Status:** 🔴 Not started  
> **Layer:** Advanced  
> **Estimated session:** ~8 minutes to run through

## What this demo shows

Agents can use `engine_*` MCP tools (e.g., `engine_create_issue`, `engine_assign_card`) to trigger Squadboard actions. The `/squadboard` CLI command lets you query the engine from the command line.

## Prerequisites

- Demo 4 complete (one-shot agent working)
- `npx @sabbour/squadboard up` running (engine MCP server listening on localhost)
- A test agent that uses MCP tools

## Run it

```bash
# Step 1: Inside an agent's charter, use the engine_* tools
# Example: "Create a follow-up issue for documentation"
# The agent calls engine_create_issue with workflow context

# Step 2: Run the agent
# The MCP tool creates the issue in Squadboard

# Step 3: See the new card on the board
# It appears instantly (no manual refresh)

# Step 4: From the CLI, use /squadboard
# Example: /squadboard list --project myproject
# Shows all open issues

# Step 5: Try /squadboard assign
# Example: /squadboard assign card-123 researcher
# Assigns the card programmatically
```

## What to observe

- MCP tool calls are idempotent (safe to replay 10× without side effects)
- Engine creates are atomic (card + issue_run + audit row in one transaction)
- CLI commands return structured JSON
- Tool errors include a recovery hint (e.g., "Issue already exists; skipping create")

## Known gaps (hacking phase)

> MCP server binding to localhost is MVP (not TLS/auth yet). `/squadboard` CLI needs arg parsing (currently stubs only).

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
