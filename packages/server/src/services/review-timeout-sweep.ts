/**
 * review-timeout-sweep.ts — Phase 8 review-policy primitive.
 *
 * Heartbeat-driven sweep that scans `step_runs` for `approve` steps still
 * in-flight (`status = 'running'`) past their resolved timeout and applies
 * `timeout_action`:
 *
 *   notify        — emit a workflow event; do not change state.
 *   auto_approve  — mark the step completed (reviewDecision='approve') and
 *                   advance the workflow.
 *   auto_reject   — mark the step + workflow_run failed
 *                   (reviewDecision='request_changes', no requeue in v1).
 *   escalate      — v1: log a warning + emit escalation event; treated as
 *                   `notify` for state purposes. Spawning a fallback
 *                   reviewer requires peer-reviewer integration; a
 *                   follow-up commit will land that path.
 *
 * Pure DB-only side effects + bus events. Idempotent: emitting an event
 * for `notify` would re-fire every tick if we didn't gate it, so we set a
 * `reviewComment` marker on the step the first time we observe the
 * deadline. Subsequent `notify` ticks see the marker and skip the event.
 *
 * Cost: bounded by the number of running approve steps. With the default
 * 5 s tick and minutes-to-hours timeouts in real workflows, the working
 * set is tiny; we issue one yaml parse per workflow_version per tick at
 * most (cached per call).
 */

import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { getDb } from '../db/index.js';
import { parseWorkflowYaml, type ApproveStep, type WorkflowDefinition } from './workflow-parser.js';
import {
  loadProjectDefault,
  resolvePolicyForStep,
  type ResolvedReviewPolicy,
} from './review-policy-resolver.js';
import { eventBus } from '../realtime/event-bus.js';

const TIMEOUT_NOTIFY_MARKER = '[timeout-notify]';

// Marker used in stepRuns.reviewComment to record that we already emitted
// a `notify` for this step's deadline. Prevents the sweep from spamming
// the bus on every tick once a step is past its deadline.

function parseDurationMs(spec: string | undefined | null): number | null {
  if (!spec) return null;
  const m = spec.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase() as 's' | 'm' | 'h' | 'd';
  const mult = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * mult;
}

interface PendingApproveRow {
  stepRun: typeof schema.stepRuns.$inferSelect;
  workflowRun: typeof schema.workflowRuns.$inferSelect;
  workflowVersionId: string;
  yamlContent: string;
  projectId: string;
}

/**
 * Find approve step_runs that are running (or still pending) and whose
 * workflow has a known timeout. We pull the union of statuses we care
 * about and let the per-row policy resolution decide whether the step
 * has actually timed out.
 */
async function loadInFlightApproveSteps(): Promise<PendingApproveRow[]> {
  const db = getDb();

  // Single JOIN: step_runs ⨝ workflow_runs ⨝ workflow_versions ⨝ workflows
  // (workflows table holds projectId; workflow_runs.projectId may be null
  // for legacy rows so we hop through workflow_versions → workflows.)
  const rows = await db
    .select({
      stepRun: schema.stepRuns,
      workflowRun: schema.workflowRuns,
      workflowVersionId: schema.workflowVersions.id,
      yamlContent: schema.workflowVersions.yamlContent,
      projectId: schema.workflows.projectId,
    })
    .from(schema.stepRuns)
    .innerJoin(schema.workflowRuns, eq(schema.workflowRuns.id, schema.stepRuns.workflowRunId))
    .innerJoin(
      schema.workflowVersions,
      eq(schema.workflowVersions.id, schema.workflowRuns.workflowVersionId),
    )
    .innerJoin(schema.workflows, eq(schema.workflows.id, schema.workflowVersions.workflowId))
    .where(
      and(
        eq(schema.stepRuns.stepType, 'approve'),
        inArray(schema.stepRuns.status, ['pending', 'running']),
      ),
    );

  return rows;
}

interface TimeoutDecision {
  fired: boolean;
  policy: ResolvedReviewPolicy;
  deadline: Date;
  /** True when state was mutated this tick (so we should refetch on next pass). */
  mutated: boolean;
}

