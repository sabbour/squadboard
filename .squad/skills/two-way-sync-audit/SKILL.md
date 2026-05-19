---
name: "two-way-sync-audit"
description: "Audit Squad ↔ Squadboard sync surfaces without confusing one-way import, mode authority, and true bidirectional sync"
domain: "architecture,sync,dogfood"
confidence: "medium"
source: "McManus two-way sync status report on 2026-05-19T14:47:51.758-07:00"
---

# Two-Way Sync Audit

## Context

Use this when reviewing the Squad ↔ Squadboard dogfood loop or any feature that claims state moves between filesystem `.squad/`, Squadboard DB/API/UI, MCP, and GitHub.

## Pattern

1. **Name the surface.** Example: agents, decisions, backlog docs, workflow runs, MCP capture, GitHub sync, storage provider.
2. **Identify the source of truth per mode.** Filesystem mode, PostgreSQL/PGlite mode, hosted PostgreSQL, and brokered MCP mode may have different authorities.
3. **Separate paths.**
   - Import path: moves existing state once.
   - Live write path: where new writes go.
   - Reverse path: how the other side receives updates.
   - Status path: how operators know the sync happened.
4. **Require evidence.** Cite code, tests, runtime status, or dogfood artifacts. If only docs exist, status is Partial or Unknown.
5. **Call out in-flight ownership.** Do not re-route a lane already owned by a specialist.
6. **Classify honestly.**
   - Working: both directions or the declared one-way contract are implemented and tested.
   - Partial: implementation exists but lacks reverse path, status, live proof, or end-to-end tests.
   - Broken: a known failing behavior is reproduced.
   - Unknown: no reliable evidence.

## Guardrails

- Do not call one-time import “two-way sync.”
- Do not call DB-backed state a filesystem mirror unless an export/hydration loop exists.
- Do not mix table names from planned docs with actual schema names; map aliases explicitly.
- Treat local PGlite as in-process only. Cross-process sharing needs hosted PostgreSQL or a broker.
- Keep report output user-facing: statuses, evidence, risk, and next action.
