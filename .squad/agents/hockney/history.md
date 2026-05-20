## W29 — Mini-Coordinator DB Spawning + Launch Reviews

**Date:** 2026-05-16  
**Wave:** 29  
**Status:** Completed


### 

### Lessons

1. **Migration example patterns matter.** Scribe's dispatcher prompt included faulty manual `INSERT` example. Always validate dispatch prompts against existing migration hooks.
2. **Post-action hook timing is fragile.** Batch 2 commit race: post-action checked `git status` before staged files flushed. Mitigation: explicit `git diff --cached --stat` before marking staged.
3. **JSONB persistence enables retroactive analysis.** `coordinator_decision` on runs allows querying coordinator routing decisions post-hoc — valuable for debugging + telemetry.

---


## 

## W24 Close-Out

**Date:** 2026-05-16  
**Status:** Completed


### 

### Lineage

- **Todo:** l2-electron-scaffold
- **Commit:** 2f2bc1b0
- **Pattern:** Orphan completion (silent success / agent runtime eviction)


### 

## W24 Wave-Close Protocol Execution

**Date:** 2026-05-16  
**Task:** First execution of `.squad/wave-close-protocol.md`  
**Result:** ✅ Wave 24 closed, main advanced from Wave 16 (7e6d931b) to Wave 24 tip (6aa32bf6)


### 

### Main Fast-Forward Phase

- **Before:** main at 7e6d931b (Wave 16)
- **After:** main at 6aa32bf6 (Wave 24 close)
- **Commits merged:** 39 commits (retroactive W17–W24 catch-up + W24 fixes + health report)
- **Merge method:** `git merge --ff-only` — zero conflicts, clean fast-forward path
- **Health report:** Filed at `.squad/health/2026-05-16/wave-24-close.md`


### 

### Lessons & Protocol Refinements

1. **AJV import inconsistency** — Caught at build time. Consider:
   - Add ESLint rule to enforce named imports for AJV in new packages
   - Or standardize to default import everywhere (requires dist config audit)

2. **Smoke verify environment** — Database configuration is prerequisite:
   - Current protocol correctly handles fallback to build-verify
   - Suggestion: Document pre-flight check for DATABASE_URL in smoke step
   - No changes needed to protocol; it already covers this ✓

3. **Protocol execution quality** — First run was smooth:
   - Clear step ordering prevents mistakes
   - Decision files (inbox/) allow easy escalation if needed
   - Health report capture is sufficient for post-wave analysis

4. **Scribe silent success** — Scribe W24 close-out not yet observed:
   - Proceeded per protocol timeout rule (8 min, then continue)
   - No health report or decision files from Scribe found
   - No blocker — build + merge succeeded on Hockney side
   - Note: May be async/deferred completion; check `.squad/health/2026-05-16/` for Scribe report later


### 

### Next Steps

1. Coordinator to close dogfood cards (per protocol step 6)
2. Wait for Scribe W24 close-out artifact (may arrive async)
3. Dispatch Wave 25 domain agents
4. Monitor Hockney tasks: Electron L2 refinement, sweeper optimizations

---

---


## 

### Learnings

1. **Audit-before-rm discipline is non-negotiable.** The task was to untrack 71 artifacts matching a pattern. Blind `git rm --cached` on a glob would have succeeded, but the actual count was 139,183 — mostly the pnpm cache tree (.pnpm/ with ~139k symlinks and resolved packages). Auditing each category BEFORE removing ensured no source files were accidentally deleted. Pattern: Always `git ls-files | grep PATTERN > audit.txt`, inspect with `wc -l` and `head -20`, THEN execute the rm. Never pipe a pattern directly to xargs-rm without auditing first.

2. **pnpm `.pnpm/` structure is voluminous but fully cacheable.** Each resolved package version gets a symlinked entry. Tracking this tree (138,715 files) means every `pnpm install` resumes from a "frozen" cache state — intended for monorepos but defeats the purpose when .gitignore is active. Solution: rely on .gitignore + `pnpm install` to regenerate. No exceptions needed.

