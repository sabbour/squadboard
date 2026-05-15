/**
 * output-validator.ts — Output schema validation service (Demo 6)
 *
 * Invariant 4: Output schema validation fires at session end —
 * AFTER sendAndWait completes, BEFORE recordRunCompletion marks the run done.
 * Never on post-tool-use hooks.
 *
 * recordRunCompletion() replaces the direct status update in stepper.ts runWorker.
 */

import { Ajv } from 'ajv';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

const ajv = new Ajv();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  rawOutput: string;
  parsedOutput?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// validateAgentOutput
// ---------------------------------------------------------------------------

/**
 * Validate raw agent output string against a JSON Schema (Invariant 4).
 *
 * Steps:
 *  1. Try JSON.parse(rawOutput)
 *  2. If parse fails: { valid: false, errors: ['Output is not valid JSON'] }
 *  3. Run ajv.validate(jsonSchema, parsed)
 *  4. Return result
 */
export async function validateAgentOutput(
  rawOutput: string,
  jsonSchema: Record<string, unknown>,
): Promise<ValidationResult> {
  let parsedOutput: Record<string, unknown>;

  try {
    parsedOutput = JSON.parse(rawOutput) as Record<string, unknown>;
  } catch {
    return { valid: false, errors: ['Output is not valid JSON'], rawOutput };
  }

  const validate = ajv.compile(jsonSchema);
  const valid = validate(parsedOutput) as boolean;

  if (valid) {
    return { valid: true, errors: [], rawOutput, parsedOutput };
  }

  const errors = (validate.errors ?? []).map(
    (e: unknown) => `${(e as { instancePath?: string }).instancePath || '/'} ${(e as { message?: string }).message ?? 'unknown error'}`,
  );
  return { valid: false, errors, rawOutput, parsedOutput };
}

// ---------------------------------------------------------------------------
// recordRunCompletion (Invariant 4 integration point)
// ---------------------------------------------------------------------------

/**
 * Finalise an issue_run after sendAndWait returns.
 *
 * If the run belongs to a workflow version that defines a JSON Schema,
 * validate the output first (Invariant 4).  On schema failure the run is
 * marked 'failed' with a descriptive error_message.  Otherwise (schema
 * passes, or no schema is attached) the run is marked 'completed'.
 *
 * This is the ONLY place that transitions an issue_run from 'running' to a
 * terminal state in the success path.  markFailed() in stepper.ts handles
 * the error path.
 */
export async function recordRunCompletion(
  issueRunId: string,
  output: string,
  workflowVersionId: string | null,
): Promise<void> {
  const db = getDb();
  const { issueRuns, workflowVersions } = schema;

  // --- Invariant 4: schema validation when a workflow version is attached ---
  if (workflowVersionId) {
    const [wv] = await db
      .select({ jsonSchema: workflowVersions.jsonSchema })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, workflowVersionId))
      .limit(1);

    if (wv?.jsonSchema) {
      let jsonSchema: Record<string, unknown>;
      try {
        jsonSchema = JSON.parse(wv.jsonSchema) as Record<string, unknown>;
      } catch {
        // Corrupt schema stored in DB — fail safe
        await db
          .update(issueRuns)
          .set({
            status: 'failed',
            errorMessage: 'Output schema validation failed: stored JSON Schema is not valid JSON',
            completedAt: new Date(),
            leaseExpiresAt: null,
            heartbeatAt: null,
            updatedAt: new Date(),
          })
          .where(eq(issueRuns.id, issueRunId));
        return;
      }

      const result = await validateAgentOutput(output, jsonSchema);

      if (!result.valid) {
        const errorDetail = result.errors.join('; ');
        await db
          .update(issueRuns)
          .set({
            status: 'failed',
            output,
            errorMessage: `Output schema validation failed: ${errorDetail}`,
            completedAt: new Date(),
            leaseExpiresAt: null,
            heartbeatAt: null,
            updatedAt: new Date(),
          })
          .where(eq(issueRuns.id, issueRunId));
        console.warn(`[output-validator] run ${issueRunId} failed schema validation: ${errorDetail}`);
        return;
      }

      console.log(`[output-validator] run ${issueRunId} passed schema validation`);
    }
  }

  // --- No schema or validation passed: mark completed ---
  await db
    .update(issueRuns)
    .set({
      status: 'completed',
      output,
      completedAt: new Date(),
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    })
    .where(eq(issueRuns.id, issueRunId));

  // --- Phase 9: auto-extract a deliverable from agent_run output ---
  // Only for primary agent_runs; peer_review / route / split / specifier_run
  // produce internal artefacts that don't belong on the deliverables tab.
  try {
    const { deliverables, issues, projects } = schema;
    const [run] = await db
      .select({ kind: issueRuns.kind, issueId: issueRuns.issueId })
      .from(issueRuns)
      .where(eq(issueRuns.id, issueRunId))
      .limit(1);
    if (run?.kind === 'agent_run') {
      const { extractFromIssueRun } = await import('./deliverables.js');
      const created = await extractFromIssueRun(issueRunId);
      if (created) {
        const [issue] = await db
          .select({ projectId: issues.projectId })
          .from(issues)
          .where(eq(issues.id, run.issueId))
          .limit(1);
        if (issue?.projectId) {
          // Lazy-import event bus + system-comment helper to avoid cycles.
          const { eventBus } = await import('../realtime/event-bus.js');
          const { appendSystemComment } = await import('./issues.js');
          eventBus.emitDeliverableEvent('deliverable.created', issue.projectId, {
            issueId: run.issueId,
            deliverable: created,
            source: 'auto-extract',
          });
          await appendSystemComment({
            issueId: run.issueId,
            eventKind: 'deliverable.submitted',
            summary: `Deliverable auto-extracted from run output: ${created.title}`,
            eventPayload: {
              deliverableId: created.id,
              kind: created.kind,
              runId: issueRunId,
              source: 'auto-extract',
            },
          }).catch((e) => console.warn('[deliverables] system-comment failed:', e));
        }
        // suppress unused-var warning for projects table in destructure
        void projects;
        void deliverables;
      }
    }
  } catch (err) {
    // Non-fatal: extraction failures must not break run completion.
    console.warn(`[deliverables] auto-extract failed for run ${issueRunId}:`, err);
  }
}
