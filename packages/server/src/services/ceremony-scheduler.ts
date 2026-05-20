/**
 * ceremony-scheduler.ts — Phase 10
 *
 * Heartbeat sweep for `triggerKind = 'on_schedule'` ceremonies.
 *
 * One row in `ceremony_schedules` per (workflow, cron) pair. The dispatcher
 * tick calls `sweepDueSchedules()` periodically; for every schedule whose
 * `nextFireAt <= now()` and `enabled = true` we:
 *
 *   1. Spawn a workflow_run for the ceremony's active version
 *      (anchored on the project's first issue — see anchor-resolution
 *      caveat documented inline).
 *   2. Update `lastFiredAt = now()` and recompute `nextFireAt` from the
 *      cron expression using `cron-parser`.
 *
 * The sweep is idempotent: a fast UPDATE-then-SELECT pattern guards against
 * double-firing if the dispatcher tick overlaps. We claim a schedule by
 * advancing its `next_fire_at` to a future placeholder before spawning,
 * then write the canonical recomputed value once the spawn resolves.
 */

import { eq, and, lte, sql, not, exists } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import { getDb, schema } from '../db/index.js';
import { createWorkflowRun } from '../engine/workflow-runner.js';
import {
  isGitHubIssueIntakeConfig,
  runGitHubIssueIntake,
} from '../github/issue-intake.js';
import {
  isDocReviewIntakeConfig,
  runGitHubDocReviewIntake,
} from '../github/doc-review-intake.js';

// In-memory consecutive-failure tracker per schedule id.
// Resets on process restart; a persistent counter is a follow-up.
const sweepFailureCount = new Map<string, number>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SweepResult {
  scanned: number;
  fired: number;
  skipped: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Cron helpers
// ---------------------------------------------------------------------------

/**
 * Compute the next N fire times for a cron expression in the given timezone.
 * Returns ISO strings. Throws on invalid cron.
 */
export function previewNextFireTimes(
  cronExpr: string,
  count = 3,
  timezone = 'UTC',
  fromDate: Date = new Date(),
): string[] {
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: fromDate,
    tz: timezone,
  });
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(interval.next().toDate().toISOString());
  }
  return out;
}

/**
 * Compute the next single fire time strictly after `from`. Returns a Date.
 */
export function computeNextFire(
  cronExpr: string,
  timezone = 'UTC',
  from: Date = new Date(),
): Date {
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: from,
    tz: timezone,
  });
  return interval.next().toDate();
}

// ---------------------------------------------------------------------------
// Schedule CRUD helpers (used by the route layer too)
// ---------------------------------------------------------------------------

export async function recomputeNextFire(scheduleId: string): Promise<Date | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.ceremonySchedules)
    .where(eq(schema.ceremonySchedules.id, scheduleId))
    .limit(1);
  if (!row) return null;
  const next = computeNextFire(row.cronExpr, row.timezone ?? 'UTC');
  await db
    .update(schema.ceremonySchedules)
    .set({ nextFireAt: next, updatedAt: new Date() })
    .where(eq(schema.ceremonySchedules.id, scheduleId));
  return next;
}

export async function enableSchedule(scheduleId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.ceremonySchedules)
    .set({ enabled: true, updatedAt: new Date() })
    .where(eq(schema.ceremonySchedules.id, scheduleId));
}

export async function disableSchedule(scheduleId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.ceremonySchedules)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(schema.ceremonySchedules.id, scheduleId));
}

