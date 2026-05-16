/**
 * coordinator-schemas.test.ts -- runtime Zod validation tests for the
 * mini-coordinator schemas (W29 MC-1).
 *
 * Covers: valid inputs, missing fields, range violations, unknown properties,
 * all three decision kinds, discriminated union rejection, batch constraints,
 * and meta field patterns.
 */

import { describe, it, expect } from "vitest";
import {
  coordinatorInputSchema,
  coordinatorDecisionSchema,
  coordinatorBatchInputSchema,
  coordinatorBatchOutputSchema,
  coordinatorCallMetaSchema,
  coordinatorCallResultSchema,
} from "../coordinator/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validIssue = {
  id: "issue-1",
  title: "Fix the bug",
  body: "Something broke",
  labels: ["bug"],
  column: "In Progress",
  parentId: null,
  priority: 2,
  createdAt: "2026-05-16T00:00:00.000Z",
};

const validAgent = {
  name: "verbal",
  role: "implementer",
  charterHash: "abc12345",
  charterContent: "# Verbal\n\n## Role\n\nimplementer",
  capabilities: ["typescript"],
  available: true,
};

const validProject = { id: "proj-1", name: "Squadboard", rules: "Be strict." };

const validInput = {
  issue: validIssue,
  candidateAgents: [validAgent],
  project: validProject,
  recentRuns: [
    { issueId: "issue-0", agentName: "verbal", outcome: "success", durationMs: 5000 },
  ],
};

const validMeta = {
  model: "claude-haiku-4.5",
  promptTokens: 1200,
  completionTokens: 80,
  durationMs: 1800,
  cacheHit: false,
  inputHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
};

// ---------------------------------------------------------------------------
// CoordinatorInput
// ---------------------------------------------------------------------------

describe("coordinatorInputSchema", () => {
  it("parses a valid CoordinatorInput", () => {
    const result = coordinatorInputSchema.parse(validInput);
    expect(result.issue.id).toBe("issue-1");
    expect(result.candidateAgents).toHaveLength(1);
  });

  it("fails with descriptive path when issue.id is missing", () => {
    const bad = { ...validInput, issue: { ...validIssue, id: undefined } };
    const result = coordinatorInputSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("id"))).toBe(true);
    }
  });

  it("allows empty candidateAgents array (skip scenario)", () => {
    const input = { ...validInput, candidateAgents: [] };
    const result = coordinatorInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts priority null", () => {
    const input = { ...validInput, issue: { ...validIssue, priority: null } };
    expect(coordinatorInputSchema.parse(input).issue.priority).toBeNull();
  });

  it("accepts priority 0", () => {
    const input = { ...validInput, issue: { ...validIssue, priority: 0 } };
    expect(coordinatorInputSchema.parse(input).issue.priority).toBe(0);
  });

  it("accepts priority 5", () => {
    const input = { ...validInput, issue: { ...validIssue, priority: 5 } };
    expect(coordinatorInputSchema.parse(input).issue.priority).toBe(5);
  });

  it("rejects priority 6", () => {
    const input = { ...validInput, issue: { ...validIssue, priority: 6 } };
    const result = coordinatorInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra property on root object (.strict)", () => {
    const input = { ...validInput, extraProp: "should-fail" };
    const result = coordinatorInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra property on nested issue (.strict)", () => {
    const input = {
      ...validInput,
      issue: { ...validIssue, unknownField: "bad" },
    };
    const result = coordinatorInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CoordinatorDecision
// ---------------------------------------------------------------------------

describe("coordinatorDecisionSchema", () => {
  it('parses a "dispatch" decision', () => {
    const d = coordinatorDecisionSchema.parse({
      kind: "dispatch",
      agent: "verbal",
      rationale: "Best match",
      confidence: 0.9,
    });
    expect(d.kind).toBe("dispatch");
  });

  it('parses a "skip" decision', () => {
    const d = coordinatorDecisionSchema.parse({ kind: "skip", reason: "nothing suitable" });
    expect(d.kind).toBe("skip");
  });

  it('parses an "ambiguous" decision', () => {
    const d = coordinatorDecisionSchema.parse({
      kind: "ambiguous",
      suggestedAgents: ["verbal", "ralph"],
      question: "Which?",
    });
    expect(d.kind).toBe("ambiguous");
  });

  it("rejects confidence < 0", () => {
    const result = coordinatorDecisionSchema.safeParse({
      kind: "dispatch",
      agent: "verbal",
      rationale: "test",
      confidence: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence > 1", () => {
    const result = coordinatorDecisionSchema.safeParse({
      kind: "dispatch",
      agent: "verbal",
      rationale: "test",
      confidence: 1.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown kind value", () => {
    const result = coordinatorDecisionSchema.safeParse({
      kind: "fan-out",
      agent: "verbal",
    });
    expect(result.success).toBe(false);
  });

  it("rejects object with no kind field", () => {
    const result = coordinatorDecisionSchema.safeParse({ agent: "verbal" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Batch schemas
// ---------------------------------------------------------------------------

describe("coordinatorBatchInputSchema", () => {
  it("parses a batch with one issue", () => {
    const result = coordinatorBatchInputSchema.parse({ issues: [validInput] });
    expect(result.issues).toHaveLength(1);
  });

  it("rejects empty issues array", () => {
    const result = coordinatorBatchInputSchema.safeParse({ issues: [] });
    expect(result.success).toBe(false);
  });
});

describe("coordinatorBatchOutputSchema", () => {
  it("allows decisions array length that differs from input (skips allowed)", () => {
    const output = {
      decisions: [
        {
          issueId: "issue-1",
          decision: { kind: "skip", reason: "nothing" },
        },
      ],
    };
    const result = coordinatorBatchOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("allows empty decisions array", () => {
    const result = coordinatorBatchOutputSchema.safeParse({ decisions: [] });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CoordinatorCallMeta
// ---------------------------------------------------------------------------

describe("coordinatorCallMetaSchema", () => {
  it("parses valid meta", () => {
    const meta = coordinatorCallMetaSchema.parse(validMeta);
    expect(meta.model).toBe("claude-haiku-4.5");
  });

  it("rejects negative promptTokens", () => {
    const result = coordinatorCallMetaSchema.safeParse({
      ...validMeta,
      promptTokens: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative durationMs", () => {
    const result = coordinatorCallMetaSchema.safeParse({
      ...validMeta,
      durationMs: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects inputHash that is not 64 hex chars", () => {
    const result = coordinatorCallMetaSchema.safeParse({
      ...validMeta,
      inputHash: "tooshort",
    });
    expect(result.success).toBe(false);
  });

  it("accepts inputHash of exactly 64 lowercase hex chars", () => {
    const hash = "0123456789abcdef".repeat(4); // 64 chars
    const result = coordinatorCallMetaSchema.safeParse({
      ...validMeta,
      inputHash: hash,
    });
    expect(result.success).toBe(true);
  });

  it("rejects cacheHit as truthy string instead of boolean", () => {
    const result = coordinatorCallMetaSchema.safeParse({
      ...validMeta,
      cacheHit: "true",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CoordinatorCallResult
// ---------------------------------------------------------------------------

describe("coordinatorCallResultSchema", () => {
  it("parses a valid call result", () => {
    const result = coordinatorCallResultSchema.parse({
      decision: { kind: "dispatch", agent: "verbal", rationale: "ok", confidence: 1 },
      meta: validMeta,
    });
    expect(result.decision.kind).toBe("dispatch");
    expect(result.meta.cacheHit).toBe(false);
  });
});
