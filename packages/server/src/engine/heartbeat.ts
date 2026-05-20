/**
 * heartbeat.ts — Phase 3
 *
 * Sweep registry that replaces the monolithic dispatcher tick.
 * Each sweep runs on its own interval; one failure never stops others.
 *
 * EventBus events emitted:
 *   heartbeat.sweep.completed — {sweepId, result, durationMs}
 *   heartbeat.sweep.error     — {sweepId, error, durationMs}
 */
import { eventBus } from '../realtime/event-bus.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface SweepResult {
  /** Number of rows/records acted on (reclaimed, marked, evicted, etc.). */
  acted: number;
  /** Number of rows that failed to process within this sweep pass. */
  errors: number;
  /** Optional human-readable detail string for logs / status UI. */
  details?: string;
  /** Project ids touched or checked by this sweep when the sweep can report them. */
  projectIds?: string[];
}

export type SweepScope = 'system' | 'project' | 'mixed';

export interface Sweep {
  /** Unique identifier used in routes, logs, and event payloads. */
  id: string;
  /** Human-readable lane label used in operational UI. */
  label: string;
  /** Plain-language description of the work this sweep performs. */
  description: string;
  /** Whether the sweep is purely system-wide, project-facing, or both. */
  scope: SweepScope;
  /** Milliseconds between successive automatic runs. */
  intervalMs: number;
  /** When false the sweep is registered but not scheduled. */
  enabled: boolean;
  run(): Promise<SweepResult>;
}

// ─── Internal state per registered sweep ─────────────────────────────────────

interface SweepState {
  sweep: Sweep;
  intervalHandle?: NodeJS.Timeout;
  lastResult?: SweepResult;
  lastRunAt?: Date;
  nextRunAt?: Date;
  lastError?: string;
}

// ─── Heartbeat class ──────────────────────────────────────────────────────────

export class Heartbeat {
  private readonly registry = new Map<string, SweepState>();
  private running = false;
  private lastTickAt?: Date;
  private lastError?: string;

  /** Add a sweep to the registry. Must be called before start(). */
  register(sweep: Sweep): void {
    this.registry.set(sweep.id, { sweep });
  }

