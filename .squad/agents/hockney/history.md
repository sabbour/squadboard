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
