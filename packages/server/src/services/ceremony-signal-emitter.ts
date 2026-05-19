/**
 * ceremony-signal-emitter.ts — CER-6 (W29)
 *
 * Emits lifecycle signals that trigger `agent-signal` ceremonies. Given a
 * (projectId, signalName, contextPayload), finds all enabled ceremonies in
 * that project whose triggerKind is 'agent-signal' and whose
 * triggerConfig.signalName matches, then spawns a workflow_run for each.
 *
 * Emission is fire-and-forget: the caller does not need to await ceremony
 * completion. The returned EmitResult summarises dispatch outcomes.
 *
 * Idempotency: TODO — add LRU dedupe per (signalName, contextKey) within a
 * short window (see ceremony-dispatcher.ts for reference pattern).
 *
 * Wiring: callers (e.g. pickup-ready sweep, batch coordinator) call emitSignal
 * directly before/after their batch operation. This module does NOT self-register
 * any listeners; it is a pure service that callers invoke explicitly.
 */

import { eq, and, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { spawnCeremonyRun } from './ceremony-scheduler.js';

// ---------------------------------------------------------------------------
// Standardised signal taxonomy (CER-6)
// ---------------------------------------------------------------------------

/**
 * Well-known signal names that squadboard lifecycle components may emit.
 *
 * Callers are responsible for emitting at the right moment; emission is
 * fire-and-forget (no ordering guarantee relative to the triggering action
 * unless the caller awaits emitSignal before proceeding).
 *
 * Documented in full in docs/ceremonies/triggers.md — "Standardized signal names".
 */
export type WellKnownSignal =
  | 'before-batch'      // emitted before a batch of issue_runs is spawned (e.g. pickup-ready sweep)
  | 'after-batch'       // emitted after the batch starts
  | 'before-run'        // emitted before a single issue_run starts
  | 'after-run'         // emitted after a single issue_run completes (any status)
  | 'on-issue-entry';   // emitted when an issue enters a new column

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmitSignalOptions {
  /** UUID of the project to search for matching ceremonies. */
  projectId: string;
  /** Signal name — one of WellKnownSignal or a custom string. */
  signalName: WellKnownSignal | string;
  /** Optional context payload attached to the trigger (informational). */
  contextPayload?: Record<string, unknown>;
  /**
   * Optional issue to anchor the workflow_run against. When omitted,
   * spawnCeremonyRun resolves the project's first issue automatically.
   */
  anchorIssueId?: string;
}

export interface EmitResult {
  /** Number of ceremonies successfully spawned. */
  fired: number;
  /** Number of ceremonies skipped (no active version, no anchor issue, etc.). */
  skipped: number;
  /** Number of ceremonies that threw during spawn. */
  errors: number;
  /** IDs of the created workflow_run rows. */
  workflowRunIds: string[];
}

// ---------------------------------------------------------------------------
// UUID guard — rejects synthetic / non-UUID project IDs (e.g. test sentinels)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// emitSignal — main public API
// ---------------------------------------------------------------------------

/**
 * Find all ceremonies in `projectId` whose trigger is `agent-signal` with
 * a matching `signalName`, and spawn a workflow_run for each.
 *
 * Returns a summary of dispatch outcomes. Never throws — errors per ceremony
 * are counted in `result.errors`.
 *
 * @example
 *   // Before spawning a batch of issue_runs:
 *   await emitSignal({ projectId, signalName: 'before-batch', contextPayload: { batchSize } });
 */
export async function emitSignal(opts: EmitSignalOptions): Promise<EmitResult> {
  const { projectId, signalName, contextPayload, anchorIssueId } = opts;
  const result: EmitResult = { fired: 0, skipped: 0, errors: 0, workflowRunIds: [] };

  if (!UUID_RE.test(projectId)) {
    return result;
  }

  const db = getDb();
  let rows: { id: string; slug: string }[];

  try {
    rows = await db
      .select({ id: schema.workflows.id, slug: schema.workflows.slug })
      .from(schema.workflows)
      .where(
        and(
          eq(schema.workflows.projectId, projectId),
          eq(schema.workflows.triggerKind, 'agent-signal'),
          eq(schema.workflows.status, 'active'),
          sql`${schema.workflows.triggerConfig}->>'signalName' = ${signalName}`,
        ),
      );
  } catch (err) {
    console.error(`[signal-emitter] DB query failed for signal '${signalName}':`, err);
    return result;
  }

  const triggerLabel = `agent-signal:${signalName}`;

  for (const row of rows) {
    try {
      const runId = await spawnCeremonyRun(row.id, {
        anchorIssueId,
        trigger: triggerLabel,
        triggerSource: {
          kind: 'on_event',
          eventType: triggerLabel,
          detail: contextPayload ? JSON.stringify(contextPayload) : undefined,
          anchorIssueId,
        },
      });

      if (runId !== null) {
        result.fired++;
        result.workflowRunIds.push(runId);
      } else {
        result.skipped++;
      }
    } catch (err) {
      console.error(`[signal-emitter] spawn failed for workflow ${row.slug}:`, err);
      result.errors++;
    }
  }

  return result;
}
