/**
 * packages/server/src/daemon/scheduler.ts
 *
 * Simple interval-based scheduler for the coordinator daemon.
 * Emits 'tick' events at the configured cadence.
 *
 * Priority order for interval configuration:
 *   1. SQUADBOARD_DAEMON_INTERVAL_MS env var
 *   2. ~/.squadboard/config.json { daemon: { intervalMs } }
 *   3. DEFAULT_INTERVAL_MS (4 hours)
 *
 * No external cron library — plain setInterval is the right tool here.
 */

import { EventEmitter } from 'node:events';
import { readConfig } from './guards.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ---------------------------------------------------------------------------
// Interval resolution
// ---------------------------------------------------------------------------

export function resolveIntervalMs(): number {
  const fromEnv = process.env.SQUADBOARD_DAEMON_INTERVAL_MS;
  if (fromEnv) {
    const parsed = parseInt(fromEnv, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  const config = readConfig();
  if (
    config.daemon?.intervalMs &&
    typeof config.daemon.intervalMs === 'number' &&
    config.daemon.intervalMs > 0
  ) {
    return config.daemon.intervalMs;
  }

  return DEFAULT_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface SchedulerEvents {
  tick: [];
}

export class Scheduler extends EventEmitter {
  private handle: ReturnType<typeof setInterval> | null = null;
  private _nextTickAt: Date | null = null;
  private _lastTickAt: Date | null = null;

  get nextTickAt(): Date | null {
    return this._nextTickAt;
  }

  get lastTickAt(): Date | null {
    return this._lastTickAt;
  }

  start(): void {
    if (this.handle) return; // already running

    const intervalMs = resolveIntervalMs();
    console.log(
      `[daemon:scheduler] starting — interval ${intervalMs}ms (${(intervalMs / 3600000).toFixed(2)}h)`,
    );

    this._nextTickAt = new Date(Date.now() + intervalMs);

    this.handle = setInterval(() => {
      this._lastTickAt = new Date();
      this._nextTickAt = new Date(Date.now() + intervalMs);
      this.emit('tick');
    }, intervalMs);

    // Allow the process to exit even if the scheduler is still running
    if (this.handle.unref) this.handle.unref();
  }

  stop(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
      this._nextTickAt = null;
      console.log('[daemon:scheduler] stopped');
    }
  }

  /** Force an immediate tick — used by testTick() and daemon run-once. */
  fireTick(): void {
    this._lastTickAt = new Date();
    const intervalMs = resolveIntervalMs();
    this._nextTickAt = new Date(Date.now() + intervalMs);
    this.emit('tick');
  }
}
