#!/usr/bin/env node
/**
 * packages/server/src/cli/dedupe-cards.ts
 *
 * Deduplicates issue cards on Squadboard project boards where the same
 * logical card was seeded twice (e.g. by `a5-seed-backlog` AND `bulk-port`).
 *
 * Duplicate detection key (in priority order):
 *   1. githubNodeId — non-null GitHub node IDs that appear > once per project.
 *   2. title — identical titles within the same project (catches bulk-import
 *      titles of the form `[idempotencyKey] Original Title`).
 *
 * For each duplicate group:
 *   - KEEP the row with the lowest created_at (oldest survivor).
 *   - Soft-delete the rest: archived=1, archived_at=NOW(), archived_reason='dedupe:bulk-port-vs-seed-backlog'.
 *
 * When the server is running at localhost:3000, delegates to POST /api/system/dedupe
 * (same pattern as backup.ts) to avoid a second PGlite connection.
 *
 * Flags:
 *   --dry-run              Print the plan as JSON without writing.
 *   --project-id <id>      Scope to a single project UUID or slug.
 *   --yes                  Skip confirmation prompt.
 *
 * Exit 0 on success, 1 on error.
 */
import http from 'node:http';
import { startPglite } from '../db/pglite.js';
import { initDb, getPool } from '../db/index.js';
import { createInterface } from 'node:readline/promises';
const SERVER_BASE = 'http://localhost:3000';
function parseArgs(argv) {
    const args = argv.slice(2);
    let dryRun = false;
    let projectId = null;
    let yes = false;
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--dry-run':
                dryRun = true;
                break;
            case '--project-id':
                projectId = args[++i];
                break;
            case '--yes':
                yes = true;
                break;
            default:
                if (args[i] && !args[i].startsWith('-'))
                    break;
                if (args[i]) {
                    console.error(`Unknown flag: ${args[i]}`);
                    process.exit(1);
                }
        }
    }
    return { dryRun, projectId, yes };
}
// ---------------------------------------------------------------------------
// Server detection (same pattern as backup.ts)
// ---------------------------------------------------------------------------
async function isServerRunning() {
    return new Promise((resolve) => {
        const req = http.get(`${SERVER_BASE}/api/health`, { timeout: 1500 }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}
// ---------------------------------------------------------------------------
// HTTP path (server is running)
// ---------------------------------------------------------------------------
async function dedupeViaHttp(opts) {
    const body = JSON.stringify({ dryRun: opts.dryRun, projectId: opts.projectId ?? undefined });
    return new Promise((resolve, reject) => {
        const req = http.request(`${SERVER_BASE}/api/system/dedupe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (!parsed.ok)
                        reject(new Error(`Server dedupe failed: ${data}`));
                    else
                        resolve(parsed);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
// ---------------------------------------------------------------------------
// Direct PGlite path (server is NOT running)
// ---------------------------------------------------------------------------
async function findDuplicates(projectId) {
    const pool = getPool();
    const nodeIdRows = await pool.query(`SELECT project_id, github_node_id AS key_value,
            string_agg(id::text, ',' ORDER BY created_at ASC, id ASC) AS ids,
            string_agg(title, '||' ORDER BY created_at ASC, id ASC) AS titles,
            string_agg(created_at::text, ',' ORDER BY created_at ASC, id ASC) AS created_ats
     FROM issues WHERE archived = 0 AND github_node_id IS NOT NULL AND github_node_id <> ''
     ${projectId ? `AND project_id = $1` : ''}
     GROUP BY project_id, github_node_id HAVING COUNT(*) > 1`, projectId ? [projectId] : []);
    const groups = [];
    const alreadyArchiving = new Set();
    for (const row of nodeIdRows.rows) {
        const ids = row.ids.split(',');
        const titles = row.titles.split('||');
        groups.push({ projectId: row.project_id, keepId: ids[0], keepTitle: titles[0] ?? '', archiveIds: ids.slice(1), detectionKey: 'githubNodeId', keyValue: row.key_value });
        ids.slice(1).forEach((id) => alreadyArchiving.add(id));
    }
    const titleRows = await pool.query(`SELECT project_id, title AS key_value,
            string_agg(id::text, ',' ORDER BY created_at ASC, id ASC) AS ids,
            string_agg(title, '||' ORDER BY created_at ASC, id ASC) AS titles,
            string_agg(created_at::text, ',' ORDER BY created_at ASC, id ASC) AS created_ats
     FROM issues WHERE archived = 0
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
    return groups;
}
async function archiveDuplicates(groups) {
    const pool = getPool();
    const now = new Date().toISOString();
    for (const g of groups) {
        if (g.archiveIds.length === 0)
            continue;
        const placeholders = g.archiveIds.map((_, i) => `$${i + 3}`).join(', ');
        await pool.query(`UPDATE issues SET archived=1, archived_at=$1::timestamptz, archived_reason=$2, updated_at=$1::timestamptz WHERE id IN (${placeholders})`, [now, 'dedupe:bulk-port-vs-seed-backlog', ...g.archiveIds]);
    }
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const opts = parseArgs(process.argv);
    const serverLive = await isServerRunning();
    let report;
    if (serverLive) {
        console.error('[dedupe] Server detected at http://localhost:3000 — delegating via HTTP');
        report = await dedupeViaHttp(opts);
    }
    else {
        // Boot PGlite directly.
        const connectionString = await startPglite();
        await initDb(connectionString);
        const groups = await findDuplicates(opts.projectId);
        const projects = {};
        for (const g of groups) {
            if (!projects[g.projectId])
                projects[g.projectId] = { kept: 0, archived: 0 };
            projects[g.projectId].kept += 1;
            projects[g.projectId].archived += g.archiveIds.length;
        }
        report = { ok: true, dryRun: opts.dryRun, projects, groups };
        if (!opts.dryRun && groups.length > 0) {
            const totalToArchive = groups.reduce((s, g) => s + g.archiveIds.length, 0);
            if (!opts.yes) {
                const rl = createInterface({ input: process.stdin, output: process.stdout });
                const answer = await rl.question(`About to archive ${totalToArchive} duplicate(s) across ${Object.keys(projects).length} project(s). Proceed? [y/N] `);
                rl.close();
                if (!answer.trim().toLowerCase().startsWith('y')) {
                    console.log('Aborted.');
                    process.exit(0);
                }
            }
            await archiveDuplicates(groups);
        }
    }
    if (report.dryRun || !serverLive) {
        // For HTTP path with dryRun=false: confirmation happens server-side (no prompt needed)
        // Output report as JSON.
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        if (report.dryRun) {
            const total = Object.values(report.projects).reduce((s, p) => s + p.archived, 0);
            console.error(`[dedupe] DRY RUN — would archive ${total} card(s). Re-run without --dry-run to apply.`);
        }
        else {
            const total = Object.values(report.projects).reduce((s, p) => s + p.archived, 0);
            if (total === 0)
                console.error('[dedupe] ✅ No duplicates found — board is clean.');
            else
                console.error(`[dedupe] ✅ Archived ${total} duplicate(s).`);
        }
    }
    else {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        const total = Object.values(report.projects).reduce((s, p) => s + p.archived, 0);
        if (total === 0)
            console.error('[dedupe] ✅ No duplicates found — board is clean.');
        else
            console.error(`[dedupe] ✅ Archived ${total} duplicate(s).`);
    }
}
main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=dedupe-cards.js.map