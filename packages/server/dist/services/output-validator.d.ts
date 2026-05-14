/**
 * output-validator.ts — Output schema validation service (Demo 6)
 *
 * Invariant 4: Output schema validation fires at session end —
 * AFTER sendAndWait completes, BEFORE recordRunCompletion marks the run done.
 * Never on post-tool-use hooks.
 *
 * recordRunCompletion() replaces the direct status update in stepper.ts runWorker.
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    rawOutput: string;
    parsedOutput?: Record<string, unknown>;
}
/**
 * Validate raw agent output string against a JSON Schema (Invariant 4).
 *
 * Steps:
 *  1. Try JSON.parse(rawOutput)
 *  2. If parse fails: { valid: false, errors: ['Output is not valid JSON'] }
 *  3. Run ajv.validate(jsonSchema, parsed)
 *  4. Return result
 */
export declare function validateAgentOutput(rawOutput: string, jsonSchema: Record<string, unknown>): Promise<ValidationResult>;
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
export declare function recordRunCompletion(issueRunId: string, output: string, workflowVersionId: string | null): Promise<void>;
//# sourceMappingURL=output-validator.d.ts.map