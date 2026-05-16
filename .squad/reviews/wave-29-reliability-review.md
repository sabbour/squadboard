# Wave 29 Reliability Review

**Reviewer**: Verbal (squadboard launch-squad)
**Date**: 2026-05-16
**Scope**: Full server + client + SDK, emphasis on W26-W29 changes

---

## Executive Summary

The system is broadly production-capable: the three-tier routing spine (coordinator → keyword → least-loaded), heartbeat/sweep isolation, and per-sweep circuit breaker are solid. **However, one critical bug will crash fresh-database migrations on any new installation**: migration file `0004_issue_runs_coordinator_decision.sql` contains a broken self-registration INSERT with the wrong column name. The second-highest risk is that the model-fallback chain configured in `coordinator-env.ts` is never wired into the actual LLM callers — the coordinator has no retry-on-model-failure logic despite a well-designed fallback API. Verdict: **YELLOW — ship-ready for existing installations, blocked for new installs until M1 is fixed.**

---

## Findings

### CRITICAL (must fix before next release)

- **[M1] Migration 0004 broken self-registration INSERT — will crash fresh installs**
  - **File**: `packages/server/src/db/migrations/0004_issue_runs_coordinator_decision.sql:2`
  - **Problem**: The migration SQL contains `INSERT INTO _migration_log (id, applied_at) VALUES (4, NOW()) ON CONFLICT DO NOTHING;`. The `_migration_log` table (defined in `migrations.ts:273-282`) has columns `version, filename, checksum, applied_at`. There is no `id` column. `filename` and `checksum` are `NOT NULL`. This INSERT will throw `ERROR: column "id" of relation "_migration_log" does not exist` on any fresh database.
  - **Evidence**: `initMigrationLog` creates `_migration_log` with PK `version INTEGER`; `applyMigrations` runs `pool.query(migration.upSql)` verbatim before calling `recordMigrationApplied`; the `ALTER TABLE ADD COLUMN IF NOT EXISTS` line runs first (succeeds, dirtying the schema), then the broken INSERT throws, so `applyMigrations` rethrows and the migration is never marked applied. On next boot it will be retried, the `ADD COLUMN IF NOT EXISTS` is idempotent (passes), the INSERT fails again — infinite boot loop.
  - **Recommended fix**: Remove the `INSERT` line from the migration file entirely. `recordMigrationApplied` in `migrations.ts` handles log registration after the SQL runs.
  - **Severity**: 10/10

- **[M2] Batch dispatch has no timeout — can hang indefinitely**
  - **File**: `packages/server/src/coordinator/batch.ts:165-173`
  - **Problem**: `dispatchBatchViaCoordinator` calls `caller.call({ messages, model, temperature: 0 })` with no `abortSignal` and no `timeoutMs`. There is no `AbortController` created. Contrast with `callCoordinatorLlm` in `llm-client.ts:134-163` which wraps the call in a 30 s `AbortController` timeout. A slow/hanging LLM response in a batch call will block the calling sweep tick indefinitely, stalling sweep progress.
  - **Evidence**: `batch.ts` line 165-172 — no AbortController or timeout guard around `caller.call(...)`. `llm-client.ts` line 137-145 clearly demonstrates the correct pattern that batch does not follow.
  - **Recommended fix**: Mirror the timeout pattern from `callCoordinatorLlm` — create an `AbortController`, set a `setTimeout` with `timeoutMs` (default 60 s for batch), pass `abortSignal` to `caller.call`, and clear the timer in a `finally` block.
  - **Severity**: 8/10

- **[M3] No `unhandledRejection` / `uncaughtException` handler — stray async throw can silently kill the process**
  - **File**: `packages/server/src/index.ts` (absent)
  - **Problem**: `index.ts` registers `SIGINT` and `SIGTERM` handlers for graceful shutdown, but there are no `process.on('unhandledRejection')` or `process.on('uncaughtException')` handlers. Node.js 18+ terminates the process on unhandled rejection by default. Any fire-and-forget async path that throws (e.g. a setInterval callback) that isn't caught will crash the server with no graceful teardown, no PGlite CHECKPOINT, and no log.
  - **Evidence**: `grep -rn "unhandledRejection\|uncaughtException" packages/server/src/` returns zero results. `runWorker(claimedId).catch(...)` in `stepper.ts:43-45` is correct, but the `setInterval` heartbeat timer in `stepper.ts:128-144` has a `try/catch` only for the DB write — if `eventBus.emitFlowHeartbeat` throws synchronously, the interval callback throws unhandled.
  - **Recommended fix**: Add `process.on('unhandledRejection', (reason) => { console.error('[process] unhandledRejection:', reason); })` and a similar `uncaughtException` handler at the top of `main()`. Consider graceful shutdown on `uncaughtException`.
  - **Severity**: 7/10

