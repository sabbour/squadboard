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

import { eq, and } from 'drizzle-orm';
import { getDb, schema, type DrizzleDb } from '../db/index.js';

type DbExecutor = DrizzleDb | Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequestChangesPolicy = 'first' | 'majority' | 'all';

export interface ReviewDecision {
  issueRunId: string;
  agentId: string;
  decision: 'approve' | 'request_changes';
  comment: string;
  suggestions: string[];
}

interface ReviewerOutput {
  decision?: 'approve' | 'request_changes';
  comment?: string;
  suggestions?: string[];
}

// ---------------------------------------------------------------------------
// createPeerReviewRuns
// ---------------------------------------------------------------------------

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
export async function createPeerReviewRuns(
  workflowRunId: string,
  stepRunId: string,
  issueId: string,
  reviewerAgentIds: string[],
  priorOutput: string,
  db: DbExecutor = getDb(),
): Promise<string[]> {
  const { issueRuns } = schema;

  if (reviewerAgentIds.length === 0) {
    console.warn(`[peer-reviewer] no reviewers to assign for step_run ${stepRunId}`);
    return [];
  }

  // Truncate priorOutput to avoid PGLite WASM memory pressure on very large LLM outputs.
  const MAX_PRIOR_OUTPUT = 20_000;
  const truncatedOutput =
    priorOutput.length > MAX_PRIOR_OUTPUT
      ? priorOutput.slice(0, MAX_PRIOR_OUTPUT) + '\n\n[... output truncated for review ...]'
      : priorOutput;
  const reviewContext = buildReviewContext(truncatedOutput);

  const inserted = await db
    .insert(issueRuns)
    .values(
      reviewerAgentIds.map((agentId) => ({
        issueId,
        agentId,
        kind: 'peer_review' as const,
        status: 'pending' as const,
        stepRunId,
        inputContext: reviewContext,
      })),
    )
    .returning({ id: issueRuns.id });

  const ids = inserted.map((r) => r.id);
  console.log(
    `[peer-reviewer] created ${ids.length} peer_review run(s) for workflow_run ${workflowRunId}, step_run ${stepRunId}: [${ids.join(', ')}]`,
  );
  return ids;
}

// ---------------------------------------------------------------------------
// collectReviewDecisions
// ---------------------------------------------------------------------------

/**
 * Gather all peer_review issueRuns linked to an approve step_run.
 *
 * Returns:
 *   allComplete  — true when every reviewer has finished (completed or failed)
 *   decisions    — parsed ReviewDecision for each completed reviewer run
 */
export async function collectReviewDecisions(stepRunId: string): Promise<{
  allComplete: boolean;
  decisions: ReviewDecision[];
}> {
  const db = getDb();
  const { issueRuns } = schema;

  const reviewRuns = await db
    .select()
    .from(issueRuns)
    .where(
      and(
        eq(issueRuns.stepRunId, stepRunId),
        eq(issueRuns.kind, 'peer_review'),
      ),
    );

  if (reviewRuns.length === 0) {
    return { allComplete: false, decisions: [] };
  }

  const allComplete = reviewRuns.every(
    (r) => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled' || r.status === 'timed_out',
  );

  const decisions: ReviewDecision[] = [];
  for (const run of reviewRuns) {
    if (run.status !== 'completed' || !run.output) continue;

    const parsed = safeParseReviewOutput(run.output);
    decisions.push({
      issueRunId: run.id,
      agentId: run.agentId,
      decision: parsed.decision ?? 'approve',
      comment: parsed.comment ?? '',
      suggestions: parsed.suggestions ?? [],
    });
  }

  return { allComplete, decisions };
}

// ---------------------------------------------------------------------------
// shouldBlock
// ---------------------------------------------------------------------------

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
export function shouldBlock(
  decisions: ReviewDecision[],
  policy: RequestChangesPolicy,
  quorum?: { n: number; of: number },
): boolean {
  if (decisions.length === 0) return false;

  const changesCount = decisions.filter((d) => d.decision === 'request_changes').length;
  const approveCount = decisions.filter((d) => d.decision === 'approve').length;

  // Quorum check: if quorum is configured and not yet met, don't advance (but don't "block" either)
  // The caller interprets !quorumMet && !blocked as "still waiting".
  if (quorum) {
    const quorumMet = approveCount >= quorum.n;
    if (!quorumMet) {
      // Haven't reached quorum — not blocking, just waiting
      return false;
    }
  }

  switch (policy) {
    case 'first':
      return changesCount >= 1;

    case 'majority':
      return changesCount > decisions.length / 2;

    case 'all':
      return changesCount === decisions.length;

    default:
      return changesCount >= 1; // safe default: treat unknown policy as 'first'
  }
}

/**
 * Check if the quorum threshold has been met.
 * Returns true when quorum.n approvals have been collected, or when no quorum is configured.
 */