3. **Batching xargs on 139k files requires careful command chaining.** Single `xargs git rm --cached` call on 139k paths can overflow ARG_MAX. Solution: pipeline in 1000-file batches, or use `-z` null-delimited mode. Direct pipe of full list to xargs (with proper `-0 git rm --cached`) succeeded on second attempt after batch loops failed.

4. **Build verification gates the commit.** After untracking, `pnpm -r build` succeeded immediately, proving that none of the artifacts were source files. This is the gate: if build fails after untracking, the artifact was source code — re-add it and flag for decision. (Did not occur here.)

5. **`git status --short` is the best post-cleanup verification.** After commit, only the deletions remain in staging. If any tracked dist/ or node_modules/ files still showed `M` (modified), untracking was incomplete. Clean status → cleanup successful.

**Decision filed:** `.squad/decisions/inbox/hockney-w25-untrack-build-artifacts.md`  
**Commit SHA:** `bef36a4755b556215244fdd83365a08859d19d99`  
**Impact:** git status now clean; repo health restored; W24 .gitignore enforcement complete.


## 

## W25 Close-Out Protocol Execution (2026-05-16T02:55:00-07:00)

**Completed by:** Hockney


### 

### Learnings

1. **FF can be skipped if wave tip is already on main.** The protocol says "FF must succeed" but doesn't mandate running it if main is already at the wave tip. W25 arrived with all 6 commits already merged, so the intent ("main ≥ wave tip") was already satisfied. This is acceptable — the gate is the outcome, not the ceremony.

2. **Build-only verify is the right tool when database is unavailable.** Unlike W24 (which required fixes pre-build), W25 shipped clean at build time. The fact that we can't run smoke doesn't matter if the build itself is solid. Protocol's downgrade path works.

3. **Zero defects before close-out is achievable.** W24 had to fix AJV imports. W25 had no pre-close-out defects. Difference: domain agents tested more carefully before committing. Pattern to encourage: always run `pnpm -r build` locally before sending PR.


### 

### Next Steps

1. Coordinator to close dogfood cards
2. Scribe to file W25 close-out decisions + health report (if not already done)
3. Dispatch Wave 26 domain agents

**Wave 25 Status:** ✅ **CLOSED**


---


## 

## W26 Charter Parser — `auto` Sentinel Fix (2026-05-16)

**P0 Bug:** Runs failing with `Model "**Preferred:** auto" is not available`.

**Root cause:** `parseCharterContent()` in `charter-compiler.ts` stripped only the leading `- ` bullet marker in `case 'model':`, leaving the raw markdown bold prefix `**Preferred:** auto` as the model value. `resolveModel()` only handles the literal string `'auto'` as a sentinel — not markdown-wrapped variants — so the malformed string reached the platform API.

**Fix:** Extended the `case 'model':` parser to:
1. Strip `**Key:** value` bold markdown prefix (and `Key: value` plain prefix)
2. Strip trailing annotations after `→` (e.g. "auto → coordinator selected …")
3. Treat `auto`, `default`, and empty as sentinels → `model = undefined`

Applied the same sentinel guard to the `identity_table` section for consistency.

**Tests:** 12 vitest cases added in `charter-parser.test.ts` — all green.

**Takeaways:**
- Charter parsing must be defensive about markdown formatting. Regex-strip *all* structural decoration before storing values.
- Sentinel values (`auto`, `default`) must be filtered at the *parser* layer, not only at the resolution layer. Defense-in-depth: the resolver also handles `'auto'` as a fallback, but the parser should never let markdown markup escape into stored metadata.
- The arrow-annotation pattern (`auto → some note`) in charters must be handled: split on `→` and use only the first part.
- Any new charter field extraction must have unit tests covering: (a) bold prefix, (b) plain prefix, (c) sentinel values, (d) absent section, (e) empty value.

**Files:**
- `packages/server/src/services/charter-compiler.ts`
- `packages/server/src/__tests__/charter-parser.test.ts`
- `.squad/decisions/inbox/hockney-w26-charter-parser-auto-sentinel.md`

