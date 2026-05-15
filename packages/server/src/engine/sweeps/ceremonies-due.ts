/**
 * sweeps/ceremonies-due.ts — Phase 3 Heartbeat
 *
 * Thin wrapper around ceremonyScheduler.sweepDueSchedules().
 * Does NOT reimplement the logic — all idempotency guarding, backoff state,
 * and Verbal's 504f4a57 consecutive-failure backoff live in ceremony-scheduler.ts.
 *
 * Runs every 5 s.
 */
import type { Sweep, SweepResult } from '../heartbeat.js';
import { sweepDueSchedules } from '../../services/ceremony-scheduler.js';

export const ceremoniesDueSweep: Sweep = {
  id: 'ceremonies-due',
  intervalMs: 5_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const result = await sweepDueSchedules();
    // Map the ceremony-scheduler SweepResult shape → heartbeat SweepResult shape.
    const acted = result.fired + result.skipped;
    const details =
      result.scanned > 0
        ? `scanned=${result.scanned} fired=${result.fired} skipped=${result.skipped}`
        : undefined;
    return { acted, errors: result.errors, details };
  },
};
