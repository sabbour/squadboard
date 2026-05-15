import { sweepDueSchedules } from '../../services/ceremony-scheduler.js';
export const ceremoniesDueSweep = {
    id: 'ceremonies-due',
    intervalMs: 5_000,
    enabled: true,
    async run() {
        const result = await sweepDueSchedules();
        // Map the ceremony-scheduler SweepResult shape → heartbeat SweepResult shape.
        const acted = result.fired + result.skipped;
        const details = result.scanned > 0
            ? `scanned=${result.scanned} fired=${result.fired} skipped=${result.skipped}`
            : undefined;
        return { acted, errors: result.errors, details };
    },
};
//# sourceMappingURL=ceremonies-due.js.map