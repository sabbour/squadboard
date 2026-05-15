import type { DrizzleDb } from '../db/index.js';
import { issueRuns } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { estimatePremiumRequests, type PremiumRequestOptions } from './pricing.js';

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
  async recordCost(
    inputTokens: number,
    outputTokens: number,
    modelId: string,
    premiumOpts?: PremiumRequestOptions,
  ): Promise<void> {
    const pricing = getPricing(modelId);
    const costUsd = computeCost(inputTokens, outputTokens, pricing).toFixed(6);
    const totalTokens = inputTokens + outputTokens;
    // Stream D — D6: stamp the GitHub Copilot premium-request equivalent
    // alongside the USD figure so the Costs page can render either model.
    const premiumRequests = estimatePremiumRequests(modelId, premiumOpts);

    await this.db
      .update(issueRuns)
      .set({
        inputTokens,
        outputTokens,
        costTokens: totalTokens,
        costUsd,
        premiumRequests: premiumRequests.toString(),
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
  premiumRequests: number;
}

export interface CostByModel {
  modelId: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  premiumRequests: number;
}

export type CostSource = 'run' | 'live_session' | 'consult';

export interface CostBySource {
  source: CostSource;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  premiumRequests: number;
}

export interface CostSummary {
  projectId: string;
  /** Sources that were included in the totals (defaults to ['run','live_session']). */
  sources: CostSource[];
  /** Stream D — D6: which cost model the consuming UI should render by default. */
  costModel: 'usd' | 'gh_multipliers';
  /** Month-to-date (calendar month of query time) */
  mtd: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    totalPremiumRequests: number;
    byAgent: CostByAgent[];
    byModel: CostByModel[];
    bySource: CostBySource[];
  };
  /** All-time totals */
  allTime: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    totalPremiumRequests: number;
    byAgent: CostByAgent[];
    byModel: CostByModel[];
    bySource: CostBySource[];
  };
}

export interface CostSummaryOptions {
  /** Which spend sources to include. Defaults to ['run','live_session']
   *  to preserve previous billing semantics — consults are opt-in. */
  sources?: CostSource[];
}

