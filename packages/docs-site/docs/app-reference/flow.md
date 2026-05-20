---
title: Flow
description: Agent lineage and issue swimlanes for project-wide visibility
---

# Flow

**Route:** `/projects/:id/flow`

Project-wide flow visualization. See agent lineage, how issues move through your workflow, and end-to-end orchestration in one view.

## Overview

Flow provides two complementary views of your project:

1. **Agents tab** — Agent dependency graph. Shows how agents invoke each other.
2. **Issues tab** — Swimlane view. Shows how issues flow through the agent network.

Switch tabs to get different perspectives on the same project.

## Agents Tab

Directed graph showing agent relationships. Nodes are agents; edges show who calls whom.

**Layout:**
- Visual node for each agent in your project team
- Color-coded by agent role or type
- Edge thickness indicates call frequency or criticality
- Zoom and pan to explore large graphs

**Node details** (on hover):
- Agent name
- Success rate
- Average execution time
- Recent run count

**Actions:**
- Click node to view agent detail (name, skills, configuration)
- Hover to highlight incoming/outgoing edges
- Use browser zoom or scroll-wheel to zoom in/out

## Issues Tab

Swimlane view showing how cards move through your workflow. Each swimlane represents an agent or column.

**Layout:**
- Horizontal swimlanes for each agent
- Vertical swimlanes for each column
- Cards displayed as boxes positioned by (agent, column, time)
- Card thickness/color indicates duration or status

**Card details** (on click):
- Issue title
- Agent assignment
- Duration in stage
- Run status
- Link to board

**Actions:**
- Click any card to open [Live Run Viewer](./live-run-viewer.md) or navigate to Board
- Filter by column or agent using left sidebar
- Scroll to explore time range
- Click project name chip to jump to project dashboard

## Switching Tabs

**Agents** — Default tab on first load. Shows agent dependency lineage.

**Issues** — Click Issues tab to switch to swimlane view. Useful when exploring how specific cards moved through your workflow.

Note: Issues tab is preserved for backwards compatibility; most users primarily use Agents.

## Related

- [Board](./board.md) — Manage cards and see per-card detail
- [Agents](./agents.md) — View agent roster and routing configuration
- [Costs](./costs.md) — See execution costs per agent or per run
- [Ceremonies](./ceremonies.md) — Set up workflows that define agent routing