// ---------------------------------------------------------------------------
// Anchor-issue resolution
// ---------------------------------------------------------------------------
// `workflow_runs.issue_id` is NOT NULL (the engine assumes every workflow run
// is anchored on an issue). For ceremonies that fire on a schedule with no
// natural issue, we anchor on the project's most-recent issue. If the
// project has no issues at all, the spawn is skipped with a log line.
//
// This is a Phase 10 hacking-phase compromise; a future phase should make
// `workflow_runs.issue_id` nullable and surface "ceremony runs" as a
// first-class concept in the UI.
async function resolveAnchorIssue(projectId: string): Promise<string | null> {
  const db = getDb();
  // Root cause (verbal-spam-loop-rootcause.md, 2026-05-15):
  // After a fan-out materialises, the newest issues in the project are the
  // fan-out children (e.g. "Foo — verbal"). The old query (ORDER BY created_at
  // DESC, no filter) would pick a child as the next ceremony anchor, triggering
  // another fan-out on it, compounding titles indefinitely each cron tick.
  //
  // Fix: exclude any issue that appears as a child_issue_id in issue_links with
  // link_type = 'fan_out'. Only top-level (non-child) issues are eligible anchors.
  const [issue] = await db
    .select({ id: schema.issues.id })
    .from(schema.issues)
    .where(
      and(
        eq(schema.issues.projectId, projectId),
        not(
          exists(
            db
              .select({ id: schema.issueLinks.id })
              .from(schema.issueLinks)
              .where(
                and(
                  eq(schema.issueLinks.childIssueId, schema.issues.id),
                  eq(schema.issueLinks.linkType, 'fan_out'),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(sql`${schema.issues.createdAt} DESC`)
    .limit(1);
  return issue?.id ?? null;
}

// ---------------------------------------------------------------------------
// spawnCeremonyRun — shared helper used by both the scheduler sweep and
// the event dispatcher (Phase 10).
// ---------------------------------------------------------------------------

/**
 * Spawn a workflow_run for the ceremony's active workflow_version.
 * Returns the new workflowRunId, or null if no active version was found
 * or no anchor issue could be resolved.
 *
 * `opts.anchorIssueId` overrides the auto-resolved anchor (used by the
 * event dispatcher when the event payload carries an issue id).
 *
 * Stream D — D4: callers may pass `opts.triggerSource` for richer provenance
 * than the bare `opts.trigger` string. When omitted the helper will derive a
 * sensible TriggerSource from the legacy `trigger` field.
 */
export async function spawnCeremonyRun(
  workflowId: string,
  opts: {
    anchorIssueId?: string;
    trigger: string;
    triggerSource?: import('../engine/workflow-runner.js').TriggerSource;
  } = { trigger: 'manual' },
): Promise<string | null> {
  const db = getDb();

  const [workflow] = await db
    .select()
    .from(schema.workflows)
    .where(eq(schema.workflows.id, workflowId))
    .limit(1);
  if (!workflow) {
    console.warn(`[ceremony] spawn skipped — workflow ${workflowId} not found`);
    return null;
  }

  if (workflow.kind === 'narrative') {
    console.warn(
      `[ceremony] spawn skipped — workflow ${workflowId} kind='narrative' (not executable)`,
    );
    return null;
  }

  // Phase 11: respect lifecycle status. Manual /run still works (caller passed
  // through routes/ceremonies.ts which can override), but auto-fire trigger
  // paths (scheduler / event dispatcher) MUST honour draft/paused/archived.
  if (
    workflow.status !== 'active' &&
    opts.trigger !== 'manual' &&
    opts.trigger !== 'manual_force'
  ) {
    console.warn(
      `[ceremony] spawn skipped — workflow ${workflowId} status='${workflow.status}' (not active, trigger=${opts.trigger})`,
    );
    return null;
  }

  const versions = await db
    .select()
    .from(schema.workflowVersions)
    .where(
      and(
        eq(schema.workflowVersions.workflowId, workflowId),
        eq(schema.workflowVersions.isActive, true),
      ),
    )
    .limit(1);
  const activeVersion = versions[0];
  if (!activeVersion) {
    console.warn(
      `[ceremony] spawn skipped — workflow ${workflowId} has no active version`,
    );
    return null;
  }

  const anchorIssueId =
    opts.anchorIssueId ?? (await resolveAnchorIssue(workflow.projectId));
  if (!anchorIssueId) {
    console.warn(
      `[ceremony] spawn skipped — workflow ${workflowId} has no anchor issue ` +
        `(project ${workflow.projectId} has zero issues)`,
    );
    return null;
  }

  const triggerSource = opts.triggerSource ?? deriveTriggerSource(opts.trigger, anchorIssueId);
  const runId = await createWorkflowRun(anchorIssueId, activeVersion.id, triggerSource);
  console.log(
    `[ceremony] spawned workflow_run ${runId} for ${workflow.slug} ` +
      `(trigger=${opts.trigger}, anchor=${anchorIssueId})`,
  );
  return runId;
}

function deriveTriggerSource(
  trigger: string,
  anchorIssueId: string,
): import('../engine/workflow-runner.js').TriggerSource {
  if (trigger === 'manual' || trigger === 'manual_force') {
    return { kind: trigger, anchorIssueId };
  }
  if (trigger === 'on_schedule') {
    return { kind: 'on_schedule', anchorIssueId };
  }
  if (trigger.startsWith('on_event:')) {
    return {
      kind: 'on_event',
      eventType: trigger.slice('on_event:'.length),
      detail: trigger,
      anchorIssueId,
    };
  }
  return { kind: 'unknown', detail: trigger, anchorIssueId };
}

// ---------------------------------------------------------------------------
// sweepDueSchedules — main heartbeat entry point
// ---------------------------------------------------------------------------

export async function sweepDueSchedules(now: Date = new Date()): Promise<SweepResult> {
  const db = getDb();
  const result: SweepResult = { scanned: 0, fired: 0, skipped: 0, errors: 0 };

  const due = await db
    .select()
    .from(schema.ceremonySchedules)
    .where(
      and(
        eq(schema.ceremonySchedules.enabled, true),
        lte(schema.ceremonySchedules.nextFireAt, now),
      ),
    );

  result.scanned = due.length;

  for (const sched of due) {
    try {
      // Idempotency: tentatively push next_fire_at far into the future so a
      // concurrent sweep skips this row. We rewrite it with the canonical
      // value below.
      const tentative = new Date(now.getTime() + 5 * 60_000);
      const updated = await db
        .update(schema.ceremonySchedules)
        .set({ nextFireAt: tentative, updatedAt: new Date() })
        .where(
          and(
            eq(schema.ceremonySchedules.id, sched.id),
            lte(schema.ceremonySchedules.nextFireAt, now),
          ),
        )
        .returning({ id: schema.ceremonySchedules.id });

      if (updated.length === 0) {
        // Another sweep beat us to it.
        result.skipped += 1;
        continue;
      }

      const scheduledAction = await runScheduledAction(sched, now);

      // Recompute the true next fire time AFTER firing, so cron expressions
      // like '*/5 * * * *' advance from the actual fire instant.
      const nextFire = computeNextFire(
        sched.cronExpr,
        sched.timezone ?? 'UTC',
        now,
      );
      await db
        .update(schema.ceremonySchedules)
        .set({
          lastFiredAt: now,
          nextFireAt: nextFire,
          updatedAt: new Date(),
        })
        .where(eq(schema.ceremonySchedules.id, sched.id));

      if (scheduledAction.fired) result.fired += 1;
      else result.skipped += 1;
      // Reset failure count on a clean fire/skip.
      sweepFailureCount.delete(sched.id);
    } catch (err) {
      const failCount = (sweepFailureCount.get(sched.id) ?? 0) + 1;
      sweepFailureCount.set(sched.id, failCount);

      console.error(
        `[ceremony] sweep error for schedule ${sched.id} (consecutive failures: ${failCount}):`,
        err,
      );

      // On repeated failure, push nextFireAt to 1 h from now to prevent
      // a re-entry storm driven by the tentative 5-min placeholder set above.
      if (failCount >= 2) {
        const backoffUntil = new Date(now.getTime() + 60 * 60_000);
        try {
          await db
            .update(schema.ceremonySchedules)
            .set({ nextFireAt: backoffUntil, updatedAt: new Date() })
            .where(eq(schema.ceremonySchedules.id, sched.id));
          console.warn(
            `[ceremony] schedule ${sched.id} backed off until ${backoffUntil.toISOString()} ` +
            `after ${failCount} consecutive failures`,
          );
        } catch (backoffErr) {
          console.error(
            `[ceremony] failed to write backoff for schedule ${sched.id}:`,
            backoffErr,
          );
        }
      }

      result.errors += 1;
    }
  }

  return result;
}

async function runScheduledAction(
  sched: typeof schema.ceremonySchedules.$inferSelect,
  now: Date,
): Promise<{ fired: boolean }> {
  const db = getDb();
  const [workflow] = await db
    .select({
      projectId: schema.workflows.projectId,
      triggerConfig: schema.workflows.triggerConfig,
    })
    .from(schema.workflows)
    .where(eq(schema.workflows.id, sched.workflowId))
    .limit(1);

  if (workflow && isGitHubIssueIntakeConfig(workflow.triggerConfig)) {
    const intake = await runGitHubIssueIntake({
      projectId: workflow.projectId,
      triggerConfig: workflow.triggerConfig as Record<string, unknown>,
      scheduleId: sched.id,
      now,
    });
    console.log(
      `[ceremony] github issue intake ${intake.owner}/${intake.repo}: ` +
      `fetched=${intake.fetched}, created=${intake.created}, updated=${intake.updated}, ` +
      `workflows=${intake.workflowsStarted}, errors=${intake.errors}`,
    );
    return { fired: true };
  }

  if (workflow && isDocReviewIntakeConfig(workflow.triggerConfig)) {
    const intake = await runGitHubDocReviewIntake({
      projectId: workflow.projectId,
      triggerConfig: workflow.triggerConfig as Record<string, unknown>,
      workflowId: sched.workflowId,
      scheduleId: sched.id,
      now,
    });
    console.log(
      `[ceremony] doc review intake ${intake.owner}/${intake.repo}: ` +
      `fetched=${intake.fetched}, candidates=${intake.candidates}, created=${intake.created}, ` +
      `updated=${intake.updated}, workflows=${intake.workflowsStarted}, errors=${intake.errors}`,
    );
    return { fired: true };
  }

  const runId = await spawnCeremonyRun(sched.workflowId, {
    trigger: 'on_schedule',
    triggerSource: {
      kind: 'on_schedule',
      scheduleId: sched.id,
      detail: sched.cronExpr,
    },
  });
  return { fired: Boolean(runId) };
}