**Commit:** `fix(server): charter parser treats Preferred: auto as sentinel (W26)`

---


## 

## W27 Server Quad (2026-05-16T03:38:00-07:00)

**Task:** Four Stream A dogfood bugs in one commit.


### 

### Bug 2 — MCP HTTP curl session

The SDK client auto-replays `Mcp-Session-Id`; curl doesn't. Error messages for missing/stale session were too terse. Fix: option 1 (small fix) — expanded 404/400 error bodies with explicit curl capture-and-replay instructions. **Lesson:** When HTTP session semantics depend on header replay, make the error messages teach the protocol, not just report the failure.


### 

### Bug 4 — PATCH project fields

`PATCH /api/projects/:id` only allowed `defaultModel` / `costModel`. `name` and `description` were missing. The `projects` table had no `description` column at all. Fix: added `description` to the Drizzle schema, added `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT` migration, extended the PATCH handler with `name` (non-empty required-if-present) and `description` (optional, max 4000 chars) validation. **Lesson:** When a new field is needed on the PATCH allowlist, check for (1) schema column, (2) migration, (3) route handler — all three must be in sync.

**Tests:** 3 conjure hint cases + 5 PATCH project cases = 8 new tests. All 464 tests green.  
**Commit:** filed as W27 quad commit on main.  
**Decision file:** `.squad/decisions/inbox/hockney-w27-server-quad.md`
Current focus: W21–W23. For earlier context, search `.squad/decisions.md` by wave number.


## 

### Summary

Hockney delivered L2 Electron scaffold (commit 2f2bc1b0). Work was completed on disk, but agent session cleared before commit. Coordinator executed orphan-commit pass with proper co-author attribution.


### 

### Next Wave

Hockney-close-w24 dispatched in parallel to run build + main FF + smoke tests before W25 starts.
- W28: Cost critical fixes (Haiku 4-5× underbilled, +8 models, consult premiums, cached tokens schema, drift alarm, migration safety with rollback + dry-run + snapshots) (b954fe18, 00ef812d, a35226ab)


## 

### 2026-05-19T14:11:32.649-07:00 — PGlite RI trigger catalog repair

- PGlite 0.4.5 local clusters can carry stale RI trigger `tgconstraint` OIDs after historical DDL churn. Symptom: any `issue_runs` update fails in `ri_LoadConstraintInfo` with `constraint ... is not a foreign key constraint`.
- Diagnosis pattern: compare RI triggers between `issue_runs` and `issue_run_events` against the canonical `issue_run_events_run_id_fkey` row; do not trust a failing update alone, because the adjacent unique constraint can be the visible failure.
- Fix pattern: run PGlite-only startup repair before any sweeper/stepper update. Repoint the stale RI triggers to the canonical FK OID; external PostgreSQL must not receive this catalog surgery.
- Key files: `packages/server/src/db/index.ts`, `packages/server/src/__tests__/pglite-issue-run-events-catalog-repair.test.ts`, `docs/bugs/bug-2026-05-19-pglite-ready-workflow-step-sweep-fails-updating-issue-runs.md`.


### 

### 2026-05-19T14:47:51.758-07:00 — Two-way sync audit boundaries

- Treat `.squad` path semantics as a runtime invariant, not cosmetic naming. `projects.path` must consistently mean the `.squad/` directory; starter/materializer code that writes files against the project root is a separate setup bug and should not be masked by tolerant readers.
- The new PostgreSQL-backed `squad_storage` provider centralizes SquadState for Squadboard, but in-process PGlite is not cross-process shared state. External Squad CLI/Copilot must use standalone PostgreSQL with matching scope/provider or go through the Squadboard MCP/API broker.
- Workflow durability is split: DB leases/heartbeats live on `issue_runs`/`step_runs`, while heartbeat sweep status is process-local telemetry. Do not infer durable wakeup/event-log semantics from the heartbeat UI alone.


### 


### 2026-05-19T15:29:23.373-07:00 — Pre-alpha GitHub/npm readiness

