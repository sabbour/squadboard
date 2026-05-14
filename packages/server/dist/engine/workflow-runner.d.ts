/**
 * workflow-runner.ts — YAML workflow execution engine (Demo 6 / Demo 10)
 *
 * Advances workflow_runs step by step. Steps desugar to issue_runs (Invariant 1).
 * The stepper still picks up resulting issue_runs via FOR UPDATE SKIP LOCKED (Invariant 2).
 *
 * Step types:
 *   route      → resolveRoute() → create issue_run kind='agent_run'
 *   agent_run  → issue_run already exists; poll for completion
 *   approve    → peer review gate (Demo 9)
 *   fan_out    → materializeFanOut() → waiting_children → checkFanOutCompletion()
 *   handoff    → create agent_run issueRun for target agent; complete immediately
 *
 * pinnedAgentRevisions: snapshotted per step at step start (open question #1 resolution).
 */
/**
 * Initialise a workflow_run for an issue under a specific workflow version.
 *
 *  1. Parse the YAML to enumerate steps
 *  2. INSERT workflow_run (with workflowVersionId and requestChangesPolicy)
 *  3. INSERT step_runs (one per step, all pending)
 *
 * @returns The new workflowRunId.
 */
export declare function createWorkflowRun(issueId: string, workflowVersionId: string): Promise<string>;
/**
 * Advance a workflow_run by one step.
 *
 * Called by the dispatcher on each tick for running workflow_runs.
 * Idempotent — safe to call repeatedly until the workflow completes.
 *
 * Step dispatch:
 *   route      → resolveRoute() + createRoutedStepRun()
 *   agent_run  → check linked issue_run completion
 *   approve    → stub (Demo 9 fills in quorum logic)
 */
export declare function advanceWorkflowRun(workflowRunId: string): Promise<void>;
/**
 * Advance all non-terminal workflow_runs by one step.
 *
 * This is the entry point the dispatcher calls every tick to drive workflow
 * execution. All active (pending | running) workflow_runs are ticked.
 * Fan-out waiting_children status is handled inside advanceWorkflowRun via
 * handleFanOutStep Phase B.
 *
 * Invariant 2 compliance: this function does NOT touch issue_runs status.
 * Only the stepper (claimAndRun) does that.
 */
export declare function tickWorkflowAdvancement(): Promise<void>;
//# sourceMappingURL=workflow-runner.d.ts.map