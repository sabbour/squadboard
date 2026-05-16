/**
 * coordinator/schemas.ts -- Zod runtime validators that exactly mirror the
 * TypeScript types in types.ts (W29 MC-1).
 *
 * Design notes:
 * - .strict() on every inner object rejects unknown properties at parse time.
 * - z.discriminatedUnion("kind", [...]) gives O(1) variant lookup and clear
 *   error messages when `kind` is absent or unrecognised.
 * - Numeric range constraints (priority 0-5, confidence 0-1, non-negative
 *   integers for tokens/durationMs) are enforced at the schema level so call
 *   sites never need to re-validate.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Sub-schemas (private to this module)
// ---------------------------------------------------------------------------

const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()),
  column: z.string(),
  parentId: z.string().nullable(),
  priority: z.number().int().min(0).max(5).nullable(),
  createdAt: z.string(),
}).strict();

const candidateAgentSchema = z.object({
  name: z.string(),
  role: z.string(),
  charterHash: z.string(),
  charterContent: z.string(),
  capabilities: z.array(z.string()),
  available: z.boolean(),
}).strict();

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  rules: z.string(),
}).strict();

const recentRunSchema = z.object({
  issueId: z.string(),
  agentName: z.string(),
  outcome: z.enum(["success", "failed", "abandoned"]),
  durationMs: z.number().int().nonnegative(),
}).strict();

// ---------------------------------------------------------------------------
// Public schemas
// ---------------------------------------------------------------------------

export const coordinatorInputSchema = z.object({
  issue: issueSchema,
  candidateAgents: z.array(candidateAgentSchema),
  project: projectSchema,
  recentRuns: z.array(recentRunSchema).max(5),
}).strict();

export const coordinatorDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("dispatch"),
    agent: z.string(),
    rationale: z.string(),
    confidence: z.number().min(0).max(1),
  }).strict(),
  z.object({
    kind: z.literal("skip"),
    reason: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("ambiguous"),
    suggestedAgents: z.array(z.string()),
    question: z.string(),
  }).strict(),
]);

export const coordinatorBatchInputSchema = z.object({
  issues: z.array(coordinatorInputSchema).min(1),
}).strict();

export const coordinatorBatchOutputSchema = z.object({
  decisions: z.array(
    z.object({
      issueId: z.string(),
      decision: coordinatorDecisionSchema,
    }).strict(),
  ),
}).strict();

export const coordinatorCallMetaSchema = z.object({
  model: z.string(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  cacheHit: z.boolean(),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const coordinatorCallResultSchema = z.object({
  decision: coordinatorDecisionSchema,
  meta: coordinatorCallMetaSchema,
}).strict();
