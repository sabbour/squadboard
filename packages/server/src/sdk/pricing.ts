/**
 * pricing.ts — Per-model token pricing for cost rollups.
 *
 * Mirrors the pattern used by Squad-IRL samples (e.g. social-media-manager/index.ts).
 * Prices are USD per 1M tokens. Hand-maintained — keep in sync with the platform
 * catalog returned by SquadClient.listModels(). When a model is unknown, falls
 * back to claude-sonnet-4.5's pricing which is roughly mid-tier.
 *
 * Stream D — D6 originally exposed GitHub Copilot premium-request multipliers.
 * GitHub Copilot now uses GitHub AI Credits for individual usage-based billing:
 * 1 credit = $0.01, with consumption based on model/token usage. The legacy
 * multiplier helpers remain for backwards-compatible persisted fields, but new
 * UI copy and cost rollups should treat USD-derived AI Credits as canonical.
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Claude — premium
  'claude-opus-4.6': { input: 15, output: 75 },
  'claude-opus-4.5': { input: 15, output: 75 },
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-opus-4-7-1m-internal': { input: 15, output: 75 },
  'claude-opus-4-7-high': { input: 15, output: 75 },
  'claude-opus-4-7-xhigh': { input: 15, output: 75 },
  // Claude — standard
  'claude-sonnet-4.6': { input: 3, output: 15 },
  'claude-sonnet-4.5': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  // Claude — fast / cheap (COST-1 fix: 0.8→1.00 input, 4→5.00 output)
  'claude-haiku-4.5': { input: 1.00, output: 5.00 },
  // OpenAI — standard
  'gpt-5.4': { input: 2.5, output: 15 },
  'gpt-5.3-codex': { input: 1.75, output: 14 },
  'gpt-5.2-codex': { input: 1.75, output: 14 },
  'gpt-5.2': { input: 1.75, output: 14 },
  'gpt-5.1-codex-max': { input: 2.5, output: 15 },
  'gpt-5.1-codex': { input: 2.5, output: 15 },
  'gpt-5.1': { input: 2.5, output: 15 },
  'gpt-4o': { input: 2.5, output: 15 },
  // OpenAI — fast / cheap (COST-1/2 fix)
  'gpt-5.4-mini': { input: 0.75, output: 4.50 },
  'gpt-5.1-codex-mini': { input: 0.75, output: 4.50 },
  'gpt-5-mini': { input: 0.25, output: 2.00 },
  'gpt-4.1': { input: 2.0, output: 8 },
  // OpenAI — powerful (COST-2 addition)
  'gpt-5.5': { input: 5.00, output: 30.00 },
  // Google (COST-2 addition)
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-3-flash': { input: 0.50, output: 3 },
  'gemini-3.1-pro': { input: 2.00, output: 12 },
  'gemini-3-pro-preview': { input: 2.00, output: 12 },
  // Fine-tuned (COST-2 addition)
  'raptor-mini': { input: 0.25, output: 2.00 },
  'goldeneye': { input: 1.25, output: 10.00 },
};

const FALLBACK = MODEL_PRICING['claude-sonnet-4.5']!;

/**
 * Estimate USD cost for a turn given input + output token counts.
 * Returns a number; format with .toFixed(4) for display.
 */
export function estimateCost(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  const pricing = (model && MODEL_PRICING[model]) || FALLBACK;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/** Get the per-1M-token price tuple for a model (returns fallback if unknown). */
export function getPricing(model: string | null | undefined): ModelPrice {
  return (model && MODEL_PRICING[model]) || FALLBACK;
}

export function estimateAiCreditsFromUsd(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  return Math.round(costUsd * 100 * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Legacy GitHub Copilot premium-request multipliers.
//
// Each prompt counts as N premium requests where N comes from this table.
// The "included" models (gpt-5-mini, gpt-4.1, gpt-4o) cost zero requests on
// paid plans. Auto-select discounts the multiplier by 10%; FedRAMP / data
// residency adds a 10% surcharge. Source:
//   https://docs.github.com/en/copilot/concepts/billing/copilot-requests
// Multipliers are subject to change — review quarterly.
// ---------------------------------------------------------------------------

export const MODEL_MULTIPLIERS: Record<string, number> = {
  // Included on paid plans — zero premium requests
  'gpt-5-mini': 0,
  'gpt-5.4-mini': 0,
  'gpt-4.1': 0,
  'gpt-4o': 0,
  'raptor-mini': 0,
  // Standard 1× tier
  'gpt-5.5': 1,
  'gpt-5.4': 1,
  'gpt-5.3-codex': 1,
  'gpt-5.2-codex': 1,
  'gpt-5.2': 1,
  'gpt-5.1': 1,
  'gpt-5.1-codex': 1,
  'gpt-5.1-codex-max': 1,
  'gpt-5.1-codex-mini': 0,
  'claude-sonnet-4': 1,
  'claude-sonnet-4.5': 1,
  'claude-sonnet-4.6': 1,
  'claude-haiku-4.5': 0.25,
  'gemini-2.5-pro': 1,
  'gemini-3-flash': 1,
  'gemini-3.1-pro': 1,
  'gemini-3-pro-preview': 1,
  'goldeneye': 1,
  // Premium / reasoning tier
  'claude-opus-4.5': 10,
  'claude-opus-4.6': 10,
  'claude-opus-4-7': 10,
  'claude-opus-4-7-1m-internal': 10,
  'claude-opus-4-7-high': 10,
  'claude-opus-4-7-xhigh': 10,
};

const DEFAULT_MULTIPLIER = 1;

export interface PremiumRequestOptions {
  /** When true, applies the 10% auto-select discount. */
  autoSelect?: boolean;
  /** When true, applies the 10% FedRAMP / data-residency surcharge. */
  dataResidency?: boolean;
  /**
   * Override the per-prompt count. Defaults to 1; bumped above 1 when an
   * agent turn issues multiple distinct prompts (rare — usually equals
   * sessions launched per agent_run).
   */
  prompts?: number;
}

/** Look up the raw multiplier for a model (1 if unknown). */
export function getModelMultiplier(model: string | null | undefined): number {
  if (model && Object.prototype.hasOwnProperty.call(MODEL_MULTIPLIERS, model)) {
    return MODEL_MULTIPLIERS[model]!;
  }
  return DEFAULT_MULTIPLIER;
}

/**
 * Estimate the number of premium requests an agent turn consumes.
 *
 * Returns a fractional number (rounded to 4 decimals) so we can preserve
 * sub-1× contributions across many calls before display rounding.
 *
 * GitHub bills in increments of one premium request, but their internal
 * counter accumulates fractional values across the billing month — so
 * accumulating fractional amounts is the correct approach for a per-project
 * rollup.
 */
export function estimatePremiumRequests(
  model: string | null | undefined,
  opts: PremiumRequestOptions = {},
): number {
  const base = getModelMultiplier(model);
  if (base === 0) return 0;

  let multiplier = base;
  if (opts.autoSelect) multiplier *= 0.9;
  if (opts.dataResidency) multiplier *= 1.1;

  const prompts = Math.max(opts.prompts ?? 1, 0);
  const total = multiplier * prompts;
  return Math.round(total * 10_000) / 10_000;
}
