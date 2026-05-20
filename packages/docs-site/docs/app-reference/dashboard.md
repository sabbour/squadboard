---
title: Dashboard
description: Project health, metrics, and performance overview
---

# Dashboard

**Route:** `/projects/:id/dashboard`

Project health snapshot at a glance. Throughput, agent performance, workflow execution stats, and cost tracking—see how your team and automation are performing.

## Overview

Dashboard gives you a bird's-eye view of one project. Unlike the Board (which is task-focused), Dashboard is metric-focused. It answers questions like:
- How many cards did we move this week?
- Which agents are most active?
- Are workflows executing reliably?
- How much are we spending?

## Sections

### Now View
Current activity: sessions in progress, active runs, active workflows. Jump to any of these from here.

Link to full [Now](./now.md) dashboard for your entire workspace.

### Overview
Project summary:
- Project name
- Storage provider and sync status
- Squad integration status
- Created date

### Throughput (30 Days)
Graph showing cards moved to Done each day over the last month. Highlights trends and productivity patterns.

### Agent Leaderboard
Top performing agents by:
- Runs completed
- Success rate
- Average execution time

Click any agent to view detailed agent profile or routing statistics.

### Workflow Health
Ceremony/workflow execution stats:
- Total runs
- Success rate
- Average duration
- Last execution time

Grouped by workflow type.

## Actions

**Jump to Board**
- Click "Go to Board" button to open the kanban board

**View Project Flow**
- Click "View Flow" to see agent lineage and swimlane view

**Navigate to Costs**
- Click cost summary to view full cost breakdown

**Update Squad Sync status**
- Click status badge to refresh or manage Squad integration
- Status shows: Ready, Manual bridge, Needs repair

## Configuration

No user-editable options on Dashboard. Metrics are read-only, sourced from:
- Issue event stream
- Agent execution logs
- Ceremony run history
- Cost aggregation

Budget and alerts are configured in [Settings](./settings.md).

## Related

- [Board](./board.md) — Active work and card management
- [Flow](./flow.md) — Agent lineage and swimlanes
- [Costs](./costs.md) — Detailed cost breakdown
- [Agents](./agents.md) — Agent details and routing stats
- [Ceremonies](./ceremonies.md) — Workflow execution history
