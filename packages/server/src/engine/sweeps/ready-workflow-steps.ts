/**
 * sweeps/ready-workflow-steps.ts — Phase 3 Heartbeat
 *
 * Advances active workflow_runs by one step: resolves fan_out completions,
 * transitions step states, and wakes any newly-unblocked steps. Also drives
 * the Stepper (claimAndRun) so pending issue_runs are consumed.
 *
 * This wraps tickWorkflowAdvancement() + claimAndRun() — the two "forward
 * progress" operations from the old dispatcher tick — and surfaces their
 * combined effect as a SweepResult.
 *
 * Runs every 5 s.
 */
import type { Sweep, SweepResult } from '../heartbeat.js';
import { getDb } from '../../db/index.js';
import { tickWorkflowAdvancement } from '../workflow-runner.js';
import { claimAndRun } from '../stepper.js';

export const readyWorkflowStepsSweep: Sweep = {
  id: 'ready-workflow-steps',
  label: 'Workflow steps',
  description: 'Advances unblocked workflow steps and lets the stepper claim one pending agent run.',
  scope: 'project',
  intervalMs: 5_000,
  enabled: true,

  async run(): Promise<SweepResult> {
    const db = getDb();
    let errors = 0;
    let acted = 0;

    // Advance all non-terminal workflow_runs (fan-out, step transitions, etc.)
    try {
      await tickWorkflowAdvancement();
      acted += 1; // tickWorkflowAdvancement doesn't return a count; treat one call = 1 action
    } catch (err) {
      errors += 1;
      console.error('[sweep:ready-workflow-steps] tickWorkflowAdvancement failed:', err);
    }

    // Claim and run one pending issue_run (the Stepper)
    try {
      await claimAndRun(db);
      acted += 1;
    } catch (err) {
      errors += 1;
      console.error('[sweep:ready-workflow-steps] claimAndRun failed:', err);
    }

    return { acted: errors > 0 ? 0 : acted, errors };
  },
};
