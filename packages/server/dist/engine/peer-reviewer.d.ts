/**
 * peer-reviewer.ts — Demo 9: Peer Review engine
 *
 * Implements the peer review gate for `approve` workflow steps.
 *
 * Invariant 1 compliance: each reviewer gets an issue_run with kind='peer_review'.
 * The stepper picks these up via FOR UPDATE SKIP LOCKED, runs executeAgentRun,
 * and the reviewer agent produces a decision JSON in its output.
 *
 * Decision schema from reviewer agent output:
 *   { "decision": "approve" | "request_changes", "comment": "...", "suggestions": [...] }
 *
 * request_changes_policy (open question #2 resolution, 'first' is default):
 *   'first'    — first request_changes blocks (GitHub PR semantics)
 *   'majority' — majority of reviewers must request_changes to block
 *   'all'      — all reviewers must request_changes to block
 */
export type RequestChangesPolicy = 'first' | 'majority' | 'all';
export interface ReviewDecision {
    issueRunId: string;
    agentId: string;
    decision: 'approve' | 'request_changes';
    comment: string;
    suggestions: string[];
}
/**
 * Create one issueRun per reviewer agent with kind='peer_review'.
 *
 * Each peer_review run receives `priorOutput` as inputContext — the reviewer
 * agent sees the work it is reviewing as part of its effective issue body.
 *
 * Reviewer lockout (exclude_author): if the prior step's agent matches one of
 * the reviewerAgentIds, that reviewer is silently skipped.
 *
 * @param workflowRunId   - the parent workflow_run ID (for logging)
 * @param stepRunId       - the approve step_run ID (linked to each peer_review run)
 * @param issueId         - the issue these runs belong to
 * @param reviewerAgentIds - resolved reviewer agent IDs (already locked out author if needed)
 * @param priorOutput     - output of the prior agent_run step (the work under review)
 * @returns array of created issueRun IDs
 */
export declare function createPeerReviewRuns(workflowRunId: string, stepRunId: string, issueId: string, reviewerAgentIds: string[], priorOutput: string): Promise<string[]>;
/**
 * Gather all peer_review issueRuns linked to an approve step_run.
 *
 * Returns:
 *   allComplete  — true when every reviewer has finished (completed or failed)
 *   decisions    — parsed ReviewDecision for each completed reviewer run
 */
export declare function collectReviewDecisions(stepRunId: string): Promise<{
    allComplete: boolean;
    decisions: ReviewDecision[];
}>;
/**
 * Apply request_changes_policy to determine if the workflow should be blocked.
 *
 * 'first'    — any request_changes blocks (like GitHub: one veto stops the train)
 * 'majority' — strictly more than half must request_changes to block
 * 'all'      — every reviewer must request_changes to block
 *
 * If quorum is provided, the workflow only advances when ≥ quorum.n approvals
 * are collected (regardless of policy). shouldBlock returning false does NOT
 * automatically mean advance — the caller must also check quorum satisfaction.
 */
export declare function shouldBlock(decisions: ReviewDecision[], policy: RequestChangesPolicy, quorum?: {
    n: number;
    of: number;
}): boolean;
/**
 * Check if the quorum threshold has been met.
 * Returns true when quorum.n approvals have been collected, or when no quorum is configured.
 */
export declare function isQuorumMet(decisions: ReviewDecision[], quorum?: {
    n: number;
    of: number;
}): boolean;
/**
 * Persist reviewer suggestions on the approve step_run and record each
 * reviewer's decision in the review_events audit table.
 *
 * When the prior agent_run step is re-queued, the feedback is prepended to
 * its inputContext so the agent sees reviewer suggestions on its next attempt.
 *
 * @param stepRunId       - the approve step_run (where suggestions are stored)
 * @param workflowRunId   - for review_events FK
 * @param decisions       - the reviewer decisions that caused blocking
 */
export declare function injectReviewerFeedback(stepRunId: string, workflowRunId: string, decisions: ReviewDecision[]): Promise<void>;
/**
 * Record approval decisions in the audit trail and update the step_run.
 */
export declare function recordApproval(stepRunId: string, workflowRunId: string, decisions: ReviewDecision[]): Promise<void>;
//# sourceMappingURL=peer-reviewer.d.ts.map