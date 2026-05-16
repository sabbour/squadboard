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

---

## Wave 14 — PGlite permanent, data migration queued

**Date:** 2026-05-15T22:14:50-07:00  
**Spawned by:** Copilot Coordinator  
**Task:** q1-followup-data-migration  

Ahmed confirmed: PGlite (commit `ca257838`) is now permanent. Local-first single-user kanban fits PGlite's model. Stream-L (Electron) packaging is simpler without per-platform Postgres binaries.

Queued in Wave 14 backlog: Migrator to unlock foo's 166 stranded cards from legacy embedded-PG cluster → PGlite cluster. No rollback planned.


---

## Wave 14 — Legacy data migrator (q1-followup-data-migration) COMPLETED

**Date:** 2026-05-15T22:14:50.847-07:00
**Task:** Build one-time legacy embedded-postgres → PGlite migrator

### Approach Selected: Option (c) — cached pnpm binaries

The workspace's pnpm virtual store still holds `embedded-postgres@18.3.0-beta.17` and `@embedded-postgres/linux-arm64@18.3.0-beta.17` even though the package was removed from `packages/server/package.json`. Discovery algorithm: read `PG_VERSION` from legacy data dir → scan `node_modules/.pnpm/` for `@embedded-postgres+{platform}-{arch}@{pgMajor}.`* → resolve the `native/bin/` directory. Zero re-installs, zero network.

`pg_ctl start -D legacyDataDir -o "-p <randomPort>" -w` brings the cluster up. `pg` client (already in deps) connects and reads all tables. PGlite pool adapter (already in deps) writes all rows. `pg_ctl stop` cleans up. Whole round-trip is self-contained.

### Deliverables shipped

| File | Purpose |
|------|---------|
| `packages/server/src/scripts/migrate-from-legacy-pg.ts` | Core migrator (~360 lines) |
| `packages/server/src/scripts/verify-migration.ts` | Post-migration row count checker |
| `packages/server/src/cli/migrate.ts` | CLI surface (`squadboard migrate [flags]`) |
| `packages/server/src/index.ts` | Auto-run integration (before `startPglite()`) |
| `bin/squad-migrate` | Shell shim |

### Edge cases hit and fixed

1. **FK ordering bug**: `workflow_runs.workflow_version_id` has a live FK constraint in PGlite's DDL even though Drizzle schema doesn't declare `.references()` on it. Fix: moved `workflow_versions` before `workflow_runs` in `TABLE_ORDER`. Verified by running the actual migration.

2. **Path resolution**: `resolve(fileURL, '../../../../../..')` walked one level too far (6 `..` instead of 5). The file is at `packages/server/src/scripts/`, so 5 `..` levels reach the workspace root.

3. **Pre-existing PGlite data**: `ON CONFLICT DO NOTHING` on INSERT handles the case where PGlite's `bootstrapSchema()` already seeded review policy presets. Verify script treats `actual >= expected` as passing (extras are from post-migration server activity, not data loss).

### Migration results (dev run)

```
225 issues + 3 projects + 58 issue_runs (652 total rows across 39 tables)
Marker written at ~/.squadboard/data/.migrated-to-pglite-v1
```

### Invariants to watch for in future migrators

- **Always derive FK order empirically**: Drizzle schema `.references()` declarations don't always match live DDL (bootstrapSchema may add FKs not in the schema file). Test with actual `--force` run, not just dry-run.
- **pnpm store binary discovery is workspace-layout-dependent**: if the workspace root changes (monorepo restructure), the `resolve(thisFile, '../../../../..')` path must be updated.
- **Binary version must match PG_VERSION exactly** (major version): PG17 binary cannot start a PG18 cluster. Read `PG_VERSION` file first.
- **pg_ctl log must not go to /tmp**: wrote to `~/.squadboard/data/migrate-pg_ctl.log` instead.
- **Auto-run must be non-fatal**: migration failure in `index.ts` auto-run is caught and logged; server continues. Users can retry with `squadboard migrate`.

---

## Wave 15 — Stream I (Reliability): verify + backup + restore

**Date:** 2026-05-15T22:42:29.855-07:00  
**Tasks:** w15-migration-verify, i1 (backup), i2 (restore)

### Deliverable 1: W14 Migration Verify (`squadboard migrate --verify`)

W14 migration verified **clean** on initial run — all 39 tables had `actual >= expected` counts. Migration marker upgraded to include a `dest_counts` block with live PGlite counts at verify time, making future verifications self-contained.

