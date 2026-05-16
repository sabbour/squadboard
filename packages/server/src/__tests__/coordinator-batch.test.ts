/**
 * coordinator-batch.test.ts — Unit tests for coordinator/batch.ts (W29 MC-11).
 *
 * Zero real API calls — injectable fake LlmCaller throughout.
 * Cache isolation: fresh BatchDecisionCache per test via beforeEach.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dispatchBatchViaCoordinator,
  BatchDecisionCache,
  batchDecisionCache,
} from "../coordinator/batch.js";
import { CoordinatorLlmParseError } from "../coordinator/llm-client.js";
import type { CoordinatorBatchInput, CoordinatorBatchOutput } from "../coordinator/types.js";
import type { LlmCaller } from "../coordinator/llm-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSingleIssueInput(issueId: string): CoordinatorBatchInput["issues"][number] {
  return {
    issue: {
      id: issueId,
      title: `Issue ${issueId}`,
      body: "Do the thing",
      labels: ["feature"],
      column: "To Do",
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

function makeBatchInput(issueIds: string[]): CoordinatorBatchInput {
  return { issues: issueIds.map(makeSingleIssueInput) };
}

function makeBatchOutput(issueIds: string[]): CoordinatorBatchOutput {
  return {
    decisions: issueIds.map((id) => ({
      issueId: id,
      decision: { kind: "dispatch", agent: "verbal", rationale: "Best fit", confidence: 0.9 },
    })),
  };
}

function makeFakeCaller(output: CoordinatorBatchOutput): LlmCaller {
  return {
    call: vi.fn().mockResolvedValue({
      text: JSON.stringify(output),
      promptTokens: 120,
      completionTokens: 50,
      model: "claude-haiku-4.5",
    }),
  };
}

// ---------------------------------------------------------------------------
// Setup — clear the singleton and use fresh cache instances per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  batchDecisionCache.clear();
});

// ---------------------------------------------------------------------------
// Test 1: Valid batch input → parsed decisions + meta
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — happy path", () => {
  it("returns parsed decisions with model, token counts, and duration in meta", async () => {
    const input = makeBatchInput(["iss-1", "iss-2"]);
    const output = makeBatchOutput(["iss-1", "iss-2"]);
    const caller = makeFakeCaller(output);
    const cache = new BatchDecisionCache();

    const result = await dispatchBatchViaCoordinator(input, { llmCaller: caller, cache });

    expect(result.output).toEqual(output);
    expect(result.meta.cacheHit).toBe(false);
    expect(result.meta.model).toBe("claude-haiku-4.5");
    expect(result.meta.promptTokens).toBe(120);
    expect(result.meta.completionTokens).toBe(50);
    expect(typeof result.meta.durationMs).toBe("number");
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.meta.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Cache hit on identical input
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — cache hit", () => {
  it("second identical call returns cacheHit:true with no LLM invocation", async () => {
    const input = makeBatchInput(["iss-1"]);
    const output = makeBatchOutput(["iss-1"]);
    const caller = makeFakeCaller(output);
    const cache = new BatchDecisionCache();

    const first = await dispatchBatchViaCoordinator(input, { llmCaller: caller, cache });
    const second = await dispatchBatchViaCoordinator(input, { llmCaller: caller, cache });

    expect(first.meta.cacheHit).toBe(false);
    expect(second.meta.cacheHit).toBe(true);
    expect(second.output).toEqual(output);
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Different inputs → different cache keys → both call LLM
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — cache key isolation", () => {
  it("two different batch inputs each trigger a separate LLM call", async () => {
    const output1 = makeBatchOutput(["iss-A"]);
    const output2 = makeBatchOutput(["iss-B"]);
    const caller1 = makeFakeCaller(output1);
    const caller2 = makeFakeCaller(output2);
    const cache = new BatchDecisionCache();

    const r1 = await dispatchBatchViaCoordinator(makeBatchInput(["iss-A"]), {
      llmCaller: caller1,
      cache,
    });
    const r2 = await dispatchBatchViaCoordinator(makeBatchInput(["iss-B"]), {
      llmCaller: caller2,
      cache,
    });

    expect(r1.meta.cacheHit).toBe(false);
    expect(r2.meta.cacheHit).toBe(false);
    expect((caller1.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect((caller2.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(r1.meta.inputHash).not.toBe(r2.meta.inputHash);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Mixed decision kinds in one batch
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — mixed decision kinds", () => {
  it("parses dispatch, skip, and ambiguous decisions in a single batch", async () => {
    const mixedOutput: CoordinatorBatchOutput = {
      decisions: [
        {
          issueId: "iss-1",
          decision: { kind: "dispatch", agent: "verbal", rationale: "Best fit", confidence: 0.9 },
        },
        {
          issueId: "iss-2",
          decision: { kind: "skip", reason: "Out of scope" },
        },
        {
          issueId: "iss-3",
          decision: {
            kind: "ambiguous",
            suggestedAgents: ["verbal", "cipher"],
            question: "Which agent?",
          },
        },
      ],
    };

    const input: CoordinatorBatchInput = {
      issues: [
        makeSingleIssueInput("iss-1"),
        makeSingleIssueInput("iss-2"),
        makeSingleIssueInput("iss-3"),
      ],
    };

    const caller: LlmCaller = {
      call: vi.fn().mockResolvedValue({
        text: JSON.stringify(mixedOutput),
        promptTokens: 200,
        completionTokens: 80,
        model: "claude-haiku-4.5",
      }),
    };
    const cache = new BatchDecisionCache();

    const result = await dispatchBatchViaCoordinator(input, { llmCaller: caller, cache });

    expect(result.output.decisions).toHaveLength(3);
    expect(result.output.decisions[0]?.decision.kind).toBe("dispatch");
    expect(result.output.decisions[1]?.decision.kind).toBe("skip");
    expect(result.output.decisions[2]?.decision.kind).toBe("ambiguous");
  });
});

// ---------------------------------------------------------------------------
// Test 5: LLM returns invalid JSON → CoordinatorLlmParseError
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — parse errors", () => {
  it("throws CoordinatorLlmParseError with raw text when LLM returns invalid JSON", async () => {
    const caller: LlmCaller = {
      call: vi.fn().mockResolvedValue({
        text: "sorry, I cannot produce JSON right now",
        promptTokens: 10,
        completionTokens: 8,
        model: "claude-haiku-4.5",
      }),
    };
    const cache = new BatchDecisionCache();

    await expect(
      dispatchBatchViaCoordinator(makeBatchInput(["iss-1"]), { llmCaller: caller, cache }),
    ).rejects.toBeInstanceOf(CoordinatorLlmParseError);
  });

  it("CoordinatorLlmParseError preserves rawText", async () => {
    const rawText = "not { json at all }}}";
    const caller: LlmCaller = {
      call: vi.fn().mockResolvedValue({
        text: rawText,
        promptTokens: 5,
        completionTokens: 5,
        model: "claude-haiku-4.5",
      }),
    };
    const cache = new BatchDecisionCache();

    let caught: unknown;
    try {
      await dispatchBatchViaCoordinator(makeBatchInput(["iss-1"]), { llmCaller: caller, cache });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(CoordinatorLlmParseError);
    expect((caught as CoordinatorLlmParseError).rawText).toBe(rawText);
  });
});

// ---------------------------------------------------------------------------
// Test 6: LLM returns valid JSON but missing required fields → ZodError
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — schema validation", () => {
  it("throws ZodError when LLM returns valid JSON missing required fields", async () => {
    const badOutput = { decisions: [{ issueId: "iss-1" /* missing decision */ }] };
    const caller: LlmCaller = {
      call: vi.fn().mockResolvedValue({
        text: JSON.stringify(badOutput),
        promptTokens: 30,
        completionTokens: 15,
        model: "claude-haiku-4.5",
      }),
    };
    const cache = new BatchDecisionCache();

    await expect(
      dispatchBatchViaCoordinator(makeBatchInput(["iss-1"]), { llmCaller: caller, cache }),
    ).rejects.toThrow(); // ZodError
  });
});

