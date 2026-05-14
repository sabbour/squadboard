import { sql } from 'drizzle-orm';
import type { DrizzleDb } from '../db/index.js';

/**
 * Reclaim runs whose lease has expired (process crashed mid-run).
 * Resets status → 'pending' so the stepper can re-claim them.
 *
 * Invariant 3: lease_expires_at (90 s TTL) is the authoritative liveness signal.
 *
 * @returns number of runs reclaimed
 */
export async function sweepExpiredLeases(db: DrizzleDb): Promise<number> {
  const result = await db.execute(sql`
    UPDATE issue_runs
    SET
      status           = 'pending',
      lease_expires_at = NULL,
      heartbeat_at     = NULL,
      updated_at       = NOW()
    WHERE status = 'running'
      AND lease_expires_at < NOW()
  `);
  const count = (result as unknown as { rowCount: number | null }).rowCount ?? 0;
  if (count > 0) {
    console.log(`[sweeper] reclaimed ${count} expired lease(s)`);
  }
  return count;
}

/**
 * Fail runs that are nominally 'running' but have not sent a heartbeat in
 * the last 120 seconds (2× the 60 s grace window above the 90 s lease TTL).
 * These are truly orphaned — the process is gone and the lease already expired
 * on a previous tick, so sweepExpiredLeases already reset them; this function
 * catches any edge cases where the lease was extended right before the crash.
 *
 * @returns number of runs marked failed
 */
export async function sweepOrphanedRuns(db: DrizzleDb): Promise<number> {
  const result = await db.execute(sql`
    UPDATE issue_runs
    SET
      status        = 'failed',
      error_message = 'Orphaned: no heartbeat',
      updated_at    = NOW()
    WHERE status = 'running'
      AND heartbeat_at < NOW() - INTERVAL '120 seconds'
  `);
  const count = (result as unknown as { rowCount: number | null }).rowCount ?? 0;
  if (count > 0) {
    console.log(`[sweeper] orphaned ${count} run(s) with no heartbeat`);
  }
  return count;
}