- Renamed the local integration branch from `main` to `dev`; no local `dev` branch existed, so the rename was safe and did not touch file contents.
- Release mechanics now treat `@sabbour/squadboard-sdk`, `@sabbour/squadboard-cli`, and `@sabbour/squadboard` as the publishable npm set for this phase. Versions and publish configs use `0.1.0-prealpha.0` plus the `prealpha` dist-tag.
- `pnpm publish` must be invoked through workspace `--filter`; using `pnpm -C` / `--dir` with `publish` leaked extra argv into the delegated npm command and failed with `EUSAGE`.
- Publish builds must clean `dist` before `tsc`; otherwise stale compiled test files can enter the npm tarball. Server build also copies built-in `.workflow.yaml` ceremony assets into `dist/ceremonies/built-in` so package runtime reads succeed after publish.
- Validation run: frozen install metadata, npm package builds, npm publish dry-run, docs build, and workflow YAML parsing all passed.

### 2026-05-19T15:43:53.554-07:00 — Sync rejection revision

- Kujan rejected the cross-surface sync workstream for API namespace drift and ceremony invariant conflict. I did the independent Hockney revision; I did not touch release-copy wording.
- Canonical sync API namespace is now `/api/projects/:projectId/squad-sync/...`. Rationale: project-scoped resource naming matches existing routes and avoids generic sync/GitHub sync ambiguity.
- Ceremony sync invariant is now strict: `.squad/ceremonies.md` is required and must contain seeded, non-placeholder defaults. Missing, empty, or placeholder-only ceremonies produce a required `seed-ceremony-defaults` repair item.
- `sync-ownership.ts` now models `ceremoniesDefaultsPresent`; `sdk-state.ts` marks the current placeholder text as not seeded defaults.
- Validation passed: focused sync-ownership Vitest, server build/typecheck, and client typecheck.

### 2026-05-19T18:15:41.495-07:00 — Root start argument normalization

- `pnpm start dev` appends `dev` to the root `start` script, which made the recursive workspace command become `run dev dev`; pnpm then forwarded that positional argument into every workspace dev script.
- Docusaurus treats a trailing positional after `start --host 0.0.0.0 --port 3002` as a content path, so the leaked `dev` became `packages/docs-site/dev` and failed with `ENOENT`.
- Fix pattern: normalize at the root launcher boundary. `scripts/start-dev.mjs` ignores only the compatibility `dev` arg, rejects any other unsupported args, and spawns the deterministic backend+client+docs `pnpm --parallel ... run dev` command with docs still on port 3002.
- Validation: focused Vitest coverage for the launcher plus `SQUADBOARD_START_PRINT_COMMAND=1 pnpm start dev` proving no trailing `dev` is forwarded.
- Decision filed: `.squad/decisions/inbox/hockney-start-dev-arg-filter.md`.

### 2026-05-19T21:58:16.699-07:00 — Cross-surface squad-sync backend

- Added the project-scoped `/api/projects/:projectId/squad-sync` backend surface with status, repair, `project-squad-to-fs`, and `generate-github-agent` routes.
- Kept authority honest: PostgreSQL mode reports `squad_storage` plus explicit projection repairs only; filesystem mode reports live filesystem authority and skips DB-to-FS projection.
- Safe repair pattern: create missing files/directories, replace only empty/default ceremony placeholders, and skip divergent or unsafe targets with typed reasons instead of overwriting.
- Validation: focused squad-sync Vitest coverage and server build passed.


### 2026-05-19T23:37:54.700-07:00 — DELETE project JSON failure (stale OID 500 → text/html)

**Symptom:** UI modal showed `API 500: expected JSON but got text/html; charset=utf-8. error: could not open relation with OID 66346` when attempting "Permanently delete project and folder."

**Root causes (two independent failures):**
1. `DELETE /api/projects/:id` handler had no try/catch around its `db.select()` and `db.delete()` calls. When PGlite's catalog carries a stale OID (same family as the `issue_runs` RI-trigger bug), the thrown error propagates to Express.
2. No global JSON error handler was registered in `index.ts`. Express's default error handler returns `text/html`, causing the client to see the wrong content type and fail to parse the body.

