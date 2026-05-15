/**
 * pricing.ts — Per-model token pricing for cost rollups.
 *
 * Mirrors the pattern used by Squad-IRL samples (e.g. social-media-manager/index.ts).
 * Prices are USD per 1M tokens. Hand-maintained — keep in sync with the platform
 * catalog returned by SquadClient.listModels(). When a model is unknown, falls
 * back to claude-sonnet-4.5's pricing which is roughly mid-tier.
 *
 * Stream D — D6: in addition to USD pricing this module exposes a GitHub
 * Copilot premium-request multiplier table for the alternate cost model
 * documented at https://docs.github.com/en/copilot/concepts/billing/copilot-requests.
 * The two cost models live side-by-side; Costs.tsx renders one or the other
 * based on the project setting / `SQUADBOARD_COST_MODEL` env flag.
 */
export const MODEL_PRICING = {
    // Claude — premium
    'claude-opus-4.6': { input: 15, output: 75 },
    'claude-opus-4.5': { input: 15, output: 75 },
    // Claude — standard
    'claude-sonnet-4.6': { input: 3, output: 15 },
    'claude-sonnet-4.5': { input: 3, output: 15 },
    'claude-sonnet-4': { input: 3, output: 15 },
    // Claude — fast / cheap
    'claude-haiku-4.5': { input: 0.8, output: 4 },
    // OpenAI — standard
    'gpt-5.4': { input: 2.5, output: 10 },
    'gpt-5.3-codex': { input: 2.5, output: 10 },
    'gpt-5.2-codex': { input: 2.5, output: 10 },
    'gpt-5.2': { input: 2.5, output: 10 },
    'gpt-5.1-codex-max': { input: 2.5, output: 10 },
    'gpt-5.1-codex': { input: 2.5, output: 10 },
    'gpt-5.1': { input: 2.5, output: 10 },
    'gpt-4o': { input: 2.5, output: 10 },
    // OpenAI — fast / cheap
    'gpt-5.4-mini': { input: 0.4, output: 1.6 },
    'gpt-5.1-codex-mini': { input: 0.4, output: 1.6 },
    'gpt-5-mini': { input: 0.4, output: 1.6 },
    'gpt-4.1': { input: 2.0, output: 8 },
    // Google
    'gemini-3-pro-preview': { input: 3, output: 15 },
};
const FALLBACK = MODEL_PRICING['claude-sonnet-4.5'];
/**
 * Estimate USD cost for a turn given input + output token counts.
 * Returns a number; format with .toFixed(4) for display.
 */
export function estimateCost(model, inputTokens, outputTokens) {
    const pricing = (model && MODEL_PRICING[model]) || FALLBACK;
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
/** Get the per-1M-token price tuple for a model (returns fallback if unknown). */
export function getPricing(model) {
    return (model && MODEL_PRICING[model]) || FALLBACK;
}
// ---------------------------------------------------------------------------
// Stream D — D6: GitHub Copilot premium-request multipliers.
//
// Each prompt counts as N premium requests where N comes from this table.
// The "included" models (gpt-5-mini, gpt-4.1, gpt-4o) cost zero requests on
// paid plans. Auto-select discounts the multiplier by 10%; FedRAMP / data
// residency adds a 10% surcharge. Source:
//   https://docs.github.com/en/copilot/concepts/billing/copilot-requests
// Multipliers are subject to change — review quarterly.
// ---------------------------------------------------------------------------
export const MODEL_MULTIPLIERS = {
    // Included on paid plans — zero premium requests
    'gpt-5-mini': 0,
    'gpt-5.4-mini': 0,
    'gpt-4.1': 0,
    'gpt-4o': 0,
    // Standard 1× tier
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
    'gemini-3-pro-preview': 1,
    // Premium / reasoning tier
    'claude-opus-4.5': 10,
    'claude-opus-4.6': 10,
};
const DEFAULT_MULTIPLIER = 1;
/** Look up the raw multiplier for a model (1 if unknown). */
export function getModelMultiplier(model) {
    if (model && Object.prototype.hasOwnProperty.call(MODEL_MULTIPLIERS, model)) {
        return MODEL_MULTIPLIERS[model];
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
export function estimatePremiumRequests(model, opts = {}) {
    const base = getModelMultiplier(model);
    if (base === 0)
        return 0;
    let multiplier = base;
    if (opts.autoSelect)
        multiplier *= 0.9;
    if (opts.dataResidency)
        multiplier *= 1.1;
    const prompts = Math.max(opts.prompts ?? 1, 0);
    const total = multiplier * prompts;
    return Math.round(total * 10_000) / 10_000;
}
//# sourceMappingURL=pricing.js.map