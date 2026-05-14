import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Helper: start-of-week (Monday 00:00 UTC) offsets
// ---------------------------------------------------------------------------
const THIS_WEEK_START = `date_trunc('week', now() AT TIME ZONE 'UTC')`;
const LAST_WEEK_START = `date_trunc('week', now() AT TIME ZONE 'UTC') - INTERVAL '7 days'`;
const MTD_START = `date_trunc('month', now() AT TIME ZONE 'UTC')`;

// ---------------------------------------------------------------------------
// GET /api/projects/:id/analytics/overview
// ---------------------------------------------------------------------------
router.get('/overview', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const db = getDb();

    // Issues by status (non-archived)
    const byStatusRows = await db.execute(sql`
      SELECT status, COUNT(*)::int AS count
      FROM issues
      WHERE project_id = ${id} AND archived = 0
      GROUP BY status
    `);

    const issuesByStatus: Record<string, number> = {
      backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0,
    };
    for (const row of byStatusRows.rows as { status: string; count: number }[]) {
      issuesByStatus[row.status] = row.count;
    }

    // Done issues this week vs last week
    const doneWeekRows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE updated_at >= ${sql.raw(THIS_WEEK_START)})::int              AS this_week,
        COUNT(*) FILTER (WHERE updated_at >= ${sql.raw(LAST_WEEK_START)}
                           AND updated_at <  ${sql.raw(THIS_WEEK_START)})::int              AS last_week
      FROM issues
      WHERE project_id = ${id} AND status = 'done' AND archived = 0
    `);
    const doneRow = (doneWeekRows.rows[0] ?? { this_week: 0, last_week: 0 }) as {
      this_week: number; last_week: number;
    };
    const thisWeek = doneRow.this_week;
    const lastWeek = doneRow.last_week;
    const weekOverWeekChange = lastWeek > 0
      ? Math.round(((thisWeek - lastWeek) / lastWeek) * 10000) / 10000
      : thisWeek > 0 ? 1 : 0;

    // Active agents
    const agentRows = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM agents
      WHERE project_id = ${id} AND status = 'active'
    `);
    const activeAgents = ((agentRows.rows[0] as { count: number }) ?? { count: 0 }).count;

    // Run stats (via join issues → agents scoped to project)
    const runRows = await db.execute(sql`
      SELECT
        COUNT(ir.id)::int                                                                   AS total_runs,
        COUNT(ir.id) FILTER (WHERE ir.created_at >= ${sql.raw(THIS_WEEK_START)})::int       AS runs_this_week,
        COALESCE(AVG(ir.cost_usd::numeric), 0)::float                                      AS avg_cost,
        COALESCE(SUM(ir.cost_usd::numeric) FILTER (
          WHERE ir.created_at >= ${sql.raw(MTD_START)}
        ), 0)::float                                                                        AS cost_mtd
      FROM issue_runs ir
      JOIN issues i ON ir.issue_id = i.id
      WHERE i.project_id = ${id}
    `);
    const runRow = (runRows.rows[0] ?? {}) as {
      total_runs: number; runs_this_week: number; avg_cost: number; cost_mtd: number;
    };

    // Active workflows
    const wfRows = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM workflows WHERE project_id = ${id}
    `);
    const workflowsActive = ((wfRows.rows[0] as { count: number }) ?? { count: 0 }).count;

    // Open reviews (approve steps in pending/running state on this project's workflow runs)
    const reviewRows = await db.execute(sql`
      SELECT COUNT(sr.id)::int AS count
      FROM step_runs sr
      JOIN workflow_runs wr ON sr.workflow_run_id = wr.id
      JOIN issues i ON wr.issue_id = i.id
      WHERE i.project_id = ${id}
        AND sr.step_type = 'approve'
        AND sr.status IN ('pending', 'running')
    `);
    const openReviews = ((reviewRows.rows[0] as { count: number }) ?? { count: 0 }).count;

    res.json({
      issuesByStatus,
      issuesDoneThisWeek: thisWeek,
      issuesDoneLastWeek: lastWeek,
      weekOverWeekChange,
      activeAgents,
      totalRuns: runRow.total_runs ?? 0,
      runsThisWeek: runRow.runs_this_week ?? 0,
      avgRunCostUsd: Math.round((runRow.avg_cost ?? 0) * 1e6) / 1e6,
      totalCostMtd: Math.round((runRow.cost_mtd ?? 0) * 1e4) / 1e4,
      workflowsActive,
      openReviews,
    });
  } catch (err: unknown) {
    console.error('[analytics] GET /overview error:', err);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/analytics/throughput
// ---------------------------------------------------------------------------
router.get('/throughput', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const db = getDb();

    // Generate last-30-day series then left join actual counts
    const rows = await db.execute(sql`
      WITH dates AS (
        SELECT generate_series(
          (current_date - INTERVAL '29 days')::date,
          current_date::date,
          '1 day'
        )::date AS day
      ),
      done_counts AS (
        SELECT updated_at::date AS day, COUNT(*)::int AS done
        FROM issues
        WHERE project_id = ${id}
          AND status = 'done'
          AND archived = 0
          AND updated_at >= current_date - INTERVAL '29 days'
        GROUP BY updated_at::date
      ),
      created_counts AS (
        SELECT created_at::date AS day, COUNT(*)::int AS created
        FROM issues
        WHERE project_id = ${id}
          AND archived = 0
          AND created_at >= current_date - INTERVAL '29 days'
        GROUP BY created_at::date
      )
      SELECT
        d.day::text                              AS date,
        COALESCE(dc.done, 0)::int               AS done,
        COALESCE(cc.created, 0)::int            AS created
      FROM dates d
      LEFT JOIN done_counts dc ON dc.day = d.day
      LEFT JOIN created_counts cc ON cc.day = d.day
      ORDER BY d.day
    `);

    res.json({
      days: rows.rows as { date: string; done: number; created: number }[],
    });
  } catch (err: unknown) {
    console.error('[analytics] GET /throughput error:', err);
    res.status(500).json({ error: 'Failed to fetch throughput' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/analytics/agents
// ---------------------------------------------------------------------------
router.get('/agents', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const db = getDb();

    const rows = await db.execute(sql`
      SELECT
        a.id,
        a.name,
        COUNT(ir.id)::int                                                                     AS runs_total,
        COUNT(ir.id) FILTER (WHERE ir.created_at >= ${sql.raw(THIS_WEEK_START)})::int         AS runs_this_week,
        COALESCE(AVG(ir.cost_usd::numeric), 0)::float                                        AS avg_cost_usd,
        COALESCE(
          AVG(
            EXTRACT(EPOCH FROM (ir.completed_at - ir.started_at)) * 1000
          ) FILTER (WHERE ir.completed_at IS NOT NULL AND ir.started_at IS NOT NULL),
          0
        )::float                                                                              AS avg_duration_ms,
        CASE
          WHEN COUNT(ir.id) = 0 THEN 0
          ELSE ROUND(
            COUNT(ir.id) FILTER (WHERE ir.status = 'completed')::numeric
            / COUNT(ir.id)::numeric * 100,
            1
          )::float
        END                                                                                   AS success_rate
      FROM agents a
      LEFT JOIN issue_runs ir ON ir.agent_id = a.id
      WHERE a.project_id = ${id}
      GROUP BY a.id, a.name
      ORDER BY runs_this_week DESC, runs_total DESC
    `);

    res.json({
      agents: rows.rows as {
        id: string; name: string;
        runsTotal: number; runsThisWeek: number;
        avgCostUsd: number; avgDurationMs: number; successRate: number;
      }[],
    });
  } catch (err: unknown) {
    console.error('[analytics] GET /agents error:', err);
    res.status(500).json({ error: 'Failed to fetch agent stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/analytics/workflows
// ---------------------------------------------------------------------------
router.get('/workflows', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const db = getDb();

    const rows = await db.execute(sql`
      SELECT
        w.id,
        w.name,
        COUNT(wr.id)::int                                                            AS runs_total,
        COUNT(wr.id) FILTER (WHERE wr.status = 'completed')::int                    AS completed_runs,
        COUNT(wr.id) FILTER (WHERE wr.status = 'failed')::int                       AS failed_runs,
        COALESCE(
          AVG((SELECT MAX(sr.step_index) + 1 FROM step_runs sr WHERE sr.workflow_run_id = wr.id)),
          0
        )::float                                                                     AS avg_steps,
        COALESCE(
          AVG(
            EXTRACT(EPOCH FROM (wr.updated_at - wr.created_at)) * 1000
          ) FILTER (WHERE wr.status IN ('completed', 'failed')),
          0
        )::float                                                                     AS avg_duration_ms
      FROM workflows w
      LEFT JOIN workflow_runs wr ON wr.workflow_version_id IN (
        SELECT wv.id FROM workflow_versions wv WHERE wv.workflow_id = w.id
      )
      WHERE w.project_id = ${id}
      GROUP BY w.id, w.name
      ORDER BY runs_total DESC
    `);

    res.json({
      workflows: rows.rows as {
        id: string; name: string;
        runsTotal: number; completedRuns: number; failedRuns: number;
        avgSteps: number; avgDurationMs: number;
      }[],
    });
  } catch (err: unknown) {
    console.error('[analytics] GET /workflows error:', err);
    res.status(500).json({ error: 'Failed to fetch workflow stats' });
  }
});

export default router;
