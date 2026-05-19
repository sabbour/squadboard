/**
 * coordinator-dispatch-fallback.test.ts — W30: model fallback chain tests.
 *
 * Verifies that dispatchViaCoordinator() loops through the model chain
 * (Option A — dispatch-level retry policy) on retriable failures, propagates
 * non-retriable errors immediately, and caches results from whichever model
 * ultimately succeeds.
 *
 * All tests use injected LlmCaller and CoordinatorDecisionCache — no real API
 * calls or singleton state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchViaCoordinator } from "../coordinator/dispatch.js";
import { CoordinatorDecisionCache, decisionCache } from "../coordinator/cache.js";
import { CoordinatorLlmParseError } from "../coordinator/llm-client.js";
import type { CoordinatorInput, CoordinatorDecision } from "../coordinator/types.js";
import type { LlmCaller, LlmCallerResult } from "../coordinator/llm-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(id = "i-fallback"): CoordinatorInput {
  return {
    issue: {
      id,
      title: "Fallback test issue",
      body: "Test body",
      labels: ["test"],
      column: "Ready",
      parentId: null,
      priority: 1,
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    candidateAgents: [
      {
        name: "verbal",
        role: "implementer",
        charterHash: "abcd1234",
        charterContent: "# Verbal\nImplements features.",
        capabilities: ["implement"],
        available: true,
      },
    ],
    project: { id: "p-1", name: "TestProject", rules: "Move fast" },
    recentRuns: [],
  };
}

const DISPATCH_DECISION: CoordinatorDecision = {
  kind: "dispatch",
  agent: "verbal",
  rationale: "Best fit",
  confidence: 0.9,
};

function makeLlmResult(model: string, decision: CoordinatorDecision = DISPATCH_DECISION): LlmCallerResult {
  return {
    text: JSON.stringify(decision),
    promptTokens: 100,
    completionTokens: 30,
    model,
  };
}

/** A caller that always succeeds. */
function makeSucceedingCaller(model = "claude-haiku-4.5"): LlmCaller {
  return { call: vi.fn().mockResolvedValue(makeLlmResult(model)) };
}

// The two-model test chain used across most tests below.
const TEST_CHAIN = ["primary-model", "fallback-model-a"] as const;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  decisionCache.clear();
});

afterEach(() => {
  delete process.env.COORDINATOR_MODEL;
  delete process.env.COORDINATOR_MODEL_FALLBACKS;
});

// ---------------------------------------------------------------------------
// Test 1: Primary succeeds — no fallback called
// ---------------------------------------------------------------------------

describe("fallback chain — test 1: primary succeeds", () => {
  it("only calls primary model when it succeeds", async () => {
    const caller = makeSucceedingCaller("primary-model");
    const cache = new CoordinatorDecisionCache();

    const result = await dispatchViaCoordinator(makeInput(), {
      llmCaller: caller,
      cache,
      bypassCache: true,
      modelChain: [...TEST_CHAIN],
    });

    expect(result.decision).toEqual(DISPATCH_DECISION);
    expect(result.cacheHit).toBe(false);
    expect(result.meta.model).toBe("primary-model");
    // Only one LLM call — no fallback invoked
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const firstCall = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCall.model).toBe("primary-model");
  });
});

// ---------------------------------------------------------------------------
// Test 2: Primary throws "model not available" → fallback[0] succeeds
// ---------------------------------------------------------------------------

