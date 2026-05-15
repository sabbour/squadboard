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

## Recent Learnings (2026-05-15)

### Bytea + Image Attachment Design

**Bytea pattern in Drizzle ORM:**  
Drizzle pg-core does not ship a built-in `bytea` helper; you add it via `customType` from `drizzle-orm/pg-core`. The minimal definition is:
```ts
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});
```
The pg driver returns bytea columns as Node.js `Buffer` objects automatically — no `fromDriver` conversion needed for the common case. The `customType` import must be added to the existing pg-core import list in `schema.ts`.

**multer memoryStorage usage:**  
`multer({ storage: multer.memoryStorage(), limits: { fileSize: N } })` makes the uploaded file available at `req.file.buffer` (a `Buffer`). The `limits.fileSize` guard rejects oversized streams before they reach the route handler — the service layer applies a second check to guard against middleware bypasses. The multer `MulterError` with `code === 'LIMIT_FILE_SIZE'` (or `message === 'File too large'`) maps to `{ ok: false, error: 'image_too_large' }`.

**Staging discipline:**  
On a previous commit (column-meta work) I accidentally staged untracked scratch files by using `git add packages/` instead of listing paths explicitly. Correct discipline: `git add -- <path1> <path2> ...` for each intentional file, then `git status` to confirm only those files are staged before committing. Never use `git add .` or broad directory globs in a repo with `.squad/` log files and editor artifacts.

## Team Activity Log

**2026-05-15 Round 2 shipped:** Hockney (attachments backend), McManus (multi-modal frontend), Verbal (Consult chat fix), Fenster (typography sweep), Kobayashi (Ceremony Conjure UX), Keyser (layout rebalance). See `.squad/decisions.md` for Fluent2 canon, image bytea architecture, create-page pattern, react-markdown rendering.

## Archive

For older learnings (Demo 1–15 architecture notes, GitHub App auth, TS fixes, UTC bug), see `history-archive.md`.

## Learnings

**2026-05-15T08:21:46-07:00 — P0 fix: resolveAnchorIssue spam-loop root cause**

Fixed the ceremony scheduler anchor spam loop (root cause identified by Verbal in
`verbal-spam-loop-rootcause.md`). Added a `NOT EXISTS (SELECT 1 FROM issue_links
WHERE child_issue_id = issues.id AND link_type = 'fan_out')` filter to
`resolveAnchorIssue()` in `ceremony-scheduler.ts`. The `issue_links` table from
Demo 10 already had the discriminator — no schema migration needed. Only the one
occurrence of the bad anchor selector pattern was in scope; the grep sweep of
`packages/server/src/services/` and `packages/server/src/engine/` confirmed no
other anchor-picker queries. TS check confirmed no regressions (pre-existing
`conjure-classifier.ts` errors were present on the base commit). See
`.squad/decisions/inbox/hockney-anchor-filter.md` for the exact filter and
follow-ups.

**2026-05-15 — Phase 3 Doctor (diagnostics service):**

