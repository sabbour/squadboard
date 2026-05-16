# Hockney Agent — Compact History Summary

**Focus areas:** Server architecture (routes, websockets, MCP, embedded-postgres), diagnostics, heartbeat registry, backend lifecycle management.

**Key learnings:**
- Heartbeat registry: 6 sweeps, ~30s cadence per sweep (5s fast, 25s standard, 5s heartland). Check `lastTickAt` and ring cursor advancement via `GET /api/heartbeat/status` for smoke-test verification.
- Diagnostics false-negative resolution: double-nesting bug in `resolveSquadDir()` when `projects.path` pointed AT `.squad/` (not parent). Solution: helper tolerates both layouts, returns single clear error.
- MCP Phase 1 starter tools: 11 tools total (stdio + HTTP transports), naming convention (bare names, no `squadboard.*` prefix). Tools: `list_projects`, `list_inbox`, `capture` (Conjure classifier), `get_routing`.
- Express route ordering trap: `POST /formulate` MUST register BEFORE parameterized `GET /:id` / `PATCH /:id` routes. Express matches declaration order.
- Formulate routes use `{ ok, error }` envelope (not bare `{ error }`), matching `apiFetch<Envelope<T>>`.
- `curl` smoke-test for missing routes: returns `<!doctype html>` when route not mounted → client `JSON.parse('<!doctype ...')` throws. Add route-mount auditing to Wave DoD.
- per-file `git add -- <path>` discipline: prevents accidental sweeps of other agents' uncommitted changes (mcmanus history, server/index.ts, vite churn).

**Recent work:**
- other two → `ok: false, reason: "no .squad/ directory found at ... or ..."`
  — single, clear, actionable. (Their `.squad/` was indeed never created.)

**Files touched (4 total):**
- `packages/server/src/services/diagnostics.ts` — +`resolveSquadDir`,
  rewrote `checkSquadDirShape` body, updated `checkDiskWriteable`.
- `packages/server/src/mcp/server.ts` — +4 TOOLS entries, +4 handlers,
  +4 switch cases, imports for new services.
- `packages/server/src/mcp/README.md` — new file.

**Decision filed:** `.squad/decisions/inbox/hockney-mcp-and-diagnostics.md`.

**Status:** COMPLETE. `tsc --noEmit` clean. Local commits only — not pushed.

### Learnings

1. **Read what's already there before adding a new package.** The brief
   suggested standing up `packages/mcp/` for the MCP server. A 30-second
   look at `packages/server/src/mcp/` showed the whole stdio + HTTP
   apparatus was already built (Phase 18). Extending the existing factory
   was the right call — same lifecycle, same DB pool, same build.
2. **`projects.path` semantics are inconsistent across the table.** The
   schema comment says ".squad/ directory" but seeders / project-create
   flows have stored both layouts. Future writers should either (a) pick
   one layout and migrate, or (b) keep using `resolveSquadDir()`. Logged
   in the decision doc as a follow-up.
3. **Cascading false-negatives mask the actual bug.** When a parent check
   fails, don't run dependent child checks — they generate noise. Pattern
   is now: resolve once, fail-fast with remediation, only descend when the
   parent is healthy.

---

## Heartbeat live verification path — Wave 10 E4 (2026-05-15T13:09:47-07:00)

**Verified by:** Hockney (programmatic, no browser needed)

### Data path traced

| Layer | Detail |
|---|---|
| Engine | `engine/heartbeat.ts` — `Heartbeat._runSweep()` sets `this.lastTickAt = new Date()` on every sweep completion |
| Sweeps | 6 registered: `stuck-issue-runs` (30s), `stale-presence` (30s), `idle-live-sessions` (60s), `ready-workflow-steps` (5s), `ceremonies-due` (5s), `github-sync-overdue` (60s) |
| Service | `services/heartbeat.ts` — `getHeartbeatSnapshot()` reads `heartbeat.getStatus().lastTickAt` and returns it as `lastTickAt` in the snapshot. Also maintains an in-memory ring buffer (capacity 200) of recent sweep events keyed by monotonic `seq`. |
| API endpoint | `GET /api/heartbeat/status` — returns `{ active, lastTickAt, lastError, sweeps[], recent }` |
| React component | `pages/Heartbeat.tsx` — polls `/api/heartbeat/status` every 5s; renders `lastTickAt` via `relativeTime()` helper in the "Last tick" section card |
| No DB column | `lastTickAt` is pure in-memory (`Heartbeat` singleton). The lease+heartbeat column `heartbeat_at` on `issue_runs` is separate (written by runWorker at 30s interval during active LLM runs). |

