/**
 * packages/server/src/routes/system.ts
 *
 * System management API:
 *   POST /api/system/backup    — trigger a manual backup now, return path + metadata
 *   GET  /api/system/backups   — list backups in ~/.squadboard/backups/
 *   GET  /api/system/db-counts — live row counts for all tables (used by verify CLI)
 *
 * Used by the Settings page "Back up now" button.
 */

import { Router } from 'express';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { runBackup } from '../scripts/backup.js';
import { getPool } from '../db/index.js';

const router = Router();
const BACKUP_DIR = join(homedir(), '.squadboard', 'backups');

/**
 * POST /api/system/backup
 * Triggers a manual backup of the live PGlite cluster.
 * Returns { ok, path, sizeBytes, durationMs, pruned }.
 */
router.post('/backup', async (_req, res) => {
  try {
    const result = await runBackup({ quiet: true });
    res.json({
      ok: true,
      path: result.path,
      sizeBytes: result.sizeBytes,
      sizeMB: parseFloat((result.sizeBytes / 1024 / 1024).toFixed(2)),
      durationMs: result.durationMs,
      pruned: result.pruned,
    });
  } catch (err: unknown) {
    console.error('[system] backup error:', err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/**
 * GET /api/system/backups
 * Lists available backup files in ~/.squadboard/backups/.
 */
router.get('/backups', (_req, res) => {
  if (!existsSync(BACKUP_DIR)) {
    return res.json({ ok: true, backups: [] });
  }

  try {
    const backups = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('squadboard-') && (f.endsWith('.tar.gz') || f.endsWith('.tar')))
      .map((f) => {
        const p = join(BACKUP_DIR, f);
        const stat = statSync(p);
        return {
          filename: f,
          path: p,
          sizeBytes: stat.size,
          sizeMB: parseFloat((stat.size / 1024 / 1024).toFixed(2)),
          createdAt: new Date(stat.mtimeMs).toISOString(),
        };
      })
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)); // newest first

    res.json({ ok: true, backups });
  } catch (err: unknown) {
    console.error('[system] list backups error:', err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

/**
 * GET /api/system/db-counts
 * Returns live row counts for all public tables. Used by the verify CLI
 * to avoid opening a second PGlite instance while the server is running.
 */
router.get('/db-counts', async (_req, res) => {
  try {
    const pool = getPool();
    const tablesRes = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    const counts: Record<string, number> = {};
    for (const row of tablesRes.rows) {
      const tbl = row['tablename'];
      const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM "${tbl}"`);
      counts[tbl] = parseInt(String(countRes.rows[0]?.['cnt'] ?? '0'), 10);
    }

    res.json({ ok: true, counts });
  } catch (err: unknown) {
    console.error('[system] db-counts error:', err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

export default router;
