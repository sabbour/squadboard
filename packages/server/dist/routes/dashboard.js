/**
 * Global Dashboard API — cross-project landing-page aggregator.
 *
 * Returns a single rollup the home page can render in one fetch:
 *   - Projects + per-project quick stats (agents, issues, MTD spend, active runs)
 *   - Cross-project totals
 *   - "Now" — every active live session + every running issue_run, scoped across all projects
 *   - Recent activity tail (latest run/session/comment events in the bus persisted layer)
 *
 * Designed to be cheap: one query per axis, no per-project N+1.
 */
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
const router = Router();
router.get('/', async (_req, res) => {
    try {
        const db = getDb();
        const startOfMonth = new Date();
        startOfMonth.setUTCDate(1);
        startOfMonth.setUTCHours(0, 0, 0, 0);
        // 1) projects + their per-project counts in a single round trip
        const projectRows = await db.execute(sql `
      SELECT
        p.id,
        p.name,
        p.path,
        p.monthly_budget_usd,
        p.updated_at,
        COALESCE(agent_counts.cnt, 0) AS agent_count,
        COALESCE(issue_counts.cnt, 0) AS issue_count,
        COALESCE(issue_counts.open_cnt, 0) AS open_issue_count,
        COALESCE(active_run_counts.cnt, 0) AS active_run_count,
        COALESCE(live_session_counts.cnt, 0) AS live_session_count,
        COALESCE(mtd_costs.total, 0) AS mtd_spend,
        last_activity.last_at AS last_activity_at
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*)::int AS cnt
        FROM agents
        WHERE status = 'active'
        GROUP BY project_id
      ) agent_counts ON agent_counts.project_id = p.id
      LEFT JOIN (
        SELECT
          project_id,
          COUNT(*)::int AS cnt,
          SUM(CASE WHEN primary_status NOT IN ('done', 'failed') THEN 1 ELSE 0 END)::int AS open_cnt
        FROM issues
        GROUP BY project_id
      ) issue_counts ON issue_counts.project_id = p.id
      LEFT JOIN (
        SELECT i.project_id, COUNT(*)::int AS cnt
        FROM issue_runs ir
        JOIN issues i ON ir.issue_id = i.id
        WHERE ir.status IN ('pending', 'running')
        GROUP BY i.project_id
      ) active_run_counts ON active_run_counts.project_id = p.id
      LEFT JOIN (
        SELECT project_id, COUNT(*)::int AS cnt
        FROM live_sessions
        WHERE status IN ('active', 'idle')
        GROUP BY project_id
      ) live_session_counts ON live_session_counts.project_id = p.id
      LEFT JOIN (
        SELECT i.project_id, COALESCE(SUM(ir.cost_usd), 0)::numeric AS total
        FROM issue_runs ir
        JOIN issues i ON ir.issue_id = i.id
        WHERE ir.created_at >= ${startOfMonth.toISOString()}
          AND ir.status IN ('completed', 'failed')
        GROUP BY i.project_id
      ) mtd_costs ON mtd_costs.project_id = p.id
      LEFT JOIN (
        SELECT project_id, MAX(ts) AS last_at FROM (
          SELECT i.project_id, ir.updated_at AS ts
            FROM issue_runs ir
            JOIN issues i ON ir.issue_id = i.id
          UNION ALL
          SELECT project_id, updated_at AS ts FROM live_sessions
          UNION ALL
          SELECT project_id, updated_at AS ts FROM issues
        ) all_activity
        GROUP BY project_id
      ) last_activity ON last_activity.project_id = p.id
      ORDER BY p.updated_at DESC
    `);
        const projects = projectRows.rows.map((r) => ({
            id: r.id,
            name: r.name,
            path: r.path,
            agentCount: Number(r.agent_count ?? 0),
            issueCount: Number(r.issue_count ?? 0),
            openIssueCount: Number(r.open_issue_count ?? 0),
            activeRunCount: Number(r.active_run_count ?? 0),
            liveSessionCount: Number(r.live_session_count ?? 0),
            mtdSpendUsd: parseFloat(String(r.mtd_spend ?? '0')) || 0,
            monthlyBudgetUsd: r.monthly_budget_usd === null || r.monthly_budget_usd === undefined
                ? null
                : parseFloat(String(r.monthly_budget_usd)),
            updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
            lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
        }));
        // 2) "Active now" — currently running cross-project
        const activeRunRows = await db.execute(sql `
      SELECT
        ir.id,
        ir.status,
        ir.created_at,
        ir.updated_at,
        i.title,
        i.project_id,
        p.name AS project_name,
        a.name AS agent_name
      FROM issue_runs ir
      JOIN issues i ON ir.issue_id = i.id
      JOIN projects p ON i.project_id = p.id
      LEFT JOIN agents a ON ir.agent_id = a.id
      WHERE ir.status IN ('pending', 'running')
      ORDER BY ir.created_at DESC
      LIMIT 50
    `);
        const liveSessionRows = await db.execute(sql `
      SELECT
        ls.id,
        ls.status,
        ls.name,
        ls.created_at,
        ls.updated_at,
        ls.project_id,
        ls.model,
        ls.agent_name,
        p.name AS project_name
      FROM live_sessions ls
      JOIN projects p ON ls.project_id = p.id
      WHERE ls.status IN ('active', 'idle')
      ORDER BY ls.updated_at DESC
      LIMIT 50
    `);
        const activeNow = [
            ...liveSessionRows.rows.map((r) => ({
                kind: 'live-session',
                id: r.id,
                projectId: r.project_id,
                projectName: r.project_name,
                agentName: r.agent_name,
                title: r.name ?? 'Live session',
                status: r.status,
                startedAt: new Date(r.created_at).toISOString(),
                model: r.model,
            })),
            ...activeRunRows.rows.map((r) => ({
                kind: 'issue-run',
                id: r.id,
                projectId: r.project_id,
                projectName: r.project_name,
                agentName: r.agent_name,
                title: r.title,
                status: r.status,
                startedAt: new Date(r.created_at).toISOString(),
            })),
        ];
        // 3) recent activity — short cross-project tail (issues + completed runs)
        const recentRows = await db.execute(sql `
      WITH events AS (
        SELECT
          'run-completed'::text AS kind,
          ir.updated_at AS ts,
          i.project_id,
          p.name AS project_name,
          ir.status,
          i.title,
          a.name AS agent_name,
          ir.id::text AS ref_id,
          'issue_run'::text AS ref_type
        FROM issue_runs ir
        JOIN issues i ON ir.issue_id = i.id
        JOIN projects p ON i.project_id = p.id
        LEFT JOIN agents a ON ir.agent_id = a.id
        WHERE ir.status IN ('completed', 'failed')
        UNION ALL
        SELECT
          'issue-created'::text AS kind,
          i.created_at AS ts,
          i.project_id,
          p.name AS project_name,
          NULL AS status,
          i.title,
          NULL AS agent_name,
          i.id::text AS ref_id,
          'issue'::text AS ref_type
        FROM issues i
        JOIN projects p ON i.project_id = p.id
      )
      SELECT * FROM events
      ORDER BY ts DESC
      LIMIT 20
    `);
        const recentActivity = recentRows.rows.map((r) => {
            const isFailed = r.kind === 'run-completed' && r.status === 'failed';
            const summary = r.kind === 'run-completed'
                ? isFailed
                    ? `${r.agent_name ?? 'agent'} failed on "${r.title}"`
                    : `${r.agent_name ?? 'agent'} completed "${r.title}"`
                : `New issue: "${r.title}"`;
            return {
                kind: isFailed ? 'run-failed' : r.kind,
                ts: new Date(r.ts).toISOString(),
                projectId: r.project_id,
                projectName: r.project_name,
                summary,
                refType: r.ref_type,
                refId: r.ref_id,
            };
        });
        // 4) totals
        const totals = projects.reduce((acc, p) => {
            acc.agents += p.agentCount;
            acc.issuesOpen += p.openIssueCount;
            acc.activeRuns += p.activeRunCount;
            acc.liveSessions += p.liveSessionCount;
            acc.mtdSpendUsd += p.mtdSpendUsd;
            return acc;
        }, { projects: projects.length, agents: 0, issuesOpen: 0, activeRuns: 0, liveSessions: 0, mtdSpendUsd: 0 });
        const response = {
            totals,
            projects,
            activeNow,
            recentActivity,
        };
        res.json(response);
    }
    catch (err) {
        console.error('[dashboard] GET / failed:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
    }
});
export default router;
//# sourceMappingURL=dashboard.js.map