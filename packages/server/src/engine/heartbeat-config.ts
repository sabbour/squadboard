/**
 * heartbeat-config.ts — W25
 *
 * Loads per-sweep cadence overrides from heartbeat.config.json (adjacent to
 * package.json, two levels above this file in the compiled dist tree).
 *
 * Brady can edit heartbeat.config.json to tune sweep intervals without any
 * code change. A missing file is silently ignored — coded defaults apply.
 *
 * Config fields per sweep entry:
 *   intervalMs  — override the coded intervalMs directly (ms between runs)
 *   multiplier  — multiply the coded default by N (ignored if intervalMs set)
 *   enabled     — set false to disable the sweep at startup
 *
 * The config is loaded once at process start (not hot-reloaded).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Sweep } from './heartbeat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
// In the compiled dist tree: dist/engine/heartbeat-config.js → ../../heartbeat.config.json
const CONFIG_PATH = join(__dirname, '..', '..', 'heartbeat.config.json');

export interface SweepOverride {
  intervalMs?:  number;
  multiplier?:  number;
  enabled?:     boolean;
}

export interface HeartbeatConfig {
  sweeps: Record<string, SweepOverride>;
}

let _cached: HeartbeatConfig | null = null;

export function loadHeartbeatConfig(): HeartbeatConfig {
  if (_cached) return _cached;
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as HeartbeatConfig;
    _cached = parsed;
    console.log(`[heartbeat-config] loaded from ${CONFIG_PATH}`);
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('[heartbeat-config] no config file found — using coded defaults');
    } else {
      console.warn('[heartbeat-config] failed to parse config, using coded defaults:', err);
    }
    _cached = { sweeps: {} };
    return _cached;
  }
}

/**
 * Reset the in-module cache. Test-only — production code reads the config
 * exactly once at boot and treats it as immutable.
 */
export function _resetHeartbeatConfigCache(): void {
  _cached = null;
}

/**
 * Apply config overrides to an array of Sweep objects (mutates in place).
 * Call this before heartbeat.register() in index.ts.
 */
export function applyHeartbeatConfig(sweeps: Sweep[]): void {
  const config = loadHeartbeatConfig();
  for (const sweep of sweeps) {
    const override = config.sweeps[sweep.id];
    if (!override) continue;
    const originalIntervalMs = sweep.intervalMs;
    const originalEnabled    = sweep.enabled;

    if (typeof override.intervalMs === 'number' && override.intervalMs > 0) {
      sweep.intervalMs = override.intervalMs;
    } else if (typeof override.multiplier === 'number' && override.multiplier > 0) {
      sweep.intervalMs = Math.round(sweep.intervalMs * override.multiplier);
    }

    if (typeof override.enabled === 'boolean') {
      sweep.enabled = override.enabled;
    }

    const intervalChanged = sweep.intervalMs !== originalIntervalMs;
    const enabledChanged  = sweep.enabled    !== originalEnabled;
    if (intervalChanged || enabledChanged) {
      console.log(
        `[heartbeat-config] ${sweep.id}: intervalMs=${sweep.intervalMs}ms ` +
        `(was ${originalIntervalMs}ms), enabled=${sweep.enabled} ` +
        `(was ${originalEnabled})`,
      );
    }
  }
}

/**
 * Return the effective config as a plain object for GET /api/heartbeat/config.
 * Called after applyHeartbeatConfig() has run.
 */
export function getEffectiveConfig(sweeps: Sweep[]): {
  configPath: string;
  sweeps: Array<{ id: string; intervalMs: number; enabled: boolean }>;
} {
  return {
    configPath: CONFIG_PATH,
    sweeps: sweeps.map((s) => ({ id: s.id, intervalMs: s.intervalMs, enabled: s.enabled })),
  };
}
