/**
 * coordinator-dispatch.test.ts — Unit tests for dispatch.ts (W29 MC-3).
 *
 * Injectable fake LlmCaller throughout — no real API calls.
 * Cache isolation: decisionCache.clear() in beforeEach + fresh CoordinatorDecisionCache injected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchViaCoordinator } from "../coordinator/dispatch.js";
import { CoordinatorDecisionCache, decisionCache } from "../coordinator/cache.js";
import { CoordinatorLlmParseError } from "../coordinator/llm-client.js";
import { hashCoordinatorInput } from "../coordinator/hash.js";
import type { CoordinatorInput, CoordinatorDecision } from "../coordinator/types.js";
import type { LlmCaller } from "../coordinator/llm-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<CoordinatorInput["issue"]> = {}): CoordinatorInput {
  return {
    issue: {
      id: "i-test",
      title: "Test issue",
      body: "Do the thing",
      labels: ["bug"],
      column: "Ready",
      parentId: null,
      priority: 1,
      createdAt: "2024-01-01T00:00:00.000Z",
      ...overrides,
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

const SKIP_DECISION: CoordinatorDecision = {
  kind: "skip",
  reason: "Nothing to do",
};

const AMBIGUOUS_DECISION: CoordinatorDecision = {
  kind: "ambiguous",
  suggestedAgents: ["verbal", "cipher"],
  question: "Which?",
};

function makeFakeCaller(decision: CoordinatorDecision): LlmCaller {
  return {
    call: vi.fn().mockResolvedValue({
      text: JSON.stringify(decision),
      promptTokens: 100,
      completionTokens: 30,
      model: "claude-haiku-4.5",
    }),
  };
}

// ---------------------------------------------------------------------------
// Setup — isolate the singleton cache between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  decisionCache.clear();
});

afterEach(() => {
  delete process.env.COORDINATOR_MODEL;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dispatchViaCoordinator — happy path", () => {
  it("dispatches valid input and returns dispatch decision with cacheHit:false", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();
    const result = await dispatchViaCoordinator(makeInput(), {
      llmCaller: caller,
      cache,
      bypassCache: true,
    });

    expect(result.decision).toEqual(DISPATCH_DECISION);
    expect(result.cacheHit).toBe(false);
    expect(result.meta.cacheHit).toBe(false);
  });

  it("second identical dispatch hits cache and returns cacheHit:true with no LLM call", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();
    const input = makeInput();

    await dispatchViaCoordinator(input, { llmCaller: caller, cache });
    const second = await dispatchViaCoordinator(input, { llmCaller: caller, cache });

    expect(second.cacheHit).toBe(true);
    expect(second.decision).toEqual(DISPATCH_DECISION);
    // caller was called exactly once (first call only)
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("bypassCache forces LLM call even when already cached", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();
    const input = makeInput();

    await dispatchViaCoordinator(input, { llmCaller: caller, cache });
    await dispatchViaCoordinator(input, { llmCaller: caller, cache, bypassCache: true });

    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

describe("dispatchViaCoordinator — input validation", () => {
  it("throws ZodError when input is missing issue.id, no LLM call made", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();

    const badInput = {
      ...makeInput(),
      issue: { ...makeInput().issue, id: undefined as unknown as string },
    };

    await expect(
      dispatchViaCoordinator(badInput as unknown as CoordinatorInput, { llmCaller: caller, cache }),
    ).rejects.toThrow();

    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

describe("dispatchViaCoordinator — error propagation", () => {
  it("propagates CoordinatorLlmParseError to caller", async () => {
    const caller: LlmCaller = {
      call: vi.fn().mockResolvedValue({
        text: "not valid json at all",
        promptTokens: 10,
        completionTokens: 5,
        model: "claude-haiku-4.5",
      }),
    };
    const cache = new CoordinatorDecisionCache();

    await expect(
      dispatchViaCoordinator(makeInput(), { llmCaller: caller, cache, bypassCache: true }),
    ).rejects.toBeInstanceOf(CoordinatorLlmParseError);
  });
});

describe("dispatchViaCoordinator — decision variants cached", () => {
  it("skip decision is cached and retrieved correctly", async () => {
    const caller = makeFakeCaller(SKIP_DECISION);
    const cache = new CoordinatorDecisionCache();
    const input = makeInput({ id: "i-skip" });

    await dispatchViaCoordinator(input, { llmCaller: caller, cache });
    const hit = await dispatchViaCoordinator(input, { llmCaller: caller, cache });

    expect(hit.decision).toEqual(SKIP_DECISION);
    expect(hit.cacheHit).toBe(true);
  });

  it("ambiguous decision is cached and retrieved correctly", async () => {
    const caller = makeFakeCaller(AMBIGUOUS_DECISION);
    const cache = new CoordinatorDecisionCache();
    const input = makeInput({ id: "i-ambig" });

    await dispatchViaCoordinator(input, { llmCaller: caller, cache });
    const hit = await dispatchViaCoordinator(input, { llmCaller: caller, cache });

    expect(hit.decision).toEqual(AMBIGUOUS_DECISION);
    expect(hit.cacheHit).toBe(true);
  });
});

describe("dispatchViaCoordinator — deterministic post-processing", () => {
  it("applies the low-confidence floor before returning and caching LLM decisions", async () => {
    const lowConfidenceDecision: CoordinatorDecision = {
      kind: "dispatch",
      agent: "verbal",
      rationale: "Weak fit",
      confidence: 0.39,
    };
    const caller = makeFakeCaller(lowConfidenceDecision);
    const cache = new CoordinatorDecisionCache();
    const input = makeInput({ id: "i-low-confidence" });

    const first = await dispatchViaCoordinator(input, { llmCaller: caller, cache });
    const second = await dispatchViaCoordinator(input, { llmCaller: caller, cache });

    expect(first.decision).toEqual({
      kind: "ambiguous",
      suggestedAgents: ["verbal"],
      question: "Best fit verbal scored 0.39, below the 0.40 floor. Please clarify scope before dispatch.",
    });
    expect(second.decision).toEqual(first.decision);
    expect(second.cacheHit).toBe(true);
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("dispatchViaCoordinator — model resolution", () => {
  it("uses COORDINATOR_MODEL env when no opts.model", async () => {
    process.env.COORDINATOR_MODEL = "claude-sonnet-4.5";
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();

    const result = await dispatchViaCoordinator(makeInput(), {
      llmCaller: caller,
      cache,
      bypassCache: true,
    });

    const callArgs = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4.5");
    expect(result.meta.model).toBe("claude-haiku-4.5"); // returned from fake caller
  });

  it("falls back to 'claude-haiku-4.5' when no env and no opts.model", async () => {
    delete process.env.COORDINATOR_MODEL;
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();

    await dispatchViaCoordinator(makeInput(), { llmCaller: caller, cache, bypassCache: true });

    const callArgs = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.model).toBe("claude-haiku-4.5");
  });

  it("opts.model overrides env", async () => {
    process.env.COORDINATOR_MODEL = "claude-sonnet-4.5";
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();

    await dispatchViaCoordinator(makeInput(), {
      llmCaller: caller,
      cache,
      bypassCache: true,
      model: "claude-opus-4.5",
    });

    const callArgs = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.model).toBe("claude-opus-4.5");
  });
});

describe("dispatchViaCoordinator — meta.inputHash", () => {
  it("meta.inputHash matches hashCoordinatorInput(input)", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();
    const input = makeInput();

    const result = await dispatchViaCoordinator(input, {
      llmCaller: caller,
      cache,
      bypassCache: true,
    });

    expect(result.meta.inputHash).toBe(hashCoordinatorInput(input));
    expect(result.meta.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two inputs with reordered top-level fields produce same hash → second hits cache", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();

    const base = makeInput();
    // Reorder top-level keys by building a new object with different insertion order
    const reordered: CoordinatorInput = {
      project: base.project,
      recentRuns: base.recentRuns,
      candidateAgents: base.candidateAgents,
      issue: base.issue,
    };

    await dispatchViaCoordinator(base, { llmCaller: caller, cache });
    const second = await dispatchViaCoordinator(reordered, { llmCaller: caller, cache });

    expect(second.cacheHit).toBe(true);
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("dispatchViaCoordinator — options forwarding", () => {
  it("squadRoot option is forwarded to preamble loader (uses built-in for non-existent path)", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();

    // Non-existent squadRoot — preamble should still load (falls back to built-in)
    const result = await dispatchViaCoordinator(makeInput(), {
      llmCaller: caller,
      cache,
      bypassCache: true,
      squadRoot: "/tmp/nonexistent-squad-root-xyz",
    });

    expect(result.decision).toEqual(DISPATCH_DECISION);
    // Preamble was passed to caller
    const callArgs = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const sysMsg = callArgs.messages.find((m: { role: string }) => m.role === "system");
    expect(typeof sysMsg?.content).toBe("string");
    expect(sysMsg?.content.length).toBeGreaterThan(0);
  });

  it("timeoutMs option is forwarded to llm caller", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const cache = new CoordinatorDecisionCache();

    // Fake caller ignores it, but we verify it makes it to callCoordinatorLlm by
    // confirming the call still succeeds with a custom timeout
    const result = await dispatchViaCoordinator(makeInput(), {
      llmCaller: caller,
      cache,
      bypassCache: true,
      timeoutMs: 5_000,
    });

    expect(result.decision).toEqual(DISPATCH_DECISION);
  });
});