### Live-fire samples (server was already running on :3000)

| Sample | `lastTickAt` | Ring cursor |
|---|---|---|
| T1 | `2026-05-15T20:15:30.871Z` | 374 |
| T2 | `2026-05-15T20:15:58.809Z` | 384 |

- **Delta:** 27.9 s ✅ (within ~30s ± 5s; driven by the 5s fast-sweeps so actual cadence is ≤5s between any tick)
- **Ring advancement:** +10 events — confirms continuous sweep completions
- **Status:** ✅ TICKING — `active: true`, no `lastError`

### Quick re-verify command (future agents)

```bash
T1=$(curl -s http://localhost:3000/api/heartbeat/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['lastTickAt'])")
sleep 10
T2=$(curl -s http://localhost:3000/api/heartbeat/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['lastTickAt'])")
echo "T1=$T1  T2=$T2"
# Expect T2 > T1 by ≥5s (fastest sweep cadence)
```

- **2026-05-15 Wave 11B — M1 (Hire-team server routes) — IN-FLIGHT:** Dispatched to fix missing POST handlers for `/api/projects/:projectId/agents/hire-team/propose` and `/hire-team/confirm`. Root cause: Express SPA catch-all returned index.html instead of JSON, client `apiFetch` threw "Unexpected token '<'". M1 adds route handlers, returns proper JSON errors. Sequenced first in Stream M to unblock M2+M3 (client-side fixes) and M4 (e2e regression test).

### Wave 11B — M1 M4 Landing (2026-05-15)

**Completed:** Added two missing POST routes in `packages/server/src/routes/agents.ts`:
- `POST /api/projects/:projectId/agents/hire-team/propose` → `{ ok: true, data: { members: CastedMember[] } }`
- `POST /api/projects/:projectId/agents/hire-team/confirm` → `{ ok: true, data: { created: Agent[], errors: [...] } }`

**Context:** Cast-Team modal crash root cause. When routes are `import`ed but missing an `app.use()` mount, Express silently falls through to SPA fallback (`res.sendFile('index.html')`). Client calls `JSON.parse('<!doctype...')` → "Unexpected token '<'" with zero context.

**Learning:** Router mounting discipline — grep `index.ts` for unmatched imports after adding any new router file. Add route-mount audit to squad DoD. The SPA catch-all is a feature trap; unimplemented routes should ideally throw 404 or register a default 404 handler instead of silently serving HTML.

### Wave 12 — N7/N5/N1/N2 (2026-05-15)

**N7 — Junk project cleanup:** Deleted 41 test projects via DELETE /api/projects/:id, all returned 204. Remaining: 3 canonical projects (foo, Content Creation Workflow, Social Media Content Manager).

**N5 — Test MCP Connection fix:** Root cause: `McpConfigPanel.tsx` constructed `healthUrl` as `${window.location.hostname}:3000/mcp/health` (absolute URL). In Vite dev mode (port 5173 → 3000 cross-origin), browsers block the fetch because no CORS headers are set. Fix: changed to relative URL `/mcp/health` + added `/mcp` to the Vite proxy in `vite.config.ts`. The proxy forwards to localhost:3000 in dev; in prod the relative URL resolves same-origin. **Learning:** Never hardcode port in client-side absolute URLs — always use relative paths + proxy config so dev/prod behave identically.

**N1 — Kanban done-capture:** The `capture` MCP tool now detects a `done:` prefix (e.g. `capture("done: Fixed login bug (sha=abc)")`) and close-matches the best open card in the project using token overlap (stop-word filtered, ≥2 token threshold). Matched card is updated to `status='done'`. If no match: a standalone done card is created rather than silently failing. Also added `bin/squad-card-done` helper script. **Learning:** The Conjure classifier path shouldn't be invoked for close-out semantics — detect structural prefixes BEFORE LLM classification for determinism and speed.

**N2 — Double-pickup prevention:** Added 4 columns to `inbox_items`: `idempotency_key TEXT UNIQUE`, `created_by TEXT DEFAULT 'user'`, `claimed_by TEXT`, `claim_expires_at TIMESTAMPTZ`. Idempotency dedup runs before Conjure classify; `POST /api/inbox/:id/claim` implements 5-min TTL lease with atomic conditional UPDATE (same worker can extend, different worker gets 409). **Learning:** Claim/lease MUST be a single SQL UPDATE...WHERE...RETURNING pattern — never a SELECT+UPDATE pair, which has a TOCTOU race. The 409 response should always return the current claim owner so the losing worker can log/retry intelligently.

