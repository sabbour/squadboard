/**
 * services/flow-agents.ts — Phase 12 reframe: agent-centric flow data API.
 *
 * Powers:
 *   GET /api/projects/:id/flow/agents  → getFlowAgents()
 *   GET /api/projects/:id/flow/lineage → getFlowLineage()
 *
 * Data sources for instances:
 *   workflow_runs   — attributed to the current step's agent (or issue assignee)
 *   issue_runs      — standalone (not linked to a step_run)
 *   live_sessions   — attributed to agentId
 *   consult_sessions (mode='agent') — attributed to agentId
 *
 * Performance posture:
 *   Active + all non-terminal instances are always included.
 *   Completed/failed instances are capped to the trailing 24 h, at most 50
 *   rows per source type (so the overall cap is ~200 across 4 sources).
 *
 * Data gaps (documented for Keyser):
 *   - workflow_runs with no current-step issue_run AND no issue assignee are
 *     excluded from all agent cards (they belong to no agent yet).
 *   - consult_sessions with mode='model' (direct model sessions) are excluded
 *     because they have no agentId.
 *   - issue_runs that ARE linked to a step_run are subsumed into their parent
 *     workflow_run — they do NOT appear as separate instances to avoid
 *     duplication. The flow page should render the workflow_run as the top-level
 *     entity and the issue_run (current step) as the "currentStep" detail.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toIso(value) {
    if (value == null)
        return undefined;
    if (value instanceof Date)
        return value.toISOString();
    if (typeof value === 'string') {
        const d = new Date(value);
        if (!isNaN(d.getTime()))
            return d.toISOString();
    }
    return undefined;
}
function mapStatus(dbStatus) {
    switch (dbStatus) {
        case 'running':
        case 'active':
        case 'splitting':
        case 'waiting_children':
            return 'active';
        case 'idle':
            return 'idle';
        case 'completed':
            return 'completed';
        case 'failed':
        case 'cancelled':
            return 'failed';
        default:
            return 'pending';
    }
}
// ---------------------------------------------------------------------------
// getFlowAgents
// ---------------------------------------------------------------------------
export async function getFlowAgents(projectId) {
    const db = getDb();
    // ── 1. All non-retired agents in the project ──────────────────────────────
    const agentRows = (await db.execute(sql `
    SELECT id, name, role
    FROM   agents
    WHERE  project_id = ${projectId}::uuid
      AND  status != 'retired'
    ORDER  BY name
  `)).rows;
    // ── 2. Union all instance sources ────────────────────────────────────────
    // Each branch must produce the same 13 columns in the same order.
    // Completed rows are limited to trailing 24 h, 50 rows per source.
    //
    // Column order:
    //   instance_id, instance_kind, agent_id, status,
    //   issue_id, issue_title,
    //   started_at, last_heartbeat_at, ended_at,
    //   model,
    //   current_step_id, current_step_label, current_step_started_at
    const instanceRows = (await db.execute(sql `
    WITH
    -- ── A: non-terminal workflow_runs ──────────────────────────────────────
    wf_active (
      instance_id, instance_kind, agent_id, status,
      issue_id, issue_title,
      started_at, last_heartbeat_at, ended_at,
      model,
      current_step_id, current_step_label, current_step_started_at
    ) AS (
      SELECT
        wr.id::text,
        'workflow_run'::text,
        COALESCE(step_ir.agent_id::text, i.assignee_id::text),
        wr.status::text,
        i.id::text,
        i.title,
        wr.created_at,
        wr.updated_at,
        NULL::timestamptz,
        NULL::text,
        cur_step.id::text,
        cur_step.step_type,
        cur_step.started_at
      FROM workflow_runs wr
      JOIN issues i ON wr.issue_id = i.id
      LEFT JOIN LATERAL (
        SELECT id, step_type, started_at, issue_run_id
        FROM   step_runs
        WHERE  workflow_run_id = wr.id
          AND  step_index = wr.current_step_index
        LIMIT  1
      ) cur_step ON true
      LEFT JOIN issue_runs step_ir ON step_ir.id = cur_step.issue_run_id
      WHERE i.project_id = ${projectId}::uuid
        AND wr.status NOT IN ('completed', 'failed', 'cancelled')
    ),

    -- ── B: active standalone issue_runs (not linked to any step_run) ───────
    ir_active (
      instance_id, instance_kind, agent_id, status,
      issue_id, issue_title,
      started_at, last_heartbeat_at, ended_at,
      model,
      current_step_id, current_step_label, current_step_started_at
    ) AS (
      SELECT
        ir.id::text,
        'issue_run'::text,
        ir.agent_id::text,
        ir.status::text,
        i.id::text,
        i.title,
        ir.started_at,
        ir.heartbeat_at,
        ir.completed_at,
        NULL::text,
        NULL::text,
        NULL::text,
        NULL::timestamptz
      FROM issue_runs ir
      JOIN issues i ON ir.issue_id = i.id
      WHERE i.project_id = ${projectId}::uuid
        AND ir.status NOT IN ('completed', 'failed', 'cancelled')
        AND NOT EXISTS (SELECT 1 FROM step_runs sr WHERE sr.issue_run_id = ir.id)
    ),

    -- ── C: recently completed standalone issue_runs (trailing 24 h, cap 50) ─
    ir_done (
      instance_id, instance_kind, agent_id, status,
      issue_id, issue_title,
      started_at, last_heartbeat_at, ended_at,
      model,
      current_step_id, current_step_label, current_step_started_at
    ) AS (
      SELECT
        ir.id::text,
        'issue_run'::text,
        ir.agent_id::text,
        ir.status::text,
        i.id::text,
        i.title,
        ir.started_at,
        ir.heartbeat_at,
        ir.completed_at,
        NULL::text,
        NULL::text,
        NULL::text,
        NULL::timestamptz
      FROM issue_runs ir
      JOIN issues i ON ir.issue_id = i.id
      WHERE i.project_id = ${projectId}::uuid
        AND ir.status IN ('completed', 'failed', 'cancelled')
        AND ir.updated_at >= NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (SELECT 1 FROM step_runs sr WHERE sr.issue_run_id = ir.id)
      ORDER BY ir.updated_at DESC
      LIMIT 50
    ),

    -- ── D: active live_sessions with an assigned agent ─────────────────────
    ls_active (
      instance_id, instance_kind, agent_id, status,
      issue_id, issue_title,
      started_at, last_heartbeat_at, ended_at,
      model,
      current_step_id, current_step_label, current_step_started_at
    ) AS (
      SELECT
        ls.id::text,
        'live_session'::text,
        ls.agent_id::text,
        ls.status::text,
        NULL::text,
        ls.title,
        ls.created_at,
        ls.updated_at,
        ls.completed_at,
        ls.model,
        NULL::text,
        NULL::text,
        NULL::timestamptz
      FROM live_sessions ls
      WHERE ls.project_id = ${projectId}::uuid
        AND ls.status IN ('active', 'idle')
        AND ls.agent_id IS NOT NULL
    ),

    -- ── E: recently completed live_sessions (trailing 24 h, cap 50) ────────
    ls_done (
      instance_id, instance_kind, agent_id, status,
      issue_id, issue_title,
      started_at, last_heartbeat_at, ended_at,
      model,
      current_step_id, current_step_label, current_step_started_at
    ) AS (
      SELECT
        ls.id::text,
        'live_session'::text,
        ls.agent_id::text,
        ls.status::text,
        NULL::text,
        ls.title,
        ls.created_at,
        ls.updated_at,
        ls.completed_at,
        ls.model,
        NULL::text,
        NULL::text,
        NULL::timestamptz
      FROM live_sessions ls
      WHERE ls.project_id = ${projectId}::uuid
        AND ls.status IN ('completed', 'failed', 'cancelled')
        AND ls.updated_at >= NOW() - INTERVAL '24 hours'
        AND ls.agent_id IS NOT NULL
      ORDER BY ls.updated_at DESC
      LIMIT 50
    ),

    -- ── F: active consult_sessions (agent mode only) ────────────────────────
    cs_active (
      instance_id, instance_kind, agent_id, status,
      issue_id, issue_title,
      started_at, last_heartbeat_at, ended_at,
      model,
      current_step_id, current_step_label, current_step_started_at
    ) AS (
      SELECT
        cs.id::text,
        'consult_session'::text,
        cs.agent_id::text,
        cs.status::text,
        NULL::text,
        cs.name,
        cs.started_at,
        cs.updated_at,
        cs.ended_at,
        cs.model,
        NULL::text,
        NULL::text,
        NULL::timestamptz
      FROM consult_sessions cs
      WHERE cs.project_id = ${projectId}::uuid
        AND cs.status IN ('active', 'idle')
        AND cs.agent_id IS NOT NULL
        AND cs.mode = 'agent'
    ),

    -- ── G: recently completed consult_sessions (trailing 24 h, cap 50) ─────
    cs_done (
      instance_id, instance_kind, agent_id, status,
      issue_id, issue_title,
      started_at, last_heartbeat_at, ended_at,
      model,
      current_step_id, current_step_label, current_step_started_at
    ) AS (
      SELECT
        cs.id::text,
        'consult_session'::text,
        cs.agent_id::text,
        cs.status::text,
        NULL::text,
        cs.name,
        cs.started_at,
        cs.updated_at,
        cs.ended_at,
        cs.model,
        NULL::text,
        NULL::text,
        NULL::timestamptz
      FROM consult_sessions cs
      WHERE cs.project_id = ${projectId}::uuid
        AND cs.status IN ('completed', 'failed', 'cancelled')
        AND cs.updated_at >= NOW() - INTERVAL '24 hours'
        AND cs.agent_id IS NOT NULL
        AND cs.mode = 'agent'
      ORDER BY cs.updated_at DESC
      LIMIT 50
    )

    SELECT * FROM wf_active
    UNION ALL SELECT * FROM ir_active
    UNION ALL SELECT * FROM ir_done
    UNION ALL SELECT * FROM ls_active
    UNION ALL SELECT * FROM ls_done
    UNION ALL SELECT * FROM cs_active
    UNION ALL SELECT * FROM cs_done
  `)).rows;
    // ── 3. Group instances by agent_id ────────────────────────────────────────
    const instancesByAgent = new Map();
    for (const row of instanceRows) {
        if (!row.agent_id)
            continue;
        if (!instancesByAgent.has(row.agent_id)) {
            instancesByAgent.set(row.agent_id, []);
        }
        const currentStep = row.current_step_id
            ? {
                stepId: row.current_step_id,
                label: row.current_step_label ?? row.current_step_id,
                startedAt: toIso(row.current_step_started_at) ?? new Date().toISOString(),
            }
            : undefined;
        instancesByAgent.get(row.agent_id).push({
            instanceId: row.instance_id,
            instanceKind: row.instance_kind,
            status: mapStatus(row.status),
            currentStep,
            currentIssue: row.issue_id
                ? { issueId: row.issue_id, title: row.issue_title ?? '' }
                : undefined,
            startedAt: toIso(row.started_at) ?? new Date().toISOString(),
            lastHeartbeatAt: toIso(row.last_heartbeat_at),
            endedAt: toIso(row.ended_at),
            model: row.model ?? undefined,
        });
    }
    // ── 4. Build response — every agent appears, even with 0 instances ────────
    const agents = agentRows.map((agent) => ({
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        instances: instancesByAgent.get(agent.id) ?? [],
    }));
    return { agents };
}
// ---------------------------------------------------------------------------
// getFlowLineage
// ---------------------------------------------------------------------------
export async function getFlowLineage(projectId) {
    const db = getDb();
    // Three lineage sources, trailing 24 h window:
    //
    // 1. issue_links (link_type='fan_out'|'handoff') → map to workflow_run IDs
    //    using LATERAL to pick the most-recent run per issue. triggerStepId
    //    comes from handoff_context.
    //
    // 2. workflow_runs.parent_workflow_run_id — child runs spawned by fan_out
    //    already set this foreign key. Relation tagged 'spawn'.
    //
    // 3. consult_sessions.forked_from_session_id — session forks get tagged
    //    'consult'.
    //
    // GAP: issue_run → issue_run lineage (e.g., handoff without a workflow_run)
    //      is not tracked in the current schema. Document only.
    //
    // GAP: consult_sessions lack a parent_run_id FK to workflow_runs, so there
    //      is no cross-source edge from a workflow_run to a consult_session.
    const edgeRows = (await db.execute(sql `
    WITH

    -- ── Source 1: issue_links → most-recent workflow_run per issue ──────────
    il_edges AS (
      SELECT
        parent_wr.id::text              AS from_instance_id,
        child_wr.id::text               AS to_instance_id,
        il.link_type                    AS relation,
        il.created_at,
        hc.step_run_id::text            AS trigger_step_id
      FROM issue_links il
      JOIN issues parent_i ON il.parent_issue_id = parent_i.id
      JOIN issues child_i  ON il.child_issue_id  = child_i.id
      -- Most-recent workflow_run for the parent issue
      JOIN LATERAL (
        SELECT id FROM workflow_runs
        WHERE  issue_id = parent_i.id
        ORDER  BY created_at DESC
        LIMIT  1
      ) parent_wr ON true
      -- Most-recent workflow_run for the child issue (may not exist yet)
      LEFT JOIN LATERAL (
        SELECT id FROM workflow_runs
        WHERE  issue_id = child_i.id
        ORDER  BY created_at DESC
        LIMIT  1
      ) child_wr ON true
      -- Trigger step from handoff_context (if any)
      LEFT JOIN LATERAL (
        SELECT step_run_id FROM handoff_context
        WHERE  target_issue_id = child_i.id
        ORDER  BY created_at DESC
        LIMIT  1
      ) hc ON true
      WHERE parent_i.project_id = ${projectId}::uuid
        AND il.created_at >= NOW() - INTERVAL '24 hours'
    ),

    -- ── Source 2: direct parent_workflow_run_id links ───────────────────────
    wr_spawn_edges AS (
      SELECT
        wr.parent_workflow_run_id::text AS from_instance_id,
        wr.id::text                    AS to_instance_id,
        'spawn'::text                  AS relation,
        wr.created_at,
        NULL::text                     AS trigger_step_id
      FROM workflow_runs wr
      JOIN issues i ON wr.issue_id = i.id
      WHERE i.project_id = ${projectId}::uuid
        AND wr.parent_workflow_run_id IS NOT NULL
        AND wr.created_at >= NOW() - INTERVAL '24 hours'
    ),

    -- ── Source 3: consult session forks ────────────────────────────────────
    cs_fork_edges AS (
      SELECT
        cs.forked_from_session_id::text AS from_instance_id,
        cs.id::text                    AS to_instance_id,
        'consult'::text                AS relation,
        cs.created_at,
        NULL::text                     AS trigger_step_id
      FROM consult_sessions cs
      WHERE cs.project_id = ${projectId}::uuid
        AND cs.forked_from_session_id IS NOT NULL
        AND cs.created_at >= NOW() - INTERVAL '24 hours'
    )

    SELECT * FROM il_edges       WHERE to_instance_id IS NOT NULL
    UNION ALL
    SELECT * FROM wr_spawn_edges
    UNION ALL
    SELECT * FROM cs_fork_edges
    ORDER BY created_at DESC
  `)).rows;
    const edges = edgeRows
        .filter((r) => r.to_instance_id != null)
        .map((r) => ({
        fromInstanceId: r.from_instance_id,
        toInstanceId: r.to_instance_id,
        relation: r.relation,
        createdAt: toIso(r.created_at) ?? new Date().toISOString(),
        triggerStepId: r.trigger_step_id ?? undefined,
    }));
    return { edges };
}
//# sourceMappingURL=flow-agents.js.map