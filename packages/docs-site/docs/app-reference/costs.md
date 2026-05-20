---
title: Costs
description: Month-to-date LLM spend dashboard
---

# Costs

**Route:** `/projects/:id/costs`

Track your LLM spending for this project. Month-to-date aggregation of all costs from agent runs.

## Overview

Costs shows a consolidated view of what you're spending on LLM inference via agents. Each card or metric represents cost for a time period, agent, or run.

## Dashboard

**Cost breakdown by:**
- **Total MTD** — Month-to-date spend across all runs
- **By agent** — Which agents cost the most
- **By run type** — Issues vs. workflows vs. ceremonies
- **Trending** — Daily or weekly spend trend

**Metrics per run:**
- Input tokens
- Output tokens
- Model used
- Cost in USD (configurable currency per project)
- Effective rate ($/1k tokens)

## Sections

The dashboard aggregates cost data from the Run history and Ceremony execution logs. Each section is read-only; costs can't be edited directly.

### Summary Card
Large prominent number: total MTD spend.

### By Agent
Bar chart or table showing top-spending agents. Click any agent to see detailed runs.

### By Time
Line chart showing cumulative cost through the month. See if spending is accelerating or steady.

### By Run Type
Breakdown: What portion of budget went to issue runs vs. workflow runs vs. interactive sessions?

## Actions

**View run detail**
- Click any cost breakdown item
- Opens [Live Run Viewer](./live-run-viewer.md) for detailed token/cost analysis

**Export cost report**
- Click "Export" button (if available)
- Downloads CSV of all runs this month with costs

**Set budget limit**
- Navigate to [Settings](./settings.md) → Budget section
- Set spending cap per month

**Adjust currency**
- Navigate to [Settings](./settings.md) → General section
- Change currency display (USD default)

## Configuration

Costs are read-only on this page. To configure:

**Budget limits** — Set in [Settings](./settings.md) under "Budget"

**Currency display** — Set in [Settings](./settings.md) under "General"

**Model pricing** — Configured per agent in [Agents](./agents.md) based on model selection

## Related

- [Dashboard](./dashboard.md) — Project overview including cost summary
- [Agents](./agents.md) — View per-agent cost and model selection
- [Live Run Viewer](./live-run-viewer.md) — See token counts and cost for specific runs
- [Settings](./settings.md) — Configure budget limits and currency
