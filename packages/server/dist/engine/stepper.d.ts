import { type DrizzleDb } from '../db/index.js';
/**
 * Claim exactly one pending issue_run and execute it.
 *
 * Invariant 2 — FOR UPDATE SKIP LOCKED is the ONLY mechanism by which a run
 * transitions to 'running'. No other code path may set status='running'.
 */
export declare function claimAndRun(db: DrizzleDb): Promise<void>;
/**
 * Execute one claimed issue_run:
 *  1. Load run + related records
 *  2. Resolve workspace
 *  3. Heartbeat loop (every 30 s)
 *  4. Call SDK bridge (Kobayashi's implementation)
 *  5. Persist result and clear lease
 */
export declare function runWorker(issueRunId: string): Promise<void>;
//# sourceMappingURL=stepper.d.ts.map