/**
 * services/coordinator-decision-log.ts — W29 MC-10
 *
 * Pure helper + persistence layer for storing coordinator decisions on issue_runs.
 *
 * Exports:
 *   - CoordinatorDecisionRecord    — JSONB shape written to issue_runs.coordinator_decision
 *   - buildCoordinatorDecisionRecord() — pure factory (no side-effects, easy to test)
 *   - persistCoordinatorDecision()     — fire-and-forget writer (warns on missing row)
 */

import type { CoordinatorDecision, CoordinatorCallMeta } from '../coordinator/types.js';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoordinatorDecisionRecord {
  /** The full decision the coordinator returned */
  decision: CoordinatorDecision;
  /** Metadata about the LLM call */
  meta: CoordinatorCallMeta;
  /** When we persisted (ISO 8601) */
  persistedAt: string;
}

// ---------------------------------------------------------------------------
// Pure builder — no side-effects
// ---------------------------------------------------------------------------

export function buildCoordinatorDecisionRecord(
  decision: CoordinatorDecision,
  meta: CoordinatorCallMeta,
): CoordinatorDecisionRecord {
  return {
    decision,
    meta,
    persistedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// DB writer — fire-and-forget; never throws to caller
// ---------------------------------------------------------------------------

export async function persistCoordinatorDecision(
  runId: string,
  decision: CoordinatorDecision,
  meta: CoordinatorCallMeta,
  db?: ReturnType<typeof getDb>,
): Promise<void> {
  const database = db ?? getDb();
  const record = buildCoordinatorDecisionRecord(decision, meta);

  try {
    const result = await database
      .update(schema.issueRuns)
      .set({ coordinatorDecision: record as unknown })
      .where(eq(schema.issueRuns.id, runId))
      .returning({ id: schema.issueRuns.id });

    if (result.length === 0) {
      console.warn(
        `[coordinator-decision-log] persistCoordinatorDecision: runId "${runId}" not found — decision not persisted`,
      );
    }
  } catch (err) {
    console.warn(
      `[coordinator-decision-log] persistCoordinatorDecision: failed to persist decision for runId "${runId}":`,
      err,
    );
  }
}
