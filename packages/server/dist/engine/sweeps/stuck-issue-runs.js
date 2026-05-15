import { getDb } from '../../db/index.js';
import { sweepExpiredLeases, sweepOrphanedRuns, sweepExpiredStepLeases, sweepOrphanedWorkflowRuns, } from '../sweeper.js';
import { sweepReviewTimeouts } from '../../services/review-timeout-sweep.js';
export const stuckIssueRunsSweep = {
    id: 'stuck-issue-runs',
    intervalMs: 30_000,
    enabled: true,
    async run() {
        const db = getDb();
        let acted = 0;
        let errors = 0;
        const details = [];
        const tasks = [
            { label: 'expired-leases', fn: () => sweepExpiredLeases(db) },
            { label: 'orphaned-runs', fn: () => sweepOrphanedRuns(db) },
            { label: 'expired-step-leases', fn: () => sweepExpiredStepLeases(db) },
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
                if (n > 0)
                    details.push(`${label}=${n}`);
            }
            catch (err) {
                errors += 1;
                console.error(`[sweep:stuck-issue-runs] ${label} failed:`, err);
            }
        }
        return { acted, errors, details: details.join(' ') || undefined };
    },
};
//# sourceMappingURL=stuck-issue-runs.js.map