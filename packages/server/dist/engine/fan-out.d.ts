/**
 * fan-out.ts — Demo 10 Fan-Out + Handoff Engine (Invariant 5)
 *
 * Implements the six-step atomic fan_out materialization transaction using raw
 * SQL (not Drizzle — to guarantee real Postgres BEGIN/COMMIT atomicity).
 *
 * Invariant 5: fan_out materializes full child workflow_runs in ONE transaction:
 *   1. BEGIN
 *   2. UPDATE parent stepRun → status='splitting'
 *   3. INSERT N child workflowRuns (one per split target)
 *   4. INSERT step_runs for each child workflowRun (all steps)
 *   5. UPDATE parent workflowRun childIds=[...]
 *   6. COMMIT
 *
 * Children inherit pinnedAgentRevisions from the parent workflow_run.
 */
import type { DrizzleDb } from '../db/index.js';
import type { FanOutStep } from '../services/workflow-parser.js';
import type { Issue } from '../db/schema.js';
export interface SplitTarget {
    label: string;
    agentId: string | null;
    agentName: string;
    variables: Record<string, unknown>;
}
export interface ChildResult {
    workflowRunId: string;
    issueId: string;
    status: string;
    completed: boolean;
    failed: boolean;
    output: string | null;
}
export declare function resolveTargets(fanOutStep: FanOutStep, issue: Issue, db: DrizzleDb): Promise<SplitTarget[]>;
export declare function materializeFanOut(parentWorkflowRunId: string, parentStepRunId: string, fanOutStep: FanOutStep, issue: Issue, db: DrizzleDb): Promise<string[]>;
export declare function checkFanOutCompletion(parentWorkflowRunId: string, mergeStrategy: 'all' | 'any' | 'first', onChildFailure: 'continue' | 'fail_fast', db: DrizzleDb): Promise<{
    done: boolean;
    failed: boolean;
    results: ChildResult[];
}>;
//# sourceMappingURL=fan-out.d.ts.map