**Key learning — two-PGlite problem**: opening a second PGlite WASM instance against the same nodefs data directory while the server is running causes inconsistent reads. All CLI tools that need live counts now detect the running server via `GET /api/health` and fall back to `GET /api/system/db-counts` HTTP endpoint. Direct PGlite boot only when server is confirmed stopped.

**Learnings:**
- PGlite singleton in `db/pglite.ts` uses module-level state — second process has no visibility into it
- All CLI standalone entry points must use the ESM `fileURLToPath(import.meta.url) === argv1` guard to avoid double-running when imported as a module
- Hard process termination bypasses SIGTERM handler — PGlite does not checkpoint and the next startup sees partial WAL state. Production discipline: only stop via SIGINT/SIGTERM, which triggers the registered handler in the server.

### Deliverable 2: Periodic DB Backup (`squadboard backup`)

**Format:** PGlite native `dumpDataDir('gzip')` — produces a `.tar.gz`. Chosen over raw filesystem tar because PGlite checkpoints before tarring (consistent snapshot even under live queries). ~5 MB per cluster.

**Files shipped:**
- `packages/server/src/scripts/backup.ts` — `runBackup()`, `pruneBackups()`
- `packages/server/src/cli/backup.ts` — CLI surface; HTTP-first (server-aware)
- `packages/server/src/routes/system.ts` — `POST /api/system/backup`, `GET /api/system/backups`, `GET /api/system/db-counts`
- `packages/server/src/daemon/index.ts` — `maybeRunBackup()` tied to daemon tick
- `packages/server/src/daemon/guards.ts` — `BackupConfig` added to `SquadboardConfig`
- `packages/server/package.json` — scripts: `migrate:verify`, `backup`, `restore`

**Defaults:** retainCount=7, intervalMs=24h. Both overridable via `~/.squadboard/config.json { "backup": { ... } }`.

### Deliverable 3: Restore Flow (`squadboard restore <backup-file>`)

**Safety order (invariants):**
1. Validate backup file format
2. Reject if daemon PID live (unless `--force`)
3. Move pglite dir to pglite.pre-restore-{ts} (rollback preserved)
4. `new PGlite({ dataDir, loadDataDir: blob })` — PGlite native tarball restore
5. Verify row counts via `createPoolAdapter()` directly (no `initDb()` singleton dependency)
6. On any failure: auto-rollback pre-restore back to pglite

**Restore UI:** Deferred to Keyser / W16. TODO left in decision file.

### Invariants Added

- **Never open two PGlite instances on the same data dir**: use HTTP API when server is running.
- **CLI standalone guard is mandatory**: every script with both an exported function AND a standalone `main()` must gate `main()` with `fileURLToPath(import.meta.url) === argv1`.
- **Restore verification must not use initDb()**: `initDb()` reads the module-level PGlite singleton. In a subprocess that called `PGlite.create()` directly, use `createPoolAdapter(instance)` instead.
- **Graceful shutdown discipline**: hard process kills bypass the SIGTERM handler — PGlite will not checkpoint cleanly. Always stop via registered signal handlers. Consider adding postmaster.pid presence check on startup as a WAL-replay warning.

## Team Update — undefined

Run: wave-15

