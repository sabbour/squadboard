# Hockney — History

## Core Context

- **Project:** Squadboard — local-first kanban + workflow board for [Squad](https://github.com/bradygaster/squad) agents
- **Package:** `@sabbour/squadboard` · Local install: `npx @sabbour/squadboard init` · MIT · Self-hosted
- **Role:** Backend / Workflow Engine Dev
- **Joined:** 2026-05-14T08:17:03Z
- **Hired by:** Ahmed Sabbour
- **PRD:** `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md`

## Tech stack I own

- Node.js single-process, Express v5
- Postgres — embedded `embedded-postgres` for local, hosted Postgres for cloud (same Drizzle schema)
- Drizzle ORM (~30 tables; 8 load-bearing)
- TypeScript
- Subprocess spawning (`setsid` + pgid) for isolated runWorkers
- WebSocket fan-out via in-process `EventEmitter` (real-time piece coordinated with Verbal)

## Five invariants I defend

1. **`agent_run` is the only step that does LLM work.** `peer_review`, tier-3 routing, and `split` are composites that desugar to `issue_runs` rows with distinct `kind` values.
2. **Single-spawner discipline.** The stepper alone spawns runs via `FOR UPDATE SKIP LOCKED`. The dispatcher only ticks, sweeps, and wakes.
3. **Lease + heartbeat is the authoritative liveness signal.** `lease_expires_at` (90s TTL) + `heartbeat_at` (30s interval).
4. **Output schema validation happens at session end.** After `sendAndWait`, before `recordRunCompletion`. Never on post-tool-use hooks.
5. **`fan_out` and `split` materialize full child workflow_runs.** Six-step transaction, no phantom columns.

## Roadmap I deliver against

15 demoable thin slices. The engine appears progressively across:
- **Demo 4** — One-shot agent (workspaces + live header)
- **Demo 6** — First workflow (engine end-to-end with retry + cost)
- **Demo 7** — Resilience + cost (lease/heartbeat sweepers, budget caps)
- **Demo 9** — Peer review (4-verb approvals, quorum)
- **Demo 10** — Fan-out + handoff (subtrees + additive skills)
- **Demo 14** — MCP + slash command + idempotent create
- **Demo 15** — GitHub sync (pushes, PRs, check runs, webhooks)

## Learnings

<!-- Append learnings below -->

### 2026-05-14 — Demo 1 backend scaffold
Demo 1 backend scaffold: Express v5 + embedded-postgres + Drizzle ORM. Monorepo with pnpm workspaces. packages/server (backend), packages/cli (npx entry). Schema: projects + settings tables. Server port 3000, health endpoint, projects CRUD stubs. Wired Kobayashi's squad discovery routes to real DB (upsert by path). CLI uses waitForPort (TCP probe, 15s timeout) before opening browser — avoids brittle sleep().

### 2026-05-14 — Demo 2 backend: issues/comments/labels CRUD API
Demo 2 backend: issues/comments/labels CRUD API. Drizzle schema additions: issues (with status enum + position), comments, labels, issue_labels. Bulk action endpoint. Move endpoint handles position recalculation.

### 2026-05-14 — Demo 5 routing tier 1
Demo 5 routing tier 1: router.ts loads rules from .squad/routing.md via Kobayashi's parseRoutingFile. Resolves by label→keyword→catchall priority. createRoutedRun inserts issue_runs with kind='agent_run' (Invariant 1: routing desugars to agent_run). Auto-routes on issue create. Hot-reload is restart-only (PRD non-goal).

### 2026-05-14 — Demo 5 routing tier 1 deepdive
Demo 5 engine completion: routing_rules table caches parsed rules (3-table format: label, keyword, catchall). POST /reload refreshes cache. GET /rules surfaces active rules. POST /test validates match logic. resolveRoute matches label→keyword→catchall priority, returns null for escalation tiers. createRoutedRun inserts issue_run with kind='agent_run' + routing context. Auto-route hook on POST /issues applies resolveRoute (non-fatal on miss).