// ---------------------------------------------------------------------------
// Test 7: Empty items array → ZodError (schema rejects issues.min(1))
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — input validation", () => {
  it("throws ZodError for empty issues array (schema enforces min(1))", async () => {
    const caller = makeFakeCaller(makeBatchOutput([]));
    const cache = new BatchDecisionCache();

    await expect(
      dispatchBatchViaCoordinator({ issues: [] }, { llmCaller: caller, cache }),
    ).rejects.toThrow();

    // LLM should not have been called
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 8: Cache eviction — capacity 2, 3 different batches
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — LRU eviction", () => {
  it("with capacity 2, the third insert evicts the oldest entry", async () => {
    const cache = new BatchDecisionCache({ capacity: 2 });

    const input1 = makeBatchInput(["iss-A"]);
    const input2 = makeBatchInput(["iss-B"]);
    const input3 = makeBatchInput(["iss-C"]);

    const out1 = makeBatchOutput(["iss-A"]);
    const out2 = makeBatchOutput(["iss-B"]);
    const out3 = makeBatchOutput(["iss-C"]);

    const caller1 = makeFakeCaller(out1);
    const caller2 = makeFakeCaller(out2);
    const caller3 = makeFakeCaller(out3);

    // Insert 3 batches into a capacity-2 cache → input1 is evicted
    await dispatchBatchViaCoordinator(input1, { llmCaller: caller1, cache });
    await dispatchBatchViaCoordinator(input2, { llmCaller: caller2, cache });
    await dispatchBatchViaCoordinator(input3, { llmCaller: caller3, cache });

    // Check input2 and input3 first (still cached), before re-fetching input1
    const r2 = await dispatchBatchViaCoordinator(input2, { llmCaller: caller2, cache });
    const r3 = await dispatchBatchViaCoordinator(input3, { llmCaller: caller3, cache });
    expect(r2.meta.cacheHit).toBe(true);
    expect(r3.meta.cacheHit).toBe(true);

    // input1 was evicted — re-fetch required
    const r1 = await dispatchBatchViaCoordinator(input1, { llmCaller: caller1, cache });
    expect(r1.meta.cacheHit).toBe(false);
    expect((caller1.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 9: TTL expiry via injected now
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — TTL expiry", () => {
  it("expired entry is re-fetched from LLM", async () => {
    let t = 1_000_000;
    const cache = new BatchDecisionCache({ ttlMs: 1_000, now: () => t });

    const input = makeBatchInput(["iss-1"]);
    const output = makeBatchOutput(["iss-1"]);
    const caller = makeFakeCaller(output);

    // First call — cache miss, LLM called
    const r1 = await dispatchBatchViaCoordinator(input, { llmCaller: caller, cache });
    expect(r1.meta.cacheHit).toBe(false);

    // Second call before TTL — cache hit
    const r2 = await dispatchBatchViaCoordinator(input, { llmCaller: caller, cache });
    expect(r2.meta.cacheHit).toBe(true);

    // Advance time beyond TTL
    t += 2_000;

    // Third call — expired, re-fetches
    const r3 = await dispatchBatchViaCoordinator(input, { llmCaller: caller, cache });
    expect(r3.meta.cacheHit).toBe(false);
    expect((caller.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Test 10: Code-fence stripping
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — code fence stripping", () => {
  it("parses correctly when LLM wraps response in ```json fences", async () => {
    const output = makeBatchOutput(["iss-1"]);
    const fencedText = "```json\n" + JSON.stringify(output) + "\n```";

    const caller: LlmCaller = {
      call: vi.fn().mockResolvedValue({
        text: fencedText,
        promptTokens: 100,
        completionTokens: 40,
        model: "claude-haiku-4.5",
      }),
    };
    const cache = new BatchDecisionCache();

    const result = await dispatchBatchViaCoordinator(makeBatchInput(["iss-1"]), {
      llmCaller: caller,
      cache,
    });

    expect(result.output).toEqual(output);
    expect(result.meta.cacheHit).toBe(false);
  });

  it("parses correctly when LLM wraps response in plain ``` fences", async () => {
    const output = makeBatchOutput(["iss-2"]);
    const fencedText = "```\n" + JSON.stringify(output) + "\n```";

    const caller: LlmCaller = {
      call: vi.fn().mockResolvedValue({
        text: fencedText,
        promptTokens: 100,
        completionTokens: 40,
        model: "claude-haiku-4.5",
      }),
    };
    const cache = new BatchDecisionCache();

    const result = await dispatchBatchViaCoordinator(makeBatchInput(["iss-2"]), {
      llmCaller: caller,
      cache,
    });

    expect(result.output).toEqual(output);
  });
});
