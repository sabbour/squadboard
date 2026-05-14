# Demo 8 — Routing Tiers 2+3

> **Status:** 🔴 Not started  
> **Layer:** Engine  
> **Estimated session:** ~8 minutes to run through

## What this demo shows

When Tier 1 rules don't match, fall back to Tier 2 (static matchRoute fallback) or Tier 3 (LLM specifier agent picks the best agent), then human triage if needed.

## Prerequisites

- Demo 5 complete (Tier 1 routing working)
- `npx @sabbour/squadboard up` running
- A "specifier" agent in your squad (e.g., `.squad/agents/specifier.md`)
- A `.squad/routing.md` with incomplete rules

## Run it

```bash
# Step 1: Create a card that doesn't match any Tier 1 rule
# The card stays in Backlog

# Step 2: Wait for the dispatcher (5s)
# Card moves to Tier 2 matching (static fallback agent)

# Step 3: If Tier 2 fails, the card goes to Tier 3
# The specifier agent runs and recommends an agent for the card

# Step 4: If Tier 3 is inconclusive, card goes to "Triage"
# A human reviewer (you) picks the right agent manually

# Step 5: Click "Assign" on a triaged card
# The card moves to the assigned agent's lane
```

## What to observe

- Tier 1 rules execute first and are deterministic
- Tier 2 falls back to a static matchRoute function
- Tier 3 routes via LLM (the specifier agent)
- Tier 4 is human triage (you pick manually)
- Each tier is logged in the activity feed with reasoning

## Known gaps (hacking phase)

> Tier 3 LLM routing is TBD. Tier 2 matchRoute function is partially stubbed. Triage column in Board UI is TBD.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
