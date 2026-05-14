export type HookPoint = 'pre-run' | 'output-validation' | 'post-run' | 'on-error';
export interface Hook {
    name: string;
    point: HookPoint;
    handler: (context: HookContext) => Promise<HookResult>;
}
export interface HookContext {
    issueRunId: string;
    agentName: string;
    output?: string;
    workflowVersionId?: string;
    jsonSchema?: Record<string, unknown>;
}
export interface HookResult {
    pass: boolean;
    message?: string;
    /** Optional: hook may transform the output for downstream steps. */
    mutatedOutput?: string;
}
export declare class HookPipeline {
    private hooks;
    register(hook: Hook): void;
    /** Run all hooks registered for `point` in order.
     *  Stops at the first failure (pass=false). */
    run(point: HookPoint, context: HookContext): Promise<{
        allPassed: boolean;
        results: HookResult[];
    }>;
}
/** Singleton pipeline for the server process. */
export declare const globalPipeline: HookPipeline;
/** Register the output-validation hook (Invariant 4).
 *  Call once at server startup. */
export declare function registerOutputValidationHook(pipeline: HookPipeline): void;
//# sourceMappingURL=hook-pipeline.d.ts.map