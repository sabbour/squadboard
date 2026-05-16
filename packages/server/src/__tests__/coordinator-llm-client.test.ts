/**
 * coordinator-llm-client.test.ts — Unit tests for llm-client.ts (W29 MC-3).
 *
 * All tests use an injected fake LlmCaller — no real API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  callCoordinatorLlm,
  CoordinatorLlmParseError,
  type LlmCaller,
  type LlmCallerOpts,
  type LlmCallerResult,
} from "../coordinator/llm-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DISPATCH_DECISION = JSON.stringify({
  kind: "dispatch",
  agent: "verbal",
  rationale: "Best fit for the task",
  confidence: 0.92,
});

const SKIP_DECISION = JSON.stringify({
  kind: "skip",
  reason: "No suitable agent available",
});

const AMBIGUOUS_DECISION = JSON.stringify({
  kind: "ambiguous",
  suggestedAgents: ["verbal", "cipher"],
  question: "Which agent should handle this?",
});

function makeFakeCaller(text: string, overrides?: Partial<LlmCallerResult>): LlmCaller {
  return {
    call: vi.fn().mockResolvedValue({
      text,
      promptTokens: 120,
      completionTokens: 45,
      model: "claude-haiku-4.5",
      ...overrides,
    }),
  };
}

const BASE_PARAMS = {
  preamble: "You are the coordinator. Return JSON decision only.",
  userPayload: JSON.stringify({ issue: { id: "i-1" } }),
  model: "claude-haiku-4.5",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("callCoordinatorLlm — happy path: dispatch", () => {
  it("returns parsed dispatch decision from valid JSON", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    const result = await callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller });

    expect(result.decision).toEqual({
      kind: "dispatch",
      agent: "verbal",
      rationale: "Best fit for the task",
      confidence: 0.92,
    });
    expect(result.rawText).toBe(DISPATCH_DECISION);
  });
});

describe("callCoordinatorLlm — code fence stripping", () => {
  it("strips ```json fences and parses correctly", async () => {
    const fenced = "```json\n" + DISPATCH_DECISION + "\n```";
    const caller = makeFakeCaller(fenced);
    const result = await callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller });

    expect(result.decision.kind).toBe("dispatch");
  });

  it("strips plain ``` fences and parses correctly", async () => {
    const fenced = "```\n" + DISPATCH_DECISION + "\n```";
    const caller = makeFakeCaller(fenced);
    const result = await callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller });

    expect(result.decision.kind).toBe("dispatch");
  });
});

describe("callCoordinatorLlm — skip and ambiguous variants", () => {
  it("parses skip decision correctly", async () => {
    const caller = makeFakeCaller(SKIP_DECISION);
    const result = await callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller });

    expect(result.decision).toEqual({
      kind: "skip",
      reason: "No suitable agent available",
    });
  });

  it("parses ambiguous decision correctly", async () => {
    const caller = makeFakeCaller(AMBIGUOUS_DECISION);
    const result = await callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller });

    expect(result.decision).toEqual({
      kind: "ambiguous",
      suggestedAgents: ["verbal", "cipher"],
      question: "Which agent should handle this?",
    });
  });
});

describe("callCoordinatorLlm — parse errors", () => {
  it("throws CoordinatorLlmParseError with rawText when JSON is invalid", async () => {
    const caller = makeFakeCaller("this is not JSON");
    await expect(callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller })).rejects.toThrow(
      CoordinatorLlmParseError,
    );

    try {
      await callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller });
    } catch (err) {
      expect(err).toBeInstanceOf(CoordinatorLlmParseError);
      expect((err as CoordinatorLlmParseError).rawText).toBe("this is not JSON");
    }
  });

  it("throws CoordinatorLlmParseError with zodError when JSON fails Zod validation", async () => {
    const badDecision = JSON.stringify({ kind: "unknown-kind", foo: "bar" });
    const caller = makeFakeCaller(badDecision);

    try {
      await callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CoordinatorLlmParseError);
      const parseErr = err as CoordinatorLlmParseError;
      expect(parseErr.rawText).toBe(badDecision);
      expect(parseErr.zodError).toBeDefined();
    }
  });
});

describe("callCoordinatorLlm — meta fields", () => {
  it("populates promptTokens, completionTokens, model, and durationMs", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION, {
      promptTokens: 200,
      completionTokens: 50,
      model: "claude-sonnet-4.5",
    });
    const result = await callCoordinatorLlm({
      ...BASE_PARAMS,
      model: "claude-sonnet-4.5",
      llmCaller: caller,
    });

    expect(result.meta.promptTokens).toBe(200);
    expect(result.meta.completionTokens).toBe(50);
    expect(result.meta.model).toBe("claude-sonnet-4.5");
    expect(typeof result.meta.durationMs).toBe("number");
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("callCoordinatorLlm — messages composition", () => {
  it("passes preamble as system message and userPayload as user message", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    await callCoordinatorLlm({
      preamble: "MY PREAMBLE",
      userPayload: "MY PAYLOAD",
      model: "claude-haiku-4.5",
      llmCaller: caller,
    });

    const callArgs = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0] as LlmCallerOpts;
    expect(callArgs.messages).toEqual([
      { role: "system", content: "MY PREAMBLE" },
      { role: "user", content: "MY PAYLOAD" },
    ]);
  });

  it("passes temperature=0 to the caller", async () => {
    const caller = makeFakeCaller(DISPATCH_DECISION);
    await callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller });

    const callArgs = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0] as LlmCallerOpts;
    expect(callArgs.temperature).toBe(0);
  });
});

describe("callCoordinatorLlm — abort / timeout", () => {
  it("forwards abortSignal to the caller", async () => {
    const controller = new AbortController();
    const caller = makeFakeCaller(DISPATCH_DECISION);

    await callCoordinatorLlm({
      ...BASE_PARAMS,
      llmCaller: caller,
      abortSignal: controller.signal,
    });

    const callArgs = (caller.call as ReturnType<typeof vi.fn>).mock.calls[0][0] as LlmCallerOpts;
    expect(callArgs.abortSignal).toBe(controller.signal);
  });

  it("rejects when caller rejects (simulating timeout/abort)", async () => {
    const caller: LlmCaller = {
      call: vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    };

    await expect(callCoordinatorLlm({ ...BASE_PARAMS, llmCaller: caller })).rejects.toThrow(
      "aborted",
    );
  });
});