async function applyTimeoutAction(
  row: PendingApproveRow,
  step: ApproveStep,
  policy: ResolvedReviewPolicy,
  deadline: Date,
): Promise<TimeoutDecision> {
  const db = getDb();
  const stepRun = row.stepRun;

  switch (policy.timeout_action) {
    case 'notify': {
      const alreadyNotified = (stepRun.reviewComment ?? '').includes(TIMEOUT_NOTIFY_MARKER);
      if (alreadyNotified) return { fired: true, policy, deadline, mutated: false };
      const note = `${TIMEOUT_NOTIFY_MARKER} review timeout reached at ${deadline.toISOString()} — no automated action taken (policy: notify).`;
      await db
        .update(schema.stepRuns)
        .set({
          reviewComment: stepRun.reviewComment ? `${stepRun.reviewComment}\n${note}` : note,
        })
        .where(eq(schema.stepRuns.id, stepRun.id));
      eventBus.emitWorkflowEvent(row.projectId, {
          kind: 'review.timeout.notify',
          workflowRunId: row.workflowRun.id,
          stepRunId: stepRun.id,
          stepIndex: stepRun.stepIndex,
          deadline: deadline.toISOString(),
          policy,
        });
      console.log(
        `[review-timeout] notify: workflow_run=${row.workflowRun.id} step_run=${stepRun.id} deadline=${deadline.toISOString()}`,
      );
      return { fired: true, policy, deadline, mutated: true };
    }

    case 'auto_approve': {
      await db
        .update(schema.stepRuns)
        .set({
          status: 'completed',
          reviewDecision: 'approve',
          reviewComment: `[timeout-auto-approve] no decision by ${deadline.toISOString()} — auto-approved per policy.`,
          updatedAt: new Date(),
        })
        .where(eq(schema.stepRuns.id, stepRun.id));
      // Workflow advancement happens on the next dispatcher tick via
      // tickWorkflowAdvancement; keeping this sweep DB-only avoids
      // re-entrancy with workflow-runner.
      eventBus.emitWorkflowEvent(row.projectId, {
          kind: 'review.timeout.auto_approve',
          workflowRunId: row.workflowRun.id,
          stepRunId: stepRun.id,
          stepIndex: stepRun.stepIndex,
          deadline: deadline.toISOString(),
          policy,
        });
      console.log(
        `[review-timeout] auto_approve: workflow_run=${row.workflowRun.id} step_run=${stepRun.id} stepIndex=${stepRun.stepIndex}`,
      );
      return { fired: true, policy, deadline, mutated: true };
    }

    case 'auto_reject': {
      await db
        .update(schema.stepRuns)
        .set({
          status: 'failed',
          reviewDecision: 'request_changes',
          reviewComment: `[timeout-auto-reject] no decision by ${deadline.toISOString()} — auto-rejected per policy.`,
          updatedAt: new Date(),
        })
        .where(eq(schema.stepRuns.id, stepRun.id));
      // Mark the parent workflow_run failed so it surfaces in the UI.
      await db
        .update(schema.workflowRuns)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(schema.workflowRuns.id, row.workflowRun.id));
      eventBus.emitWorkflowEvent(row.projectId, {
          kind: 'review.timeout.auto_reject',
          workflowRunId: row.workflowRun.id,
          stepRunId: stepRun.id,
          stepIndex: stepRun.stepIndex,
          deadline: deadline.toISOString(),
          policy,
        });
      console.log(
        `[review-timeout] auto_reject: workflow_run=${row.workflowRun.id} failed (step_run=${stepRun.id})`,
      );
      return { fired: true, policy, deadline, mutated: true };
    }

    case 'escalate': {
      // v1: log + emit a distinct event. Spawning a fallback peer_review
      // run requires routing through peer-reviewer.startPeerReviews and
      // resolving the fallback agent — landed in a follow-up commit.
      const alreadyEscalated = (stepRun.reviewComment ?? '').includes('[timeout-escalate]');
      if (alreadyEscalated) return { fired: true, policy, deadline, mutated: false };
      const note = `[timeout-escalate] review timeout reached at ${deadline.toISOString()}; escalation to '${policy.fallback_reviewer ?? 'unspecified fallback'}' pending (manual intervention required in v1).`;
      await db
        .update(schema.stepRuns)
        .set({
          reviewComment: stepRun.reviewComment ? `${stepRun.reviewComment}\n${note}` : note,
        })
        .where(eq(schema.stepRuns.id, stepRun.id));
      eventBus.emitWorkflowEvent(row.projectId, {
          kind: 'review.timeout.escalate',
          workflowRunId: row.workflowRun.id,
          stepRunId: stepRun.id,
          stepIndex: stepRun.stepIndex,
          fallbackReviewer: policy.fallback_reviewer,
          deadline: deadline.toISOString(),
          policy,
        });
      console.warn(
        `[review-timeout] escalate (v1: notify-only): workflow_run=${row.workflowRun.id} step_run=${stepRun.id} fallback=${policy.fallback_reviewer ?? 'none'}`,
      );
      return { fired: true, policy, deadline, mutated: true };
    }

    default: {
      console.warn(`[review-timeout] unknown timeout_action: ${String(policy.timeout_action)}`);
      return { fired: false, policy, deadline, mutated: false };
    }
  }
}

