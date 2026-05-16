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
    }
    catch (err) {
        console.error('[system] backup error:', err);
        res.status(500).json({ ok: false, error: err.message });
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
    }
    catch (err) {
        console.error('[system] list backups error:', err);
        res.status(500).json({ ok: false, error: err.message });
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
        const tablesRes = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
        const counts = {};
        for (const row of tablesRes.rows) {
            const tbl = row['tablename'];
            const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM "${tbl}"`);
            counts[tbl] = parseInt(String(countRes.rows[0]?.['cnt'] ?? '0'), 10);
        }
        res.json({ ok: true, counts });
    }
    catch (err) {
        console.error('[system] db-counts error:', err);
        res.status(500).json({ ok: false, error: err.message });
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
    const { backupPath } = req.body;
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
    }
    catch (err) {
        console.error('[system] restore error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});
// ── GitHub integration ────────────────────────────────────────────────────────
/** Parse `gh auth status --hostname github.com` output into structured data. */
function parseGhAuthStatus(raw) {
    const authenticated = /Logged in to github\.com/i.test(raw);
    const usernameMatch = raw.match(/account\s+(\S+)/i);
    const protocolMatch = raw.match(/Git operations protocol:\s*(\S+)/i);
    const scopesMatch = raw.match(/Token scopes:\s*'([^']+(?:',\s*'[^']+)*)'/i);
    const scopes = scopesMatch
        ? scopesMatch[1].split(/[',\s]+/).filter(Boolean)
        : [];
    return {
        authenticated,
        username: usernameMatch?.[1] ?? null,
        protocol: protocolMatch?.[1] ?? null,
        scopes,
    };
}
/** Required scope matrix for each Squad action. */
const ACTION_SCOPES = [
    { action: 'Push branch', scope: 'repo' },
    { action: 'Create PR', scope: 'repo' },
    { action: 'Comment issue', scope: 'repo' },
    { action: 'Merge PR', scope: 'repo' },
    { action: 'Trigger workflow', scope: 'workflow' },
    { action: 'Manage webhooks', scope: 'admin:repo_hook' },
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
    }
    catch {
        return res.json({ ok: true, installed: false });
    }
    if (!ghInstalled)
        return res.json({ ok: true, installed: false });
    let raw = '';
    let authenticated = false;
    try {
        const { stdout, stderr } = await execFileAsync('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 8000 });
        raw = stdout + stderr;
        authenticated = true;
    }
    catch (err) {
        // gh auth status exits non-zero when not authenticated
        const execErr = err;
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
    const { test } = req.body;
    if (!['push', 'pr', 'workflow'].includes(test ?? '')) {
        return res.status(400).json({ ok: false, error: 'test must be push | pr | workflow' });
    }
    // Check gh is installed
    try {
        await execFileAsync('gh', ['--version'], { timeout: 5000 });
    }
    catch {
        return res.json({ ok: false, error: 'gh CLI not installed' });
    }
    try {
        if (test === 'push') {
            // Validate auth status — a successful auth status implies push capability
            const { stdout, stderr } = await execFileAsync('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 8000 }).catch((e) => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
            const out = stdout + stderr;
            const ok = /Logged in/i.test(out);
            return res.json({ ok, message: ok ? 'Authenticated — push capability confirmed.' : 'Not authenticated.' });
        }
        if (test === 'pr') {
            // List open PRs (read-only probe) against the current repo if available
            const { stdout } = await execFileAsync('gh', ['pr', 'list', '--limit', '1', '--json', 'number'], { timeout: 10000 }).catch(() => ({ stdout: '[]' }));
            const prs = JSON.parse(stdout || '[]');
            return res.json({ ok: true, message: `PR API reachable. ${prs.length} open PR(s) visible.` });
        }
        if (test === 'workflow') {
            // List workflow runs (read-only probe)
            const { stdout } = await execFileAsync('gh', ['run', 'list', '--limit', '1', '--json', 'databaseId'], { timeout: 10000 }).catch(() => ({ stdout: '[]' }));
            const runs = JSON.parse(stdout || '[]');
            return res.json({ ok: true, message: `Workflow API reachable. ${runs.length} run(s) visible.` });
        }
    }
    catch (err) {
        return res.json({ ok: false, error: err.message });
    }
});
/**
 * POST /api/system/dedupe
 * Finds and soft-deletes duplicate issue cards (same title or githubNodeId
 * per project). Used by the `squadboard cards dedupe` CLI.
 *
 * Body: { dryRun?: boolean, projectId?: string }
 * Returns: { ok, dryRun, projects, groups }
 */
router.post('/dedupe', async (req, res) => {
    const { dryRun = false, projectId } = req.body;
    try {
        const pool = getPool();
        const now = new Date().toISOString();
        // ── Detect by githubNodeId ────────────────────────────────────────────
        const nodeRows = await pool.query(`SELECT project_id,
              github_node_id AS key_value,
              string_agg(id::text, ',' ORDER BY created_at ASC, id ASC) AS ids,
              string_agg(title, '||' ORDER BY created_at ASC, id ASC) AS titles,
              string_agg(created_at::text, ',' ORDER BY created_at ASC, id ASC) AS created_ats
       FROM issues
       WHERE archived = 0
         AND github_node_id IS NOT NULL AND github_node_id <> ''
         ${projectId ? `AND project_id = $1` : ''}
       GROUP BY project_id, github_node_id HAVING COUNT(*) > 1`, projectId ? [projectId] : []);
        const groups = [];
        const alreadyArchiving = new Set();
        for (const row of nodeRows.rows) {
            const ids = row.ids.split(',');
            const titles = row.titles.split('||');
            groups.push({ projectId: row.project_id, keepId: ids[0], keepTitle: titles[0] ?? '', archiveIds: ids.slice(1), detectionKey: 'githubNodeId', keyValue: row.key_value });
            ids.slice(1).forEach((id) => alreadyArchiving.add(id));
        }
        // ── Detect by title ───────────────────────────────────────────────────
        const titleRows = await pool.query(`SELECT project_id, title AS key_value,
              string_agg(id::text, ',' ORDER BY created_at ASC, id ASC) AS ids,
              string_agg(title, '||' ORDER BY created_at ASC, id ASC) AS titles,
              string_agg(created_at::text, ',' ORDER BY created_at ASC, id ASC) AS created_ats
       FROM issues
       WHERE archived = 0
         ${projectId ? `AND project_id = $1` : ''}
       GROUP BY project_id, title HAVING COUNT(*) > 1`, projectId ? [projectId] : []);
        for (const row of titleRows.rows) {
            const ids = row.ids.split(',');
            const remaining = ids.filter((id) => !alreadyArchiving.has(id));
            if (remaining.length <= 1)
                continue;
            groups.push({ projectId: row.project_id, keepId: remaining[0], keepTitle: row.key_value, archiveIds: remaining.slice(1), detectionKey: 'title', keyValue: row.key_value });
            remaining.slice(1).forEach((id) => alreadyArchiving.add(id));
        }
        // ── Build report ──────────────────────────────────────────────────────
        const projects = {};
        for (const g of groups) {
            if (!projects[g.projectId])
                projects[g.projectId] = { kept: 0, archived: 0 };
            projects[g.projectId].kept += 1;
            projects[g.projectId].archived += g.archiveIds.length;
        }
        // ── Execute (unless dry-run) ──────────────────────────────────────────
        if (!dryRun) {
            for (const g of groups) {
                if (g.archiveIds.length === 0)
                    continue;
                const idPlaceholders = g.archiveIds.map((_, i) => `$${i + 3}`).join(', ');
                await pool.query(`UPDATE issues SET archived=1, archived_at=$1::timestamptz, archived_reason=$2, updated_at=$1::timestamptz WHERE id IN (${idPlaceholders})`, [now, 'dedupe:bulk-port-vs-seed-backlog', ...g.archiveIds]);
            }
        }
        res.json({ ok: true, dryRun, projects, groups });
    }
    catch (err) {
        console.error('[system] dedupe error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});
export default router;
//# sourceMappingURL=system.js.map