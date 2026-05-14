import { sql, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { resolveWorkspace } from './workspace.js';
import { executeAgentRun } from '../sdk/bridge.js';
import { recordRunCompletion } from '../services/output-validator.js';
const LEASE_TTL_SECONDS = 90;
const HEARTBEAT_INTERVAL_MS = 30_000;
/**
 * Claim exactly one pending issue_run and execute it.
 *
 * Invariant 2 — FOR UPDATE SKIP LOCKED is the ONLY mechanism by which a run
 * transitions to 'running'. No other code path may set status='running'.
 */
export async function claimAndRun(db) {
    // Atomic claim: BEGIN → SELECT FOR UPDATE SKIP LOCKED → UPDATE → COMMIT
    const claimedId = await db.transaction(async (tx) => {
        const result = await tx.execute(sql `SELECT id FROM issue_runs WHERE status='pending' LIMIT 1 FOR UPDATE SKIP LOCKED`);
        const rows = result.rows;
        if (rows.length === 0)
            return undefined;
        const runId = rows[0].id;
        await tx.execute(sql `
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
    if (!claimedId)
        return;
    // Spawn worker asynchronously — do not await so the dispatcher tick returns quickly.
    runWorker(claimedId).catch((err) => {
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
export async function runWorker(issueRunId) {
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
    // Resolve the workflow version attached to this issue (for Invariant 4)
    const workflowVersionId = await resolveWorkflowVersionId(db, run.issueId);
    // --- Resolve workspace ---
    let workspacePath;
    try {
        workspacePath = await resolveWorkspace(issueRunId, run.workspaceStrategy);
        await db
            .update(issueRuns)
            .set({ workspacePath, updatedAt: new Date() })
            .where(eq(issueRuns.id, issueRunId));
    }
    catch (err) {
        await markFailed(db, issueRunId, `Workspace error: ${String(err)}`);
        return;
    }
    // --- Start heartbeat (every 30 s, extends lease by 90 s) ---
    const heartbeatTimer = setInterval(async () => {
        try {
            await db.execute(sql `
        UPDATE issue_runs
        SET
          heartbeat_at     = NOW(),
          lease_expires_at = NOW() + INTERVAL '${sql.raw(String(LEASE_TTL_SECONDS))} seconds',
          updated_at       = NOW()
        WHERE id = ${issueRunId}
          AND status = 'running'
      `);
        }
        catch (err) {
            console.error(`[stepper] heartbeat failed for ${issueRunId}:`, err);
        }
    }, HEARTBEAT_INTERVAL_MS);
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
            await recordRunCompletion(issueRunId, result.output ?? '', workflowVersionId);
        }
        else {
            await markFailed(db, issueRunId, result.errorMessage ?? 'Agent run failed');
        }
    }
    catch (err) {
        clearInterval(heartbeatTimer);
        await markFailed(db, issueRunId, err instanceof Error ? err.message : String(err));
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function markFailed(db, issueRunId, errorMessage) {
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
}
/**
 * Look up the workflow version attached to an issue (if any).
 * Used to pass workflowVersionId to recordRunCompletion for Invariant 4.
 */
async function resolveWorkflowVersionId(db, issueId) {
    const { issueWorkflows } = schema;
    const rows = await db
        .select({ workflowVersionId: issueWorkflows.workflowVersionId })
        .from(issueWorkflows)
        .where(eq(issueWorkflows.issueId, issueId))
        .limit(1);
    return rows[0]?.workflowVersionId ?? null;
}
//# sourceMappingURL=stepper.js.map