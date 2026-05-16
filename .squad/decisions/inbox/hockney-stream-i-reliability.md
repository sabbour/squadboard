# Hockney — Stream I (Reliability) Decision Record
**Date:** 2026-05-15T22:42:29.855-07:00  
**Wave:** 15  
**Author:** Hockney (Backend / Workflow Engine Dev)

---

## Deliverable 1 — W14 Migration Verification

### Verification Outcome

Migration verified **clean** on first run (before any server kills this session):
- All 39 tables: `actual >= expected`  
- Marker stamped with `dest_counts` block for self-contained audit trail

### Verification Architecture

**New surface:** `squadboard migrate --verify` (flag on existing CLI; calls `runVerify()` from `scripts/verify-migration.ts`).

**Key design choice — dual mode:**  
When the squadboard server is detected alive at `http://localhost:3000`, verify fetches counts via `GET /api/system/db-counts` (new endpoint) instead of booting a second PGlite WASM instance. This avoids the two-PGlite problem: two processes opening the same PGlite nodefs data directory produce inconsistent reads and potential WAL corruption.

When the server is NOT running, PGlite is booted directly.

**Marker upgrade:** `~/.squadboard/data/.migrated-to-pglite-v1` now includes a `dest_counts` block:
```json
{
  "row_counts": { ... },  // source: from legacy embedded-PG at migration time
  "dest_counts": {
    "verified_at": "2026-05-16T...",
    "counts": { ... },    // dest: live PGlite counts at verify time
    "all_ok": true
  }
}
```

### Session Data Loss (not a migration bug)

During W15 development, the running server was killed with `kill <PID>` (SIGKILL equivalent). PGlite's WASM runtime did not complete a clean checkpoint before exit. On next startup, the data directory was in a partially-committed WAL state, resulting in most rows being invisible.

**Root cause:** PGlite relies on SIGTERM/SIGINT → graceful close for durability. Hard kills bypass the checkpoint. The process.on('SIGINT'/'SIGTERM') handlers in the server call `closeDb()` which must be the only shutdown path.

**Mitigation going forward:** The restore flow (Deliverable 3) always preserves a pre-restore rollback copy, so a future accidental kill can be recovered from the last backup.

---

## Deliverable 2 — Periodic DB Backup + Retention

### Format Chosen: PGlite Native dumpDataDir (Format A)

`PGlite.dumpDataDir('gzip')` — returns a `Blob` containing a gzipped tar of the entire PGDATA directory. Written as `.tar.gz`. Backed by PGlite's internal checkpoint + WASM FS tar routine.

**Why not raw filesystem tar (Format B):**
- dumpDataDir is atomic: PGlite checkpoints before tarring, so the result is always a consistent snapshot even under concurrent queries.
- Raw filesystem tar of an in-flight WASM nodefs directory would capture partial page writes.

**Default output:** `~/.squadboard/backups/squadboard-{ISO8601}.tar.gz`  
**Average size:** ~5 MB for a fresh cluster with 39 tables.

### Files Shipped

| File | Purpose |
|------|---------|
| `packages/server/src/scripts/backup.ts` | Core: `runBackup()`, `pruneBackups()` |
| `packages/server/src/cli/backup.ts` | CLI: `squadboard backup [--out PATH] [--retain N]` |
| `packages/server/src/routes/system.ts` | Routes: `POST /api/system/backup`, `GET /api/system/backups`, `GET /api/system/db-counts` |

### Backup CLI — Server-Aware Dispatch

Same dual-mode pattern as verify:
- **Server running:** `POST /api/system/backup` via HTTP → in-process PGlite → safe
- **Server not running:** `runBackup()` directly → boots PGlite standalone

### Scheduled Backup (Daemon)

Added to `packages/server/src/daemon/index.ts`:
- `maybeRunBackup(tickAt)` — checks if `tickAt >= nextBackupAt`; if so, calls `runBackup()` in the daemon process (which runs inside the server process, so PGlite is already live)
- `nextBackupAt` advances by `intervalMs` after each backup (even on error, to avoid retry-spam)
- Daemon status (`getDaemonStatus()`) now exposes `backup.lastBackupAt` and `backup.nextBackupAt`

### Retention Defaults

| Parameter | Default | Override |
|-----------|---------|---------|
| `retainCount` | 7 (one week of dailies) | `~/.squadboard/config.json { "backup": { "retainCount": N } }` |
| `intervalMs` | 86400000 (24h) | `~/.squadboard/config.json { "backup": { "intervalMs": Ms } }` |

After each backup, `pruneBackups()` sorts by mtime descending and deletes all beyond retainCount.

---

## Deliverable 3 — Restore Flow

### Restore CLI

`squadboard restore <backup-file>` — implemented in `packages/server/src/cli/restore.ts` + `packages/server/src/scripts/restore.ts`.

### Safety Invariants (in execution order)

1. **File existence + format check** — reject immediately if path missing or not `.tar.gz`/`.tar`
2. **Daemon PID check** — read `~/.squadboard/daemon.pid`; reject if live process found (skip with `--force` in tests)
3. **Pre-restore preservation** — `mv ~/.squadboard/data/pglite → ~/.squadboard/data/pglite.pre-restore-{ts}`; this is the rollback copy
4. **Load backup into fresh cluster** — `new PGlite({ dataDir: PGLITE_DATA_DIR, loadDataDir: blob })`
5. **Verify** — count all tables via direct pool query against restored PGlite (no `initDb()` — uses `createPoolAdapter()` directly to avoid the singleton problem)
6. **Rollback on failure** — if load or verify fails, attempt `mv pre-restore → pglite` to recover original cluster

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Restore + verify pass |
| 1 | Load error (rollback attempted) or verify failure |

### Restore UI (deferred)

TODO (Keyser, W16): Settings page "Restore from backup" — call `GET /api/system/backups` to list, display table with "Restore" buttons, confirm modal, call `POST /api/system/restore` (not yet implemented — requires daemon stop guard on the server side). The CLI is the production-grade path for W15.

---

## Open Questions

### Encryption at Rest
PGlite backup files are plaintext `.tar.gz`. They may contain API keys (stored in agents table), GitHub tokens, etc. Options:
- **Age encryption:** `age -r <pubkey> < backup.tar.gz > backup.tar.gz.age` — simple, no deps
- **PGlite native:** no encryption support in 0.4.5
- **Priority:** HIGH — should land in W16 before backup files proliferate

### Cross-Machine Restore (Different PGlite Versions)
`loadDataDir` replays a PGlite WASM filesystem tarball. PGlite's PGDATA is tied to the internal Postgres version compiled into the WASM bundle. Restoring a `@electric-sql/pglite@0.4.5` backup to `@0.5.x` may fail if the on-disk format changed. **Mitigation:** embed PGlite version in backup filename or a metadata sidecar file (`.meta.json` alongside the `.tar.gz`). Track this as a breaking change risk on PGlite upgrades.

### Cloud Sync
No cloud sync in W15. Backups live only in `~/.squadboard/backups/`. Options for W16+:
- S3/Cloudflare R2 upload after each backup (add to `runBackup`)
- A `squadboard backup --upload` flag
- Stream-L (Electron) packaging with cloud sync as a premium tier

### Graceful Shutdown Discipline
After the W15 WAL corruption experience: add a health check that validates PGlite's `postmaster.pid` is absent before server start. If present, PGlite was killed hard and WAL replay may be incomplete. Log a warning + consider triggering a restore from latest backup automatically.
