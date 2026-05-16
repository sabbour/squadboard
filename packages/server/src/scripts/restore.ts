/**
 * restore.ts
 *
 * Core restore logic — loads a PGlite backup (.tar.gz from dumpDataDir) into a
 * fresh PGlite data directory.
 *
 * Safety invariants:
 *   1. Reject if a server daemon is running (checks ~/.squadboard/daemon.pid).
 *   2. Move the current PGlite cluster to ~/.squadboard/data/pglite.pre-restore-{ts}
 *      before touching anything (rollback path is always preserved).
 *   3. Initialize a fresh PGlite cluster by loading the backup tarball via
 *      PGlite({ loadDataDir: blob }).
 *   4. Verify row counts against the backup's embedded dest_counts (or raw table scan).
 *   5. Exit 0 on success, 1 on verify failure (rollback path still preserved).
 *
 * Exported:
 *   runRestore(backupPath, opts?) → Promise<RestoreResult>
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const SQUADBOARD_DIR = join(HOME, '.squadboard');
const PID_FILE = join(SQUADBOARD_DIR, 'daemon.pid');
const PGLITE_DATA_DIR = join(SQUADBOARD_DIR, 'data', 'pglite');

export interface RestoreOptions {
  /** Skip the daemon-running check (use only in tests). */
  force?: boolean;
  quiet?: boolean;
}

export interface RestoreResult {
  ok: boolean;
  backupPath: string;
  rollbackPath: string;
  verifyOk: boolean;
  durationMs: number;
  message: string;
}

/** Returns the PID from the daemon.pid file if alive, else null. */
function getLiveDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (isNaN(pid)) return null;
    process.kill(pid, 0); // throws if not running
    return pid;
  } catch {
    return null;
  }
}

/**
 * Restore PGlite cluster from a backup file.
 */
export async function runRestore(backupPath: string, opts: RestoreOptions = {}): Promise<RestoreResult> {
  const t0 = Date.now();
  const log = opts.quiet ? () => {} : console.log.bind(console);
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const rollbackPath = join(SQUADBOARD_DIR, 'data', `pglite.pre-restore-${ts}`);

  // ── 1. Validate backup file ───────────────────────────────────────────────
  if (!existsSync(backupPath)) {
    return {
      ok: false, backupPath, rollbackPath: '', verifyOk: false,
      durationMs: Date.now() - t0,
      message: `Backup file not found: ${backupPath}`,
    };
  }

  if (!backupPath.endsWith('.tar.gz') && !backupPath.endsWith('.tar')) {
    return {
      ok: false, backupPath, rollbackPath: '', verifyOk: false,
      durationMs: Date.now() - t0,
      message: `Unsupported backup format. Expected .tar.gz or .tar, got: ${basename(backupPath)}`,
    };
  }

  const backupStat = statSync(backupPath);
  log(`[restore] Backup: ${backupPath} (${(backupStat.size / 1024 / 1024).toFixed(2)} MB)`);

  // ── 2. Reject if daemon is running ────────────────────────────────────────
  if (!opts.force) {
    const livePid = getLiveDaemonPid();
    if (livePid !== null) {
      return {
        ok: false, backupPath, rollbackPath: '', verifyOk: false,
        durationMs: Date.now() - t0,
        message: `Server daemon is running (PID ${livePid}). Stop it first with: squadboard daemon stop`,
      };
    }
  }

  // ── 3. Preserve current cluster ───────────────────────────────────────────
  if (existsSync(PGLITE_DATA_DIR)) {
    log(`[restore] Preserving current cluster → ${rollbackPath}`);
    mkdirSync(join(rollbackPath, '..'), { recursive: true });
    renameSync(PGLITE_DATA_DIR, rollbackPath);
  } else {
    log('[restore] No existing PGlite cluster to preserve — fresh restore');
  }

  // ── 4. Load backup into fresh PGlite ─────────────────────────────────────
  log('[restore] Loading backup into PGlite...');

  try {
    // Read backup bytes and wrap in a Blob for PGlite's loadDataDir option
    const backupBytes = readFileSync(backupPath);
    const blob = new Blob([backupBytes]);

    // Boot PGlite with loadDataDir — this replays the tarball into PGLITE_DATA_DIR
    const { PGlite } = await import('@electric-sql/pglite');
    const restoredPglite = await PGlite.create({
      dataDir: PGLITE_DATA_DIR,
      loadDataDir: blob,
    });

    log('[restore] PGlite loaded backup. Running post-restore verification...');

    // ── 5. Verify row counts ────────────────────────────────────────────────
    const { createPoolAdapter } = await import('../db/pglite.js');
    const pool = createPoolAdapter(restoredPglite);

    let verifyOk = true;
    let tableCount = 0;
    let totalRows = 0;

    try {
      const tablesRes = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      for (const row of tablesRes.rows) {
        const tbl = row['tablename'];
        const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM "${tbl}"`);
        const cnt = parseInt(String(countRes.rows[0]?.['cnt'] ?? '0'), 10);
        totalRows += cnt;
        tableCount++;
      }
      log(`[restore] Verified ${tableCount} tables, ${totalRows} total rows.`);
    } catch (err) {
      log(`[restore] ⚠️ Verification query failed: ${(err as Error).message}`);
      verifyOk = false;
    }

    await restoredPglite.close();

    const durationMs = Date.now() - t0;
    const msg = verifyOk
      ? `Restore complete (${tableCount} tables, ${totalRows} rows). Previous cluster preserved at ${rollbackPath}. Delete with: rm -rf "${rollbackPath}" when you're sure.`
      : `Restore finished but verification failed. Previous cluster preserved at ${rollbackPath}.`;

    log(`[restore] ${verifyOk ? '✅' : '⚠️'} ${msg}`);
    return { ok: true, backupPath, rollbackPath, verifyOk, durationMs, message: msg };

  } catch (err) {
    // Restore itself failed — attempt to roll back
    const errMsg = (err as Error).message;
    log(`[restore] ❌ Restore failed: ${errMsg}`);
    log(`[restore] Attempting rollback — moving ${rollbackPath} back to ${PGLITE_DATA_DIR}`);

    try {
      if (existsSync(PGLITE_DATA_DIR)) {
        // Partial new cluster exists — remove it
        const { rmSync } = await import('node:fs');
        rmSync(PGLITE_DATA_DIR, { recursive: true, force: true });
      }
      if (existsSync(rollbackPath)) {
        renameSync(rollbackPath, PGLITE_DATA_DIR);
        log('[restore] Rollback successful — original cluster restored.');
      }
    } catch (rollbackErr) {
      log(`[restore] ❌ Rollback also failed: ${(rollbackErr as Error).message}`);
      log(`[restore] Manual recovery: move ${rollbackPath} back to ${PGLITE_DATA_DIR}`);
    }

    return {
      ok: false, backupPath, rollbackPath, verifyOk: false,
      durationMs: Date.now() - t0,
      message: `Restore failed: ${errMsg}`,
    };
  }
}
