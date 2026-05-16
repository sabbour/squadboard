/**
 * services/copilot-watcher.ts — Wave 20 G4.2
 *
 * Polls every 60 s while at least one issue_runs row with agent_kind='copilot'
 * is in 'pending' or 'running' state. For each such run, calls:
 *   gh pr list --repo owner/repo --author copilot --state open --json ...
 *
 * When a draft PR is found whose headRefName matches the run's git_branch (or
 * the run's GitHub issue number appears in the PR body), the service:
 *   1. Updates the issue_runs row with pr_number, pr_url, pr_state='draft'.
 *   2. Emits a `copilot.pr.detected` WS event.
 *
 * Watching stops for a run once its PR becomes non-draft, merged, or closed.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { getDb, getPool, schema } from '../db/index.js';
import { eventBus } from '../realtime/event-bus.js';
import { GH_BIN } from './github-git-ops.js';
const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 60_000;
const GH_TIMEOUT_MS = 30_000;
let _interval = null;
// ─── Core tick ───────────────────────────────────────────────────────────────
async function tick() {
    const pool = getPool();
    const db = getDb();
    // Find all copilot runs that are still pending/running and have a project
    // with github_owner and github_repo set.
    const rows = await pool.query(`
    SELECT
      ir.id            AS run_id,
      ir.issue_id,
      ir.git_branch,
      ir.pr_number,
      ir.pr_state,
      i.github_issue_number,
      p.github_owner,
      p.github_repo,
      p.id             AS project_id
    FROM issue_runs ir
    JOIN agents     a  ON a.id = ir.agent_id
    JOIN issues     i  ON i.id = ir.issue_id
    JOIN projects   p  ON p.id = i.project_id
    WHERE a.agent_kind = 'copilot'
      AND ir.status IN ('pending', 'running')
      AND p.github_owner IS NOT NULL
      AND p.github_repo  IS NOT NULL
  `);
    if (rows.rows.length === 0)
        return;
    // Group by repo so we only call gh once per (owner, repo) pair.
    const byRepo = new Map();
    for (const row of rows.rows) {
        const key = `${row.github_owner}/${row.github_repo}`;
        if (!byRepo.has(key))
            byRepo.set(key, []);
        byRepo.get(key).push(row);
    }
    for (const [repoKey, runs] of byRepo.entries()) {
        const [owner, repo] = repoKey.split('/');
        let prs = [];
        try {
            const { stdout } = await execFileAsync(GH_BIN(), [
                'pr', 'list',
                '--repo', `${owner}/${repo}`,
                '--author', 'copilot',
                '--state', 'open',
                '--json', 'number,headRefName,isDraft,createdAt,url,body,state',
            ], { timeout: GH_TIMEOUT_MS });
            prs = JSON.parse(stdout.trim());
        }
        catch (err) {
            console.warn(`[copilot-watcher] gh pr list failed for ${repoKey}:`, err);
            continue;
        }
        for (const run of runs) {
            // Skip runs whose PR is already tracked and no longer draft / open.
            if (run.pr_state && !['open', 'draft', null].includes(run.pr_state))
                continue;
            // Match: headRefName equals git_branch, OR GitHub issue number appears in PR body.
            const matched = prs.find((pr) => {
                if (run.git_branch && pr.headRefName === run.git_branch)
                    return true;
                if (run.github_issue_number) {
                    const bodyStr = pr.body ?? '';
                    // GitHub auto-links issues: "Fixes #N" / "Closes #N" / bare "#N"
                    return bodyStr.includes(`#${run.github_issue_number}`);
                }
                return false;
            });
            if (!matched)
                continue;
            // Determine canonical pr_state.
            const prState = matched.isDraft ? 'draft' : matched.state.toLowerCase();
            // If this is a new detection (no pr_number yet), or state changed, update the row.
            if (run.pr_number !== matched.number || run.pr_state !== prState) {
                await db
                    .update(schema.issueRuns)
                    .set({
                    prNumber: matched.number,
                    prUrl: matched.url,
                    prState,
                    gitCacheRefreshedAt: new Date(),
                    updatedAt: new Date(),
                })
                    .where(eq(schema.issueRuns.id, run.run_id));
                // Only emit on initial detection (pr_number was null / different).
                if (!run.pr_number || run.pr_number !== matched.number) {
                    eventBus.emitCopilotEvent('copilot.pr.detected', run.project_id, {
                        run_id: run.run_id,
                        pr_number: matched.number,
                        draft: matched.isDraft,
                        url: matched.url,
                    });
                    console.log(`[copilot-watcher] detected PR #${matched.number} for run ${run.run_id} (draft=${matched.isDraft})`);
                }
            }
            // If PR is no longer draft / open, mark the run as completed.
            if (!matched.isDraft && ['merged', 'closed'].includes(matched.state.toLowerCase())) {
                await db
                    .update(schema.issueRuns)
                    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
                    .where(eq(schema.issueRuns.id, run.run_id));
                console.log(`[copilot-watcher] run ${run.run_id} marked completed (PR ${matched.state})`);
            }
        }
    }
}
// ─── Lifecycle ───────────────────────────────────────────────────────────────
/** Start the 60 s copilot-PR watcher. Idempotent — safe to call multiple times. */
export function startCopilotWatcher() {
    if (_interval)
        return;
    console.log('[copilot-watcher] starting (60 s poll)');
    _interval = setInterval(() => {
        tick().catch((err) => console.error('[copilot-watcher] tick error:', err));
    }, POLL_INTERVAL_MS);
    // Unref so the interval doesn't keep the process alive on clean shutdown.
    if (_interval.unref)
        _interval.unref();
}
/** Stop the watcher (called on graceful shutdown). */
export function stopCopilotWatcher() {
    if (_interval) {
        clearInterval(_interval);
        _interval = null;
        console.log('[copilot-watcher] stopped');
    }
}
/** Exposed for tests — runs one tick immediately and returns. */
export { tick as runWatcherTickOnce };
//# sourceMappingURL=copilot-watcher.js.map