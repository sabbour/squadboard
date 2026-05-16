/**
 * coordinator/index.ts -- public barrel for the mini-coordinator module.
 *
 * Downstream slices import types and schemas from here; they do not reach
 * into types.ts or schemas.ts directly.
 */

export type {
  CoordinatorInput,
  CoordinatorDecision,
  CoordinatorBatchInput,
  CoordinatorBatchOutput,
  CoordinatorCallMeta,
  CoordinatorCallResult,
} from "./types.js";

export {
  coordinatorInputSchema,
  coordinatorDecisionSchema,
  coordinatorBatchInputSchema,
  coordinatorBatchOutputSchema,
  coordinatorCallMetaSchema,
  coordinatorCallResultSchema,
} from "./schemas.js";
