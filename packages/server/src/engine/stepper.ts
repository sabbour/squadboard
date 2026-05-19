import { sql, eq } from 'drizzle-orm';
import { getDb, schema, type DrizzleDb } from '../db/index.js';
import { resolveWorkspaceLifecycle } from './workspace.js';
import { executeAgentRun } from '../sdk/bridge.js';
import { recordRunCompletion } from '../services/output-validator.js';
import { eventBus } from '../realtime/event-bus.js';

const LEASE_TTL_SECONDS = 90;
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Claim exactly one pending issue_run and execute it.
 *
 * Invariant 2 — FOR UPDATE SKIP LOCKED is the ONLY mechanism by which a run
 * transitions to 'running'. No other code path may set status='running'.
 */
export async function claimAndRun(db: DrizzleDb): Promise<void> {
  // Atomic claim: BEGIN → SELECT FOR UPDATE SKIP LOCKED → UPDATE → COMMIT
  const claimedId = await db.transaction(async (tx) => {
    const result = await tx.execute(
      sql`SELECT id FROM issue_runs WHERE status='pending' LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    const rows = result.rows as Array<{ id: string }>;
    if (rows.length === 0) return undefined;

    const runId = rows[0].id;
    await tx.execute(sql`
      UPDATE issue_runs
      SET
        status           = 'running',
        lease_expires_at = NOW() + INTERVAL '${sql.raw(String(LEASE_TTL_SECONDS))} seconds',
        heartbeat_at     = NOW(),
        started_at       = NOW(),
        updated_at       = NOW()
      WHERE id = ${runId}
    `);
    return runId;
  });

  if (!claimedId) return;

  await syncRunIssueColumn(db, claimedId, 'in_progress');

  // Spawn worker asynchronously — do not await so the dispatcher tick returns quickly.
  runWorker(claimedId).catch((err: unknown) => {
    console.error(`[stepper] runWorker(${claimedId}) crashed:`, err);
  });
}

/**
 * Execute one claimed issue_run:
 *  1. Load run + related records
 *  2. Resolve workspace
 *  3. Heartbeat loop (every 30 s)
 *  4. Call SDK bridge (Kobayashi's implementation)
 *  5. Persist result and clear lease
 */
export async function runWorker(issueRunId: string): Promise<void> {
  const db = getDb();
  const { issueRuns, agents, issues, projects } = schema;

  // --- Load full run context ---
  const [run] = await db
    .select()
    .from(issueRuns)
    .where(eq(issueRuns.id, issueRunId))
    .limit(1);

  if (!run) {
    console.error(`[stepper] runWorker: issue_run ${issueRunId} not found`);
    return;
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, run.agentId))
    .limit(1);

  const [issue] = await db
    .select()
    .from(issues)
    .where(eq(issues.id, run.issueId))
    .limit(1);

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, issue.projectId))
    .limit(1);

  if (!agent || !issue || !project) {
    await markFailed(db, issueRunId, 'Missing agent, issue, or project record');
    return;
  }

  // Wave 10 B9: defense-in-depth — even if the route accepted this run while
  // the agent was active, the operator may have disabled or retired it
  // before the worker picked it up. Refuse to spend tokens on a non-active
  // agent and surface a clear failure reason instead.
  if (agent.status !== 'active') {
    await markFailed(
      db,
      issueRunId,
      `Agent "${agent.name}" is ${agent.status} — re-enable it before retrying this run.`,
    );
    return;
  }

  // Resolve the workflow version attached to this issue (for Invariant 4)
  const workflowVersionId = await resolveWorkflowVersionId(db, run.issueId);

  // --- Resolve workspace ---
  let workspacePath: string;
  try {
    const workspace = await resolveWorkspaceLifecycle(issueRunId, run.workspaceStrategy, {
      agentName: agent.name,
      issueTitle: issue.title,
    });
    workspacePath = workspace.workspacePath;
    await db
      .update(issueRuns)
      .set({
        workspacePath,
        ...(workspace.branch ? { gitBranch: workspace.branch } : {}),
        updatedAt: new Date(),
      })
      .where(eq(issueRuns.id, issueRunId));
  } catch (err: unknown) {
    await markFailed(db, issueRunId, `Workspace error: ${String(err)}`);
    return;
  }

  // --- Start heartbeat (every 30 s, extends lease by 90 s) ---
  const heartbeatTimer = setInterval(async () => {
    try {
      await db.execute(sql`
        UPDATE issue_runs
        SET
          heartbeat_at     = NOW(),
          lease_expires_at = NOW() + INTERVAL '${sql.raw(String(LEASE_TTL_SECONDS))} seconds',
          updated_at       = NOW()
        WHERE id = ${issueRunId}
          AND status = 'running'
      `);
      // ── Flow heartbeat (throttled to 1/s in the bus) ─────────────────────
      eventBus.emitFlowHeartbeat(project.id, issueRunId, { instanceId: issueRunId, status: 'active' });
    } catch (err: unknown) {
      console.error(`[stepper] heartbeat failed for ${issueRunId}:`, err);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // ── Flow event: issue_run started ──────────────────────────────────────────
  eventBus.emitFlowEvent('flow.instance.started', project.id, {
    instanceId: issueRunId,
    agentId: run.agentId,
    kind: 'issue_run',
  });

  // --- Call SDK bridge ---
  try {
    // For peer_review runs, prepend the inputContext (prior step output + review prompt)
    // to the issue body so the reviewer agent sees what it must evaluate.
    const effectiveBody = run.inputContext
      ? `${run.inputContext}\n\n---\n\n${issue.body ?? ''}`
      : (issue.body ?? '');

    const result = await executeAgentRun({
      issueRunId,
      projectId: project.id,
      agent,
      issueTitle: issue.title,
      issueBody: effectiveBody,
      workspacePath,
      projectSquadPath: project.path,
      workspaceStrategy: run.workspaceStrategy,
    });

    clearInterval(heartbeatTimer);

    if (result.success) {
      // Persist cost fields first (recordRunCompletion handles status + output)
      await db
        .update(issueRuns)
        .set({
          costTokens: result.tokensUsed ?? 0,
          costUsd: result.costUsd ?? '0',
          updatedAt: new Date(),
        })
        .where(eq(issueRuns.id, issueRunId));

      // Invariant 4: validate output schema (if attached) BEFORE marking completed.
      // recordRunCompletion fires after sendAndWait, before run is finalised.
      await recordRunCompletion(
        issueRunId,
        result.output ?? '',
        workflowVersionId,
      );
      await syncRunIssueColumn(db, issueRunId, 'review');
      // ── Flow event: issue_run ended (completed) ────────────────────────────
      eventBus.emitFlowEvent('flow.instance.ended', project.id, { instanceId: issueRunId, status: 'completed' });
    } else {
      await markFailed(db, issueRunId, result.errorMessage ?? 'Agent run failed');
      // ── Flow event: issue_run ended (failed) ───────────────────────────────
      eventBus.emitFlowEvent('flow.instance.ended', project.id, { instanceId: issueRunId, status: 'failed' });
    }
  } catch (err: unknown) {
    clearInterval(heartbeatTimer);
    await markFailed(db, issueRunId, err instanceof Error ? err.message : String(err));
    // ── Flow event: issue_run ended (failed — exception path) ─────────────────
    eventBus.emitFlowEvent('flow.instance.ended', project.id, { instanceId: issueRunId, status: 'failed' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markFailed(
  db: DrizzleDb,
  issueRunId: string,
  errorMessage: string,
): Promise<void> {
  console.error(`[stepper] run ${issueRunId} failed: ${errorMessage}`);
  await db
    .update(schema.issueRuns)
    .set({
      status: 'failed',
      errorMessage,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.issueRuns.id, issueRunId));
  await syncRunIssueColumn(db, issueRunId, 'review');
}

async function syncRunIssueColumn(
  db: DrizzleDb,
  issueRunId: string,
  semantic: 'in_progress' | 'review',
): Promise<void> {
  try {
    const result = await db.execute(sql`
      WITH run_issue AS (
        SELECT issues.id AS issue_id, issues.project_id AS project_id
        FROM issue_runs
        JOIN issues ON issues.id = issue_runs.issue_id
        WHERE issue_runs.id = ${issueRunId}
      ),
      target AS (
        SELECT column_meta.column_id AS column_id
        FROM column_meta
        JOIN run_issue ON run_issue.project_id = column_meta.project_id
        WHERE column_meta.semantic = ${semantic}
        ORDER BY column_meta.position ASC
        LIMIT 1
      ),
      updated AS (
        UPDATE issues
        SET status = target.column_id,
            updated_at = NOW()
        FROM target, run_issue
        WHERE issues.id = run_issue.issue_id
          AND issues.status <> target.column_id
        RETURNING issues.id AS issue_id, issues.project_id, issues.status, issues.position
      )
      SELECT * FROM updated
    `);
    const [row] = result.rows as Array<{
      issue_id: string;
      project_id: string;
      status: string;
      position: number | null;
    }>;
    if (!row) return;

    eventBus.emitIssueEvent('issue.moved', row.project_id, {
      issueId: row.issue_id,
      column: row.status,
      position: row.position ?? undefined,
    });
  } catch (err) {
    console.error(`[stepper] failed to sync issue column for run ${issueRunId} (${semantic}):`, err);
  }
}

/**
 * Look up the workflow version attached to an issue (if any).
 * Used to pass workflowVersionId to recordRunCompletion for Invariant 4.
 */
async function resolveWorkflowVersionId(
  db: DrizzleDb,
  issueId: string,
): Promise<string | null> {
  const { issueWorkflows } = schema;
  const rows = await db
    .select({ workflowVersionId: issueWorkflows.workflowVersionId })
    .from(issueWorkflows)
    .where(eq(issueWorkflows.issueId, issueId))
    .limit(1);
  return rows[0]?.workflowVersionId ?? null;
}