**Fixes:**
- `packages/server/src/routes/projects.ts`: wrapped the DB lookup and DB mutation phases of DELETE in separate try/catch blocks. Lookup failure → JSON 500 with `"Database error during project lookup: <msg>"`. Mutation failure → JSON 500 with `"Database error during project deletion: <msg>"`. Safety contracts (metadata-only default, folder guards) are unchanged.
- `packages/server/src/index.ts`: added a global 4-arg Express error handler (registered after all routes, before the SPA fallback). Ensures every unhandled route error returns `application/json` regardless of which route threw.

**Tests added (delete-project.test.ts):**
- `selectError` and `settingsDeleteError` fixtures added to the DB mock.
- Two new regression cases: DB-select-throws → 500 JSON `{ ok: false, error: "Database error during project lookup: …OID 66346" }`; settings-delete-throws → 500 JSON `{ ok: false, error: "Database error during project deletion: …OID 99999" }`.
- 15/15 tests green; server build clean.

**Key files:** `packages/server/src/routes/projects.ts`, `packages/server/src/index.ts`, `packages/server/src/__tests__/delete-project.test.ts`

**Invariant confirmed:** The dispatcher/stepper/spawner discipline, lease/heartbeat liveness, and sweeper logic are unaffected. This is a pure route-layer fault-tolerance fix.


### 2026-05-19T23:37:54.700-07:00 — DELETE stale-OID root-cause fix (withPgliteOidRetry)

**Context:** Previous fix only shaped the 500 as JSON. The delete still failed. Root cause is deeper.

**Root cause:** PGlite's extended query protocol caches prepared statement plans. When a migration cycle drops and recreates a table (e.g. `projects`), the new relation gets a fresh OID in `pg_class`, but older cached plan still references the stale OID. The next parameterised Drizzle query fails with `could not open relation with OID NNNNN`. This is not a trigger-catalog corruption (like the `issue_runs` fix); it is a prepared-statement plan cache staleness.

**Fix: `withPgliteOidRetry<T>(fn)` in `db/index.ts`:**
- Detects the OID error via `/could not open relation with OID/i` on the error message.
- In PGlite mode: issues `DEALLOCATE ALL` (clears all prepared-statement caches) then retries `fn()` exactly once. External Postgres re-throws immediately (external PG handles relcache invalidation itself).
- Helper `discardPgliteStatementCache()` issues `DEALLOCATE ALL` via the pool; failure is non-fatal (logged, not rethrown).
- Exported so routes can wrap individual operations without knowing the DB mode.

**Updated DELETE handler in `routes/projects.ts`:**
- Lookup wrapped: `withPgliteOidRetry(() => db.select()...)`
- Mutation wrapped: `withPgliteOidRetry(async () => { delete settings; delete project; })`
- Both phases still have outer try/catch for errors that persist after retry.

**Regression tests added:**
- `delete-project.test.ts` (16 tests): added recovery test (test 14) — first select throws OID error, `withPgliteOidRetry` mock catches it, sets `oidRetryDeallocateCalled`, retries, second call succeeds, delete completes with 200. Uses `_selectOidErrorConsumed` one-shot flag (module-level, reset in beforeEach) to avoid cross-test counter bleed.
- `pglite-oid-retry.test.ts` (6 tests, NEW): focused tests for the retry utility against a real in-memory PGlite instance. Covers: pass-through on success, immediate re-throw of non-OID errors, DEALLOCATE ALL + retry succeeds (verified via `pg_prepared_statements`), retry fails → re-throw, external-Postgres mode → no retry, case-insensitive OID message detection.

**Key files:** `packages/server/src/db/index.ts`, `packages/server/src/routes/projects.ts`, `packages/server/src/__tests__/delete-project.test.ts`, `packages/server/src/__tests__/pglite-oid-retry.test.ts`.

**Invariant:** Dispatcher/stepper/spawner discipline unaffected. No real folders touched in tests. Safety guards unchanged.

---

## logs-heartbeat-diagnostics — 2026-05-20