- `getWebSocketServer()` is already exported from `realtime/ws-server.ts` — no new singleton needed. The `WebSocketServer` node from `ws` doesn't expose a `.readyState` in its TypeScript types the same way a client `WebSocket` does; checking `wss !== null` is the primary liveness signal; `.clients.size` gives connected count.
- `execFile` (promisified) is the safest way to invoke `gh auth status` — avoids shell injection, handles ENOENT cleanly. A non-zero exit still rejects the promise, so catch handles both "not found" and "not authed" cases.
- Pool.connect() + client.query() both need independent timeouts for the postgres health check. 50ms is tight but correct for embedded Postgres — if that fails the DB is genuinely unhealthy.
- Dynamic `import('@bradygaster/squad-sdk/client')` inside async functions works cleanly with ESM + `"moduleResolution": "bundler"` — no top-level import needed, which keeps the diagnostics service from throwing at module load time if the SDK isn't configured yet.
- `Promise.all` across all checks (each individually try/catch'd) gives true parallelism — total wall-clock bounded by the slowest single check, not the sum of all. The SDK checks each re-connect/disconnect to avoid state leakage.
- `mergeParams: true` on sub-routers is not needed for `GET /api/projects/:id/diagnostics` when mounted via `app.use('/api/projects/:id/diagnostics', projectDiagnosticsRouter)` because Express automatically merges params for routers created with `Router({ mergeParams: true })` or when mounted directly. Use `req.params['id']` (bracket notation) not `.id` to keep TS happy with index signature types. Also handle `string | string[]` on `req.params` values — cast with `Array.isArray(rawId) ? rawId[0] : rawId`.
- Pre-existing TypeScript errors in `conjure-classifier.ts` (`.modelId` / `.source` on `ResolveModelResult`) are not regressions from this work — confirmed by stashing and re-running `tsc --noEmit` on the base commit.

**2026-05-15T15:21:46Z — Coordination snag: Parallel commit with Keyser**

Keyser's Diagnostics UI work (commit 13c34dca) accidentally swept Hockney's server files when both agents committed diagnostics changes in parallel. Functional code is verified OK; server routes and diagnostics service are intact. **Audit trail is murky** — the commit appears to contain both agents' changes under one SHA. This happened because neither agent used explicit `git add -- <path>` per-file staging; Keyser's broader staging glob swept Hockney's uncommitted work into the same commit. **Action for future parallel sessions:** Use `git add -- <path1> <path2> ...` (bracket notation) for each intentional file. Never use `git add .` or `git add <directory>/` when multiple agents have working trees. Always `git status` before committing to confirm ONLY your changes are staged.

---

**2026-05-15T08:21:46-07:00 — Task: p6-templates-bug — Fix workload templates page load error**

**Commit:** `3e3fefad` — `fix(templates): resolve workloads page load error + empty state`

**Root cause:** `Templates.tsx` never existed as a page. Navigation to the template catalog hit the catch-all redirect (`*` → `/`) and rendered nothing. `TemplatePicker.tsx` was orphaned (written but never imported anywhere). The `ceremoniesTopRouter.get('/templates')` handler also lacked a `try/catch`, leaving it without a graceful error envelope on any unexpected throw.

**Changes:**
- `packages/server/src/routes/ceremonies.ts` — Wrapped `GET /templates` in try/catch; returns `{ ok: false, error: '...' }` 500 JSON on failure instead of crashing Express.
- `packages/client/src/pages/Templates.tsx` — New page: loading spinner → empty state (`Body1`: "No workload templates yet.") → error state (`Subtitle1`: "Couldn't load templates — try again" + Retry button) → template card grid. Never throws or renders a stack trace.
- `packages/client/src/App.tsx` — Wired `Templates` at `/projects/:id/ceremonies/templates`.

**Verification:** `cd packages/client && npx tsc --noEmit` → clean. `cd packages/server && npx tsc --noEmit` → 2 pre-existing errors in `conjure-classifier.ts` (confirmed pre-existing by stash test), none from this change.

## Team update (2026-05-15T16:09:55Z — Wave 3)

Anchor filter fix (r3, commit 4ecb5525): `resolveAnchorIssue()` now excludes fan-out child issues via `issue_links` table. Closes spam loop at source — no ceremony anchor will pick a recently-created child that itself has fan-out steps. Indexed by existing `(child_issue_id, link_type)` pair from Demo 10; no schema migration. P1 follow-up: persist sweep failure count to Redis for process-restart recovery.

---

**2026-05-15T09:09:55-07:00 — Task: Phase 19 Templates & Portability backend**

**Commits:** 3 batches (see SHAs below after commit)

**Scope:**
- `db/schema.ts`: Added `templates` pgTable — UUID PK, kind TEXT + CHECK('workflow'|'team'|'project'), name, description, payload JSONB, optional project_id FK, timestamps.
- `db/index.ts`: Bootstrap DDL — `CREATE TABLE IF NOT EXISTS templates` + `CREATE INDEX IF NOT EXISTS templates_kind_name_idx ON templates (kind, name)`.
- `services/templates/workflow-template.ts`: exportWorkflow, importWorkflow (creates ceremony + version row), saveAsTemplate, instantiateTemplate.
- `services/templates/team-template.ts`: exportTeam (agents + skills/tools/mcp by key), importTeam (with name-conflict skip/force), saveAsTemplate, instantiateTemplate.
- `services/templates/project-template.ts`: exportProject (full bundle excluding issues/runs/comments/inbox/costs), importProject (transactional), saveAsTemplate, instantiateTemplate.
- `routes/templates.ts`: GET /api/templates (filter by kind), GET /api/templates/:id, DELETE /api/templates/:id.
- `routes/team-portability.ts`: POST export/import/save-as-template/instantiate-template under /api/projects/:id/team/.
- `routes/project-portability.ts`: POST export/import/save-as-template/instantiate-template under /api/projects (import + instantiate-template are static paths mounted before /:id handlers).
- `index.ts`: Mounted all 3 new route modules at end of mount block.

**Route count:** 11 new endpoints.

**No-conflict:** Did NOT touch engine/, sdk/, client/, ceremonies.ts existing GET /templates handler, Kobayashi's charter-compiler.ts/agent-sync.ts, McManus's engine/, or Verbal's sdk/.

**TypeScript:** `npx tsc --noEmit` → only 2 pre-existing conjure-classifier.ts errors. Zero new errors from this change.

**Decision filed:** `.squad/decisions/inbox/hockney-phase19-backend.md`

---

## 2026-05-15 — Phase 12 Reframe: Agent-Centric Flow Data API

**Task:** Build the data API powering the new agent-centric Flow page. Per Ahmed's request: "I want the flow page to be agent centric, see instances of agents, what are they active on, lineage of what triggered them, visually."

**Batch A** — `ce01a382` — Schema queries + 3 routes + service
**Batch B** — `9a9fb8a3` — WS event hooks (workflow-runner, stepper, fan-out, consult-stream)

**Scope:**
- `services/flow-agents.ts` (new): `getFlowAgents()` + `getFlowLineage()`. Uses CTE-based UNION ALL query across 4 data sources (workflow_runs, issue_runs, live_sessions, consult_sessions). LATERAL join for current step attribution. Trailing-24h cap of 50 completed rows per source type.
- `routes/flow.ts`: Added `GET /agents`, `GET /lineage`, `GET /graph` sub-routes to existing `projectFlowRouter`. Original `GET /flow` kanban payload unchanged.
- `realtime/event-bus.ts`: Added `FlowEventType` union, `emitFlowEvent()`, and `emitFlowHeartbeat()` (in-memory 1/s throttle per instanceId).
- `engine/workflow-runner.ts`: Surgical adds — `flow.instance.started` on `createWorkflowRun`, heartbeat/ended in `advanceToNextStep`, ended in `handleAgentRunStep` failure path. Added `getProjectIdForWorkflowRun()` internal helper.
- `engine/stepper.ts`: `flow.instance.started` before SDK call, heartbeat in DB timer, ended on success and both failure paths.
- `engine/fan-out.ts`: `flow.lineage.edge.created` for each child run after `materializeFanOut()` commits.
- `sdk/consult-stream.ts`: `flow.instance.started` after `startConsultSession`, `flow.instance.ended` in `endRunningConsult`.

**Route count:** 3 new endpoints.

**Data gaps logged in decision doc:**
- `workflow_runs` with no step agent and no issue assignee excluded silently.
- `consult_sessions` mode='model' excluded (no agentId).
- No issue_run→issue_run direct lineage (schema gap).
- No workflow_run→consult_session cross-source edges (no FK).
- `parentInstanceId` not emitted in flow.instance.started for issue_runs (deferred).

**TypeScript:** `npx tsc --noEmit` → only 2 pre-existing conjure-classifier.ts errors. Zero new errors.

**Smoke test:** Dev server started, all 3 new endpoints returned `{ ok: true, data: {...} }` with correct shapes. Project "foo" returned 11 agents, fenster with 1 consult_session instance, hockney with 1 issue_run instance. Original `/flow` returned 5 columns + activeRunsCount intact.

**Decision filed:** `.squad/decisions/inbox/hockney-flow-agent-api.md`
