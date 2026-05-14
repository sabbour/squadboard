# Demo 7 — Resilience + Cost

> **Status:** 🔴 Not started  
> **Layer:** Engine  
> **Estimated session:** ~10 minutes to run through

## What this demo shows

Kill the Squadboard process while an agent is running. The engine recovers: the run resumes (or retries) without data loss. Per-run cost is tracked and displayed live.

## Prerequisites

- Demo 6 complete (workflows working)
- `npx @sabbour/squadboard up` running
- A workflow in progress (or queued)

## Run it

```bash
# Step 1: Start a long-running workflow
# Create a card, assign it to a workflow, click Execute
# The agent starts running

# Step 2: Kill the engine process
# Ctrl+C the Squadboard process OR pkill -f squadboard

# Step 3: Restart Squadboard
# npx @sabbour/squadboard up (same project)

# Step 4: Check the Live ops view
# The run is still there; its status shows "recovering" then "running"
# No data loss; the step resumes from where it left off

# Step 5: Open the cost tracker in Live ops
# Per-step cost and total workflow cost are displayed
```

## What to observe

- The database is persistent (Postgres survives engine restart)
- In-flight runs have a lease (90s TTL) and heartbeat (30s interval)
- After restart, the dispatcher sweeps leases and recovers stuck runs
- Cost is cumulative and per-run accurate
- The workflow completes without manual retry

## Known gaps (hacking phase)

> Sweeper logic for lease recovery is TBD pending durability PR. Cost tracking is MVP (no per-agent breakdowns yet).

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
