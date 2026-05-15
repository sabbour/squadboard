import { getDb } from '../../db/index.js';
import { tickWorkflowAdvancement } from '../workflow-runner.js';
import { claimAndRun } from '../stepper.js';
export const readyWorkflowStepsSweep = {
    id: 'ready-workflow-steps',
    intervalMs: 5_000,
    enabled: true,
    async run() {
        const db = getDb();
        let errors = 0;
        let acted = 0;
        // Advance all non-terminal workflow_runs (fan-out, step transitions, etc.)
        try {
            await tickWorkflowAdvancement();
            acted += 1; // tickWorkflowAdvancement doesn't return a count; treat one call = 1 action
        }
        catch (err) {
            errors += 1;
            console.error('[sweep:ready-workflow-steps] tickWorkflowAdvancement failed:', err);
        }
        // Claim and run one pending issue_run (the Stepper)
        try {
            await claimAndRun(db);
            acted += 1;
        }
        catch (err) {
            errors += 1;
            console.error('[sweep:ready-workflow-steps] claimAndRun failed:', err);
        }
        return { acted: errors > 0 ? 0 : acted, errors };
    },
};
//# sourceMappingURL=ready-workflow-steps.js.map