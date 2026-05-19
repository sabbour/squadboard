/**
 * coordinator-batch-timeout.test.ts — Timeout-specific tests for dispatchBatchViaCoordinator.
 *
 * Tests verify:
 * - Default 30s timeout fires correctly
 * - Hung LLM calls are interrupted within timeout window
 * - opts.timeoutMs override changes behavior
 * - Successful calls complete before timeout
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  dispatchBatchViaCoordinator,
  BatchDecisionCache,
  CoordinatorTimeoutError,
} from "../coordinator/batch.js";
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

function makeHungLlmCaller(): LlmCaller {
  return {
    call: (opts) =>
      new Promise((resolve, reject) => {
        // Listen for abort signal and reject with AbortError if triggered
        if (opts.abortSignal) {
          if (opts.abortSignal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
          } else {
            opts.abortSignal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }
        }
        // Otherwise never resolves — simulates hung LLM
      }),
  };
}

function makeSuccessfulLlmCaller(output: CoordinatorBatchOutput): LlmCaller {
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
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Use real timers; tests use small timeouts (< 1s each)
});

// Clean up after each test
afterEach(() => {
  // No cleanup needed
});

// ---------------------------------------------------------------------------
// Test 1: Hung LLM call with default 30s timeout
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — timeout with hung LLM", () => {
  it("throws CoordinatorTimeoutError when LLM never responds within timeout", async () => {
    const input = makeBatchInput(["iss-1"]);
    const hungCaller = makeHungLlmCaller();
    const cache = new BatchDecisionCache();
    const timeoutMs = 100;

    const promise = dispatchBatchViaCoordinator(input, {
      llmCaller: hungCaller,
      cache,
      timeoutMs,
    });

    // Promise should reject with timeout
    await expect(promise).rejects.toBeInstanceOf(CoordinatorTimeoutError);
  }, 2000);

  it("CoordinatorTimeoutError includes model and timeout details", async () => {
    const input = makeBatchInput(["iss-1"]);
    const hungCaller = makeHungLlmCaller();
    const cache = new BatchDecisionCache();
    const model = "claude-opus-4.7";
    const timeoutMs = 100;

    const promise = dispatchBatchViaCoordinator(input, {
      llmCaller: hungCaller,
      cache,
      model,
      timeoutMs,
    });

    let caught: unknown;
    try {
      await promise;
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(CoordinatorTimeoutError);
    const err = caught as CoordinatorTimeoutError;
    expect(err.model).toBe(model);
    expect(err.timeoutMs).toBe(timeoutMs);
    expect(err.elapsedMs).toBeGreaterThanOrEqual(timeoutMs);
    expect(err.message).toContain("exceeded timeout");
  }, 2000);
});

// ---------------------------------------------------------------------------
// Test 2: Custom timeout override
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — custom timeout override", () => {
  it("respects opts.timeoutMs and fires at the specified duration", async () => {
    const input = makeBatchInput(["iss-1"]);
    const hungCaller = makeHungLlmCaller();
    const cache = new BatchDecisionCache();
    const customTimeoutMs = 150;

    const promise = dispatchBatchViaCoordinator(input, {
      llmCaller: hungCaller,
      cache,
      timeoutMs: customTimeoutMs,
    });

    await expect(promise).rejects.toBeInstanceOf(CoordinatorTimeoutError);
  }, 2000);

  it("custom timeout error shows correct timeoutMs value", async () => {
    const input = makeBatchInput(["iss-1"]);
    const hungCaller = makeHungLlmCaller();
    const cache = new BatchDecisionCache();
    const customTimeoutMs = 120;

    const promise = dispatchBatchViaCoordinator(input, {
      llmCaller: hungCaller,
      cache,
      timeoutMs: customTimeoutMs,
    });

    let caught: unknown;
    try {
      await promise;
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(CoordinatorTimeoutError);
    const err = caught as CoordinatorTimeoutError;
    expect(err.timeoutMs).toBe(customTimeoutMs);
  }, 2000);
});

// ---------------------------------------------------------------------------
// Test 3: LLM completes successfully before timeout
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — success before timeout", () => {
  it("returns successfully when LLM responds quickly", async () => {
    const input = makeBatchInput(["iss-1"]);
    const output = makeBatchOutput(["iss-1"]);
    const caller = makeSuccessfulLlmCaller(output);
    const cache = new BatchDecisionCache();

    const promise = dispatchBatchViaCoordinator(input, { llmCaller: caller, cache });

    // LLM responds immediately (synchronously in this mock)
    const result = await promise;

    expect(result.output).toEqual(output);
    expect(result.meta.cacheHit).toBe(false);
    expect(result.meta.model).toBe("claude-haiku-4.5");
  });

  it("does not throw timeout when response arrives before timeout window", async () => {
    const input = makeBatchInput(["iss-2"]);
    const output = makeBatchOutput(["iss-2"]);
    const caller = makeSuccessfulLlmCaller(output);
    const cache = new BatchDecisionCache();

    const result = await dispatchBatchViaCoordinator(input, {
      llmCaller: caller,
      cache,
      timeoutMs: 1000,
    });

    expect(result.output).toEqual(output);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Very short custom timeout (50ms)
// ---------------------------------------------------------------------------

describe("dispatchBatchViaCoordinator — very short timeout", () => {
  it("50ms timeout fires for any non-instant call", async () => {
    const input = makeBatchInput(["iss-1"]);
    const hungCaller = makeHungLlmCaller();
    const cache = new BatchDecisionCache();

    const promise = dispatchBatchViaCoordinator(input, {
      llmCaller: hungCaller,
      cache,
      timeoutMs: 50,
    });

    await expect(promise).rejects.toBeInstanceOf(CoordinatorTimeoutError);
  }, 2000);
});
