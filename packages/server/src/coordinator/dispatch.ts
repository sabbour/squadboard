/**
 * coordinator/dispatch.ts — One-shot dispatch core for the mini-coordinator (W29 MC-3).
 *
 * Glues MC-1 (types + Zod), MC-2 (preamble), MC-4 (cache + hash), and the
 * LLM client into a single `dispatchViaCoordinator()` call.
 *
 * Failure modes (surface to caller; no swallowing):
 *   - ZodError          — bad input (coordinatorInputSchema) or bad LLM output
 *   - CoordinatorLlmParseError — LLM returned non-JSON / schema-invalid text
 *   - AbortError        — LLM timed out or caller aborted
 */

import type {
  CoordinatorDecision,
  CoordinatorInput,
  CoordinatorCallMeta,
  CoordinatorCallResult,
} from "./types.js";
import { coordinatorInputSchema } from "./schemas.js";
import { hashCoordinatorInput } from "./hash.js";
import { decisionCache, CoordinatorDecisionCache } from "./cache.js";
import { loadCoordinatorPreamble } from "./preamble.js";
import {
  callCoordinatorLlm,
  type LlmCaller,
} from "./llm-client.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DispatchOptions {
  /** Default: COORDINATOR_MODEL env → "claude-haiku-4.5" */
  model?: string;
  bypassCache?: boolean;
  squadRoot?: string;
  /** Injectable LlmCaller for tests. */
  llmCaller?: LlmCaller;
  timeoutMs?: number;
  /** Injectable cache for tests. If omitted, uses the singleton decisionCache. */
  cache?: CoordinatorDecisionCache;
}

export interface DispatchResult extends CoordinatorCallResult {
  cacheHit: boolean;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export async function dispatchViaCoordinator(
  input: CoordinatorInput,
  opts?: DispatchOptions,
): Promise<DispatchResult> {
  // 1. Validate input (throws ZodError on invalid)
  coordinatorInputSchema.parse(input);

  // 2. Stable hash of the input
  const inputHash = hashCoordinatorInput(input);

  // 3. Cache lookup (unless bypassed)
  const cache = opts?.cache ?? decisionCache;
  if (!opts?.bypassCache) {
    const cached = cache.get(input);
    if (cached !== undefined) {
      const meta: CoordinatorCallMeta = {
        model: opts?.model ?? process.env.COORDINATOR_MODEL ?? "claude-haiku-4.5",
        promptTokens: 0,
        completionTokens: 0,
        durationMs: 0,
        cacheHit: true,
        inputHash,
      };
      return { decision: cached, meta, cacheHit: true };
    }
  }

  // 4. Load preamble
  const preamble = await loadCoordinatorPreamble({ squadRoot: opts?.squadRoot });

  // 5. Stringify input for user payload
  const userPayload = JSON.stringify(input, null, 2);

  // 6. Resolve model
  const model = opts?.model ?? process.env.COORDINATOR_MODEL ?? "claude-haiku-4.5";

  // 7. Call LLM
  const llmResult = await callCoordinatorLlm({
    preamble: preamble.text,
    userPayload,
    model,
    timeoutMs: opts?.timeoutMs,
    llmCaller: opts?.llmCaller,
  });

  // 8. Store in cache
  cache.set(input, llmResult.decision);

  // 9. Build and return result
  const meta: CoordinatorCallMeta = {
    ...llmResult.meta,
    cacheHit: false,
    inputHash,
  };

  return { decision: llmResult.decision, meta, cacheHit: false };
}
