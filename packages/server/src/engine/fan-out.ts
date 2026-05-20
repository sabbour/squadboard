/**
 * fan-out.ts — Demo 10 Fan-Out + Handoff Engine (Invariant 5)
 *
 * Implements the six-step atomic fan_out materialization transaction using raw
 * SQL (not Drizzle — to guarantee real Postgres BEGIN/COMMIT atomicity).
 *
 * Invariant 5: fan_out materializes full child workflow_runs in ONE transaction:
 *   1. BEGIN
 *   2. UPDATE parent stepRun → status='splitting'
 *   3. INSERT N child workflowRuns (one per split target)
 *   4. INSERT step_runs for each child workflowRun (all steps)
 *   5. UPDATE parent workflowRun childIds=[...]
 *   6. COMMIT
 *
 * Children inherit pinnedAgentRevisions from the parent workflow_run.
 */

import { sql } from 'drizzle-orm';
import { getPool } from '../db/index.js';
import type { DrizzleDb } from '../db/index.js';
import type { FanOutStep } from '../services/workflow-parser.js';
import type { Issue } from '../db/schema.js';
import {
  spawnFanOutChildren,
  type FanOutChild,
  type FanOutSpawnResult,
} from '../sdk/fan-out-adapter.js';
import { eventBus } from '../realtime/event-bus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SplitTarget {
  label: string;          // human-readable label for this split (label name, agent name, or "child-N")
  agentId: string | null; // resolved agent UUID (null if unresolved)
  agentName: string;      // agent name for context propagation
  variables: Record<string, unknown>; // target-specific variable overrides
}

export interface ChildResult {
  workflowRunId: string;
  issueId: string;
  status: string;
  completed: boolean;
  failed: boolean;
  output: string | null;
}

// ---------------------------------------------------------------------------
// resolveTargets — resolve split_by to concrete SplitTarget[]
// ---------------------------------------------------------------------------

export async function resolveTargets(
  fanOutStep: FanOutStep,
  issue: Issue,
  db: DrizzleDb,
): Promise<SplitTarget[]> {
  switch (fanOutStep.split_by) {
    case 'agents': {
      if (!fanOutStep.agents || fanOutStep.agents.length === 0) {
        throw new Error('fan_out with split_by=agents requires a non-empty agents list');
      }
      const targets: SplitTarget[] = [];
      for (const agentName of fanOutStep.agents) {
        const rows = await db.execute(
          sql`SELECT id, name FROM agents WHERE project_id = ${issue.projectId} AND name = ${agentName} LIMIT 1`,
        );
        const row = (rows.rows as Array<{ id: string; name: string }>)[0];
        targets.push({
          label: agentName,
          agentId: row?.id ?? null,
          agentName,
          variables: { 'child.agent': agentName },
        });
      }
      return targets;
    }

    case 'labels': {
      const labelRows = await db.execute(
        sql`
          SELECT l.id AS label_id, l.name AS label_name
          FROM issue_labels il
          JOIN labels l ON l.id = il.label_id
          WHERE il.issue_id = ${issue.id}
          ORDER BY l.name
        `,
      );
      const foundLabels = labelRows.rows as Array<{ label_id: string; label_name: string }>;
      if (foundLabels.length === 0) {
        // No labels on the issue — create a single child with no label context
        return [{
          label: 'default',
          agentId: null,
          agentName: '',
          variables: { 'child.label': null },
        }];
      }
      return foundLabels.map((l) => ({
        label: l.label_name,
        agentId: null,
        agentName: '',
        variables: { 'child.label': l.label_name, 'child.labelId': l.label_id },
      }));
    }

    case 'count': {
      const count = fanOutStep.count ?? 1;
      const agentPool = fanOutStep.agents ?? [];
      const targets: SplitTarget[] = [];
      for (let i = 0; i < count; i++) {
        const agentName = agentPool.length > 0 ? agentPool[i % agentPool.length] : '';
        let agentId: string | null = null;
        if (agentName) {
          const rows = await db.execute(
            sql`SELECT id FROM agents WHERE project_id = ${issue.projectId} AND name = ${agentName} LIMIT 1`,
          );
          agentId = ((rows.rows as Array<{ id: string }>)[0])?.id ?? null;
        }
        targets.push({
          label: `child-${i + 1}`,
          agentId,
          agentName,
          variables: { 'child.index': i, 'child.agent': agentName },
        });
      }
      return targets;
    }

    default:
      throw new Error(`Unknown split_by: ${String(fanOutStep.split_by)}`);
  }
}