export interface SweepResult {
  scanned: number;
  fired: number;
  errors: number;
}

/**
 * One pass of the review-timeout sweep. Designed to be invoked from the
 * dispatcher tick — runs in O(in-flight approve steps), parses each
 * relevant workflow yaml at most once per tick (cached), loads each
 * project's default policy at most once per tick (cached).
 */
export async function sweepReviewTimeouts(): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, fired: 0, errors: 0 };

  let rows: PendingApproveRow[];
  try {
    rows = await loadInFlightApproveSteps();
  } catch (e) {
    console.error('[review-timeout] failed to load in-flight approve steps:', e);
    return { scanned: 0, fired: 0, errors: 1 };
  }
  if (rows.length === 0) return result;

  const now = Date.now();
  const definitionCache = new Map<string, WorkflowDefinition | null>();
  const projectDefaultCache = new Map<string, Awaited<ReturnType<typeof loadProjectDefault>>>();

  for (const row of rows) {
    result.scanned++;
    try {
      // Parse the yaml at most once per workflow_version per sweep.
      let definition: WorkflowDefinition | null;
      if (definitionCache.has(row.workflowVersionId)) {
        definition = definitionCache.get(row.workflowVersionId) ?? null;
      } else {
        try {
          definition = await parseWorkflowYaml(row.yamlContent);
        } catch (e) {
          console.warn(
            `[review-timeout] failed to parse workflow_version ${row.workflowVersionId}:`,
            e,
          );
          definition = null;
        }
        definitionCache.set(row.workflowVersionId, definition);
      }
      if (!definition) continue;

      const stepDef = definition.steps[row.stepRun.stepIndex];
      if (!stepDef || stepDef.type !== 'approve') continue;

      // Load project default at most once per project per sweep.
      let projectDefault: Awaited<ReturnType<typeof loadProjectDefault>>;
      if (projectDefaultCache.has(row.projectId)) {
        projectDefault = projectDefaultCache.get(row.projectId);
      } else {
        projectDefault = await loadProjectDefault(row.projectId);
        projectDefaultCache.set(row.projectId, projectDefault);
      }

      const { policy } = resolvePolicyForStep(stepDef as ApproveStep, {
        project: projectDefault,
      });

      const timeoutMs = parseDurationMs(policy.timeout);
      if (!timeoutMs) {
        console.warn(
          `[review-timeout] step_run ${row.stepRun.id} has unparseable timeout '${policy.timeout}' — skipping`,
        );
        continue;
      }

      // Use updatedAt as the "review opened at" timestamp. This is a
      // proxy: workflow-runner sets updatedAt when the step transitions
      // pending → running, and peer-reviewer doesn't touch updatedAt
      // mid-review, so updatedAt ≈ "review window opened at" while
      // status = 'running'. For 'pending' status (rare — the step exists
      // but the runner hasn't initiated reviews yet), we still use
      // updatedAt: this gives a slightly conservative deadline, which is
      // fine for the sweep's purpose.
      const startedAt = row.stepRun.updatedAt instanceof Date
        ? row.stepRun.updatedAt.getTime()
        : new Date(row.stepRun.updatedAt as unknown as string).getTime();
      const deadline = new Date(startedAt + timeoutMs);

      if (deadline.getTime() > now) continue; // not yet expired

      const decision = await applyTimeoutAction(row, stepDef as ApproveStep, policy, deadline);
      if (decision.fired) result.fired++;
    } catch (e) {
      result.errors++;
      console.error(`[review-timeout] error processing step_run ${row.stepRun.id}:`, e);
    }
  }

  if (result.fired > 0 || (result.errors > 0 && process.env.LOG_LEVEL === 'debug')) {
    console.log(
      `[review-timeout] swept ${result.scanned} step(s); fired ${result.fired}, errors ${result.errors}`,
    );
  }

  return result;
}
