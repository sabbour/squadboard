import { getDb } from '../db/index.js';
import { sweepExpiredLeases, sweepOrphanedRuns } from './sweeper.js';
import { claimAndRun } from './stepper.js';

const TICK_INTERVAL_MS = 5_000;

/**
 * Dispatcher — the engine's heartbeat.
 *
 * Every 5 seconds:
 *   1. sweepExpiredLeases()  — reclaim runs whose 90 s lease expired
 *   2. sweepOrphanedRuns()   — fail runs with no heartbeat > 120 s
 *   3. claimAndRun()         — Stepper claims one pending run via FOR UPDATE SKIP LOCKED
 *
 * Invariant 2: only the stepper (via claimAndRun) may set status='running'.
 * The dispatcher never touches status directly — it only calls sweep + wake.
 */
export class Dispatcher {
  private intervalId?: NodeJS.Timeout;

  start(): void {
    if (this.intervalId) return;
    console.log('[dispatcher] starting — tick every 5 s');
    this.intervalId = setInterval(() => {
      this.tick().catch((err: unknown) => {
        console.error('[dispatcher] tick error:', err);
      });
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      console.log('[dispatcher] stopped');
    }
  }

  private async tick(): Promise<void> {
    const db = getDb();

    // 1. Reclaim expired leases → back to 'pending'
    await sweepExpiredLeases(db);

    // 2. Fail orphaned runs with no heartbeat
    await sweepOrphanedRuns(db);

    // 3. Stepper: claim one pending run and execute it
    await claimAndRun(db);
  }
}

// Singleton instance used by the server entry point.
export const dispatcher = new Dispatcher();
