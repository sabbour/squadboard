import type { DrizzleDb } from '../db/index.js';
import { issueRuns } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Model pricing table (USD per million tokens)
// ---------------------------------------------------------------------------
interface ModelPricing {
  inputPerM: number;  // USD per 1M input tokens
  outputPerM: number; // USD per 1M output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude Opus 4.x
  'claude-opus-4':          { inputPerM: 15.00, outputPerM: 75.00 },
  'claude-opus-4-5':        { inputPerM: 15.00, outputPerM: 75.00 },
  'claude-opus-4-7':        { inputPerM: 15.00, outputPerM: 75.00 },
  // Claude Sonnet 4.x
  'claude-sonnet-4':        { inputPerM:  3.00, outputPerM: 15.00 },
  'claude-sonnet-4-5':      { inputPerM:  3.00, outputPerM: 15.00 },
  'claude-sonnet-4-6':      { inputPerM:  3.00, outputPerM: 15.00 },
  // Claude Haiku 4.x
  'claude-haiku-4':         { inputPerM:  0.25, outputPerM:  1.25 },
  'claude-haiku-4-5':       { inputPerM:  0.25, outputPerM:  1.25 },
  // GPT-4.x
  'gpt-4':                  { inputPerM: 10.00, outputPerM: 30.00 },
  'gpt-4-turbo':            { inputPerM: 10.00, outputPerM: 30.00 },
  'gpt-4o':                 { inputPerM: 10.00, outputPerM: 30.00 },
  'gpt-4.1':                { inputPerM: 10.00, outputPerM: 30.00 },
  // GPT-4o-mini
  'gpt-4o-mini':            { inputPerM:  0.15, outputPerM:  0.60 },
  'gpt-5-mini':             { inputPerM:  0.15, outputPerM:  0.60 },
  'gpt-4.1-mini':           { inputPerM:  0.15, outputPerM:  0.60 },
};

const DEFAULT_PRICING: ModelPricing = { inputPerM: 3.00, outputPerM: 15.00 };

function getPricing(modelId: string): ModelPricing {
  // Exact match
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];
  // Prefix match (e.g. 'claude-opus-4-7-high' → 'claude-opus-4')
  const key = Object.keys(MODEL_PRICING).find((k) => modelId.startsWith(k));
  return key ? MODEL_PRICING[key] : DEFAULT_PRICING;
}

function computeCost(inputTokens: number, outputTokens: number, pricing: ModelPricing): number {
  return (inputTokens / 1_000_000) * pricing.inputPerM
       + (outputTokens / 1_000_000) * pricing.outputPerM;
}

// ---------------------------------------------------------------------------
// CostTracker — per-run instance
// ---------------------------------------------------------------------------
export class CostTracker {
  constructor(
    private readonly issueRunId: string,
    private readonly db: DrizzleDb,
  ) {}

  /** Legacy single-value record (kept for backward compat with existing callers). */
  async record(tokensUsed: number, costUsd: string): Promise<void> {
    await this.db
      .update(issueRuns)
      .set({ costTokens: tokensUsed, costUsd })
      .where(eq(issueRuns.id, this.issueRunId));
  }

  /** Full granular cost record with input/output split. */
  async recordCost(inputTokens: number, outputTokens: number, modelId: string): Promise<void> {
    const pricing = getPricing(modelId);
    const costUsd = computeCost(inputTokens, outputTokens, pricing).toFixed(6);
    const totalTokens = inputTokens + outputTokens;

    await this.db
      .update(issueRuns)
      .set({
        inputTokens,
        outputTokens,
        costTokens: totalTokens,
        costUsd,
        updatedAt: new Date(),
      })
      .where(eq(issueRuns.id, this.issueRunId));
  }

  /** Accumulate cost incrementally (for streaming runs). */
  async accumulate(deltaTokens: number, deltaCostUsd: string): Promise<void> {
    const delta = parseFloat(deltaCostUsd);
    await this.db
      .update(issueRuns)
      .set({
        costTokens: sql`COALESCE(${issueRuns.costTokens}, 0) + ${deltaTokens}`,
        costUsd: sql`(COALESCE(${issueRuns.costUsd}::numeric, 0) + ${delta})::text`,
      })
      .where(eq(issueRuns.id, this.issueRunId));
  }
}

// ---------------------------------------------------------------------------
// Cost summary aggregation (used by /api/projects/:id/costs)
// ---------------------------------------------------------------------------

export interface CostByAgent {
  agentId: string;
  agentName: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface CostByModel {
  modelId: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface CostSummary {
  projectId: string;
  /** Month-to-date (calendar month of query time) */
  mtd: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    byAgent: CostByAgent[];
  };
  /** All-time totals */
  allTime: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    byAgent: CostByAgent[];
  };
}

export async function getCostSummary(db: DrizzleDb, projectId: string): Promise<CostSummary> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  // Query all completed issue_runs for this project, joined with agent info
  const rows = await db.execute(sql`
    SELECT
      ir.id,
      ir.agent_id,
      a.name          AS agent_name,
      a.model         AS model_id,
      ir.input_tokens,
      ir.output_tokens,
      ir.cost_tokens,
      ir.cost_usd,
      ir.created_at
    FROM issue_runs ir
    JOIN agents a ON ir.agent_id = a.id
    JOIN issues i ON ir.issue_id = i.id
    WHERE i.project_id = ${projectId}
      AND ir.status IN ('completed', 'failed')
    ORDER BY ir.created_at DESC
  `);

  type Row = {
    id: string;
    agent_id: string;
    agent_name: string;
    model_id: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: string | null;
    created_at: Date;
  };

  const allRows = rows.rows as Row[];
  const mtdRows = allRows.filter((r) => new Date(r.created_at) >= startOfMonth);

  function aggregate(raws: Row[]): { totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number; byAgent: CostByAgent[] } {
    const agentMap = new Map<string, CostByAgent>();
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;

    for (const r of raws) {
      const input = Number(r.input_tokens ?? 0);
      const output = Number(r.output_tokens ?? 0);
      const cost = parseFloat(r.cost_usd ?? '0') || 0;
      totalInput += input;
      totalOutput += output;
      totalCost += cost;

      const existing = agentMap.get(r.agent_id);
      if (existing) {
        existing.runCount++;
        existing.inputTokens += input;
        existing.outputTokens += output;
        existing.costUsd += cost;
      } else {
        agentMap.set(r.agent_id, {
          agentId: r.agent_id,
          agentName: r.agent_name,
          runCount: 1,
          inputTokens: input,
          outputTokens: output,
          costUsd: cost,
        });
      }
    }

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCostUsd: totalCost,
      byAgent: Array.from(agentMap.values()),
    };
  }

  return {
    projectId,
    mtd: aggregate(mtdRows),
    allTime: aggregate(allRows),
  };
}

/** Compute MTD spend for a project (used by BudgetGuard). */
export async function getMtdSpend(db: DrizzleDb, projectId: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const result = await db.execute(sql`
    SELECT COALESCE(SUM(ir.cost_usd::numeric), 0) AS total
    FROM issue_runs ir
    JOIN issues i ON ir.issue_id = i.id
    WHERE i.project_id = ${projectId}
      AND ir.created_at >= ${startOfMonth.toISOString()}
  `);
  const rows = result.rows as Array<{ total: string }>;
  return parseFloat(rows[0]?.total ?? '0') || 0;
}
