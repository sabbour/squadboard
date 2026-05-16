/**
 * coordinator-env.ts — central env config for the W29 mini-coordinator.
 *
 * - COORDINATOR_DISPATCH_ENABLED (MC-9): "0"/"false"/"off"/"no" disables; anything
 *   else (including unset) enables. Default: enabled.
 * - COORDINATOR_MODEL (MC-13): canonical model id. Default: "claude-haiku-4.5".
 * - COORDINATOR_MODEL_FALLBACKS: comma-separated override of the fallback chain.
 *   Default chain: ["claude-haiku-4.5", "gpt-5.4-mini", "gpt-5.1-codex-mini", "gpt-4.1"].
 *
 * All readers are PURE — they read process.env at call time. Tests can mutate
 * process.env between calls; no caching.
 */

export const DEFAULT_COORDINATOR_MODEL = "claude-haiku-4.5";

export const DEFAULT_COORDINATOR_MODEL_FALLBACKS = [
  "claude-haiku-4.5",
  "gpt-5.4-mini",
  "gpt-5.1-codex-mini",
  "gpt-4.1",
] as const;

const FALSEY_VALUES = new Set(["0", "false", "off", "no"]);

export function isCoordinatorDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.COORDINATOR_DISPATCH_ENABLED;
  if (raw === undefined || raw === null) return true;       // default on
  const normalized = raw.trim().toLowerCase();
  return !FALSEY_VALUES.has(normalized);
}

export function getCoordinatorModel(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.COORDINATOR_MODEL?.trim();
  if (raw && raw.length > 0) return raw;
  return DEFAULT_COORDINATOR_MODEL;
}

export function getCoordinatorModelFallbacks(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.COORDINATOR_MODEL_FALLBACKS?.trim();
  if (raw && raw.length > 0) {
    return raw
      .split(",")
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }
  return [...DEFAULT_COORDINATOR_MODEL_FALLBACKS];
}

/**
 * Resolves the model chain: primary model first, then fallbacks (dedup, primary
 * first if listed). Used by MC-3 dispatch + future MC-7/8 wire-up to attempt
 * each in order until one succeeds.
 */
export function resolveCoordinatorModelChain(env: NodeJS.ProcessEnv = process.env): string[] {
  const primary = getCoordinatorModel(env);
  const fallbacks = getCoordinatorModelFallbacks(env);
  const chain = [primary, ...fallbacks];
  // dedupe preserving order
  const seen = new Set<string>();
  return chain.filter(m => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });
}

/**
 * Summary helper for diagnostics endpoints (consumed by I8 later if applicable).
 */
export interface CoordinatorEnvSummary {
  dispatchEnabled: boolean;
  primaryModel: string;
  fallbacks: string[];
  modelChain: string[];
}

export function getCoordinatorEnvSummary(env: NodeJS.ProcessEnv = process.env): CoordinatorEnvSummary {
  return {
    dispatchEnabled: isCoordinatorDispatchEnabled(env),
    primaryModel: getCoordinatorModel(env),
    fallbacks: getCoordinatorModelFallbacks(env),
    modelChain: resolveCoordinatorModelChain(env),
  };
}