describe("fallback chain — test 2: primary model-not-available → fallback succeeds", () => {
  it("retries fallback when primary is unavailable; meta.model = fallback", async () => {
    const caller: LlmCaller = {
      call: vi.fn()
        .mockRejectedValueOnce(new Error("model not available"))
        .mockResolvedValueOnce(makeLlmResult("fallback-model-a")),
    };
    const cache = new CoordinatorDecisionCache();

    const result = await dispatchViaCoordinator(makeInput(), {
      llmCaller: caller,
      cache,
      bypassCache: true,
      modelChain: [...TEST_CHAIN],
    });

    expect(result.decision).toEqual(DISPATCH_DECISION);
    expect(result.cacheHit).toBe(false);
    // meta.model records who actually answered
    expect(result.meta.model).toBe("fallback-model-a");
    // Two calls: primary (failed) + fallback (succeeded)
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    const [call0, call1] = (caller.call as ReturnType<typeof vi.fn>).mock.calls;
    expect(call0[0].model).toBe("primary-model");
    expect(call1[0].model).toBe("fallback-model-a");
  });

  it("also retries on 'is not available' phrasing", async () => {
    const caller: LlmCaller = {
      call: vi.fn()
        .mockRejectedValueOnce(new Error("claude-haiku is not available in this region"))
        .mockResolvedValueOnce(makeLlmResult("fallback-model-a")),
    };
    const cache = new CoordinatorDecisionCache();

    const result = await dispatchViaCoordinator(makeInput("i-region"), {
      llmCaller: caller,
      cache,
      bypassCache: true,
      modelChain: [...TEST_CHAIN],
    });

    expect(result.meta.model).toBe("fallback-model-a");
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Primary + fallback[0] both fail → fallback[1] succeeds
// ---------------------------------------------------------------------------

describe("fallback chain — test 3: two failures → third model succeeds", () => {
  const THREE_CHAIN = ["primary-model", "fallback-model-a", "fallback-model-b"];

  it("tries three models when first two fail; meta.model = fallback[1]", async () => {
    const caller: LlmCaller = {
      call: vi.fn()
        .mockRejectedValueOnce(new Error("429 rate limit exceeded"))
        .mockRejectedValueOnce(new Error("503 service unavailable"))
        .mockResolvedValueOnce(makeLlmResult("fallback-model-b")),
    };
    const cache = new CoordinatorDecisionCache();

    const result = await dispatchViaCoordinator(makeInput("i-three"), {
      llmCaller: caller,
      cache,
      bypassCache: true,
      modelChain: THREE_CHAIN,
    });

    expect(result.decision).toEqual(DISPATCH_DECISION);
    expect(result.meta.model).toBe("fallback-model-b");
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Test 4: All models fail → aggregate error thrown
// ---------------------------------------------------------------------------

describe("fallback chain — test 4: all models fail → aggregate error", () => {
  it("throws aggregate error listing all failed attempts", async () => {
    const caller: LlmCaller = {
      call: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    };
    const cache = new CoordinatorDecisionCache();

    await expect(
      dispatchViaCoordinator(makeInput("i-allfail"), {
        llmCaller: caller,
        cache,
        bypassCache: true,
        modelChain: [...TEST_CHAIN],
      }),
    ).rejects.toThrow("All coordinator models failed");

    // Both models were tried before giving up
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("aggregate error message includes each model name and its error", async () => {
    const caller: LlmCaller = {
      call: vi.fn()
        .mockRejectedValueOnce(new Error("model not available"))
        .mockRejectedValueOnce(new Error("502 bad gateway")),
    };
    const cache = new CoordinatorDecisionCache();

    let thrown: Error | undefined;
    try {
      await dispatchViaCoordinator(makeInput("i-agg-msg"), {
        llmCaller: caller,
        cache,
        bypassCache: true,
        modelChain: [...TEST_CHAIN],
      });
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain("primary-model");
    expect(thrown!.message).toContain("fallback-model-a");
    expect(thrown!.message).toContain("model not available");
    expect(thrown!.message).toContain("502 bad gateway");
  });
});

// ---------------------------------------------------------------------------
// Test 5: ZodError on primary → NOT retried, propagates immediately
// ---------------------------------------------------------------------------

describe("fallback chain — test 5: ZodError is non-retriable", () => {
  it("propagates ZodError from primary without trying fallback", async () => {
    // callCoordinatorLlm wraps schema failures in CoordinatorLlmParseError,
    // but ZodError from coordinatorInputSchema.parse is thrown before chain logic.
    // Here we simulate a ZodError surfacing from callCoordinatorLlm.
    const zodLike = Object.assign(new Error("ZodError: unexpected shape"), {
      name: "ZodError",
    });
    const caller: LlmCaller = {
      call: vi.fn().mockRejectedValue(zodLike),
    };
    const cache = new CoordinatorDecisionCache();

    await expect(
      dispatchViaCoordinator(makeInput("i-zod"), {
        llmCaller: caller,
        cache,
        bypassCache: true,
        modelChain: [...TEST_CHAIN],
      }),
    ).rejects.toMatchObject({ name: "ZodError" });

    // Only one call — ZodError is non-retriable
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 6: CoordinatorLlmParseError on primary → NOT retried, propagates
// ---------------------------------------------------------------------------

describe("fallback chain — test 6: CoordinatorLlmParseError is non-retriable", () => {
  it("propagates parse error without trying fallback", async () => {
    // Caller returns non-JSON text — callCoordinatorLlm will throw CoordinatorLlmParseError
    const caller: LlmCaller = {
      call: vi.fn().mockResolvedValue({
        text: "I cannot help with that request.",
        promptTokens: 10,
        completionTokens: 5,
        model: "primary-model",
      }),
    };
    const cache = new CoordinatorDecisionCache();

    await expect(
      dispatchViaCoordinator(makeInput("i-parse"), {
        llmCaller: caller,
        cache,
        bypassCache: true,
        modelChain: [...TEST_CHAIN],
      }),
    ).rejects.toBeInstanceOf(CoordinatorLlmParseError);

    // Only one call — CoordinatorLlmParseError is non-retriable
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Cache hit → no fallback logic exercised
// ---------------------------------------------------------------------------

describe("fallback chain — test 7: cache hit bypasses all LLM calls", () => {
  it("returns cached decision with cacheHit:true and no LLM calls", async () => {
    const caller = makeSucceedingCaller("primary-model");
    const cache = new CoordinatorDecisionCache();
    const input = makeInput("i-cache-hit");

    // Prime the cache
    await dispatchViaCoordinator(input, {
      llmCaller: caller,
      cache,
      modelChain: [...TEST_CHAIN],
    });

    // Reset call count
    (caller.call as ReturnType<typeof vi.fn>).mockClear();

    // Second call — should hit cache
    const result = await dispatchViaCoordinator(input, {
      llmCaller: caller,
      cache,
      modelChain: [...TEST_CHAIN],
    });

    expect(result.cacheHit).toBe(true);
    expect(result.decision).toEqual(DISPATCH_DECISION);
    // No LLM calls at all — cache served it
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 8: Fallback success result is cached → second call is a cache hit
// ---------------------------------------------------------------------------

describe("fallback chain — test 8: fallback result is cached by input key", () => {
  it("caches the fallback model's result; second call is a hit with no LLM calls", async () => {
    const caller: LlmCaller = {
      call: vi.fn()
        .mockRejectedValueOnce(new Error("model not available"))
        .mockResolvedValueOnce(makeLlmResult("fallback-model-a")),
    };
    const cache = new CoordinatorDecisionCache();
    const input = makeInput("i-fallback-cached");

    // First call: primary fails, fallback succeeds → result cached
    const first = await dispatchViaCoordinator(input, {
      llmCaller: caller,
      cache,
      modelChain: [...TEST_CHAIN],
    });

    expect(first.cacheHit).toBe(false);
    expect(first.meta.model).toBe("fallback-model-a");
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);

    // Reset call count
    (caller.call as ReturnType<typeof vi.fn>).mockClear();

    // Second call with same input → cache hit, no LLM calls at all
    const second = await dispatchViaCoordinator(input, {
      llmCaller: caller,
      cache,
      modelChain: [...TEST_CHAIN],
    });

    expect(second.cacheHit).toBe(true);
    expect(second.decision).toEqual(DISPATCH_DECISION);
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Additional retriable error patterns (sanity checks)
// ---------------------------------------------------------------------------

describe("fallback chain — retriable error patterns", () => {
  const cases: Array<[string, string]> = [
    ["ECONNRESET", "network reset"],
    ["ECONNREFUSED", "connection refused"],
    ["ETIMEDOUT", "connection timed out"],
    ["429 Too Many Requests", "rate limit HTTP status"],
    ["502 Bad Gateway", "gateway error 502"],
    ["503 Service Unavailable", "gateway error 503"],
    ["504 Gateway Timeout", "gateway error 504"],
    ["rate limit exceeded", "rate limit message"],
  ];

  for (const [errorMsg, label] of cases) {
    it(`retries on: ${label} ("${errorMsg}")`, async () => {
      const caller: LlmCaller = {
        call: vi.fn()
          .mockRejectedValueOnce(new Error(errorMsg))
          .mockResolvedValueOnce(makeLlmResult("fallback-model-a")),
      };
      const cache = new CoordinatorDecisionCache();

      const result = await dispatchViaCoordinator(makeInput(`i-ret-${label.replace(/\s/g, "-")}`), {
        llmCaller: caller,
        cache,
        bypassCache: true,
        modelChain: [...TEST_CHAIN],
      });

      expect(result.meta.model).toBe("fallback-model-a");
      expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    });
  }
});

describe("fallback chain — non-retriable auth/policy patterns", () => {
  const cases: Array<[string, string]> = [
    ["401 Unauthorized", "auth 401"],
    ["403 Forbidden", "auth 403"],
    ["usage policy violation", "usage policy"],
    ["content filter triggered", "content filter"],
  ];

  for (const [errorMsg, label] of cases) {
    it(`does NOT retry on: ${label} ("${errorMsg}")`, async () => {
      const caller: LlmCaller = {
        call: vi.fn().mockRejectedValue(new Error(errorMsg)),
      };
      const cache = new CoordinatorDecisionCache();

      await expect(
        dispatchViaCoordinator(makeInput(`i-noret-${label.replace(/\s/g, "-")}`), {
          llmCaller: caller,
          cache,
          bypassCache: true,
          modelChain: [...TEST_CHAIN],
        }),
      ).rejects.toThrow(errorMsg);

      // Non-retriable: only one call made
      expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
  }
});
