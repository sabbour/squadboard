// HookPipeline runs registered hooks in sequence at defined lifecycle points.
// Demo 6 hook point: 'output-validation' (Invariant 4)
// validateAgentOutput is implemented by Hockney in the workflow engine.
import { validateAgentOutput } from '../services/output-validator.js';
export class HookPipeline {
    hooks = [];
    register(hook) {
        this.hooks.push(hook);
    }
    /** Run all hooks registered for `point` in order.
     *  Stops at the first failure (pass=false). */
    async run(point, context) {
        const applicable = this.hooks.filter((h) => h.point === point);
        const results = [];
        for (const hook of applicable) {
            const result = await hook.handler(context);
            results.push(result);
            if (!result.pass) {
                return { allPassed: false, results };
            }
        }
        return { allPassed: true, results };
    }
}
/** Singleton pipeline for the server process. */
export const globalPipeline = new HookPipeline();
/** Register the output-validation hook (Invariant 4).
 *  Call once at server startup. */
export function registerOutputValidationHook(pipeline) {
    pipeline.register({
        name: 'output-schema-validator',
        point: 'output-validation',
        handler: async (ctx) => {
            if (!ctx.jsonSchema || !ctx.output)
                return { pass: true };
            // Delegate to Hockney's validateAgentOutput service.
            const result = await validateAgentOutput(ctx.output, ctx.jsonSchema);
            return { pass: result.valid, message: result.errors.join(', ') };
        },
    });
}
//# sourceMappingURL=hook-pipeline.js.map