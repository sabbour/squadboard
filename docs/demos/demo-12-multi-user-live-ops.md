# Demo 12 — Multi-User + Live Ops

> **Status:** 🔴 Not started  
> **Layer:** Board UI  
> **Estimated session:** ~12 minutes to run through

## What this demo shows

Log in with GitHub OAuth. Multiple users see the same board in real-time (via WebSocket). The Live ops view shows active runs, queued work, and a durable activity feed.

## Prerequisites

- Demo 7 complete (resilience working)
- `npx @sabbour/squadboard up` running
- GitHub OAuth app configured (see SETUP guide TBD)
- A shared project (`.squad/` in a team repo)

## Run it

```bash
# Step 1: Start a second browser session (or ask a colleague)
# Go to http://localhost:5173 (same Squadboard instance)

# Step 2: Log in with GitHub
# Click "Sign in with GitHub" → authorize the app

# Step 3: Both sessions see the same board
# Create a card in one session
# It appears in the other session instantly (via WebSocket)

# Step 4: Click the "Live" tab
# See the Live ops view: header summary, active-runs grid, activity feed

# Step 5: Execute a workflow in one session
# The other session sees the run appear in the active-runs grid in real-time

# Step 6: Scroll the activity feed
# Every action (card created, workflow started, approval, etc.) is logged with timestamp
```

## What to observe

- WebSocket reconnect is automatic (survives brief network glitches)
- Multi-user edits are concurrent; no conflicts
- The Live ops header shows project-level stats (cards, active runs, cost burn)
- Activity feed is immutable (auditable)
- Pagination in the activity feed is via `since-id` cursor

## Known gaps (hacking phase)

> GitHub OAuth scope refinement is TBD. WebSocket reconnect cursor (`since-id`) is MVP. Conflict resolution (e.g., simultaneous edits to same card) is TBD pending PRD §12.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
