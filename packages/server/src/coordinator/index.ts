/**
 * coordinator/index.ts -- public barrel for the mini-coordinator module.
 *
 * Downstream slices import types and schemas from here; they do not reach
 * into types.ts or schemas.ts directly.
 *
 * MC-1: types + schemas
 * MC-2: preamble
 * MC-3: llm-client + dispatch
 * MC-4: cache + hash
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

export {
  loadCoordinatorPreamble,
  resetPreambleCache,
  getCachedPreamble,
} from "./preamble.js";
export type { PreambleSource } from "./preamble.js";

export {
  CoordinatorDecisionCache,
  decisionCache,
} from "./cache.js";
export type { CacheStats, CacheOptions } from "./cache.js";

export { stableStringify, sha256Hex, hashCoordinatorInput } from "./hash.js";

export {
  callCoordinatorLlm,
  CoordinatorLlmParseError,
  defaultLlmCaller,
} from "./llm-client.js";
export type {
  LlmCaller,
  LlmCallerOpts,
  LlmCallerResult,
  CoordinatorLlmCallParams,
  CoordinatorLlmResult,
} from "./llm-client.js";

export { dispatchViaCoordinator } from "./dispatch.js";
export type { DispatchOptions, DispatchResult } from "./dispatch.js";

// MC-11: batch dispatch
export { dispatchBatchViaCoordinator, BatchDecisionCache, batchDecisionCache, CoordinatorTimeoutError } from "./batch.js";
export type { BatchCacheOptions, BatchDispatchOptions, BatchDispatchResult } from "./batch.js";
