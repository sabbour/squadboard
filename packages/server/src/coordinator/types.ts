/**
 * coordinator/types.ts -- canonical TypeScript types for the mini-coordinator
 * input/output contract (W29 MC-1).
 *
 * All downstream slices (MC-2 preamble, MC-3 dispatch core, MC-7/8 wire-up,
 * MC-10 decision log, MC-11 batch, MC-12 integration tests) import from here.
 */

// ---------------------------------------------------------------------------
// Single-issue dispatch input
// ---------------------------------------------------------------------------

export interface CoordinatorInput {
  issue: {
    id: string;
    title: string;
    body: string | null;
    labels: string[];
    column: string;          // "Backlog" | "To Do" | "In Progress" | ...
    parentId: string | null;
    priority: number | null; // 0-5
    createdAt: string;       // ISO 8601
  };
  candidateAgents: Array<{
    name: string;            // e.g. "verbal"
    role: string;            // e.g. "implementer"
    charterHash: string;     // sha256 prefix (first 8 chars) of charter
    charterContent: string;  // raw charter markdown
    capabilities: string[];  // labels declared in charter
    available: boolean;      // not currently running anything in this project
  }>;
  project: {
    id: string;
    name: string;
    rules: string;           // brief team rules / preferences
  };
  recentRuns: Array<{        // last <=5 runs from the same column (for context)
    issueId: string;
    agentName: string;
    outcome: "success" | "failed" | "abandoned";
    durationMs: number;
  }>;
}

// ---------------------------------------------------------------------------
// Dispatch decision -- discriminated union
// ---------------------------------------------------------------------------

export type CoordinatorDecision =
  | { kind: "dispatch"; agent: string; rationale: string; confidence: number /* 0-1 */ }
  | { kind: "skip"; reason: string }
  | { kind: "ambiguous"; suggestedAgents: string[]; question: string };

// ---------------------------------------------------------------------------
// Batch variants (for MC-11)
// ---------------------------------------------------------------------------

export interface CoordinatorBatchInput {
  issues: CoordinatorInput[];
}

export interface CoordinatorBatchOutput {
  decisions: Array<{ issueId: string; decision: CoordinatorDecision }>;
}

// ---------------------------------------------------------------------------
// Telemetry / cache metadata
// ---------------------------------------------------------------------------

export interface CoordinatorCallMeta {
  model: string;            // e.g. "claude-haiku-4.5"
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  cacheHit: boolean;
  inputHash: string;        // sha256 of stable-stringified input (64 hex chars)
}

export interface CoordinatorCallResult {
  decision: CoordinatorDecision;
  meta: CoordinatorCallMeta;
}
