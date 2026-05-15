/**
 * routes/activity.ts — Global activity aggregator for the /now view.
 *
 * GET /api/activity/now
 *   Returns every active live session, every running issue run, and every
 *   active workflow run across ALL projects, ordered most-recently-active
 *   first, capped at 50 rows per list.
 *
 *   Timestamps are always emitted as ISO 8601 with Z suffix via
 *   Date#toISOString() so the client's "5s ago" badge is never wrong even
 *   if the Hockney timestamp fix hasn't landed yet.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPool } from '../db/index.js';

const router = Router();

// ---------------------------------------------------------------------------
// Active status sets
// ---------------------------------------------------------------------------

/** live_session_status values that count as "running" for the Now view. */
const ACTIVE_SESSION_STATUSES = ['active', 'idle'];

/** run_status values that count as "running" for the Now view. */
const ACTIVE_RUN_STATUSES = ['pending', 'running', 'splitting', 'waiting_children'];

// ---------------------------------------------------------------------------
// GET /api/activity/now
// ---------------------------------------------------------------------------

router.get('/now', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();

    // ── 1. Live Sessions ──────────────────────────────────────────────────

    const sessionPlaceholders = ACTIVE_SESSION_STATUSES.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: sessionRows } = await pool.query<{
      id: string;
      projectId: string;
      projectName: string;
      agentName: string | null;
      status: string;
      startedAt: Date;
      lastEventAt: Date;
    }>(
      `SELECT
         ls.id,
         ls.project_id  AS "projectId",
         p.name         AS "projectName",
         ls.agent_name  AS "agentName",
         ls.status,
         ls.created_at  AS "startedAt",
         ls.updated_at  AS "lastEventAt"
       FROM live_sessions ls
       INNER JOIN projects p ON ls.project_id = p.id
       WHERE ls.status IN (${sessionPlaceholders})
       ORDER BY ls.updated_at DESC
       LIMIT 50`,
      ACTIVE_SESSION_STATUSES,
    );

    // ── 2. Issue Runs ─────────────────────────────────────────────────────

    const runPlaceholders = ACTIVE_RUN_STATUSES.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: runRows } = await pool.query<{
      id: string;
      projectId: string;
      projectName: string;
      issueId: string;
      issueTitle: string;
      agentName: string | null;
      status: string;
      startedAt: Date | null;
      leaseExpiresAt: Date | null;
    }>(
      `SELECT
         ir.id,
         i.project_id        AS "projectId",
         p.name              AS "projectName",
         ir.issue_id         AS "issueId",
         i.title             AS "issueTitle",
         a.name              AS "agentName",
         ir.status,
         ir.started_at       AS "startedAt",
         ir.lease_expires_at AS "leaseExpiresAt"
       FROM issue_runs ir
       INNER JOIN issues i  ON ir.issue_id  = i.id
       INNER JOIN projects p ON i.project_id = p.id
       LEFT  JOIN agents a  ON ir.agent_id  = a.id
       WHERE ir.status IN (${runPlaceholders})
       ORDER BY ir.started_at DESC NULLS LAST
       LIMIT 50`,
      ACTIVE_RUN_STATUSES,
    );

    // ── 3. Workflow Runs ──────────────────────────────────────────────────

    const wfPlaceholders = ACTIVE_RUN_STATUSES.map((_, i) => `$${i + 1}`).join(', ');
    const { rows: workflowRows } = await pool.query<{
      id: string;
      projectId: string;
      projectName: string;
      workflowName: string | null;
      status: string;
      startedAt: Date;
      currentStepKind: string | null;
    }>(
      `SELECT
         wr.id,
         i.project_id AS "projectId",
         p.name       AS "projectName",
         w.name       AS "workflowName",
         wr.status,
         wr.created_at AS "startedAt",
         sr.step_type  AS "currentStepKind"
       FROM workflow_runs wr
       INNER JOIN issues   i  ON wr.issue_id = i.id
       INNER JOIN projects p  ON i.project_id = p.id
       LEFT  JOIN workflow_versions wv ON wr.workflow_version_id = wv.id
       LEFT  JOIN workflows w          ON wv.workflow_id = w.id
       LEFT  JOIN step_runs sr         ON sr.workflow_run_id = wr.id
                                      AND sr.step_index = wr.current_step_index
                                      AND sr.status = 'running'
       WHERE wr.status IN (${wfPlaceholders})
       ORDER BY wr.created_at DESC
       LIMIT 50`,
      ACTIVE_RUN_STATUSES,
    );

    // ── Serialize with explicit ISO 8601 + Z suffix ───────────────────────

    const liveSessions = sessionRows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      agentName: r.agentName,
      status: r.status,
      startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : r.startedAt,
      lastEventAt: r.lastEventAt instanceof Date ? r.lastEventAt.toISOString() : r.lastEventAt,
    }));

    const issueRuns = runRows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      issueId: r.issueId,
      issueTitle: r.issueTitle,
      agentName: r.agentName,
      status: r.status,
      startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : (r.startedAt ?? null),
      leaseExpiresAt: r.leaseExpiresAt instanceof Date ? r.leaseExpiresAt.toISOString() : (r.leaseExpiresAt ?? null),
    }));

    const workflowRuns = workflowRows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      workflowName: r.workflowName ?? 'Workflow',
      status: r.status,
      startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : r.startedAt,
      currentStepKind: r.currentStepKind,
    }));

    return res.json({ liveSessions, issueRuns, workflowRuns });
  } catch (err) {
    console.error('[activity] GET /now error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
