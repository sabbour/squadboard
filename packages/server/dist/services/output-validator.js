/**
 * output-validator.ts — Output schema validation service (Demo 6)
 *
 * Invariant 4: Output schema validation fires at session end —
 * AFTER sendAndWait completes, BEFORE recordRunCompletion marks the run done.
 * Never on post-tool-use hooks.
 *
 * recordRunCompletion() replaces the direct status update in stepper.ts runWorker.
 */
import Ajv from 'ajv';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
const ajv = new Ajv();
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
export async function validateAgentOutput(rawOutput, jsonSchema) {
    let parsedOutput;
    try {
        parsedOutput = JSON.parse(rawOutput);
    }
    catch {
        return { valid: false, errors: ['Output is not valid JSON'], rawOutput };
    }
    const validate = ajv.compile(jsonSchema);
    const valid = validate(parsedOutput);
    if (valid) {
        return { valid: true, errors: [], rawOutput, parsedOutput };
    }
    const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'unknown error'}`);
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
export async function recordRunCompletion(issueRunId, output, workflowVersionId) {
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
            let jsonSchema;
            try {
                jsonSchema = JSON.parse(wv.jsonSchema);
            }
            catch {
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
}
//# sourceMappingURL=output-validator.js.map