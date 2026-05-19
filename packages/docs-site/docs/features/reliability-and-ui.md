---
title: Reliability and real-time UI
description: Persistence, backup/restore, migration safety, live updates, and operational visibility.
---

# Reliability and real-time UI

Squadboard is local-first, but it still treats orchestration as durable system state.

## Persistence

- Local database-backed projects, cards, runs, events, and settings.
- Versioned migrations.
- Backup and restore flows for project state.
- Health and close-out reports under `.squad/` where available.

## Real-time UI

- Live run drawer for agent output.
- Activity feed for workflow, routing, approval, retry, and completion events.
- Optimistic UI updates reconciled with server state.
- Project-scoped WebSocket fan-out.

## Operational posture

Failures should surface as visible state: failed runs, skipped dispatch records, dead ceremony triggers, audit findings, and monitor idle decisions.

## Heartbeat and sweeps

The Heartbeat page shows the background sweeps that keep a project moving:

- what each sweep does
- how often it runs
- whether it is enabled or paused
- its last run result and errors
- a recent activity timeline seeded from server history and live WebSocket ticks

Project Heartbeat pages show project context while preserving system-level sweeps that are not tied to a single project, such as stale browser presence cleanup.