---

### HIGH (should fix soon)

- **[H1] Model fallback chain defined but never wired — coordinator has no retry-on-model-failure**
  - **File**: `packages/server/src/config/coordinator-env.ts:54-65` (defined), `packages/server/src/coordinator/dispatch.ts:86`, `packages/server/src/coordinator/batch.ts:159` (ignored)
  - **Problem**: `resolveCoordinatorModelChain()` produces an ordered list `[primary, ...fallbacks]` (default: haiku → gpt-mini → codex-mini → gpt-4.1). Neither `dispatchViaCoordinator` nor `dispatchBatchViaCoordinator` call this function. Both resolve `model` from a single env variable and pass it directly to the LLM caller. If that model is unavailable (quota, outage, model deprecation), the entire coordinator call fails and falls through to tier-2/3 routing — the fallback chain provides zero additional resilience.
  - **Evidence**: `dispatch.ts:86` — `const model = opts?.model ?? process.env.COORDINATOR_MODEL ?? "claude-haiku-4.5"` — no chain iteration. `batch.ts:159` — same pattern.
  - **Recommended fix**: Add a retry loop over `resolveCoordinatorModelChain()` in both callers; if the LLM call throws (or returns `CoordinatorLlmParseError`), try the next model in the chain before surfacing the error.
  - **Severity**: 7/10

- **[H2] Preamble module-level cache never expires — operator edits require server restart**
  - **File**: `packages/server/src/coordinator/preamble.ts:24`
  - **Problem**: `let cached: PreambleSource | null = null` is module-level and never invalidated by a TTL or file watch. Once loaded, the preamble is frozen for the process lifetime. An operator editing `.squad/squadboard-coordinator.md` to adjust coordinator behavior must restart the server for the change to take effect. No warning is logged, and the `forceReload` escape hatch is only accessible in tests.
  - **Evidence**: `preamble.ts:30` — `if (cached && !opts?.forceReload) return cached;` — TTL = infinity.
  - **Recommended fix**: Add a TTL (e.g. 5 minutes) to the cached entry, or use `fs.watch` to invalidate on file change. At minimum, log the preamble source + path at server startup so the operator knows which file was loaded.
  - **Severity**: 5/10

- **[H3] `busyAgentIds` in coordinator runs route scans ALL projects — cross-project availability pollution**
  - **File**: `packages/server/src/routes/runs.ts:200-206`
  - **Problem**: When building `candidateAgents` for coordinator dispatch (path B), the route fetches ALL running issue_runs regardless of project: `eq(schema.issueRuns.status, 'running')` with no `projectId` filter. An agent active in Project A will appear `available: false` to the coordinator dispatching for Project B. This causes incorrect availability signals in multi-project setups.
  - **Evidence**: `runs.ts:200-206` — no `projectId` predicate on `busyRunRows`.
  - **Recommended fix**: Add `eq(schema.issueRuns.projectId, projectId)` — or, since `issueRuns` may not carry `projectId` directly, join through `issues`: filter by `schema.issues.projectId`. Alternatively, filter candidate agents first and use `inArray(issueRuns.agentId, agentRows.map(a => a.id))` as the primary constraint.
  - **Severity**: 5/10

- **[H4] `sweepExpiredStepLeases` uses `sql.raw` string interpolation for UUID array**
  - **File**: `packages/server/src/engine/sweeper.ts:92`
  - **Problem**: IDs from a prior SELECT are interpolated directly into SQL: `` sql.raw(`ARRAY[${ids.map((id) => `'${id}'`).join(',')}]::uuid[]`) ``. While the UUIDs come from the database (low exploitation risk), this bypasses Drizzle's parameterized-query protection entirely. A corrupted or maliciously crafted row could inject arbitrary SQL. Drizzle's `inArray()` helper would produce parameterized output safely.
  - **Evidence**: `sweeper.ts:92` — raw string interpolation of `ids` array.
  - **Recommended fix**: Replace with `inArray(step_runs.id, retryable.map(r => r.id))` using Drizzle's ORM query builder, or use a proper `$1, $2, …` parameterized query pattern.
  - **Severity**: 4/10

