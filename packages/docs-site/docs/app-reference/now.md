---
title: Now
description: Global live dashboard of all active sessions and workflows
---

# Now

**Route:** `/now`

The global "Uber Dashboard" — a real-time view of every active session, run, and workflow happening across all your projects. Jump into any project or drill down into specific runs.

## Overview

Now aggregates activity from all projects into one live feed. You see sessions being created, issues moving through the board, ceremony workflows running, and team activity happening in real time.

Sections update as activity occurs, powered by WebSocket real-time events.

## Sections

### Statistics (all projects)
- **Active projects** — Count of projects with current activity
- **Active sessions** — Conversations in progress across all projects
- **Active runs** — Issues/cards currently being processed
- **Active workflows** — Ceremonies/workflows running
- **Cost MTD** — Month-to-date spend across all projects (summarized)

Done-today stat is currently stubbed (`—`).

### Scope Filter
Switch between viewing **All projects** or a specific project. If you have more than 4 active projects, a dropdown appears. Otherwise, clickable tabs show each active project.

This filter narrows all sections below to only that project's activity.

### Live Sessions
Real-time list of Consult conversations in progress. Shows session name, project, participants, and creation time.

**Actions:**
- Click a row to open that Consult session

### Issue Runs
Real-time list of card/issue runs currently processing. Shows issue title, assigned agent, status, elapsed time.

**Actions:**
- Click a row to open the Live Run Viewer for that run
- Status badge indicates stage: processing, completed, failed

### Workflow Runs
Real-time list of ceremony/workflow executions. Shows workflow name, trigger type, progress, estimated time remaining.

**Actions:**
- Click a row to open workflow detail
- Shows step-by-step progress as workflow executes

### Recent Activity Feed
Reverse-chronological stream of events: issues moved, agents hired, ceremonies triggered, drafts reviewed.

### Per-Project Mini-Rollups
If filtered to "All projects", small cards show top metrics for each active project:
- Active runs
- Throughput (cards moved to Done today)
- Cost MTD
- Squad Sync status

Click a project card to view that project's full dashboard.

### Sweep Activity Timeline
"Wave 25" timeline view showing automation sweeper executions and their results across all projects. Shows sweep type, start time, duration, result (success/error).

## Actions

**Scope filter**
- Click a project tab or use dropdown to narrow activity to that project

**Navigate to live session**
- Click any row in Live Sessions to open Consult

**Navigate to live run**
- Click any row in Issue Runs to open Live Run Viewer

**Navigate to project dashboard**
- Click project name or mini-card to open full project dashboard

## Configuration

**Scope default** — Starts at "All projects". Preference is stored in browser local storage.

**Cost currency** — Displays in USD (configurable per project in Settings)

## Related

- [Inbox](./inbox.md) — Captured items awaiting action
- [Consult](./consult.md) — Join any active session
- [Live Run Viewer](./live-run-viewer.md) — Deep dive into a specific run
- [Dashboard](./dashboard.md) — Project-specific view
