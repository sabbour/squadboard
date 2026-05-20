---
title: Diagnostics & Heartbeat
description: System health checks and automation sweeper monitoring
---

# Diagnostics & Heartbeat

**Routes:** 
- `/diagnostics` (global) and `/projects/:id/diagnostics` (project-scoped)
- `/heartbeat` (global) and `/projects/:id/heartbeat` (project-scoped)

Two pages for monitoring system health and automation.

## Diagnostics

Health check dashboard. See system status at a glance and diagnose issues.

**Routes:** `/diagnostics` (global) or `/projects/:id/diagnostics` (project-scoped)

### Overview

Diagnostics runs a suite of health checks and reports results. Each check has a status badge:
- **✅ OK** — System is functioning normally
- **⚠️ WARN** — Non-critical issue; system still works but degraded
- **❌ ERROR** — Critical issue; feature may not work

### Scope Tabs

If viewing project-scoped diagnostics, tabs allow switching scope:
- **This project** — Checks specific to this project
- **Global · all projects** — System-wide checks affecting all projects

Select a tab to narrow the view.

### Check Categories

Common health checks include:

**Project checks:**
- Board state consistency
- Run history integrity
- Ceremony definition validation
- Agent routing model status
- Squad Sync status
- MCP server connectivity

**System checks:**
- Database connectivity
- Storage provider status
- LLM model availability
- WebSocket gateway health
- Cache health
- Backup status

Each check shows:
- Check name
- Current status (OK, WARN, ERROR)
- Last run timestamp
- Error message (if failed)
- Remediation hint (e.g., "Restart service" or "Check connectivity")

### Actions

**Re-run all checks:**
- Click "Re-run all" button
- Manually trigger diagnostics (useful if you think issue is fixed)
- Auto-refresh occurs every 30 seconds by default

**Expand check detail:**
- Click any check card for more information
- Shows:
  - When it last ran
  - Full error text (if any)
  - Suggested fixes

## Heartbeat

Monitor automation sweepers and scheduling.

**Routes:** `/heartbeat` (global) or `/projects/:id/heartbeat` (project-scoped)

Heartbeat tracks "sweepers" — automated tasks that run on a schedule to keep your workspace healthy.

### Overview Sections

**Scheduler state:**
- Global scheduler active/idle status
- Sweeps enabled or paused
- Active sweeper count

**Sweep definitions:**
Each sweep shows:
- **ID** — Internal identifier
- **Label** — Human-readable name (e.g., "Clean up orphaned runs")
- **Description** — What the sweep does
- **Scope** — System-wide or project-specific
- **Interval** — How often it runs (milliseconds; e.g., 3600000 = 1 hour)
- **Enabled** — Toggle to enable/disable

**Sweep activity:**
Recent sweeps and their results. Shows per sweep:
- Start time and duration
- Result: Success, warning, or error
- Output or error message

**Last error:**
Most recent error (if any sweep has failed). Shows:
- Error message
- Time occurred
- Stack trace or diagnostic info

**Sweep Activity Timeline** (Wave 10 B3)
Time-series graph showing sweep executions over time. See:
- When sweeps run
- How long they take
- Error rate over time

### Scope

**Global Heartbeat** (Route: `/heartbeat`)
- System-wide sweepers affecting all projects
- Example: "Compact old run logs" or "Prune deleted projects"

**Project Heartbeat** (Route: `/projects/:id/heartbeat`)
- Project-specific sweepers
- Example: "Archive stale cards" or "Refresh agent keywords"

Each project can have its own sweeper schedule.

### Configuration

On Heartbeat page, most options are read-only (observation only). To configure sweepers:
- Go to [Settings](./settings.md) (if project-specific)
- Or system configuration files (if system-wide)

What you can typically control:
- **Enabled toggle** — Turn individual sweeps on/off
- **Interval** — Adjust run frequency (if editable)
- **Scope** — System vs. project (if configurable)

### Polling & Updates

Heartbeat updates in real-time:
- Scheduler status polled every 5 seconds
- Sweep events streamed every 2 seconds
- WebSocket pushes updates as they occur

Manual refresh available if you think data is stale.

### Troubleshooting

If a sweep is failing repeatedly:
1. Open Heartbeat to see last error
2. Check [Diagnostics](#diagnostics) for related system health issues
3. If issue persists, check logs (if available)
4. Disable sweep temporarily and re-enable after fix

## Common Issues

### Diagnostics

**"Check failed to run"** — Usually temporary; click "Re-run all" to retry. If persists, check system logs.

**"Status changed to WARN"** — Feature still works but degraded. Check remediation hint for guidance.

**"Status changed to ERROR"** — Feature may not work. Follow remediation steps or escalate to admin.

### Heartbeat

**"Sweep not running"** — Check if sweep is enabled. If enabled, check Diagnostics for system issues.

**"Sweep running very slowly"** — May indicate resource contention. Check other active sweeps or increase interval.

**"Last error occurred X hours ago"** — Stale error; sweep likely recovered. Monitor to confirm all is well.

## Related

- [Settings](./settings.md) — Configure system health checks and sweep parameters
- [Dashboard](./dashboard.md) — Project health overview
- [Now](./now.md) — Real-time activity dashboard (includes sweep timeline)
