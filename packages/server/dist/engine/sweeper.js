import { sql } from 'drizzle-orm';
/**
 * Reclaim issue_runs whose lease has expired (process crashed mid-run).
 * Resets status → 'pending' so the stepper can re-claim them.
 *
 * Invariant 3: lease_expires_at (90 s TTL) is the authoritative liveness signal.
 *
 * @returns number of runs reclaimed
 */
export async function sweepExpiredLeases(db) {
    const result = await db.execute(sql `
    UPDATE issue_runs
    SET
      status           = 'pending',
      lease_expires_at = NULL,
      heartbeat_at     = NULL,
      updated_at       = NOW()
    WHERE status = 'running'
      AND lease_expires_at < NOW()
  `);
    const count = result.rowCount ?? 0;
    if (count > 0) {
        console.log(`[sweeper] reclaimed ${count} expired lease(s)`);
    }
    return count;
}
/**
 * Fail issue_runs that are nominally 'running' but have not sent a heartbeat
 * in the last 120 seconds. These are truly orphaned.
 *
 * @returns number of runs marked failed
 */
export async function sweepOrphanedRuns(db) {
    const result = await db.execute(sql `
    UPDATE issue_runs
    SET
      status        = 'failed',
      error_message = 'Orphaned: no heartbeat for >120s',
      updated_at    = NOW()
    WHERE status = 'running'
      AND heartbeat_at < NOW() - INTERVAL '120 seconds'
  `);
    const count = result.rowCount ?? 0;
    if (count > 0) {
        console.log(`[sweeper] orphaned ${count} issue_run(s) with no heartbeat`);
    }
    return count;
}
/**
 * Reclaim step_runs whose lease has expired.
 *
 * - If retry_count < max_retries → reset to 'pending' with retry_count++
 * - If retry_count >= max_retries → mark step 'failed' and fail the parent workflow_run
 *
 * @returns number of steps processed
 */
export async function sweepExpiredStepLeases(db) {
    // First: fetch expired running step_runs
    const expiredResult = await db.execute(sql `
    SELECT id, workflow_run_id, retry_count, max_retries
    FROM step_runs
    WHERE status = 'running'
      AND lease_expires_at < NOW()
  `);
    const expired = expiredResult.rows;
    if (expired.length === 0)
        return 0;
    const retryable = expired.filter((r) => (r.retry_count ?? 0) < (r.max_retries ?? 3));
    const exhausted = expired.filter((r) => (r.retry_count ?? 0) >= (r.max_retries ?? 3));
    // Retryable: reset to pending with incremented retry_count
    if (retryable.length > 0) {
        const ids = retryable.map((r) => r.id);
        await db.execute(sql `
      UPDATE step_runs
      SET
        status           = 'pending',
        retry_count      = retry_count + 1,
        lease_expires_at = NULL,
        heartbeat_at     = NULL,
        updated_at       = NOW()
      WHERE id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
    `);
        console.log(`[sweeper] retried ${retryable.length} step_run(s) (lease expired)`);
    }
    // Exhausted: mark step failed, then fail the parent workflow_run
    for (const step of exhausted) {
        await db.execute(sql `
      UPDATE step_runs
      SET
        status        = 'failed',
        error_message = 'Max retries exceeded after lease expiry',
        updated_at    = NOW()
      WHERE id = ${step.id}
    `);
        await db.execute(sql `
      UPDATE workflow_runs
      SET
        status     = 'failed',
        updated_at = NOW()
      WHERE id = ${step.workflow_run_id}
        AND status NOT IN ('completed', 'failed', 'cancelled')
    `);
        console.log(`[sweeper] step_run ${step.id} exhausted retries — workflow_run ${step.workflow_run_id} failed`);
    }
    return expired.length;
}
/**
 * Detect workflow_runs that are stuck in 'running' with no active step_runs.
 * This catches cases where all step_runs completed/failed but the parent was
 * never finalized (e.g., mid-run crash during finalisation).
 *
 * Note: step_runs in 'splitting' or 'waiting_children' state are active — they
 * keep the parent workflow alive while fan_out children are in flight.
 *
 * @returns number of workflow_runs marked failed
 */
export async function sweepOrphanedWorkflowRuns(db) {
    const result = await db.execute(sql `
    UPDATE workflow_runs wr
    SET
      status     = 'failed',
      updated_at = NOW()
    WHERE wr.status = 'running'
      AND NOT EXISTS (
        SELECT 1 FROM step_runs sr
        WHERE sr.workflow_run_id = wr.id
          AND sr.status IN ('pending', 'running', 'splitting', 'waiting_children')
      )
  `);
    const count = result.rowCount ?? 0;
    if (count > 0) {
        console.log(`[sweeper] failed ${count} orphaned workflow_run(s) with no active steps`);
    }
    return count;
}
//# sourceMappingURL=sweeper.js.map