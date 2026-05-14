# Demo 4 — One-Shot Agent

> **Status:** 🔴 Not started  
> **Layer:** Engine  
> **Estimated session:** ~5 minutes to run through

## What this demo shows

Pick an agent, click "Run", and watch it execute in an isolated workspace. The run completes, output is captured, and the card moves to Done.

## Prerequisites

- Demo 3 complete (agent hired)
- `npx @sabbour/squadboard up` running
- At least one agent assigned to your project
- A card in your Backlog column

## Run it

```bash
# Step 1: Click on a card in Backlog
# Open the detail panel

# Step 2: Assign the card to an agent
# Click "Assign Agent" and select an agent from the dropdown

# Step 3: Click "Run"
# Watch the card move to In Progress; the engine spawns a run

# Step 4: Monitor the run in the Live ops view
# Go to Settings → Live Ops or click the "Live" tab
# See your run in the active-runs grid with live output

# Step 5: Wait for completion
# The run finishes; the card automatically moves to Done
```

## What to observe

- The card moves to In Progress immediately when you click Run
- The agent runs in an isolated workspace (no interference with other runs)
- Live ops view shows the run's status, cost, and exit code
- Card auto-advances to Done when the agent completes
- Output is captured and visible in the card's comment thread

## Known gaps (hacking phase)

> Isolated workspaces (tmpdir/worktree strategy) are TBD pending workspace isolation PR.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