export async function getCostSummary(
  db: DrizzleDb,
  projectId: string,
  options: CostSummaryOptions = {},
): Promise<CostSummary> {
  const sources: CostSource[] =
    options.sources && options.sources.length > 0
      ? options.sources
      : ['run', 'live_session'];

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  type Row = {
    id: string;
    agent_id: string;
    agent_name: string;
    model_id: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd: string | null;
    premium_requests: string | number | null;
    created_at: Date;
    source: CostSource;
  };

  const allRows: Row[] = [];

  if (sources.includes('run')) {
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
        ir.premium_requests,
        ir.created_at,
        'run'::text     AS source
      FROM issue_runs ir
      JOIN agents a ON ir.agent_id = a.id
      JOIN issues i ON ir.issue_id = i.id
      WHERE i.project_id = ${projectId}
        AND ir.status IN ('completed', 'failed')
      ORDER BY ir.created_at DESC
    `);
    allRows.push(...(rows.rows as Row[]));
  }

  if (sources.includes('live_session')) {
    // Live sessions also accrue cost via SquadClient streaming.
    // They're not bound to issue_runs, so union them in as synthetic rows
    // grouped under their owning agent (or 'live-session' bucket if no agent).
    const liveRows = await db.execute(sql`
      SELECT
        ls.id,
        COALESCE(ls.agent_id::text, ls.id::text) AS agent_id,
        COALESCE(ls.agent_name, 'Live session') AS agent_name,
        ls.model AS model_id,
        ls.input_tokens,
        ls.output_tokens,
        (ls.input_tokens + ls.output_tokens) AS cost_tokens,
        ls.cost_usd::text AS cost_usd,
        NULL::numeric AS premium_requests,
        ls.created_at,
        'live_session'::text AS source
      FROM live_sessions ls
      WHERE ls.project_id = ${projectId}
    `);
    allRows.push(...(liveRows.rows as Row[]));
  }

  if (sources.includes('consult')) {
    // Phase 17: Ask / Consult sessions (free-form brainstorm). These
    // are intentionally separate from billable run + live spend so
    // exploratory thinking doesn't pollute project run cost charts.
    const consultRows = await db.execute(sql`
      SELECT
        cs.id,
        COALESCE(cs.agent_id::text, cs.id::text) AS agent_id,
        COALESCE(cs.agent_name, CASE WHEN cs.mode = 'model' THEN 'Model consult' ELSE 'Agent consult' END) AS agent_name,
        cs.model AS model_id,
        cs.input_tokens,
        cs.output_tokens,
        (cs.input_tokens + cs.output_tokens) AS cost_tokens,
        cs.cost_usd::text AS cost_usd,
        cs.premium_requests,
        cs.created_at,
        'consult'::text AS source
      FROM consult_sessions cs
      WHERE cs.project_id = ${projectId}
    `);
    allRows.push(...(consultRows.rows as Row[]));
  }
  const mtdRows = allRows.filter((r) => new Date(r.created_at) >= startOfMonth);

  function aggregate(raws: Row[]): { totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number; totalPremiumRequests: number; byAgent: CostByAgent[]; byModel: CostByModel[]; bySource: CostBySource[] } {
    const agentMap = new Map<string, CostByAgent>();
    const modelMap = new Map<string, CostByModel>();
    const sourceMap = new Map<CostSource, CostBySource>();
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let totalPremium = 0;

    for (const r of raws) {
      const input = Number(r.input_tokens ?? 0);
      const output = Number(r.output_tokens ?? 0);
      const cost = parseFloat(r.cost_usd ?? '0') || 0;
      // Stream D — D6: prefer the persisted column when present (paid/agent
      // runs), otherwise estimate from the model multiplier so live_session
      // rows still contribute a sensible figure.
      const stored = r.premium_requests == null ? null : Number(r.premium_requests);
      const premium = stored !== null && Number.isFinite(stored)
        ? stored
        : estimatePremiumRequests(r.model_id ?? undefined);
      totalInput += input;
      totalOutput += output;
      totalCost += cost;
      totalPremium += premium;

      const existing = agentMap.get(r.agent_id);
      if (existing) {
        existing.runCount++;
        existing.inputTokens += input;
        existing.outputTokens += output;
        existing.costUsd += cost;
        existing.premiumRequests += premium;
      } else {
        agentMap.set(r.agent_id, {
          agentId: r.agent_id,
          agentName: r.agent_name,
          runCount: 1,
          inputTokens: input,
          outputTokens: output,
          costUsd: cost,
          premiumRequests: premium,
        });
      }

      const modelKey = r.model_id ?? 'unknown';
      const existingModel = modelMap.get(modelKey);
      if (existingModel) {
        existingModel.runCount++;
        existingModel.inputTokens += input;
        existingModel.outputTokens += output;
        existingModel.costUsd += cost;
        existingModel.premiumRequests += premium;
      } else {
        modelMap.set(modelKey, {
          modelId: modelKey,
          runCount: 1,
          inputTokens: input,
          outputTokens: output,
          costUsd: cost,
          premiumRequests: premium,
        });
      }

      const existingSource = sourceMap.get(r.source);
      if (existingSource) {
        existingSource.runCount++;
        existingSource.inputTokens += input;
        existingSource.outputTokens += output;
        existingSource.costUsd += cost;
        existingSource.premiumRequests += premium;
      } else {
        sourceMap.set(r.source, {
          source: r.source,
          runCount: 1,
          inputTokens: input,
          outputTokens: output,
          costUsd: cost,
          premiumRequests: premium,
        });
      }
    }

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCostUsd: totalCost,
      totalPremiumRequests: Math.round(totalPremium * 10_000) / 10_000,
      byAgent: Array.from(agentMap.values()),
      byModel: Array.from(modelMap.values()),
      bySource: Array.from(sourceMap.values()),
    };
  }

  // Stream D — D6: resolve the project's cost model preference.
  let costModel: 'usd' | 'gh_multipliers' = (process.env.SQUADBOARD_COST_MODEL === 'gh_multipliers')
    ? 'gh_multipliers'
    : 'usd';
  try {
    const proj = await db.execute(sql`
      SELECT cost_model FROM projects WHERE id = ${projectId} LIMIT 1
    `);
    const stored = (proj.rows as Array<{ cost_model: string | null }>)[0]?.cost_model;
    if (stored === 'usd' || stored === 'gh_multipliers') {
      costModel = stored;
    }
  } catch {
    // Pre-D6 schema or transient error — keep env default.
  }

  return {
    projectId,
    sources,
    costModel,
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
    SELECT
      COALESCE(SUM(ir.cost_usd::numeric), 0)
      + COALESCE((
          SELECT SUM(ls.cost_usd::numeric)
          FROM live_sessions ls
          WHERE ls.project_id = ${projectId}
            AND ls.created_at >= ${startOfMonth.toISOString()}
        ), 0)
      AS total
    FROM issue_runs ir
    JOIN issues i ON ir.issue_id = i.id
    WHERE i.project_id = ${projectId}
      AND ir.created_at >= ${startOfMonth.toISOString()}
  `);
  const rows = result.rows as Array<{ total: string }>;
  return parseFloat(rows[0]?.total ?? '0') || 0;
}
