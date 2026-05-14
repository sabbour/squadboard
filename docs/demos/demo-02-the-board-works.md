# Demo 2 — The Board Works

> **Status:** 🔴 Not started  
> **Layer:** Foundation  
> **Estimated session:** ~8 minutes to run through

## What this demo shows

Drag a card across columns, add a comment with markdown, filter by label, and bulk-edit multiple cards at once. The board is a real kanban.

## Prerequisites

- Demo 1 complete
- `npx @sabbour/squadboard up` running
- At least one project created with a sample card in Backlog

## Run it

```bash
# Step 1: Create sample cards in your project
# Use the UI: click "Add Card" in Backlog column, name a few tasks

# Step 2: Drag a card from Backlog to In Progress
# Card moves instantly; no refresh needed

# Step 3: Click on a card to open the detail panel
# Add a comment with markdown (e.g., "## Title" or "```code block```")

# Step 4: Apply a label filter
# Click Filters → select a label or create a new one

# Step 5: Bulk edit cards
# Multi-select cards, apply the same label to all at once
```

## What to observe

- Cards drag smoothly between columns
- Comments render markdown and mermaid diagrams
- Filters persist across page reloads
- Bulk actions complete without page refresh
- The board reflects real-time changes

## Known gaps (hacking phase)

> Mermaid diagram rendering and bulk-delete actions are TBD pending Demo 2 implementation.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
