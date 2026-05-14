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
export declare class Dispatcher {
    private timeoutId?;
    private running;
    start(): void;
    stop(): void;
    private scheduleTick;
    private tick;
}
export declare const dispatcher: Dispatcher;
//# sourceMappingURL=dispatcher.d.ts.map