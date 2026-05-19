/**
 * sweeps/stuck-issue-runs.ts — Phase 3 Heartbeat
 *
 * Reclaims issue_runs whose lease has expired without a clean completion
 * (process crash, OOM, timeout). Resets status → 'pending' so the Stepper
 * can pick them up again. Also covers: orphaned runs with no heartbeat,
 * expired step-run leases, orphaned workflow_runs, and review-step timeouts —
 * all cleanup duties previously bundled in the dispatcher 5s tick.
 *
 * Runs every 30 s.
 */
import type { Sweep, SweepResult } from '../heartbeat.js';
import { getDb } from '../../db/index.js';
import {
  sweepExpiredLeases,
  sweepOrphanedRuns,
  sweepExpiredStepLeases,
  sweepOrphanedWorkflowRuns,
} from '../sweeper.js';
import { sweepReviewTimeouts } from '../../services/review-timeout-sweep.js';

export const stuckIssueRunsSweep: Sweep = {
  id: 'stuck-issue-runs',
  label: 'Stuck runs',
  description: 'Reclaims expired leases, orphaned workflow runs, and review timeouts so work can continue.',
  scope: 'project',
  intervalMs: 30_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const db = getDb();
    let acted = 0;
    let errors = 0;
    const details: string[] = [];

    const tasks: Array<{ label: string; fn: () => Promise<number> }> = [
      { label: 'expired-leases',       fn: () => sweepExpiredLeases(db) },
      { label: 'orphaned-runs',        fn: () => sweepOrphanedRuns(db) },
      { label: 'expired-step-leases',  fn: () => sweepExpiredStepLeases(db) },
      { label: 'orphaned-workflow-runs', fn: () => sweepOrphanedWorkflowRuns(db) },
      {
        label: 'review-timeouts',
        fn: async () => {
          const r = await sweepReviewTimeouts();
          return r.fired ?? 0;
        },
      },
    ];

    for (const { label, fn } of tasks) {
      try {
        const n = await fn();
        acted += n;
        if (n > 0) details.push(`${label}=${n}`);
      } catch (err) {
        errors += 1;
        console.error(`[sweep:stuck-issue-runs] ${label} failed:`, err);
      }
    }

    return { acted, errors, details: details.join(' ') || undefined };
  },
};
