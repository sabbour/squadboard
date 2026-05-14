import { getDb } from '../db/index.js';
import { sweepExpiredLeases, sweepOrphanedRuns, sweepExpiredStepLeases, sweepOrphanedWorkflowRuns } from './sweeper.js';
import { claimAndRun } from './stepper.js';
import { tickWorkflowAdvancement } from './workflow-runner.js';

const TICK_INTERVAL_MS = 5_000;
const TICK_JITTER_MS = 500; // ±500ms jitter to avoid thundering herd on multi-instance deploys

/**
 * Dispatcher — the engine's heartbeat.
 *
 * Every ~5 seconds (±500ms jitter):
 *   1. sweepExpiredLeases()         — reclaim issue_runs whose 90 s lease expired
 *   2. sweepOrphanedRuns()          — fail issue_runs with no heartbeat > 120 s
 *   3. sweepExpiredStepLeases()     — retry or fail expired step_runs
 *   4. sweepOrphanedWorkflowRuns()  — fail workflow_runs with no active steps
 *   5. claimAndRun()                — Stepper claims one pending run via FOR UPDATE SKIP LOCKED
 *
 * Invariant 2: only the stepper (via claimAndRun) may set status='running'.
 * The dispatcher never touches status directly — it only calls sweep + wake.
 */
export class Dispatcher {
  private timeoutId?: NodeJS.Timeout;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[dispatcher] starting — tick every ~5 s (±500ms jitter)');
    this.scheduleTick();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    console.log('[dispatcher] stopped');
  }

  private scheduleTick(): void {
    if (!this.running) return;
    const jitter = Math.floor((Math.random() * 2 - 1) * TICK_JITTER_MS);
    const delay = TICK_INTERVAL_MS + jitter;
    this.timeoutId = setTimeout(() => {
      this.tick()
        .catch((err: unknown) => {
          console.error('[dispatcher] tick error:', err);
        })
        .finally(() => {
          this.scheduleTick();
        });
    }, delay);
  }

  private async tick(): Promise<void> {
    const db = getDb();

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug('[dispatcher] heartbeat');
    }

    // 1. Reclaim expired issue_run leases → back to 'pending'
    await sweepExpiredLeases(db);

    // 2. Fail orphaned issue_runs with no heartbeat
    await sweepOrphanedRuns(db);

    // 3. Reclaim or fail expired step_run leases (retry policy enforcement)
    await sweepExpiredStepLeases(db);

    // 4. Fail workflow_runs whose steps all finished but run was never finalized
    await sweepOrphanedWorkflowRuns(db);

    // 5. Advance active workflow_runs (fan_out completion, step transitions, etc.)
    await tickWorkflowAdvancement();

    // 6. Stepper: claim one pending issue_run and execute it
    await claimAndRun(db);
  }
}

// Singleton instance used by the server entry point.
export const dispatcher = new Dispatcher();