## Wave 12 — Cast-Team Follow-On + Dogfood Loop (2026-05-15)

**Team deployment:** Hockney-2, Keyser-2, Fenster-2

**This agent's contributions:**
- **N1: Kanban Auto-Update (MILESTONE):** First end-to-end dogfood done-capture loop. Implemented `done:` prefix detection in MCP capture, token-based issue matching (≥2 token score), and `bin/squad-card-done` idempotent CLI helper. Files: `packages/server/src/db/index.ts`, `packages/server/src/db/schema.ts`, `packages/server/src/mcp/server.ts`, `packages/server/src/routes/inbox.ts`, `packages/client/src/components/settings/McpConfigPanel.tsx`, `packages/client/vite.config.ts`, `bin/squad-card-done`.
- **N2: Double-Pickup Prevention:** Idempotency keys (UNIQUE constraint) + claim/lease mechanism on inbox items (5-min TTL, atomic UPDATE) to prevent race conditions across dispatcher, MCP, and concurrent workers. Same DB migration files.
- **N5: MCP Test Connection Fix:** Relative healthUrl + vite proxy for local development testing.
- **N7: Junk Projects Cleanup:** Deleted 41 unused projects to reduce noise in local universes.

**Status:** 4/4 done. Source: d2c06218. No regressions.

**Follow-ups for Hockney:** Add `GET /api/activity/stats?window=today` (for "Done today" tile), add daily cost bucket (N3 dashboard), add `/projects/:id/agents/:agentId` detail route (N4 flow nav), add `/runs/:runId` run-detail route (N4 flow nav).

---

## Wave 13 — Q1 PGlite Migration (2026-05-15T19:39:32-07:00)

### What we did
Executed the full embedded-postgres → PGlite spike-and-swap per Ahmed's directive.

### The spike → swap → charter-update sequence

1. **Spike first.** Before touching any production files, write a standalone script (`scripts/pglite-spike.ts`) that boots PGlite in a temp dir and runs the EXACT bootstrap SQL verbatim. All 17 feature checks passed. This gave us confidence before any production file was touched.