- **[H5] Migrations are not wrapped in DDL transactions — partial failure leaves inconsistent schema**
  - **File**: `packages/server/src/db/migrations.ts:213-223`
  - **Problem**: Each migration is applied via `pool.query(migration.upSql)` with no enclosing `BEGIN`/`COMMIT`/`ROLLBACK`. If a multi-statement migration fails mid-way (e.g., the second `ALTER TABLE` in a migration that has two), the schema is partially modified. On the next restart, `IF NOT EXISTS` guards may make the retry appear to succeed while leaving the DB in an unexpected state. W28 I9 added snapshots before each migration, but snapshots are read-only safety nets — they don't prevent the partial-write problem.
  - **Evidence**: `migrations.ts:213-223` — no `BEGIN/COMMIT` wrapping around `pool.query(migration.upSql)`.
  - **Recommended fix**: Wrap each migration execution in an explicit transaction: `await pool.query('BEGIN'); try { await pool.query(upSql); await pool.query('COMMIT'); } catch { await pool.query('ROLLBACK'); throw; }`. Note: DDL transactions are fully supported in PostgreSQL (and PGlite).
  - **Severity**: 4/10

---

### MEDIUM (good-to-have)

- **[Med1] Label resolution is N+1 queries in coordinator runs route**
  - **File**: `packages/server/src/routes/runs.ts:173-186`
  - **Problem**: For each label on an issue, a separate DB round-trip is made (`for (const { labelId } of issueLabelRows) { ... await db.select(...).where(eq(schema.labels.id, labelId)) ... }`). This is O(n) queries for n labels.
  - **Recommended fix**: Join `issueLabels` with `labels` in a single query, or use `inArray(schema.labels.id, issueLabelRows.map(r => r.labelId))`.
  - **Severity**: 3/10

