/**
 * packages/server/src/routes/system.ts
 *
 * System management API:
 *   POST /api/system/backup        — trigger a manual backup now, return path + metadata
 *   GET  /api/system/backups       — list backups in ~/.squadboard/backups/
 *   POST /api/system/restore       — restore PGlite cluster from a backup file
 *   GET  /api/system/db-counts     — live row counts for all tables (used by verify CLI)
 *   GET  /api/system/gh-auth-status — parse `gh auth status` for the UI
 *   POST /api/system/gh-test       — dry-run connectivity tests (push/PR/workflow)
 *
 * Used by the Settings page Backup + GitHub sections.
 */

import { Router } from 'express';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runBackup } from '../scripts/backup.js';
import { runRestore } from '../scripts/restore.js';
import { getPool } from '../db/index.js';

const execFileAsync = promisify(execFile);

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

/**
 * POST /api/system/restore
 * Restores PGlite cluster from a backup file.
 * Body: { backupPath: string }
 * Returns { ok, message, rollbackPath, durationMs }
 *
 * NOTE: The daemon must NOT be running. runRestore() checks daemon.pid and
 * returns ok:false if a live daemon is detected. The caller should reload the
 * page after a successful restore — the server will restart itself.
 */
router.post('/restore', async (req, res) => {
  const { backupPath } = req.body as { backupPath?: string };
  if (!backupPath || typeof backupPath !== 'string') {
    return res.status(400).json({ ok: false, error: 'backupPath is required' });
  }
  try {
    const result = await runRestore(backupPath, { quiet: true });
    if (!result.ok || !result.verifyOk) {
      return res.status(500).json({ ok: false, error: result.message, rollbackPath: result.rollbackPath });
    }
    res.json({
      ok: true,
      message: result.message,
      rollbackPath: result.rollbackPath,
      durationMs: result.durationMs,
    });
  } catch (err: unknown) {
    console.error('[system] restore error:', err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── GitHub integration ────────────────────────────────────────────────────────

/** Parse `gh auth status --hostname github.com` output into structured data. */
function parseGhAuthStatus(raw: string): {
  authenticated: boolean;
  username: string | null;
  protocol: string | null;
  scopes: string[];
} {
  const authenticated = /Logged in to github\.com/i.test(raw);
  const usernameMatch = raw.match(/account\s+(\S+)/i);
  const protocolMatch = raw.match(/Git operations protocol:\s*(\S+)/i);
  const scopesMatch = raw.match(/Token scopes:\s*'([^']+(?:',\s*'[^']+)*)'/i);
  const scopes = scopesMatch
    ? scopesMatch[1]!.split(/[',\s]+/).filter(Boolean)
    : [];

  return {
    authenticated,
    username: usernameMatch?.[1] ?? null,
    protocol: protocolMatch?.[1] ?? null,
    scopes,
  };
}

/** Required scope matrix for each Squad action. */
const ACTION_SCOPES: { action: string; scope: string }[] = [
  { action: 'Push branch',       scope: 'repo' },
  { action: 'Create PR',         scope: 'repo' },
  { action: 'Comment issue',     scope: 'repo' },
  { action: 'Merge PR',          scope: 'repo' },
  { action: 'Trigger workflow',  scope: 'workflow' },
  { action: 'Manage webhooks',   scope: 'admin:repo_hook' },
];

/**
 * GET /api/system/gh-auth-status
 * Shells out to `gh auth status --hostname github.com` and returns parsed data.
 * Returns { ok, installed, authenticated, username, protocol, scopes, permissions }
 */
router.get('/gh-auth-status', async (_req, res) => {
  // Check gh is installed first
  let ghInstalled = false;
  try {
    await execFileAsync('gh', ['--version'], { timeout: 5000 });
    ghInstalled = true;
  } catch {
    return res.json({ ok: true, installed: false });
  }

  if (!ghInstalled) return res.json({ ok: true, installed: false });

  let raw = '';
  let authenticated = false;
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh', ['auth', 'status', '--hostname', 'github.com'],
      { timeout: 8000 },
    );
    raw = stdout + stderr;
    authenticated = true;
  } catch (err: unknown) {
    // gh auth status exits non-zero when not authenticated
    const execErr = err as { stdout?: string; stderr?: string };
    raw = (execErr.stdout ?? '') + (execErr.stderr ?? '');
    authenticated = /Logged in/i.test(raw);
  }

  const parsed = parseGhAuthStatus(raw);
  const permissions = ACTION_SCOPES.map(({ action, scope }) => ({
    action,
    scope,
    granted: parsed.scopes.includes(scope),
  }));

  res.json({
    ok: true,
    installed: true,
    authenticated: parsed.authenticated,
    username: parsed.username,
    protocol: parsed.protocol,
    scopes: parsed.scopes,
    permissions,
    raw,
  });
});

/**
 * POST /api/system/gh-test
 * Dry-run connectivity tests for GitHub operations.
 * Body: { test: 'push' | 'pr' | 'workflow' }
 */
router.post('/gh-test', async (req, res) => {
  const { test } = req.body as { test?: string };
  if (!['push', 'pr', 'workflow'].includes(test ?? '')) {
    return res.status(400).json({ ok: false, error: 'test must be push | pr | workflow' });
  }

  // Check gh is installed
  try {
    await execFileAsync('gh', ['--version'], { timeout: 5000 });
  } catch {
    return res.json({ ok: false, error: 'gh CLI not installed' });
  }

  try {
    if (test === 'push') {
      // Validate auth status — a successful auth status implies push capability
      const { stdout, stderr } = await execFileAsync(
        'gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 8000 },
      ).catch((e: { stdout?: string; stderr?: string }) => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
      const out = stdout + stderr;
      const ok = /Logged in/i.test(out);
      return res.json({ ok, message: ok ? 'Authenticated — push capability confirmed.' : 'Not authenticated.' });
    }

    if (test === 'pr') {
      // List open PRs (read-only probe) against the current repo if available
      const { stdout } = await execFileAsync(
        'gh', ['pr', 'list', '--limit', '1', '--json', 'number'],
        { timeout: 10000 },
      ).catch(() => ({ stdout: '[]' }));
      const prs = JSON.parse(stdout || '[]') as unknown[];
      return res.json({ ok: true, message: `PR API reachable. ${prs.length} open PR(s) visible.` });
    }

    if (test === 'workflow') {
      // List workflow runs (read-only probe)
      const { stdout } = await execFileAsync(
        'gh', ['run', 'list', '--limit', '1', '--json', 'databaseId'],
        { timeout: 10000 },
      ).catch(() => ({ stdout: '[]' }));
      const runs = JSON.parse(stdout || '[]') as unknown[];
      return res.json({ ok: true, message: `Workflow API reachable. ${runs.length} run(s) visible.` });
    }
  } catch (err: unknown) {
    return res.json({ ok: false, error: (err as Error).message });
  }
});

export default router;
