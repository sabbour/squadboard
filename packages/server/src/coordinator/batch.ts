/**
 * coordinator/batch.ts — Batch dispatch for the mini-coordinator (W29 MC-11).
 *
 * Processes N pending issues in a single LLM call, letting the coordinator
 * decide for all of them at once. Uses a separate cache (BatchDecisionCache)
 * so batch hits never collide with per-issue keys in the singleton decisionCache.
 *
 * Failure modes (surface to caller; no swallowing):
 *   - ZodError               — bad input OR valid-JSON-but-wrong-schema LLM output
 *   - CoordinatorLlmParseError — LLM returned non-JSON text
 */

import type {
  CoordinatorBatchInput,
  CoordinatorBatchOutput,
  CoordinatorCallMeta,
} from "./types.js";
import { coordinatorBatchInputSchema, coordinatorBatchOutputSchema } from "./schemas.js";
import { stableStringify, sha256Hex } from "./hash.js";
import { loadCoordinatorPreamble } from "./preamble.js";
import {
  CoordinatorLlmParseError,
  defaultLlmCaller,
  type LlmCaller,
} from "./llm-client.js";

// ---------------------------------------------------------------------------
// Batch-specific cache (separate from per-issue CoordinatorDecisionCache)
// ---------------------------------------------------------------------------

export interface BatchCacheOptions {
  /** Time-to-live in milliseconds. Default: 60_000 (60 s). */
  ttlMs?: number;
  /** Maximum number of entries before LRU eviction. Default: 256. */
  capacity?: number;
  /** Injectable clock for deterministic testing. Default: Date.now. */
  now?: () => number;
}

interface BatchCacheEntry {
  output: CoordinatorBatchOutput;
  expiresAt: number;
}

/**
 * LRU + TTL cache for CoordinatorBatchOutput values, keyed by sha256 hash
 * of the stable-stringified CoordinatorBatchInput.
 */
export class BatchDecisionCache {
  private readonly ttlMs: number;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly store = new Map<string, BatchCacheEntry>();

  constructor(opts: BatchCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.capacity = opts.capacity ?? 256;
    this.now = opts.now ?? (() => Date.now());
  }

  get(hash: string): CoordinatorBatchOutput | undefined {
    const entry = this.store.get(hash);
    if (entry === undefined) return undefined;

    if (this.now() >= entry.expiresAt) {
      this.store.delete(hash);
      return undefined;
    }

    // LRU bump — move to tail by delete + re-set
    this.store.delete(hash);
    this.store.set(hash, entry);
    return entry.output;
  }

  set(hash: string, output: CoordinatorBatchOutput): void {
    const expiresAt = this.now() + this.ttlMs;

    if (this.store.has(hash)) {
      this.store.delete(hash);
    } else if (this.store.size >= this.capacity) {
      // Evict oldest (first key in insertion order)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }

    this.store.set(hash, { output, expiresAt });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Default singleton for batch — intentionally separate from decisionCache. */
export const batchDecisionCache = new BatchDecisionCache();

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BatchDispatchOptions {
  /** Default: COORDINATOR_MODEL env → "claude-haiku-4.5" */
  model?: string;
  /** Injectable LlmCaller for tests. */
  llmCaller?: LlmCaller;
  /** Injectable batch cache for tests. If omitted, uses the singleton batchDecisionCache. */
  cache?: BatchDecisionCache;
  /** Injectable clock (forwarded to default cache only when cache is omitted). */
  now?: () => number;
  /** LLM call timeout in milliseconds. Default: 30_000 (30 s). */
  timeoutMs?: number;
}

export interface BatchDispatchResult {
  output: CoordinatorBatchOutput;
  meta: CoordinatorCallMeta;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export async function dispatchBatchViaCoordinator(
  batchInput: CoordinatorBatchInput,
  opts?: BatchDispatchOptions,
): Promise<BatchDispatchResult> {
  // 1. Validate input (throws ZodError on invalid — e.g. empty issues array)
  coordinatorBatchInputSchema.parse(batchInput);

  // 2. Stable hash of the full batch input (different key space from per-issue cache)
  const inputHash = sha256Hex(stableStringify(batchInput));

  // 3. Cache lookup
  const cache = opts?.cache ?? batchDecisionCache;
  const cached = cache.get(inputHash);
  if (cached !== undefined) {
    const model = opts?.model ?? process.env.COORDINATOR_MODEL ?? "claude-haiku-4.5";
    const meta: CoordinatorCallMeta = {
      model,
      promptTokens: 0,
      completionTokens: 0,
      durationMs: 0,
      cacheHit: true,
      inputHash,
    };
    return { output: cached, meta };
  }

  // 4. Load preamble (same as one-shot dispatch)
  const preamble = await loadCoordinatorPreamble();

  // 5. Stable-stringify batch input for the user message
  const userPayload = stableStringify(batchInput);

  // 6. Resolve model
  const model = opts?.model ?? process.env.COORDINATOR_MODEL ?? "claude-haiku-4.5";

  // 7. Build abort signal with timeout (30s default, overrideable via opts.timeoutMs)
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  // 8. Call LLM with timeout signal
  const caller = opts?.llmCaller ?? defaultLlmCaller;
  let callerResult: Awaited<ReturnType<typeof caller.call>>;
  try {
    callerResult = await caller.call({
      messages: [
        { role: "system", content: preamble.text },
        { role: "user", content: userPayload },
      ],
      model,
      temperature: 0,
      abortSignal: controller.signal,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    if (err instanceof Error && err.name === "AbortError") {
      throw new CoordinatorTimeoutError(model, timeoutMs, elapsedMs);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startMs;
  const rawText = callerResult.text;

  // 8. Strip code fences, then parse JSON
  const stripped = stripCodeFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new CoordinatorLlmParseError(rawText, err);
  }

  // 9. Validate against batch output schema (ZodError propagates to caller)
  const output = coordinatorBatchOutputSchema.parse(parsed);

  // 10. Store in cache
  cache.set(inputHash, output);

  // 11. Build and return result
  const meta: CoordinatorCallMeta = {
    model: callerResult.model,
    promptTokens: callerResult.promptTokens,
    completionTokens: callerResult.completionTokens,
    durationMs,
    cacheHit: false,
    inputHash,
  };

  return { output, meta };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class CoordinatorTimeoutError extends Error {
  constructor(
    public readonly model: string,
    public readonly timeoutMs: number,
    public readonly elapsedMs: number,
  ) {
    super(
      `Coordinator LLM call to ${model} exceeded timeout of ${timeoutMs}ms (elapsed: ${elapsedMs}ms)`,
    );
    this.name = "CoordinatorTimeoutError";
  }
}
