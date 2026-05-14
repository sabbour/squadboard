# Demo 10 — Fan-Out + Handoff

> **Status:** 🔴 Not started  
> **Layer:** Engine  
> **Estimated session:** ~10 minutes to run through

## What this demo shows

A workflow step splits one card into N subtasks (fan-out). Each subtask runs in an isolated worktree. Parent waits for all children to complete (or can be paused/resumed manually).

## Prerequisites

- Demo 6 complete (workflows working)
- `npx @sabbour/squadboard up` running
- A workflow with a `split` step (or `fan_out` alias)

## Run it

```bash
# Step 1: Create a workflow with a split step
# Add: kind: split, count: 3, agent: researcher
# This creates 3 child runs from one card

# Step 2: Execute the workflow
# The engine materializes 3 workflow_runs (children) in one transaction

# Step 3: In Live ops view, see the parent run and 3 child runs
# Each child has its own isolated worktree (tmpdir or git worktree)

# Step 4: Each child runs the same agent with different input
# Progress pills show 0/3 → 1/3 → 2/3 → 3/3 on the parent card

# Step 5: Pause the subtree
# Click the parent card, toggle "Pause Subtree"
# Child runs pause; click "Resume" to restart them

# Step 6: All children complete
# The parent workflow advances to the next step
```

## What to observe

- Children inherit context (pinnedAgentRevisions, environment) from parent
- Each child is isolated (no interference with other children or parent)
- Progress pills on the parent card show live percentage (X/N done)
- Subtree pause/resume is atomic (all children pause together)
- Handoff context is passed to each child (see `.squad/` env)

## Known gaps (hacking phase)

> Isolated worktrees (git worktree strategy) are TBD. Progress pills UI is MVP. Subtree pause/resume is stubbed in engine, UI pending.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