- **[Med2] `ceremonies-due` sweep double-counts: skipped items appear as `acted`**
  - **File**: `packages/server/src/engine/sweeps/ceremonies-due.ts:20`
  - **Problem**: `acted = result.fired + result.skipped` — skipped schedules (those whose next_fire_at hasn't arrived yet) are counted as `acted`, inflating heartbeat metrics and making the sweep look busier than it is.
  - **Recommended fix**: `acted = result.fired` only. `skipped` can be surfaced in `details`.
  - **Severity**: 2/10

- **[Med3] `ready-workflow-steps` sweep always increments `acted` even when nothing happened**
  - **File**: `packages/server/src/engine/sweeps/ready-workflow-steps.ts:31-45`
  - **Problem**: `acted += 1` after `tickWorkflowAdvancement()` and again after `claimAndRun()` regardless of whether either did anything useful. The sweep will always report `acted ≥ 2` even when no work was done, making the metric meaningless.
  - **Recommended fix**: Both `tickWorkflowAdvancement` and `claimAndRun` should return a count of actions taken; only accumulate `acted` when > 0.
  - **Severity**: 2/10

- **[Med4] Ceremony consecutive-failure backoff is in-memory — resets on restart**
  - **File**: `packages/server/src/services/ceremony-scheduler.ts:27`
  - **Problem**: `const sweepFailureCount = new Map<string, number>()` is process-local. After a crash or restart, the backoff counter resets. A ceremony that was consistently failing with 1-hour backoff will immediately re-fire on the next restart, potentially causing an error storm if the root cause (e.g., a DB schema issue) persists.
  - **Recommended fix**: Persist the failure count in `ceremony_schedules.consecutive_failures` (add a column), or rely purely on the DB-persisted `nextFireAt` value that the backoff already writes. The backoff timestamp survives restarts; only the threshold check needs to be DB-driven.
  - **Severity**: 3/10

- **[Med5] `stripCodeFences` is duplicated between llm-client.ts and batch.ts**
  - **File**: `packages/server/src/coordinator/llm-client.ts:201-208` and `packages/server/src/coordinator/batch.ts:210-217`
  - **Problem**: Identical function body duplicated in two files. Any future fix (e.g., handling edge-case fence formats) must be applied in both places.
  - **Recommended fix**: Extract to `coordinator/utils.ts` and import.
  - **Severity**: 2/10

- **[Med6] Token estimation in `SquadClientLlmCaller` is approximate**
  - **File**: `packages/server/src/coordinator/llm-client.ts:72-75`
  - **Problem**: `promptTokens` and `completionTokens` are estimated at 1 token per 4 characters. This is a rough heuristic — the actual ratio depends on content (code vs. prose vs. JSON). Coordinator cost accounting will be inaccurate; if the real SDK returns token counts, they should be used.
  - **Recommended fix**: Check if `sendAndWait` returns usage metadata; if so, prefer that over character estimation.
  - **Severity**: 2/10

- **[Med7] `dispatcher` import in `index.ts` is dead code**
  - **File**: `packages/server/src/index.ts:47`
  - **Problem**: `import { dispatcher } from './engine/dispatcher.js'` is present but `dispatcher.start()` is never called. The new `heartbeat.start()` is what's active (line 184). The dead import adds confusion: a future developer might not know whether the old dispatcher is still in use.
  - **Recommended fix**: Remove the `import { dispatcher }` line (and the `DEPRECATED` marker is already on the class). The file can be left in place for one release cycle per the note, but the import in the active server entry point should be removed.
  - **Severity**: 1/10

---

### LOW (reliability-relevant only)

- **[L1] `preamble.ts` silently swallows file-read errors**
  - **File**: `packages/server/src/coordinator/preamble.ts:47`
  - **Problem**: `catch { /* fall through to built-in */ }` with no log. A permission error on `.squad/squadboard-coordinator.md` (e.g., wrong file ownership after deploy) will silently fall back to the built-in preamble with no indication that the custom file was ignored. Operators won't know their customizations aren't active.
  - **Recommended fix**: `catch (err) { console.warn('[coordinator/preamble] failed to read custom preamble, using built-in:', err); }`.
  - **Severity**: 2/10

---

## Subsystem-by-Subsystem Assessment

### Mini-coordinator (W29) — YELLOW

**Status**: YELLOW

**Strengths**:
- Clean Zod schema validation on both input and output (`schemas.ts`) with `.strict()` on all objects.
- Proper discriminated union on decision `kind` — no string-literal switch fallthrough risk.
- LRU + TTL cache (`cache.ts`) with injectable clock makes it deterministic to test.
- `dispatchViaCoordinator` correctly surfaces errors to callers rather than swallowing them.
- `persistCoordinatorDecision` is explicitly fire-and-forget with a `try/catch` + warn, which is the right trade-off (don't fail a run because audit log failed).

**Key risks**:
- No model-chain retry (H1). If the primary model is quota-limited, coordinator fails immediately.
- Batch LLM call has no timeout (M2 — CRITICAL). A hung batch call blocks the sweep tick indefinitely.
- Preamble cache never expires (H2). Custom preamble changes require server restart.
- `stripCodeFences` is duplicated (Med5).

---

### Sweeps (pickup-todos, ceremonies-due, etc.) — GREEN

**Status**: GREEN

**Strengths**:
- Three-tier routing (coordinator → keyword → least-loaded) is well-structured with explicit tier labels logged.
- Circuit breaker on `(issue, agent)` tuple with 30-minute rolling window prevents infinite failure loops.
- Each issue is guarded by a `try/catch` that increments `errors` and continues, so one bad issue never blocks the whole sweep.
- Outer `try/catch` in the sweep's `run()` method catches any sweep-level error, returning a non-throwing `SweepResult`.
- Ceremonies-due delegates to `sweepDueSchedules` which has its own idempotency guard (UPDATE-before-SELECT claim pattern).

**Key risks**:
- ceremonies-due `acted` metric inflation (Med2).
- ready-workflow-steps `acted` always ≥ 2 (Med3).
- Ceremony backoff state resets on restart (Med4).

---

### Heartbeat / Sweeper — GREEN

**Status**: GREEN

**Strengths**:
- Per-sweep `setInterval` isolation: one sweep throwing doesn't block others.
- `_runSweep` catches all errors and emits a `heartbeat.sweep.error` event for observability.
- `start()`/`stop()` idempotent (guarded by `this.running`).
- `setSweepEnabled` dynamically reschedules without restart.
- `sweepOrphanedRuns` and `sweepExpiredLeases` provide two-layer crash recovery (lease expiry + heartbeat absence).
- `sweepOrphanedWorkflowRuns` catches the finalization-crash edge case.

**Key risks**:
- No `unhandledRejection` global handler (M3 — CRITICAL): a stray async throw in a setInterval callback can crash the whole process.
- `sweepExpiredStepLeases` uses `sql.raw` string interpolation (H4).

---

### Workflow Runner — GREEN

**Status**: GREEN

**Strengths**:
- `claimAndRun` uses `FOR UPDATE SKIP LOCKED` — safe for concurrent invocation.
- `runWorker` is fire-and-forget with `.catch()` — a crashed worker doesn't block the dispatcher tick.
- Heartbeat timer (every 30 s) extends lease (90 s TTL), giving the sweeper a clean signal.
- `markFailed` always clears `leaseExpiresAt` and `heartbeatAt` so the sweeper won't re-reclaim a run that was already explicitly failed.
- Budget guard is checked before any SDK call — prevents token spend on over-budget projects.

**Key risks**:
- `resolveWorkflowVersionId` is called but the result is only used for `recordRunCompletion`. If the DB is unavailable at that point, the run proceeds without workflow version binding — this is silent (no error logged specifically for this case).

---

### DB Layer / Migrations — YELLOW

**Status**: YELLOW

**Strengths**:
- W28 I9: schema snapshots before each migration provide pre-migration archaeology.
- Rollback SQL files (`.rollback.sql`) exist for all four migrations.
- `initMigrationLog` is idempotent (`CREATE TABLE IF NOT EXISTS`).
- `applyMigrations` correctly skips already-applied versions.
- `initDb` performs `ensureCharterBackfill` idempotently on boot.

**Key risks**:
- Migration 0004 has a broken self-registration INSERT (M1 — CRITICAL). Blocks fresh installs.
- No DDL transaction wrapping per migration (H5). Partial failure leaves schema in limbo.
- `computeChecksum` uses a 32-bit polynomial hash — collision probability is non-trivial for many migrations. Not a current problem (4 migrations) but a future concern.
- `bootstrapSchema()` runs inline DDL in addition to the migration files, creating two sources of truth for the schema.

---

### SDK / Session Lifecycle — GREEN

**Status**: GREEN

**Strengths**:
- `RunningIssueSessionImpl` is created before the try block and disposed in `finally` (bridge.ts pattern ensures cleanup even on SDK throw).
- `BudgetGuard.check()` is called before any SDK session is created.
- Model validation in `bridge.ts` rejects suspicious model strings before passing to the SDK.
- `createAgentSession` disconnects the SDK client in a `finally` block (`client.disconnect().catch(() => {})`) — catches disconnect errors without swallowing the run result.
- `OutputStreamer` and `CostTracker` are wired to the run ID, providing per-run observability.

**Key risks**:
- Active session registry (`active-issue-sessions.ts`) is in-memory. Server restart loses all active session handles — clients watching a live run will get no further events after restart, and the steer endpoint will return 404 for runs that survive as "running" (before restart-pickup reclaims them).

---

### Realtime / WebSocket — GREEN

**Status**: GREEN

**Strengths**:
- 15 s ping/pong heartbeat terminates stale connections cleanly.
- `handleClose` cleans up from both `rooms` and `globalClients` maps.
- `resubscribe` with `lastSeq` replay prevents missed events on reconnect.
- WS `error` events are caught per-client (no server-level throw).
- SSE alternative (`consult-sse.ts`) with 15 s heartbeat and last-message-id resume.

**Key risks**:
- No max message size guard on incoming WS messages. A malicious client sending an arbitrarily large JSON blob causes a potentially expensive `JSON.parse` on the server.
- `rooms` and `clients` are module-level singletons — in a future multi-worker/cluster deployment, clients on different workers won't see each other's events.

---

### Routes / API Surface — GREEN

**Status**: GREEN

**Strengths**:
- Coordinator path (B) returns structured errors (503 on coordinator failure, 409 on ambiguous, 422 on skip) with enough context for clients to guide users.
- Agent status gate in both route and worker (defense-in-depth: disabled agents are rejected at two layers).
- `sanitizeBranchName` guard against shell-unsafe characters.
- `handleError` centralized for GitOpsError vs. generic 500.

**Key risks**:
- N+1 label queries (Med1) on every coordinator dispatch POST.
- Cross-project `busyAgentIds` pollution in coordinator path (H3).
- No rate limiting on coordinator dispatch endpoint — a client can trigger many expensive LLM calls in rapid succession.

---

## Test Coverage Gaps

| Area | Gap |
|---|---|
| Migration 0004 | No test that applies migration 0004 to a fresh DB and verifies it succeeds end-to-end. The existing `migration-safety.test.ts` tests the safety framework but not the specific migration SQL content. |
| Model fallback chain | No test that verifies the system falls back to the next model when the primary coordinator model fails. The fallback chain API is tested in `coordinator-env.test.ts` but is never exercised in dispatch. |
| Batch dispatch timeout | No test that verifies `dispatchBatchViaCoordinator` times out after N seconds. `coordinator-batch.test.ts` only tests successful paths. |
| `busyAgentIds` cross-project | No test that verifies an agent running in project A does not appear `available=false` when coordinator dispatches for project B. |
| WS large message | No test for oversized incoming WS message handling. |
| DDL transaction rollback | No test that a mid-migration failure leaves the schema unchanged (transaction rollback). |
| `claimAndRun` concurrency | `idempotency-*.test.ts` covers capture/MCP, but there is no test that verifies two concurrent `claimAndRun` invocations don't claim the same run (tests the `FOR UPDATE SKIP LOCKED` guarantee). |
| Ceremony backoff after restart | No test that a ceremony that hit the backoff threshold before restart still fires correctly on restart (in-memory counter reset semantics). |

---

## Recommendations

1. **(P0) Fix migration 0004 broken INSERT** — Remove the `INSERT INTO _migration_log (id, applied_at)` line from `0004_issue_runs_coordinator_decision.sql`. This is the only change blocking fresh installs. (Fixes M1)

2. **(P1) Add AbortController + timeout to `dispatchBatchViaCoordinator`** — Mirror the exact pattern from `callCoordinatorLlm`. Default timeout: 60 s for batch (2× the one-shot 30 s). (Fixes M2)

3. **(P1) Add `unhandledRejection` and `uncaughtException` handlers** — At minimum log and don't crash silently. For `uncaughtException`, attempt graceful shutdown (CHECKPOINT + drain). (Fixes M3)

4. **(P2) Wire `resolveCoordinatorModelChain` into dispatch and batch** — Iterate the chain on `CoordinatorLlmParseError` or network-level error before surfacing failure. (Fixes H1)

5. **(P2) Add DDL transaction wrapping to `applyMigrations`** — `BEGIN` before `pool.query(migration.upSql)`, `COMMIT` on success, `ROLLBACK` on throw. (Fixes H5)

6. **(P2) Fix label resolution N+1 in runs route** — Use a single JOIN or `inArray` fetch. (Fixes Med1)

7. **(P3) Scope `busyAgentIds` to the current project** in coordinator path B. (Fixes H3)

8. **(P3) Replace `sql.raw` UUID array in `sweepExpiredStepLeases`** with Drizzle `inArray()`. (Fixes H4)

9. **(P3) Add preamble TTL** (5 min) and log which file was loaded at startup. (Fixes H2, L1)

10. **(P4) Persist ceremony failure count to DB** or rely on the DB-persisted `nextFireAt` exclusively for backoff decisions. (Fixes Med4)

---

## Methodology

**Survey phase (~60% of effort)**: Used `glob` + `view` to read the 8 primary subsystem files listed in scope. Read dispatcher.ts, sweeper.ts, migrations.ts, batch.ts, dispatch.ts, llm-client.ts, preamble.ts, ws-server.ts, routes/runs.ts (selected sections), coordinator-decision-log.ts, stepper.ts (selected sections), active-issue-sessions.ts, ceremony-scheduler.ts header, coordinator-env.ts, db/schema.ts, db/index.ts, db/migrations/*.sql.

**Pattern analysis (~30% of effort)**: Used `grep` to find error handling patterns (`try/catch/throw`), `process.exit` calls, timeout/AbortController usage, and `sql.raw` usage. Verified dispatcher import status in index.ts. Confirmed model fallback is defined but not called.

**Report writing (~10% of effort)**.

**What was skipped**: GitHub sync internals (`github-sync.ts`, `copilot-watcher.ts`), peer-reviewer, cost tracker internals, electron package, CLI tools (backup/bundle/bulk-import), client React components, e2e tests. These are lower-risk for the W29 coordinator changes and were deprioritized.
