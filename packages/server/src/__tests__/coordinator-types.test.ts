/**
 * coordinator-types.test.ts -- compile-time type guards for coordinator types.
 *
 * These tests primarily prove that the types compile correctly and that the
 * discriminated union narrows as expected. Runtime assertions are minimal --
 * the real value is the TypeScript compiler catching any regressions.
 */

import { describe, it, expect } from "vitest";
import type {
  CoordinatorInput,
  CoordinatorDecision,
  CoordinatorBatchInput,
  CoordinatorBatchOutput,
  CoordinatorCallMeta,
  CoordinatorCallResult,
} from "../coordinator/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(): CoordinatorInput {
  return {
    issue: {
      id: "issue-1",
      title: "Fix the bug",
      body: "Something is broken",
      labels: ["bug", "priority"],
      column: "In Progress",
      parentId: null,
      priority: 2,
      createdAt: "2026-05-16T00:00:00.000Z",
    },
    candidateAgents: [
      {
        name: "verbal",
        role: "implementer",
        charterHash: "abc12345",
        charterContent: "# Verbal\n\n## Role\n\nimplementer",
        capabilities: ["typescript", "react"],
        available: true,
      },
    ],
    project: {
      id: "proj-1",
      name: "Squadboard",
      rules: "Use TypeScript strictly. Prefer pnpm.",
    },
    recentRuns: [
      {
        issueId: "issue-0",
        agentName: "verbal",
        outcome: "success",
        durationMs: 5000,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// CoordinatorInput
// ---------------------------------------------------------------------------

describe("CoordinatorInput -- compile-time type guards", () => {
  it("constructs a valid CoordinatorInput and satisfies the type", () => {
    const input = {
      issue: {
        id: "issue-1",
        title: "Fix the bug",
        body: "Something is broken",
        labels: ["bug"],
        column: "In Progress",
        parentId: null,
        priority: 2,
        createdAt: "2026-05-16T00:00:00.000Z",
      },
      candidateAgents: [
        {
          name: "verbal",
          role: "implementer",
          charterHash: "abc12345",
          charterContent: "# Verbal",
          capabilities: ["typescript"],
          available: true,
        },
      ],
      project: { id: "proj-1", name: "Squadboard", rules: "Be strict." },
      recentRuns: [],
    } satisfies CoordinatorInput;

    expect(input.issue.id).toBe("issue-1");
    expect(input.issue.priority).toBe(2);
    expect(input.issue.body).toBe("Something is broken");
    expect(input.issue.parentId).toBeNull();
  });

  it("accepts null body and null priority", () => {
    const input = makeInput();
    const withNulls: CoordinatorInput = {
      ...input,
      issue: { ...input.issue, body: null, priority: null },
    };
    expect(withNulls.issue.body).toBeNull();
    expect(withNulls.issue.priority).toBeNull();
  });

  it("accepts empty candidateAgents array (skip case)", () => {
    const input: CoordinatorInput = { ...makeInput(), candidateAgents: [] };
    expect(input.candidateAgents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CoordinatorDecision -- discriminated union narrowing
// ---------------------------------------------------------------------------

describe("CoordinatorDecision -- discriminated union narrowing", () => {
  it('constructs dispatch decision and narrows on kind === "dispatch"', () => {
    const decision = {
      kind: "dispatch" as const,
      agent: "verbal",
      rationale: "Best capability match",
      confidence: 0.92,
    } satisfies CoordinatorDecision;

    if (decision.kind === "dispatch") {
      expect(decision.agent).toBe("verbal");
      expect(decision.rationale).toBe("Best capability match");
      expect(decision.confidence).toBe(0.92);
    } else {
      expect.fail("Should have narrowed to dispatch");
    }
  });

  it('constructs skip decision and narrows on kind === "skip"', () => {
    const decision = {
      kind: "skip" as const,
      reason: "No suitable agent available",
    } satisfies CoordinatorDecision;

    if (decision.kind === "skip") {
      expect(decision.reason).toBe("No suitable agent available");
    } else {
      expect.fail("Should have narrowed to skip");
    }
  });

  it('constructs ambiguous decision and narrows on kind === "ambiguous"', () => {
    const decision = {
      kind: "ambiguous" as const,
      suggestedAgents: ["verbal", "ralph"],
      question: "Which agent handles infra vs. UI work?",
    } satisfies CoordinatorDecision;

    if (decision.kind === "ambiguous") {
      expect(decision.suggestedAgents).toContain("verbal");
      expect(decision.question).toBe("Which agent handles infra vs. UI work?");
    } else {
      expect.fail("Should have narrowed to ambiguous");
    }
  });
});

// ---------------------------------------------------------------------------
// Batch + meta types compile
// ---------------------------------------------------------------------------

describe("Batch and meta types -- compile-time guards", () => {
  it("CoordinatorBatchInput satisfies type", () => {
    const batch: CoordinatorBatchInput = { issues: [makeInput()] };
    expect(batch.issues).toHaveLength(1);
  });

  it("CoordinatorBatchOutput satisfies type", () => {
    const output: CoordinatorBatchOutput = {
      decisions: [{ issueId: "issue-1", decision: { kind: "skip", reason: "test" } }],
    };
    expect(output.decisions[0].issueId).toBe("issue-1");
  });

  it("CoordinatorCallMeta satisfies type", () => {
    const meta: CoordinatorCallMeta = {
      model: "claude-haiku-4.5",
      promptTokens: 1200,
      completionTokens: 80,
      durationMs: 1800,
      cacheHit: false,
      inputHash: "a".repeat(64),
    };
    expect(meta.model).toBe("claude-haiku-4.5");
  });

  it("CoordinatorCallResult satisfies type", () => {
    const result: CoordinatorCallResult = {
      decision: { kind: "dispatch", agent: "verbal", rationale: "ok", confidence: 1 },
      meta: {
        model: "claude-haiku-4.5",
        promptTokens: 500,
        completionTokens: 40,
        durationMs: 900,
        cacheHit: true,
        inputHash: "b".repeat(64),
      },
    };
    expect(result.decision.kind).toBe("dispatch");
  });
});
