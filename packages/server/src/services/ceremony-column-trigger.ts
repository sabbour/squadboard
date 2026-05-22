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
 * Build the set of string aliases that may appear in a ceremony YAML's
 * `trigger.config.column` for the given column. Bundle authors use human-
 * readable slugs ('in-review', 'done') rather than UUIDs or raw semantic
 * strings ('review'), so we resolve all likely spellings.
 */
function columnAliases(columnId: string, semantic: string): string[] {
  const aliases = new Set<string>([
    columnId,       // UUID — future-proof for UUIDs in YAML
    semantic,       // 'review', 'done', 'in_progress', etc.
    semantic.replace(/_/g, '-'),  // 'in-progress', 'in-review' (underscore → dash)
  ]);
  // Well-known semantic → slug mappings used in bundled ceremony YAMLs
  if (semantic === 'review')      { aliases.add('in-review'); aliases.add('review'); }
  if (semantic === 'in_progress') { aliases.add('in-progress'); aliases.add('in_progress'); }
  if (semantic === 'backlog')     { aliases.add('backlog'); }
  if (semantic === 'done')        { aliases.add('done'); }
  if (semantic === 'ready')       { aliases.add('ready'); }
  return [...aliases];
}

/**
 * Fire every active `on_issue_entry` ceremony whose `triggerConfig.column`
 * matches `columnSlug` or any known alias for the column's semantic, then
 * emit `wave.closeout` when `semantic === 'done'` so the built-in Scribe
 * ceremony (agent-signal: wave.closeout) picks up its clean-out run.
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

    // Resolve all possible values the ceremony YAML may have stored in
    // triggerConfig.column for this column (UUID, semantic, slug variants).
    const aliases = columnAliases(columnSlug, semantic);

    const candidates = await db
      .select({ id: schema.workflows.id, name: schema.workflows.name })
      .from(schema.workflows)
      .where(
        and(
          eq(schema.workflows.projectId, projectId),
          eq(schema.workflows.triggerKind, 'on_issue_entry'),
          eq(schema.workflows.status, 'active'),
          // Match any of the known slug aliases for this column so YAML authors
          // can write 'in-review' or 'review' and it resolves correctly.
          sql`${schema.workflows.triggerConfig}->>'column' IN (${sql.join(
            aliases.map((a) => sql`${a}`),
            sql`, `,
          )})`,
        ),
      );

    for (const ceremony of candidates) {
      try {
        await spawnCeremonyRun(ceremony.id, {
          anchorIssueId: issueId,
          trigger: `on_issue_entry:${columnSlug}`,
          triggerSource: {
            kind: 'on_event',
            eventType: `on_issue_entry:${semantic}`,
            detail: JSON.stringify({ column: columnSlug, semantic, issueId }),
            anchorIssueId: issueId,
          },
        });
      } catch (err) {
        console.error(
          `[ceremony-column-trigger] failed to spawn ceremony "${ceremony.name}" for issue ${issueId} on column "${columnSlug}" (semantic "${semantic}"):`,
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
