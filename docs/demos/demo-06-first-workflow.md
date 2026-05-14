# Demo 6 — First Workflow

> **Status:** 🔴 Not started  
> **Layer:** Engine  
> **Estimated session:** ~12 minutes to run through

## What this demo shows

Define a YAML workflow with three steps: route the card → run an agent → wait for approval. The workflow engine orchestrates the entire sequence without manual intervention.

## Prerequisites

- Demo 4 complete (one-shot agent working)
- Demo 5 complete (routing rules working)
- `npx @sabbour/squadboard up` running
- At least two agents hired (one for work, one for review)

## Run it

```bash
# Step 1: Create a workflow file at .squad/workflows/simple.yaml
# Define a 3-step workflow:
#   1. route (use tier-1 rules)
#   2. agent_run (assigned agent does work)
#   3. peer_review (wait for approval)

# Step 2: Create a card and assign it to the workflow
# Click "Link Workflow" → select "simple"

# Step 3: Click "Execute Workflow"
# Watch the card progress through steps 1, 2, 3

# Step 4: In the Live ops view, see each step as a row
# Step 1 completes → Step 2 (agent) starts

# Step 5: Approve the run (or request changes)
# In the detail panel, click Approve
# Workflow completes; card moves to Done
```

## What to observe

- Workflow YAML is human-readable and versionable
- Steps execute in order; no step starts until the previous one completes
- The agent receives context from the routing step
- Approval gates block progression until a reviewer acts
- Cost is tracked per step and per workflow run

## Known gaps (hacking phase)

> Workflow template gallery is TBD pending Demo 11 (editor). Basic YAML schema validation only.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
