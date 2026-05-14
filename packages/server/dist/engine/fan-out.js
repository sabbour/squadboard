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
// ---------------------------------------------------------------------------
// resolveTargets — resolve split_by to concrete SplitTarget[]
// ---------------------------------------------------------------------------
export async function resolveTargets(fanOutStep, issue, db) {
    switch (fanOutStep.split_by) {
        case 'agents': {
            if (!fanOutStep.agents || fanOutStep.agents.length === 0) {
                throw new Error('fan_out with split_by=agents requires a non-empty agents list');
            }
            const targets = [];
            for (const agentName of fanOutStep.agents) {
                const rows = await db.execute(sql `SELECT id, name FROM agents WHERE project_id = ${issue.projectId} AND name = ${agentName} LIMIT 1`);
                const row = rows.rows[0];
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
            const labelRows = await db.execute(sql `
          SELECT l.id AS label_id, l.name AS label_name
          FROM issue_labels il
          JOIN labels l ON l.id = il.label_id
          WHERE il.issue_id = ${issue.id}
          ORDER BY l.name
        `);
            const foundLabels = labelRows.rows;
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
            const targets = [];
            for (let i = 0; i < count; i++) {
                const agentName = agentPool.length > 0 ? agentPool[i % agentPool.length] : '';
                let agentId = null;
                if (agentName) {
                    const rows = await db.execute(sql `SELECT id FROM agents WHERE project_id = ${issue.projectId} AND name = ${agentName} LIMIT 1`);
                    agentId = (rows.rows[0])?.id ?? null;
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
export async function materializeFanOut(parentWorkflowRunId, parentStepRunId, fanOutStep, issue, db) {
    // Pre-resolve targets outside the transaction (read-only queries are safe outside)
    const targets = await resolveTargets(fanOutStep, issue, db);
    // Load parent pinnedAgentRevisions and variables for inheritance
    const parentRows = await db.execute(sql `SELECT pinned_agent_revisions, variables FROM workflow_runs WHERE id = ${parentWorkflowRunId}`);
    const parent = parentRows.rows[0];
    const pinnedAgentRevisions = parent?.pinned_agent_revisions ?? null;
    const parentVariables = parent?.variables ?? {};
    const pool = getPool();
    const client = await pool.connect();
    try {
        // ── Step 1: BEGIN ────────────────────────────────────────────────────────
        await client.query('BEGIN');
        // ── Step 2: UPDATE parent stepRun → status='splitting' ──────────────────
        await client.query(`UPDATE step_runs
          SET status = 'splitting', updated_at = NOW()
        WHERE id = $1`, [parentStepRunId]);
        // ── Steps 3 + 4: INSERT child workflowRuns + step_runs ──────────────────
        const childWorkflowRunIds = [];
        for (const target of targets) {
            // Create child issue (subtask)
            const childTitle = `${issue.title} — ${target.label}`;
            const childIssueResult = await client.query(`INSERT INTO issues (project_id, title, body, status, assignee_id)
         VALUES ($1, $2, $3, 'todo', $4)
         RETURNING id`, [issue.projectId, childTitle, issue.body ?? '', target.agentId ?? null]);
            const childIssueId = childIssueResult.rows[0].id;
            // Merge parent variables with target-specific variables
            const childVariables = { ...parentVariables, ...target.variables };
            // Create child workflowRun (inheriting pinnedAgentRevisions per Invariant 5)
            const childWfResult = await client.query(`INSERT INTO workflow_runs
           (issue_id, status, current_step_index,
            parent_workflow_run_id, pinned_agent_revisions,
            variables, inline_steps_json)
         VALUES ($1, 'pending', 0, $2, $3, $4, $5)
         RETURNING id`, [
                childIssueId,
                parentWorkflowRunId,
                pinnedAgentRevisions,
                JSON.stringify(childVariables),
                JSON.stringify(fanOutStep.steps),
            ]);
            const childWorkflowRunId = childWfResult.rows[0].id;
            childWorkflowRunIds.push(childWorkflowRunId);
            // Create step_runs for every child step (with resolved agent on first agent_run)
            for (let stepIdx = 0; stepIdx < fanOutStep.steps.length; stepIdx++) {
                const childStep = fanOutStep.steps[stepIdx];
                // Resolve agent for agent_run steps using the split target
                let resolvedAgentId = null;
                let firstIssueRunId = null;
                if (childStep.type === 'agent_run' && stepIdx === 0) {
                    resolvedAgentId = target.agentId;
                    if (resolvedAgentId) {
                        // Pre-create the pending issueRun so the stepper picks it up automatically
                        const issueRunResult = await client.query(`INSERT INTO issue_runs (issue_id, agent_id, kind, status)
               VALUES ($1, $2, 'agent_run', 'pending')
               RETURNING id`, [childIssueId, resolvedAgentId]);
                        firstIssueRunId = issueRunResult.rows[0].id;
                    }
                }
                await client.query(`INSERT INTO step_runs
             (workflow_run_id, step_index, step_type, status,
              step_config, resolved_agent_id, issue_run_id)
           VALUES ($1, $2, $3, 'pending', $4, $5, $6)`, [
                    childWorkflowRunId,
                    stepIdx,
                    childStep.type,
                    JSON.stringify(childStep),
                    resolvedAgentId,
                    firstIssueRunId,
                ]);
            }
            // Create issue_link (parent → child)
            await client.query(`INSERT INTO issue_links (parent_issue_id, child_issue_id, link_type)
         VALUES ($1, $2, 'fan_out')`, [issue.id, childIssueId]);
            // Create handoff_context (captures inherited variables + target context)
            await client.query(`INSERT INTO handoff_context (workflow_run_id, step_run_id, target_issue_id, context_json)
         VALUES ($1, $2, $3, $4)`, [
                childWorkflowRunId,
                parentStepRunId,
                childIssueId,
                JSON.stringify({
                    splitTarget: target,
                    parentWorkflowRunId,
                    inheritedVariables: parentVariables,
                }),
            ]);
        }
        // ── Step 5: UPDATE parent workflowRun childIds ───────────────────────────
        await client.query(`UPDATE workflow_runs
          SET child_workflow_run_ids = $1, updated_at = NOW()
        WHERE id = $2`, [JSON.stringify(childWorkflowRunIds), parentWorkflowRunId]);
        // ── Step 6: COMMIT ────────────────────────────────────────────────────────
        await client.query('COMMIT');
        console.log(`[fan-out] materialized ${targets.length} child workflow_run(s) for parent ${parentWorkflowRunId}` +
            ` [${childWorkflowRunIds.join(', ')}]`);
        return childWorkflowRunIds;
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
}
// ---------------------------------------------------------------------------
// checkFanOutCompletion — merge/join gate
// ---------------------------------------------------------------------------
export async function checkFanOutCompletion(parentWorkflowRunId, mergeStrategy, onChildFailure, db) {
    const rows = await db.execute(sql `
      SELECT
        wr.id              AS workflow_run_id,
        wr.issue_id        AS issue_id,
        wr.status          AS status
      FROM workflow_runs wr
      WHERE wr.parent_workflow_run_id = ${parentWorkflowRunId}
      ORDER BY wr.created_at
    `);
    const children = rows.rows;
    if (children.length === 0) {
        return { done: true, failed: false, results: [] };
    }
    // Collect each child's latest step_run output for the merge result
    const results = await Promise.all(children.map(async (c) => {
        const stepRows = await db.execute(sql `
          SELECT output FROM step_runs
          WHERE workflow_run_id = ${c.workflow_run_id}
          ORDER BY step_index DESC
          LIMIT 1
        `);
        const lastOutput = (stepRows.rows[0])?.output ?? null;
        return {
            workflowRunId: c.workflow_run_id,
            issueId: c.issue_id,
            status: c.status,
            completed: c.status === 'completed',
            failed: c.status === 'failed',
            output: lastOutput,
        };
    }));
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
                await db.execute(sql `
            UPDATE workflow_runs
               SET status = 'cancelled', updated_at = NOW()
             WHERE parent_workflow_run_id = ${parentWorkflowRunId}
               AND status NOT IN ('completed', 'failed', 'cancelled')
          `);
            }
            break;
    }
    return { done, failed: false, results };
}
//# sourceMappingURL=fan-out.js.map