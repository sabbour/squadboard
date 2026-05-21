/**
 * ceremony-column-trigger.ts
 *
 * Shared helper for firing `on_issue_entry` ceremonies and emitting the
 * `wave.closeout` signal when an issue moves into a new kanban column.
 *
 * Called from:
 *   - routes/issues.ts (PATCH /:id/move and PATCH /:id)   — user-initiated moves
 *   - engine/stepper.ts (syncRunIssueColumn)               — system-initiated moves
 *
 * The ready column is intentionally excluded here: pickup-ready sweep handles
 * that path via triggerReadyPickup.
 */

import { eq, and, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { spawnCeremonyRun } from './ceremony-scheduler.js';
import { emitSignal } from './ceremony-signal-emitter.js';
import { readyWorkflowStepsSweep } from '../engine/sweeps/ready-workflow-steps.js';

/**
 * Fire every active `on_issue_entry` ceremony whose `triggerConfig.column`
 * matches `columnSlug`, then emit `wave.closeout` when `semantic === 'done'`
 * so the built-in Scribe ceremony picks up its clean-out run.
 *
 * Fire-and-forget: never throws back to the caller.
 */
export function fireCeremoniesOnColumnEntry(
  projectId: string,
  issueId: string,
  columnSlug: string,
  semantic: string,
): void {
  void (async () => {
    const db = getDb();

    const candidates = await db
      .select({ id: schema.workflows.id, name: schema.workflows.name })
      .from(schema.workflows)
      .where(
        and(
          eq(schema.workflows.projectId, projectId),
          eq(schema.workflows.triggerKind, 'on_issue_entry'),
          eq(schema.workflows.status, 'active'),
          sql`${schema.workflows.triggerConfig}->>'column' = ${columnSlug}`,
        ),
      );

    for (const ceremony of candidates) {
      try {
        await spawnCeremonyRun(ceremony.id, {
          anchorIssueId: issueId,
          trigger: `on_issue_entry:${columnSlug}`,
          triggerSource: {
            kind: 'on_event',
            eventType: `on_issue_entry:${columnSlug}`,
            detail: JSON.stringify({ column: columnSlug, issueId }),
            anchorIssueId: issueId,
          },
        });
      } catch (err) {
        console.error(
          `[ceremony-column-trigger] failed to spawn ceremony "${ceremony.name}" for issue ${issueId} on column "${columnSlug}":`,
          err,
        );
      }
    }

    // Scribe close-out: emit wave.closeout when work lands in Done so the
    // built-in Scribe ceremony (agent-signal: wave.closeout) picks it up.
    if (semantic === 'done') {
      await emitSignal({
        projectId,
        signalName: 'wave.closeout',
        anchorIssueId: issueId,
        contextPayload: { issueId, column: columnSlug },
      });
    }

    await readyWorkflowStepsSweep.run();
  })().catch((err) => {
    console.error(
      `[ceremony-column-trigger] failed for issue ${issueId} column "${columnSlug}":`,
      err,
    );
  });
}