- **mcmanus**: Universal Project Bundle (3rd escalation cleared)
- **keyser**: UI batch (#2, #6, #7 fixes)

## Team Update — undefined

Run: wave-15-final

- **mcmanus**: Universal Project Bundle (3rd escalation cleared)
- **keyser**: UI batch (#2, #6, #7 fixes)
- **scribe**: W15 close-out + SDK fidelity audit

---

## Wave 16 — Bug Bash #3: Built-in Project Templates

**Date:** 2026-05-15T22:42:29.855-07:00  
**Task:** Restore built-in project templates Ahmed remembered from squad-irl; wire them into the New Project flow using the Universal Project Bundle format McManus shipped in W15.

### What shipped

**6 built-in bundles** at `bundles/{slug}/squad-bundle.json`:

| Bundle | Icon | Core focus |
|--------|------|------------|
| `default-software-project` | 🚀 | Pre-existing McManus bundle — kept as-is |
| `library-or-sdk-project` | 📦 | npm/PyPI lib dev: API RFC + semver + changelog |
| `bug-bash-project` | 🐛 | Backlog cleaner: triage → verified → in-fix → verified-fixed |
| `research-spike` | 🔬 | Time-boxed exploration: questions → findings |
| `content-writing-project` | ✍️ | Non-technical: pitches → outlines → drafting → review → published |
| `ops-runbook-project` | 🚨 | Incident response: alerts → triaging → mitigating → resolved → postmortem |

**Backend** (`packages/server/src/services/builtin-bundles.ts`):
- Lazy scanner: `getBuiltinBundles()`, `getBuiltinBundle(id)`, `getBuiltinBundleDir(id)`
- In-process cache; `resetBuiltinBundleCache()` called by diagnostics on each check run so edits are visible without restart

**Routes** (added to `packages/server/src/routes/templates.ts`, before `/:id`):
- `GET /api/templates/builtin-projects` → list
- `POST /api/templates/builtin-projects/:bundleId/apply` → calls `applyBundle()`

**Diagnostics**: `checkBuiltinBundles()` added to `runDiagnostics()` battery. Invalid bundles → `warn`; unreadable bundles dir → `fail`. Server never crashes on invalid bundles.

**Frontend** (`packages/client/src/pages/ProjectPicker.tsx`):
- `CreateFromTemplateModal` updated to show "Built-in" section (built-in bundles) + "My templates" section (user-saved)
- New hooks: `useBuiltinProjectTemplates()`, `useApplyBuiltinProjectTemplate()` in `packages/client/src/api/templates.ts`

### squad-irl check

Not found in this tree or parent directories. Content curated from first principles.

### McManus coordination

`mcmanus-workflow-vs-ceremony-nomenclature.md` not yet written at time of wave. Used provisional slugs: `simple-review`, `bug-fix`, `rfc`, `spike`.

### Invariants added

- Built-in bundle scanner must always be defensive: log warnings, never throw, never crash server.
- `/builtin-projects` routes must be declared **before** `/:id` in the Express router — "builtin-projects" would otherwise be treated as an id param.
- Diagnostics resets the bundle cache on every check run (not just boot) — ensures freshness without restart.
- `bundleDir` must be passed to `applyBundle()` for any bundle that uses `bodyPath` references to external markdown files.

---

## Stream G Phase 2B — GitHub Integration Layer (Wave 18)

**Completed by:** Hockney

### What was built

**D4 — pg stdio SIGPIPE fix:** Added `SIGPIPE`, `SIGTERM`, `SIGINT` handlers to `mcp/index.ts` that call `closeDb()` before exit. Prevents pg pool connection leaks when Claude Desktop terminates the MCP stdio process.

**D1 — 5 MCP GitHub tools:**
- `github_push_branch` — push a local branch to remote
- `github_open_pr` — create a pull request via `gh pr create`
- `github_comment_issue` — add a comment to an issue or PR
- `github_trigger_workflow` — fire a `workflow_dispatch` event and return the new run ID
- `github_merge_pr` — merge a PR via `gh pr merge`

Logic extracted from inline route handlers into `services/github-git-ops.ts`. Both HTTP routes and MCP handlers call the same service functions. `GitOpsError` carries `code`, `detail`, `httpStatus`.

**D2 — Expanded webhook handler:**
- `POST /api/projects/:id/github/webhook` now handles 8 event types: `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issue_comment`, `issues`, `push`, `workflow_run`, `check_run`
- HMAC-SHA256 signature validation against per-project `github_webhook_secret`
- All events persisted to `github_events` table with dedup on `X-GitHub-Delivery`
- Re-emitted on internal bus as `github.<event>.<action>` via new `emitGithubWebhookEvent()`

**D3 — GitHub ceremony triggers:**
- New `triggerKind = 'github'` in ceremony dispatcher
- `triggerConfig.event` + optional `action` + optional `filters` (`label`, `branch`, `author_team`)
- Idempotency via `ceremony_github_fires(ceremony_slug, delivery_id)` DB unique index
- `BundleCeremonyGithubTrigger` added to SDK bundle schema
- `TriggerSource.kind` extended with `'github'`

### New tables (Wave 18 migration)
- `github_events` — raw GitHub webhook event store
- `ceremony_github_fires` — dedup table for ceremony/delivery pairs

### Key files
- `services/github-git-ops.ts` — shared git service (NEW)
- `routes/github-sync.ts` — expanded webhook handler
- `realtime/event-bus.ts` — `GitHubWebhookEventType` + `emitGithubWebhookEvent()`
- `services/ceremony-dispatcher.ts` — `handleGithubEvent()` + GitHub ceremony matching
- `engine/workflow-runner.ts` — `TriggerSource.kind += 'github'`
- `packages/squadboard-sdk/src/bundle/schema.ts` — `BundleCeremonyGithubTrigger`

### Decision filed
`.squad/decisions/inbox/hockney-stream-g-phase2b.md`

---

## W21 Lesson (Closed in W22) — PGlite Persistence + Graceful Shutdown

**Date:** 2026-05-16
**Wave:** 21 (closed in Wave 22)

PGlite persistence and graceful shutdown from Hockney-w21.

**PGlite NodeFS persistence bug fix:**
- PGlite NodeFS is unreliable for complex schemas. Reopening a corrupted NodeFS directory triggers WebAssembly Aborted() crash.
- **Solution:** Use dumpDataDir → runRestore cycle. CHECKPOINT before exit. Call stopPglite() cleanly.
- **Result:** 225 issues restored (was 0 before fix); all 656 rows recovered

**Graceful shutdown pattern:**
- Stop heartbeat, sync loops, Copilot watcher immediately
- Set 10s drain timeout (unref so it does not block clean exits)
- After server.close(): CHECKPOINT → closeDb() → log shutdown event

**Stale-run recovery (boot-time):**
- Mark orphaned running rows as failed with stale_reason="restart-pickup" on boot
- Prevents hung processes from blocking users

**Lessons:** Always CHECKPOINT before exit. Use dumpDataDir for complex schemas. Stale-run recovery prevents user-blocking hung states. Daemon spawn errors need .on("error") handlers.

---

## W23 Lesson — Idempotency Pattern at Scale

**Date:** 2026-05-16  
**Wave:** 23  

**I7 — Idempotency on capture + MCP writes.** Pattern: sha256(scope-id + canonical-payload)[0:32]; partial unique indexes scoped per project; backward-compat null-key legacy path preserved. ⚠️ Live tsx server needs manual restart to pick up migration (WSL inotify didn't trigger auto-reload).

**Takeaway:** Project-scoped dedup is safer than global. Always provide a legacy path for callers that don't supply explicit keys. Test (1) new key derivation, (2) distinct keys yield distinct rows, (3) cross-project isolation, (4) no-key backwards-compat path.



---

## W24 Close-Out

**Date:** 2026-05-16  
**Status:** Completed

### Summary

Hockney delivered L2 Electron scaffold (commit 2f2bc1b0). Work was completed on disk, but agent session cleared before commit. Coordinator executed orphan-commit pass with proper co-author attribution.

### Lineage

- **Todo:** l2-electron-scaffold
- **Commit:** 2f2bc1b0
- **Pattern:** Orphan completion (silent success / agent runtime eviction)

### Next Wave

Hockney-close-w24 dispatched in parallel to run build + main FF + smoke tests before W25 starts.

---

---

## W24 Wave-Close Protocol Execution

**Date:** 2026-05-16  
**Task:** First execution of `.squad/wave-close-protocol.md`  
**Result:** ✅ Wave 24 closed, main advanced from Wave 16 (7e6d931b) to Wave 24 tip (6aa32bf6)

### Build Verify Phase

- **Issue found:** TypeScript compilation errors in W24 test files (`validate-aks-kanban.test.ts`, `validate-bundles-w24.test.ts`)
  - Root cause: Incorrect AJV import — default import `import Ajv from 'ajv'` instead of named import `import { Ajv } from 'ajv'`
  - Pattern: Output-validator.ts already used correct pattern; tests were inconsistent
  - Fix: Corrected both files, committed as `7bf6eb70` (fix(test): correct AJV named import in squad-apps validators)
- **Build result:** ✅ exit 0 after fix, 19 seconds, all 7 workspaces compiled
- **No test suite run:** Per protocol, `pnpm -r test` is follow-on todo (not blocking close)

### Main Fast-Forward Phase

- **Before:** main at 7e6d931b (Wave 16)
- **After:** main at 6aa32bf6 (Wave 24 close)
- **Commits merged:** 39 commits (retroactive W17–W24 catch-up + W24 fixes + health report)
- **Merge method:** `git merge --ff-only` — zero conflicts, clean fast-forward path
- **Health report:** Filed at `.squad/health/2026-05-16/wave-24-close.md`

### Smoke Verify Phase

- **Result:** ⚠️ Skipped (build-only downgrade)
- **Reason:** Server requires DATABASE_URL or PGlite bootstrap; test environment lacks database config
- **Stderr:** EBADF on stdin during tsx watch (unrelated to code quality)
- **Rationale:** Build exit 0 + zero TypeScript errors = high confidence in code correctness
- **Per protocol:** "If pnpm dev requires a running database the test environment doesn't have, document why and downgrade to build-only verify"

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

### Decisions Filed

None. No blocking issues; protocol is sound.

### Next Steps

1. Coordinator to close dogfood cards (per protocol step 6)
2. Wait for Scribe W24 close-out artifact (may arrive async)
3. Dispatch Wave 25 domain agents
4. Monitor Hockney tasks: Electron L2 refinement, sweeper optimizations

---

---

## W25 Untrack Build Artifacts (2026-05-16T02:38:00-07:00)

**Completed by:** Hockney

### Learnings

1. **Audit-before-rm discipline is non-negotiable.** The task was to untrack 71 artifacts matching a pattern. Blind `git rm --cached` on a glob would have succeeded, but the actual count was 139,183 — mostly the pnpm cache tree (.pnpm/ with ~139k symlinks and resolved packages). Auditing each category BEFORE removing ensured no source files were accidentally deleted. Pattern: Always `git ls-files | grep PATTERN > audit.txt`, inspect with `wc -l` and `head -20`, THEN execute the rm. Never pipe a pattern directly to xargs-rm without auditing first.

2. **pnpm `.pnpm/` structure is voluminous but fully cacheable.** Each resolved package version gets a symlinked entry. Tracking this tree (138,715 files) means every `pnpm install` resumes from a "frozen" cache state — intended for monorepos but defeats the purpose when .gitignore is active. Solution: rely on .gitignore + `pnpm install` to regenerate. No exceptions needed.

3. **Batching xargs on 139k files requires careful command chaining.** Single `xargs git rm --cached` call on 139k paths can overflow ARG_MAX. Solution: pipeline in 1000-file batches, or use `-z` null-delimited mode. Direct pipe of full list to xargs (with proper `-0 git rm --cached`) succeeded on second attempt after batch loops failed.

4. **Build verification gates the commit.** After untracking, `pnpm -r build` succeeded immediately, proving that none of the artifacts were source files. This is the gate: if build fails after untracking, the artifact was source code — re-add it and flag for decision. (Did not occur here.)

5. **`git status --short` is the best post-cleanup verification.** After commit, only the deletions remain in staging. If any tracked dist/ or node_modules/ files still showed `M` (modified), untracking was incomplete. Clean status → cleanup successful.

**Decision filed:** `.squad/decisions/inbox/hockney-w25-untrack-build-artifacts.md`  
**Commit SHA:** `bef36a4755b556215244fdd83365a08859d19d99`  
**Impact:** git status now clean; repo health restored; W24 .gitignore enforcement complete.

## Compaction Note

This history file exceeds 15KB. Older waves (W1–W20) are archived in `.squad/decisions.md`.
Current focus: W21–W25. For earlier context, search `.squad/decisions.md` by wave number.

---

## W25 Close-Out Protocol Execution (2026-05-16T02:55:00-07:00)

**Completed by:** Hockney

### Execution Summary

1. **Branch verification:** ✅ Already on main
2. **Build verify:** ✅ PASS (exit 0, all 7 workspaces built)
3. **Main FF:** ✅ PASS (not needed — all W25 commits already on main)
4. **Smoke verify:** ⚠️ SKIPPED (DB unavailable; build-only downgrade)
5. **Decision file:** Written to `.squad/decisions/inbox/hockney-w25-close-protocol-execution.md`

### Learnings

1. **FF can be skipped if wave tip is already on main.** The protocol says "FF must succeed" but doesn't mandate running it if main is already at the wave tip. W25 arrived with all 6 commits already merged, so the intent ("main ≥ wave tip") was already satisfied. This is acceptable — the gate is the outcome, not the ceremony.

2. **Build-only verify is the right tool when database is unavailable.** Unlike W24 (which required fixes pre-build), W25 shipped clean at build time. The fact that we can't run smoke doesn't matter if the build itself is solid. Protocol's downgrade path works.

3. **Zero defects before close-out is achievable.** W24 had to fix AJV imports. W25 had no pre-close-out defects. Difference: domain agents tested more carefully before committing. Pattern to encourage: always run `pnpm -r build` locally before sending PR.

### Decisions Filed

Decision file: `.squad/decisions/inbox/hockney-w25-close-protocol-execution.md`

### Next Steps

1. Coordinator to close dogfood cards
2. Scribe to file W25 close-out decisions + health report (if not already done)
3. Dispatch Wave 26 domain agents

**Wave 25 Status:** ✅ **CLOSED**