// ---------------------------------------------------------------------------
// materializeFanOut — Invariant 5 six-step raw SQL transaction
// ---------------------------------------------------------------------------

export async function materializeFanOut(
  parentWorkflowRunId: string,
  parentStepRunId: string,
  fanOutStep: FanOutStep,
  issue: Issue,
  db: DrizzleDb,
): Promise<string[]> {
  // Pre-resolve targets outside the transaction (read-only queries are safe outside)
  const targets = await resolveTargets(fanOutStep, issue, db);

  // Load parent pinnedAgentRevisions and variables for inheritance
  const parentRows = await db.execute(
    sql`SELECT pinned_agent_revisions, variables FROM workflow_runs WHERE id = ${parentWorkflowRunId}`,
  );
  const parent = (parentRows.rows as Array<{
    pinned_agent_revisions: string | null;
    variables: Record<string, unknown> | null;
  }>)[0];
  const pinnedAgentRevisions = parent?.pinned_agent_revisions ?? null;
  const parentVariables = (parent?.variables as Record<string, unknown>) ?? {};

  const pool = getPool();
  const client = await pool.connect();

  try {
    // ── Step 1: BEGIN ────────────────────────────────────────────────────────
    await client.query('BEGIN');

    // ── Step 2: UPDATE parent stepRun → status='splitting' ──────────────────
    // Guard: only claim if the step is still 'pending'. If rowCount=0, a
    // concurrent materialization already claimed this step — bail out cleanly.
    const claimResult = await client.query(
      `UPDATE step_runs
          SET status = 'splitting', updated_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [parentStepRunId],
    );
    if ((claimResult.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      console.warn(
        `[fan-out] concurrent materialization detected for step_run ${parentStepRunId} — bailing out (already claimed)`,
      );
      return [];
    }

    // ── Steps 3 + 4: INSERT child workflowRuns + step_runs ──────────────────
    const childWorkflowRunIds: string[] = [];

    for (const target of targets) {
      // Title compound guard: if the parent title already ends with
      // " — <label>", a second-pass re-fan would produce a doubly-suffixed
      // title. Log a warning and keep the parent title as-is.
      const labelSuffix = ` — ${target.label}`;
      let childTitle: string;
      if (issue.title.endsWith(labelSuffix)) {
        console.warn(
          `[fan-out] title compound guard: parent title "${issue.title}" already ends ` +
          `with "${labelSuffix}". Skipping re-append (possible double fan-out pass).`,
        );
        childTitle = issue.title;
      } else {
        childTitle = `${issue.title} — ${target.label}`;
      }
      const childIssueResult = await client.query<{ id: string }>(
        `INSERT INTO issues (project_id, title, body, status, assignee_id)
         VALUES ($1, $2, $3, 'ready', $4)
         RETURNING id`,
        [issue.projectId, childTitle, issue.body ?? '', target.agentId ?? null],
      );
      const childIssueId = childIssueResult.rows[0].id;

      // Merge parent variables with target-specific variables
      const childVariables = { ...parentVariables, ...target.variables };

      // Create child workflowRun (inheriting pinnedAgentRevisions per Invariant 5)
      const childWfResult = await client.query<{ id: string }>(
        `INSERT INTO workflow_runs
           (issue_id, status, current_step_index,
            parent_workflow_run_id, pinned_agent_revisions,
            variables, inline_steps_json)
         VALUES ($1, 'pending', 0, $2, $3, $4, $5)
         RETURNING id`,
        [
          childIssueId,
          parentWorkflowRunId,
          pinnedAgentRevisions,
          JSON.stringify(childVariables),
          JSON.stringify(fanOutStep.steps),
        ],
      );
      const childWorkflowRunId = childWfResult.rows[0].id;
      childWorkflowRunIds.push(childWorkflowRunId);

      // Create step_runs for every child step (with resolved agent on first agent_run)
      for (let stepIdx = 0; stepIdx < fanOutStep.steps.length; stepIdx++) {
        const childStep = fanOutStep.steps[stepIdx];

        // Resolve agent for agent_run steps using the split target
        let resolvedAgentId: string | null = null;
        let firstIssueRunId: string | null = null;

        if (childStep.type === 'agent_run' && stepIdx === 0) {
          resolvedAgentId = target.agentId;

          if (resolvedAgentId) {
            // Pre-create the pending issueRun so the stepper picks it up automatically
            const issueRunResult = await client.query<{ id: string }>(
              `INSERT INTO issue_runs (issue_id, agent_id, kind, status)
               VALUES ($1, $2, 'agent_run', 'pending')
               RETURNING id`,
              [childIssueId, resolvedAgentId],
            );
            firstIssueRunId = issueRunResult.rows[0].id;
          }
        }

        await client.query(
          `INSERT INTO step_runs
             (workflow_run_id, step_index, step_type, status,
              step_config, resolved_agent_id, issue_run_id)
           VALUES ($1, $2, $3, 'pending', $4, $5, $6)`,
          [
            childWorkflowRunId,
            stepIdx,
            childStep.type,
            JSON.stringify(childStep),
            resolvedAgentId,
            firstIssueRunId,
          ],
        );
      }

      // Create issue_link (parent → child)
      await client.query(
        `INSERT INTO issue_links (parent_issue_id, child_issue_id, link_type)
         VALUES ($1, $2, 'fan_out')`,
        [issue.id, childIssueId],
      );

      // Create handoff_context (captures inherited variables + target context)
      await client.query(
        `INSERT INTO handoff_context (workflow_run_id, step_run_id, target_issue_id, context_json)
         VALUES ($1, $2, $3, $4)`,
        [
          childWorkflowRunId,
          parentStepRunId,
          childIssueId,
          JSON.stringify({
            splitTarget: target,
            parentWorkflowRunId,
            inheritedVariables: parentVariables,
          }),
        ],
      );
    }

    // ── Step 5: UPDATE parent workflowRun childIds ───────────────────────────
    await client.query(
      `UPDATE workflow_runs
          SET child_workflow_run_ids = $1, updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(childWorkflowRunIds), parentWorkflowRunId],
    );

    // ── Step 6: COMMIT ────────────────────────────────────────────────────────
    await client.query('COMMIT');

    console.log(
      `[fan-out] materialized ${targets.length} child workflow_run(s) for parent ${parentWorkflowRunId}` +
      ` [${childWorkflowRunIds.join(', ')}]`,
    );

    return childWorkflowRunIds;
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// materializeAndSpawnFanOut — Phase 15 wrapper that runs the atomic
// materialisation transaction (Invariant 5) and then, only when the
// FanOutStep has `mode: 'parallel'`, immediately spawns each child's first
// LLM session via the SDK's spawnParallel() instead of waiting for the
// dispatcher to claim them serially (one-tick-per-claim, ~5 s gap).
//
// Architectural decisions (Phase 15):
//   1. Default `mode: 'serial'` is byte-identical to pre-Phase-15 behaviour
//      — this wrapper just calls materializeFanOut and returns.
//   2. Children still flow through the normal step lifecycle; this only
//      changes HOW the FIRST session is created (parallel vs serial).
//   3. Failure isolation: SDK's Promise.allSettled isolates failures.
//      Per-child spawn errors are persisted as failed step_runs.
//   4. Idempotent: if the parallel spawn helper crashes mid-flight,
//      unstarted children are still picked up by the dispatcher on the
//      next tick (parallel mode is an OPTIMIZATION, not a correctness
//      change).
//   5. Fail-closed: if the helper throws at the framework level (not at
//      individual SpawnResult level — e.g. SDK import error), we log and
//      return childIds anyway so the dispatcher can take over.
// ---------------------------------------------------------------------------

export interface MaterializeAndSpawnResult {
  childWorkflowRunIds: string[];
  /**
   * Populated only when fanOutStep.mode === 'parallel' AND the spawn
   * helper executed without a framework-level crash. May still contain
   * individual per-child failures.
   */
  spawnResults?: FanOutSpawnResult[];
  /** Human-readable reason if the parallel-spawn path was skipped. */
  parallelSpawnSkippedReason?: string;
}

export async function materializeAndSpawnFanOut(
  parentWorkflowRunId: string,
  parentStepRunId: string,
  fanOutStep: FanOutStep,
  issue: Issue,
  db: DrizzleDb,
): Promise<MaterializeAndSpawnResult> {
  const childWorkflowRunIds = await materializeFanOut(
    parentWorkflowRunId,
    parentStepRunId,
    fanOutStep,
    issue,
    db,
  );

  // ── Flow event: lineage edges created for each child ────────────────────────
  if (childWorkflowRunIds.length > 0) {
    const createdAt = new Date().toISOString();
    for (const childId of childWorkflowRunIds) {
      eventBus.emitFlowEvent('flow.lineage.edge.created', issue.projectId, {
        fromInstanceId: parentWorkflowRunId,
        toInstanceId: childId,
        relation: 'fan_out',
        createdAt,
      });
    }
  }

  // Phase 15: serial mode = byte-identical pre-Phase-15 behaviour.
  const mode = fanOutStep.mode ?? 'serial';
  if (mode !== 'parallel') {
    return { childWorkflowRunIds };
  }

  if (childWorkflowRunIds.length === 0) {
    return {
      childWorkflowRunIds,
      parallelSpawnSkippedReason: 'no children materialised',
    };
  }

  // Build FanOutChild[] from the freshly-created child workflow_runs.
  // Done outside the materialisation transaction (already committed) so
  // these reads see the just-inserted rows.
  let children: FanOutChild[];
  try {
    children = await loadFanOutChildren(
      childWorkflowRunIds,
      issue.projectId,
      db,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      '[fan-out] parallel spawn skipped — failed to load child context:',
      msg,
    );
    return {
      childWorkflowRunIds,
      parallelSpawnSkippedReason: `loadFanOutChildren failed: ${msg}`,
    };
  }

  if (children.length === 0) {
    return {
      childWorkflowRunIds,
      parallelSpawnSkippedReason: 'no spawnable agent_run children',
    };
  }

  // Fire-and-await the parallel spawn. spawnFanOutChildren never throws
  // (per its contract) — but defend anyway so a future refactor can't take
  // down the workflow-runner.
  let spawnResults: FanOutSpawnResult[] = [];
  try {
    spawnResults = await spawnFanOutChildren({
      parentStepRunId,
      parentWorkflowRunId,
      projectId: issue.projectId,
      children,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      '[fan-out] parallel spawn helper crashed — falling back to dispatcher:',
      msg,
    );
    return {
      childWorkflowRunIds,
      parallelSpawnSkippedReason: `spawnFanOutChildren threw: ${msg}`,
    };
  }

  return { childWorkflowRunIds, spawnResults };
}

/**
 * Load the per-child context needed to spawn a FanOutChild — joins the
 * child workflow_run, its first agent_run step_run, the resolved agent,
 * and the issue/project for charter + workspace + project default model.
 *
 * Children whose first step is NOT an agent_run (or has no resolved agent)
 * are skipped — the dispatcher will pick them up the normal way.
 */
async function loadFanOutChildren(
  childWorkflowRunIds: string[],
  projectId: string,
  db: DrizzleDb,
): Promise<FanOutChild[]> {
  if (childWorkflowRunIds.length === 0) return [];

  // Get the project's default model + path (squad path) once.
  const projectRows = await db.execute(sql`
    SELECT default_model, path FROM projects WHERE id = ${projectId}::uuid LIMIT 1
  `);
  const project = (projectRows.rows as Array<{
    default_model: string | null;
    path: string;
  }>)[0];
  const projectDefaultModel = project?.default_model ?? null;
  const projectSquadPath = project?.path ?? '';

  // Pull the first step_run for each child (step_index = 0). For agent_run
  // steps, the materialiser pre-creates an issue_run so we have a path to
  // the workspace and resolved_agent_id.
  // Each id is cast individually to uuid because drizzle's array binding for
  // ANY(...) interpolates as a Postgres record, not a uuid[].
  // Also cast sr.resolved_agent_id (text) when joining to agents.id (uuid).
  const idLiterals = sql.join(
    childWorkflowRunIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute(sql`
    SELECT
      sr.id                AS step_run_id,
      sr.workflow_run_id   AS workflow_run_id,
      sr.step_type         AS step_type,
      sr.resolved_agent_id AS resolved_agent_id,
      sr.issue_run_id      AS issue_run_id,
      sr.step_config       AS step_config,
      a.id                 AS agent_id,
      a.name               AS agent_name,
      a.charter_path       AS charter_path,
      a.model              AS agent_model,
      i.id                 AS issue_id,
      i.title              AS issue_title,
      i.body               AS issue_body
    FROM step_runs sr
    JOIN workflow_runs wr ON wr.id = sr.workflow_run_id
    JOIN issues i         ON i.id = wr.issue_id
    LEFT JOIN agents a    ON a.id = sr.resolved_agent_id::uuid
    WHERE sr.workflow_run_id IN (${idLiterals})
      AND sr.step_index = 0
    ORDER BY sr.created_at
  `);

  const out: FanOutChild[] = [];
  for (const r of rows.rows as Array<{
    step_run_id: string;
    workflow_run_id: string;
    step_type: string;
    resolved_agent_id: string | null;
    issue_run_id: string | null;
    step_config: Record<string, unknown> | null;
    agent_id: string | null;
    agent_name: string | null;
    charter_path: string | null;
    agent_model: string | null;
    issue_id: string;
    issue_title: string;
    issue_body: string | null;
  }>) {
    // Only spawn for agent_run children with a resolved agent + charter.
    if (r.step_type !== 'agent_run' || !r.agent_id || !r.charter_path) {
      continue;
    }

    // Resolve workspace path from issue_runs.workspace_path if the
    // materialiser pre-created the issue_run. Otherwise fall back to the
    // project squad path; the SDK will adopt that as cwd.
    let workspacePath = projectSquadPath;
    if (r.issue_run_id) {
      const wsRows = await db.execute(sql`
        SELECT workspace_path FROM issue_runs WHERE id = ${r.issue_run_id}::uuid LIMIT 1
      `);
      const ws = (wsRows.rows as Array<{ workspace_path: string | null }>)[0];
      if (ws?.workspace_path) workspacePath = ws.workspace_path;
    }

    const promptOverride =
      r.step_config && typeof (r.step_config as { prompt?: string }).prompt === 'string'
        ? (r.step_config as { prompt: string }).prompt
        : null;

    const task = promptOverride
      ? promptOverride
      : `# ${r.issue_title}\n\n${r.issue_body ?? ''}`;

    out.push({
      workflowRunId: r.workflow_run_id,
      stepRunId: r.step_run_id,
      agentName: r.agent_name ?? '',
      agentId: r.agent_id,
      charterPath: r.charter_path,
      agentModel: r.agent_model,
      projectDefaultModel,
      workspacePath,
      squadPath: projectSquadPath,
      task,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// checkFanOutCompletion — merge/join gate
// ---------------------------------------------------------------------------

export async function checkFanOutCompletion(
  parentWorkflowRunId: string,
  mergeStrategy: 'all' | 'any' | 'first',
  onChildFailure: 'continue' | 'fail_fast',
  db: DrizzleDb,
): Promise<{ done: boolean; failed: boolean; results: ChildResult[] }> {
  const rows = await db.execute(
    sql`
      SELECT
        wr.id              AS workflow_run_id,
        wr.issue_id        AS issue_id,
        wr.status          AS status
      FROM workflow_runs wr
      WHERE wr.parent_workflow_run_id = ${parentWorkflowRunId}
      ORDER BY wr.created_at
    `,
  );

  const children = rows.rows as Array<{
    workflow_run_id: string;
    issue_id: string;
    status: string;
  }>;

  if (children.length === 0) {
    return { done: true, failed: false, results: [] };
  }

  // Collect each child's latest step_run output for the merge result
  const results: ChildResult[] = await Promise.all(
    children.map(async (c) => {
      const stepRows = await db.execute(
        sql`
          SELECT output FROM step_runs
          WHERE workflow_run_id = ${c.workflow_run_id}
          ORDER BY step_index DESC
          LIMIT 1
        `,
      );
      const lastOutput = ((stepRows.rows as Array<{ output: string | null }>)[0])?.output ?? null;
      return {
        workflowRunId: c.workflow_run_id,
        issueId: c.issue_id,
        status: c.status,
        completed: c.status === 'completed',
        failed: c.status === 'failed' || c.status === 'timed_out',
        output: lastOutput,
      };
    }),
  );

  const anyFailed = results.some((r) => r.failed);
  const allTerminal = results.every((r) => r.completed || r.failed);
  const anyCompleted = results.some((r) => r.completed);

  // fast-fail: if any child failed and policy is fail_fast, we're done (with failure)
  if (anyFailed && onChildFailure === 'fail_fast') {
    return { done: true, failed: true, results };
  }

  let done = false;
  switch (mergeStrategy) {
    case 'all':
      done = allTerminal;
      break;
    case 'any':
      done = anyCompleted;
      break;
    case 'first':
      done = anyCompleted;
      if (done) {
        // Cancel remaining running children
        await db.execute(
          sql`
            UPDATE workflow_runs
               SET status = 'cancelled', updated_at = NOW()
             WHERE parent_workflow_run_id = ${parentWorkflowRunId}
               AND status NOT IN ('completed', 'failed', 'cancelled', 'timed_out')
          `,
        );
      }
      break;
  }

  return { done, failed: false, results };
}