export function isQuorumMet(
  decisions: ReviewDecision[],
  quorum?: { n: number; of: number },
): boolean {
  if (!quorum) return true; // no quorum configured — any approvals advance
  const approveCount = decisions.filter((d) => d.decision === 'approve').length;
  return approveCount >= quorum.n;
}

// ---------------------------------------------------------------------------
// injectReviewerFeedback
// ---------------------------------------------------------------------------

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
export async function injectReviewerFeedback(
  stepRunId: string,
  workflowRunId: string,
  decisions: ReviewDecision[],
  db: DbExecutor = getDb(),
): Promise<void> {
  const { stepRuns, reviewEvents } = schema;

  const blockingDecisions = decisions.filter((d) => d.decision === 'request_changes');
  const allSuggestions = blockingDecisions.flatMap((d) => d.suggestions);

  // Persist aggregated suggestions on the approve step_run.
  const combinedComment = blockingDecisions
    .map((d) => `• ${d.comment || '(no comment)'}`)
    .join('\n');

  await db
    .update(stepRuns)
    .set({
      reviewDecision: 'request_changes',
      reviewComment: combinedComment,
      reviewSuggestions: allSuggestions,
      updatedAt: new Date(),
    })
    .where(eq(stepRuns.id, stepRunId));

  // Record each reviewer's decision in the audit trail.
  if (blockingDecisions.length > 0) {
    await db.insert(reviewEvents).values(
      blockingDecisions.map((d) => ({
        workflowRunId,
        stepRunId,
        issueRunId: d.issueRunId,
        reviewerAgentId: d.agentId,
        verb: 'request_changes' as const,
        body: d.comment,
        suggestions: d.suggestions,
      })),
    );
  }

  console.log(
    `[peer-reviewer] injected feedback from ${blockingDecisions.length} reviewer(s) ` +
    `(${allSuggestions.length} suggestion(s)) onto step_run ${stepRunId}`,
  );
}

// ---------------------------------------------------------------------------
// recordApproval
// ---------------------------------------------------------------------------

/**
 * Record approval decisions in the audit trail and update the step_run.
 */
export async function recordApproval(
  stepRunId: string,
  workflowRunId: string,
  decisions: ReviewDecision[],
  db: DbExecutor = getDb(),
): Promise<void> {
  const { stepRuns, reviewEvents } = schema;

  const approvals = decisions.filter((d) => d.decision === 'approve');

  await db
    .update(stepRuns)
    .set({
      reviewDecision: 'approve',
      reviewComment: approvals.map((d) => d.comment).filter(Boolean).join('\n'),
      updatedAt: new Date(),
    })
    .where(eq(stepRuns.id, stepRunId));

  if (approvals.length > 0) {
    await db.insert(reviewEvents).values(
      approvals.map((d) => ({
        workflowRunId,
        stepRunId,
        issueRunId: d.issueRunId,
        reviewerAgentId: d.agentId,
        verb: 'approve' as const,
        body: d.comment,
        suggestions: [],
      })),
    );
  }

  console.log(
    `[peer-reviewer] recorded ${approvals.length} approval(s) for step_run ${stepRunId}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the input context string shown to reviewer agents.
 * They see this prepended to the issue body so they know what to review.
 */
function buildReviewContext(priorOutput: string): string {
  return [
    '## Work Under Review',
    '',
    'You are a peer reviewer. Read the work below and respond with a JSON object:',
    '```json',
    '{ "decision": "approve" | "request_changes", "comment": "...", "suggestions": [...] }',
    '```',
    '',
    '---',
    '',
    priorOutput,
  ].join('\n');
}

/**
 * Safely parse reviewer agent output as ReviewerOutput.
 * The agent may return raw JSON or JSON embedded in markdown code fences.
 */
function safeParseReviewOutput(output: string): ReviewerOutput {
  const trimmed = output.trim();

  // Try direct JSON parse
  try {
    return JSON.parse(trimmed) as ReviewerOutput;
  } catch {
    // Extract JSON from markdown code fence: ```json ... ```
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1].trim()) as ReviewerOutput;
      } catch {
        // fall through
      }
    }

    // Last resort: look for a decision keyword in the output text
    const lowerOutput = trimmed.toLowerCase();
    if (lowerOutput.includes('request_changes') || lowerOutput.includes('request changes')) {
      return { decision: 'request_changes', comment: trimmed, suggestions: [] };
    }
    if (lowerOutput.includes('approve')) {
      return { decision: 'approve', comment: trimmed, suggestions: [] };
    }

    // Unknown format — default to approve to avoid infinite loops
    console.warn('[peer-reviewer] could not parse reviewer output; defaulting to approve:', trimmed.slice(0, 200));
    return { decision: 'approve', comment: trimmed, suggestions: [] };
  }
}
