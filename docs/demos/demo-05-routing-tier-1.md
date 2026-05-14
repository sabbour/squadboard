# Demo 5 — Routing Tier 1

> **Status:** 🔴 Not started  
> **Layer:** Engine  
> **Estimated session:** ~6 minutes to run through

## What this demo shows

Define deterministic routing rules in `.squad/routing.md`. Cards with matching attributes auto-assign to the correct agent without clicking "Assign".

## Prerequisites

- Demo 3 complete (agents hired)
- `npx @sabbour/squadboard up` running
- A `.squad/routing.md` file in your project (see templates for examples)

## Run it

```bash
# Step 1: Create or edit .squad/routing.md
# Add a rule: if a card has label:"bug" → assign to "qa-tester"

# Step 2: Create a new card with label:"bug"
# The card appears in Backlog

# Step 3: Wait 5 seconds (dispatcher tick)
# The card auto-assigns to "qa-tester" and moves to Ready

# Step 4: Edit the routing rule
# Change the condition (e.g., label:"doc" → assign to "docs-writer")

# Step 5: Create a card with label:"doc"
# The new rule applies immediately
```

## What to observe

- Cards auto-assign based on routing rules
- Rule changes take effect on the next dispatcher tick
- Rules are declarative (no code, just matching logic)
- The rules engine respects card attributes (labels, title patterns, priority)

## Known gaps (hacking phase)

> Tier 1 routing (rules only) is implemented. Tier 2 (matchRoute fallback) and Tier 3 (LLM specifier) are in later demos.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