  /** Schedule all enabled sweeps on their individual intervals. */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[heartbeat] starting — ${this.registry.size} sweep(s) registered`);
    for (const state of this.registry.values()) {
      this._schedule(state);
    }
  }

  /** Clear all intervals cleanly. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const state of this.registry.values()) {
      if (state.intervalHandle) {
        clearInterval(state.intervalHandle);
        state.intervalHandle = undefined;
      }
    }
    console.log('[heartbeat] stopped');
  }

  /**
   * Manual run — used by tests and the "Run now" UI button.
   * If sweepId is omitted, runs ALL registered sweeps once.
   */
  async tick(sweepId?: string): Promise<void> {
    if (sweepId !== undefined) {
      const state = this.registry.get(sweepId);
      if (!state) throw new Error(`[heartbeat] unknown sweep: ${sweepId}`);
      await this._runSweep(state);
    } else {
      for (const state of this.registry.values()) {
        await this._runSweep(state);
      }
    }
  }

  /**
   * Returns a status snapshot used by GET /api/heartbeat and the
   * Heartbeat panel in the Diagnostics UI.
   */
  getStatus(): {
    lastTickAt?: string;
    lastError?: string;
    sweeps: Array<{
      id: string;
      label: string;
      description: string;
      scope: SweepScope;
      intervalMs: number;
      enabled: boolean;
      lastResult?: SweepResult;
      lastRunAt?: string;
      nextRunAt?: string;
      lastError?: string;
    }>;
  } {
    return {
      lastTickAt: this.lastTickAt?.toISOString(),
      lastError: this.lastError,
      sweeps: Array.from(this.registry.values()).map((state) => ({
        id: state.sweep.id,
        label: state.sweep.label,
        description: state.sweep.description,
        scope: state.sweep.scope,
        intervalMs: state.sweep.intervalMs,
        enabled: state.sweep.enabled,
        lastResult: state.lastResult,
        lastRunAt: state.lastRunAt?.toISOString(),
        nextRunAt: state.nextRunAt?.toISOString(),
        lastError: state.lastError,
      })),
    };
  }

  /**
   * W25: Returns the effective intervalMs/enabled for every registered sweep.
   * Used by GET /api/heartbeat/config so Brady can verify which overrides
   * from heartbeat.config.json actually took effect at boot.
   */
  getEffectiveIntervals(): Array<{
    id: string;
    label: string;
    description: string;
    scope: SweepScope;
    intervalMs: number;
    enabled: boolean;
  }> {
    return Array.from(this.registry.values()).map((state) => ({
      id:          state.sweep.id,
      label:       state.sweep.label,
      description: state.sweep.description,
      scope:       state.sweep.scope,
      intervalMs:  state.sweep.intervalMs,
      enabled:     state.sweep.enabled,
    }));
  }

  /**
   * Toggle the enabled flag of a registered sweep by id.
   * Used by PATCH /api/heartbeat/sweeps/:id in the route layer.
   */
  setSweepEnabled(id: string, enabled: boolean): void {
    const state = this.registry.get(id);
    if (!state) throw new Error(`[heartbeat] unknown sweep: ${id}`);
    state.sweep.enabled = enabled;

    if (enabled && this.running && !state.intervalHandle) {
      // Re-schedule if it wasn't scheduled before.
      this._schedule(state);
    } else if (!enabled && state.intervalHandle) {
      clearInterval(state.intervalHandle);
      state.intervalHandle = undefined;
      state.nextRunAt = undefined;
    } else if (!enabled) {
      state.nextRunAt = undefined;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _schedule(state: SweepState): void {
    if (!state.sweep.enabled) return;
    state.nextRunAt = new Date(Date.now() + state.sweep.intervalMs);
    state.intervalHandle = setInterval(async () => {
      await this._runSweep(state);
    }, state.sweep.intervalMs);
  }

  private async _runSweep(state: SweepState): Promise<void> {
    if (!state.sweep.enabled) return;

    const start = Date.now();
    this.lastTickAt = new Date();
    state.lastRunAt = new Date();
    // Optimistically advance nextRunAt so the status UI always shows something reasonable.
    state.nextRunAt = new Date(Date.now() + state.sweep.intervalMs);

    try {
      const result = await state.sweep.run();
      const durationMs = Date.now() - start;
      state.lastResult = result;
      delete state.lastError;

      eventBus.emitHeartbeatEvent('heartbeat.sweep.completed', {
        sweepId: state.sweep.id,
        result,
        durationMs,
      });

      // W25: sweep timeline tick — broadcast to global WS subscribers so the
      // Heartbeat + Now pages can animate a pulse on the sweep's lane.
      eventBus.emitHeartbeatEvent('sweep.tick', {
        sweepName:       state.sweep.id,
        sweepLabel:      state.sweep.label,
        sweepDescription: state.sweep.description,
        sweepScope:      state.sweep.scope,
        timestamp:       new Date().toISOString(),
        agentsActivated: [],
        durationMs,
        status:          'success' as const,
        projectIds:       result.projectIds ?? [],
      });

      if (result.acted > 0 || process.env.LOG_LEVEL === 'debug') {
        console.log(
          `[heartbeat] ${state.sweep.id} — acted=${result.acted} errors=${result.errors} (${durationMs}ms)` +
          (result.details ? ` ${result.details}` : ''),
        );
      }
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);
      state.lastError = errorMsg;
      this.lastError = `${state.sweep.id}: ${errorMsg}`;

      console.error(`[heartbeat] sweep ${state.sweep.id} threw:`, err);

      eventBus.emitHeartbeatEvent('heartbeat.sweep.error', {
        sweepId: state.sweep.id,
        error: errorMsg,
        durationMs,
      });

      // W25: also emit a sweep.tick with status=error so the timeline shows
      // a red pulse on the relevant lane.
      eventBus.emitHeartbeatEvent('sweep.tick', {
        sweepName:       state.sweep.id,
        sweepLabel:      state.sweep.label,
        sweepDescription: state.sweep.description,
        sweepScope:      state.sweep.scope,
        timestamp:       new Date().toISOString(),
        agentsActivated: [],
        durationMs,
        status:          'error' as const,
      });
    }
  }
}

/** Singleton instance wired up in index.ts. */
export const heartbeat = new Heartbeat();
