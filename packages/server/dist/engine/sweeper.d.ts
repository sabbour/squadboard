import type { DrizzleDb } from '../db/index.js';
/**
 * Reclaim issue_runs whose lease has expired (process crashed mid-run).
 * Resets status → 'pending' so the stepper can re-claim them.
 *
 * Invariant 3: lease_expires_at (90 s TTL) is the authoritative liveness signal.
 *
 * @returns number of runs reclaimed
 */
export declare function sweepExpiredLeases(db: DrizzleDb): Promise<number>;
/**
 * Fail issue_runs that are nominally 'running' but have not sent a heartbeat
 * in the last 120 seconds. These are truly orphaned.
 *
 * @returns number of runs marked failed
 */
export declare function sweepOrphanedRuns(db: DrizzleDb): Promise<number>;
/**
 * Reclaim step_runs whose lease has expired.
 *
 * - If retry_count < max_retries → reset to 'pending' with retry_count++
 * - If retry_count >= max_retries → mark step 'failed' and fail the parent workflow_run
 *
 * @returns number of steps processed
 */
export declare function sweepExpiredStepLeases(db: DrizzleDb): Promise<number>;
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
export declare function sweepOrphanedWorkflowRuns(db: DrizzleDb): Promise<number>;
//# sourceMappingURL=sweeper.d.ts.map