- Slowed heartbeat defaults in code and config while enforcing the `stuck-issue-runs` safety cap.
- Kept log-monitor auto-fixes allowlisted to optional diagnostics sweeps; core engine sweeps remain advisory-only.
- Structured process/backend error logs as JSON for deterministic diagnostics.
- Follow-up: the noisy SQLite ExperimentalWarning is emitted by the Copilot CLI child process via `@github/copilot-sdk`; suppress it with child-only `NODE_OPTIONS=--disable-warning=ExperimentalWarning`, not by muting server warnings globally.
- Follow-up: Now's Sweep Activity must be seeded from `/api/heartbeat/status` and show every registered sweep lane; otherwise it drifts from the Heartbeat page's ring-buffer view.
- Follow-up: never scaffold user-created projects directly under the monorepo `packages/` tree. The only repo-internal exception is the isolated E2E workspace at `packages/e2e/.e2e-workspaces`.
- Follow-up: direct package `.squad` folders (notably `packages/server/.squad`) are internal test/runtime state, not selectable projects. Self-register and discovery must skip them, and charter backfill must use per-agent/project charter paths with aggregated errors rather than `process.cwd()/.squad` fan-out noise.
- Follow-up: scheduled GitHub issue intake should be a backend primitive, not an agent prompt placeholder. The `squadboard.github-issue-intake.v1` contract maps to public/read-only GitHub issue pulls, `project.githubSyncLastAt` cursor state, `github:{owner}/{repo}#{number}` idempotency, and `on_issue_entry` triage workflow runs.
- Follow-up: Squad Doc Review uses the same source-intake pattern with a source-specific cursor setting, doc idempotency keyed by repo/path/blob-or-commit/profile version, and traceable Squadboard review issues. Manual ceremony run-now remains generic: persist selected-doc/manual-mode context in `workflow_runs.trigger_source.context`; do not create doc-specific buttons or auto-edit/push docs by default.

## Learnings

- Express route registration order is a backend invariant: project-scoped static ceremony paths such as `/audit` must be registered before `/:id`, or PostgreSQL will receive reserved words as UUID ceremony ids.
- Deep review (2026-05-20): `sql.raw()` in `sweepExpiredStepLeases()` splices row IDs into raw SQL — the only hot-path SQL-injection vector. Must use Drizzle's `inArray()` or parameterised `sql.join()` exclusively.
- Deep review (2026-05-20): heartbeat `setInterval` in `stepper.ts` has no hard timeout. A hung SDK bridge call keeps the lease alive forever, starving the issue_run from sweeper reclaim. Every agent run needs a wall-clock deadline that kills the heartbeat.
- Deep review (2026-05-20): migrations in `migrations.ts` run statement-by-statement without `BEGIN`/`COMMIT`. Partial migration failures leave schema in inconsistent state. All migration files must execute inside an explicit transaction.
- Deep review (2026-05-20): sweeper `lease_expires_at < NOW()` has no grace window — a heartbeat arriving 1ms late (event-loop jitter) triggers false reclaim. Adding a 10s grace buffer prevents race between heartbeat write and sweeper read.
- Deep review (2026-05-20): WebSocket upgrade has zero auth. Any network-adjacent client gets the full event stream including `__global__`. Must validate bearer token on WS upgrade.
- Deep review (2026-05-20): GitHub fetch calls have no `AbortSignal.timeout()`. A single hung GitHub API response can block the worker indefinitely. All external HTTP must have a wall-clock timeout.
- 2026-05-20: Workflow advancement must transact around step status changes, spawned child rows, and cursor movement together; otherwise concurrent ticks can leave a completed step with a stale parent cursor or orphaned child run.
- 2026-05-20: One-shot Squad SDK runs need a hard wall-clock timeout that tears down the SDK session before the engine clears heartbeat state; timing out only at the sweeper layer is too late because the worker can self-renew forever.
- 2026-05-20: `timed_out` is a first-class terminal engine state. Any terminal-status list used by workflow polling, retries, retrigger UX, fan-out merge logic, or worktree cleanup must treat it the same way as `failed`.