2. **One non-obvious PGlite quirk — `query()` vs `exec()`.**  
   PGlite has two query paths:
   - `pglite.query(sql, params?)` — uses the PostgreSQL *extended query* (prepared statement) protocol. Rejects multi-statement SQL with `"cannot insert multiple commands into a prepared statement"`.
   - `pglite.exec(sql)` — uses the *simple query* protocol. Accepts multi-statement DDL blocks (same as pg Pool's `pool.query(sql)` with no params).
   
   The bootstrap schema sends large multi-statement SQL blocks via `_pool.query()` (no params). The pool adapter must detect param-less calls and route them through `exec()`. This was discovered by running the server and seeing the crash — the spike missed it because the spike used `exec()` directly. **Lesson: the spike must also test via the pool adapter, not just raw PGlite API.**

3. **`rowCount` ↔ `affectedRows` mapping.** PGlite returns `affectedRows`; pg returns `rowCount`. The pool adapter maps transparently. Sweeper code reads `.rowCount ?? 0` — the `?? 0` guard handles both null and undefined safely.

4. **Union Drizzle types don't compose.** Exposing `DrizzleDb = PgliteDb | PgDb` caused TypeScript to refuse calling any query builder method (`.returning()`, `.insert()`, etc.) because the two HKT types differ. Fix: expose only `PgliteDatabase<typeof schema>` as `DrizzleDb`; cast the pg driver at the assignment site. Runtime API is identical.

5. **Charter update is part of the task.** After any DB driver swap, update the "What I Own" section in `charter.md` so future agents see the current state, not the pre-migration state.

### Files touched
- **NEW** `packages/server/src/db/pglite.ts` — PGlite engine, pool adapter, shutdown handlers
- **MODIFIED** `packages/server/src/db/index.ts` — Drizzle driver swap, `PoolLike` abstraction
- **MOVED** `packages/server/src/db/postgres.ts` → `.deprecated/postgres.ts`
- **MODIFIED** `src/index.ts`, `src/cli/bulk-import.ts`, `src/mcp/index.ts`, `src/scripts/seed-wave10-backlog.ts` — import sites
- **MODIFIED** `packages/server/package.json` — `embedded-postgres` removed, `@electric-sql/pglite@0.4.5` added
- **NEW** `packages/server/src/scripts/pglite-spike.ts` — feasibility script (17/17 PASS)
- **NEW** `.squad/decisions/inbox/hockney-pglite-migration.md` — decision record
- **MODIFIED** `.squad/agents/hockney/charter.md` — "What I Own" updated

### Decision filed
`.squad/decisions/inbox/hockney-pglite-migration.md`

### Status
COMPLETE. `tsc --noEmit` clean. 4/4 vitest tests pass. Server starts, `GET /api/projects` returns 200 + JSON from fresh PGlite cluster.


### Files Changed

| File | Change |
|------|--------|
| `packages/server/src/db/schema.ts` | Added `completedAt` (TIMESTAMPTZ), `createdBy` (TEXT DEFAULT 'user') to `issues` table |
| `packages/server/src/db/index.ts` | Wave-13 idempotent migration: `ALTER TABLE issues ADD COLUMN IF NOT EXISTS completed_at, created_by` |
| `packages/server/src/services/issues.ts` | Rewrote `createIssue()` with unified signature (see below) |
| `packages/server/src/services/bulk-import-issues.ts` | **NEW** — `bulkImportIssues()` service |
| `packages/server/src/cli/bulk-import.ts` | **NEW** — CLI real logic |
| `packages/server/src/mcp/server.ts` | `handleCreateIssue` now delegates to `createIssueService()` from services/issues.ts |
| `packages/server/src/routes/issues.ts` | POST handler delegates to `createIssue()`, column validation moved to route layer |
| `packages/server/src/services/inbox.ts` | Updated call-site to new signature |
| `packages/server/src/sdk/consult-stream.ts` | Updated two call-sites to new signature |
| `packages/server/src/__tests__/issues-service.test.ts` | **NEW** — 4 smoke tests (vitest) |
| `packages/server/package.json` | Added `test` script + vitest devDependency |
| `bin/squad-bulk-import` | **NEW** — shell shim |

### `createIssue()` Signature

```ts
createIssue(input: {
  projectId: string;
  title: string;
  body?: string;
  status?: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
  position?: number;
  archived?: boolean;
  completedAt?: Date | null;
  assigneeId?: string | null;
  labels?: string[];
  idempotencyKey?: string;
  createdBy?: string;
}): Promise<{ created: boolean; id: string; issue?: Issue; idempotencyKey?: string }>
```

Return value changed from the raw issue row to an envelope. All callers updated.

### Inertness Invariant Location

`packages/server/src/services/bulk-import-issues.ts` — `bulkImportIssues()`, before any `createIssue()` call:
```ts
if (status !== 'backlog' && status !== 'done') {
  // BulkImportInvariantError — returns error item, does NOT abort batch
}
```
Also enforced at the TypeScript type level via `InertStatus = 'backlog' | 'done'`.

### Bulk Port Results

131 issues ported to project `7a9cc07a-d463-4f8c-864a-c733342aa8a8` (foo):
- created=131, skipped=0, errors=0
- Board: 35 → 166 issues
- All ported cards: assigneeId=null, status∈{backlog,done}, createdBy='bulk-import'

### What N9 (MCP Adapter) Needs To Do

In `packages/server/src/mcp/server.ts`:
1. Import `bulkImportIssues` from `../services/bulk-import-issues.js`.
2. Add `squadboard_bulk_import_cards` tool definition to the `TOOLS` array with the input schema.
3. Add a case in the tool-call switch/if dispatcher.
4. Parse MCP args into `BulkImportItem[]` and call `bulkImportIssues()`.

The handler is N9-ready — no service changes needed for N9.

---

## Wave 13 Learnings — Bulk-import + inertness invariant

**Added by:** Scribe (Wave 13 close-out)  
**Date:** 2026-05-15T19:39:32-07:00

### Bulk-port outcome

Successfully ported 131 historical items (48 done, 83 pending) from external todo list into project `foo`. All cards landed with inert status (backlog/done only), no assignee, no labels — the invariant held edge-to-edge.

**Going forward:** The inertness invariant (status ∈ {backlog, done}) is now a charter contract for all bulk-import handlers. Enforce at both the TypeScript type level AND runtime to catch contract violations early.

### Charter update reminder

Your charter section says: "Embedded Postgres for local installs (~50MB binary)". This becomes stale post-Q1 when PGlite migration lands (Ahmed's directive). Flag: update charter `## How I Work` after PGlite ships so new agents don't assume embedded-postgres setup.

