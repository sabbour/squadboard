# Demo 13 — Dashboards

> **Status:** 🔴 Not started  
> **Layer:** Board UI  
> **Estimated session:** ~8 minutes to run through

## What this demo shows

Out-of-the-box dashboards query the `issue_runs` and `workflow_runs` tables. See agent leaderboard (most active agents), cost burn (spend over time), workflow funnel (pass/fail rates), and burndown (cards moving to Done).

## Prerequisites

- Demo 7 complete (resilience working)
- `npx @sabbour/squadboard up` running
- At least 10–20 completed workflow runs (for meaningful charts)

## Run it

```bash
# Step 1: Click the "Dashboards" tab
# See a grid of four charts

# Step 2: Agent Leaderboard
# Bar chart: agents sorted by number of runs completed
# Hover to see run count and success rate

# Step 3: Cost Burn
# Line chart: cumulative cost over time (per day)
# Drill down by agent or step type

# Step 4: Workflow Funnel
# Funnel chart: % of workflows that pass each tier
# (Tier 1 routing → Agent Run → Approval → Complete)

# Step 5: Burndown
# Line chart: open cards vs. done cards over time
# Velocity is the slope

# Step 6: Click a chart to drill down
# Filter by date range, agent, or workflow type
```

## What to observe

- All charts are read-only (no manual edits)
- Charts update as new runs complete (no refresh needed)
- Drill-down filters are cumulative
- Export to CSV is available (TBD)
- Performance: all charts render in < 2s even with 10k issues

## Known gaps (hacking phase)

> CSV export is TBD. Custom date-range picker is MVP. Drill-down is partially stubbed; some filters are not yet wired.

---
*Auto-generated stub. Last updated: 2026-05-14. Update when demo ships.*
