/**
 * log-monitor.ts — Hockney plan implementation
 *
 * In-process error registry that captures structured error signals from sweeps,
 * sweeper calls, and process handlers. Maps signals to a bounded set of safe,
 * idempotent repair actions. Does NOT mutate filesystem, schema, or external services.
 *
 * Repair boundary:
 *   - May call heartbeat.setSweepEnabled(id, false) only for allowlisted,
 *     non-critical diagnostics sweeps.
 *   - Core workflow, lease, pickup, sync, and ceremony sweeps are advisory only.
 *   - No filesystem, schema, workspace, or external-service mutation happens here.
 *
 * Usage:
 *   logMonitor.ingest('sweep:stuck-issue-runs', errorMsg, { sweepId: 'stuck-issue-runs' });
 *   logMonitor.drain();  // called by log-monitor sweep
 *   logMonitor.getState();  // used by GET /api/diagnostics/log-monitor
 */

export type ErrorClass =
  | 'pglite-oid-stale'
  | 'stale-run-reclaim'
  | 'step-retry-exhausted'
  | 'agent-sync-charter-warn'
  | 'sweep-consecutive-fail'
  | 'orphan-heartbeat';

export interface LogEvent {
  source: string;
  errorClass: ErrorClass;
  message: string;
  context?: Record<string, string | number>;
  timestamp: Date;
}

export interface PendingFix {
  errorClass: ErrorClass;
  action: string;
  context?: Record<string, string | number>;
  enqueuedAt: Date;
}

export interface AppliedFix {
  errorClass: ErrorClass;
  action: string;
  appliedAt: Date;
  context?: Record<string, string | number>;
}

// ─── Classification rules ─────────────────────────────────────────────────────

const CLASSIFICATION_RULES: Array<{ pattern: RegExp; errorClass: ErrorClass }> = [
  { pattern: /could not open relation with OID/i,          errorClass: 'pglite-oid-stale'         },
  { pattern: /reclaimed \d+ expired lease/i,               errorClass: 'stale-run-reclaim'        },
  { pattern: /orphaned \d+ issue_run/i,                    errorClass: 'orphan-heartbeat'         },
  { pattern: /exhausted retries/i,                         errorClass: 'step-retry-exhausted'     },
  { pattern: /Could not read charter\.md for/i,            errorClass: 'agent-sync-charter-warn'  },
  // sweep-consecutive-fail is detected programmatically, not by pattern
];

function classify(message: string): ErrorClass | null {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(message)) return rule.errorClass;
  }
  return null;
}

// ─── Rate limiter for noisy repeated events ───────────────────────────────────

interface RateEntry {
  count: number;
  windowStart: Date;
  suppressedCount: number;
}

// ─── Consecutive-failure tracker (per sweep) ──────────────────────────────────

interface FailureEntry {
  count: number;
  windowStart: Date;
  reported: boolean;
}

const CONSECUTIVE_FAIL_THRESHOLD = 3;
const CONSECUTIVE_FAIL_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SAFE_AUTO_DISABLE_SWEEP_IDS = new Set(['ralph-monitor', 'log-monitor']);

// ─── Rate limit for agent-sync-charter-warn suppression ──────────────────────

const RATE_LIMIT_WINDOW_MS    = 60_000; // 1 minute
const RATE_LIMIT_LOG_THRESHOLD = 3;     // log once per source per window after N occurrences

// ─── LogMonitor class ─────────────────────────────────────────────────────────

export class LogMonitor {
  private readonly events: LogEvent[] = [];
  private readonly pendingFixes: PendingFix[] = [];
  private readonly appliedFixes: AppliedFix[] = [];

  /** Per-source rate-limit tracking for repeated noisy warns. */
  private readonly rateLimitMap = new Map<string, RateEntry>();

  /** Per-sweep consecutive-failure tracking. */
  private readonly failureMap = new Map<string, FailureEntry>();

  /** Maximum number of events retained in memory. */
  private readonly maxEvents = 500;

  /**
   * Ingest an error or warning message from a source.
   * Classifies the message, records the event, and enqueues safe auto-fixes.
   */
  ingest(
    source: string,
    message: string,
    context?: Record<string, string | number>,
  ): void {
    const errorClass = classify(message);
    if (!errorClass) return;

    // Rate-limit noisy agent-sync charter warnings
    if (errorClass === 'agent-sync-charter-warn') {
      if (this._isRateLimited(source)) return;
    }

    const event: LogEvent = {
      source,
      errorClass,
      message: message.slice(0, 500), // cap message length
      context,
      timestamp: new Date(),
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    console.log(
      `[log-monitor] classified ${errorClass} from ${source}: ${message.slice(0, 120)}`,
    );

    this._enqueueAutoFix(errorClass, source, context);
  }

  /**
   * Record a sweep failure occurrence for a specific sweep ID.
   * Called from the eventBus `heartbeat.sweep.error` handler.
   * Enqueues a sweep-disable fix only when an allowlisted non-critical sweep
   * crosses the threshold; core sweeps emit advisory events only.
   */
  recordSweepFailure(sweepId: string): void {
    const now = new Date();
    let entry = this.failureMap.get(sweepId);

    if (!entry || now.getTime() - entry.windowStart.getTime() > CONSECUTIVE_FAIL_WINDOW_MS) {
      entry = { count: 0, windowStart: now, reported: false };
      this.failureMap.set(sweepId, entry);
    }

    entry.count++;

    if (entry.count >= CONSECUTIVE_FAIL_THRESHOLD && !entry.reported) {
      entry.reported = true;
      const autoFixAllowed = SAFE_AUTO_DISABLE_SWEEP_IDS.has(sweepId);
      const event: LogEvent = {
        source: `sweep:${sweepId}`,
        errorClass: 'sweep-consecutive-fail',
        message: autoFixAllowed
          ? `Optional sweep '${sweepId}' failed ${entry.count} times in ${CONSECUTIVE_FAIL_WINDOW_MS / 60000} min window; safe auto-disable queued`
          : `Core sweep '${sweepId}' failed ${entry.count} times in ${CONSECUTIVE_FAIL_WINDOW_MS / 60000} min window; advisory only`,
        context: {
          sweepId,
          failureCount: entry.count,
          autoFixAllowed: autoFixAllowed ? 1 : 0,
        },
        timestamp: now,
      };
      this.events.push(event);
      if (this.events.length > this.maxEvents) this.events.shift();

      if (autoFixAllowed) {
        this.pendingFixes.push({
          errorClass: 'sweep-consecutive-fail',
          action: `disable non-critical sweep '${sweepId}'`,
          context: { sweepId, failureCount: entry.count, autoFixAllowed: 1 },
          enqueuedAt: now,
        });

        console.log(
          `[log-monitor] safe-autofix queued: optional sweep '${sweepId}' failed ` +
          `${entry.count} times in ${CONSECUTIVE_FAIL_WINDOW_MS / 60000} min`,
        );
      } else {
        console.warn(
          `[log-monitor] advisory only: core sweep '${sweepId}' failed ` +
          `${entry.count} times in ${CONSECUTIVE_FAIL_WINDOW_MS / 60000} min; not auto-disabling`,
        );
      }
    }
  }

  /**
   * Drain: apply queued safe repairs.
   * Called periodically by the log-monitor sweep.
   * Returns the number of fixes applied.
   */
  async drain(opts?: { setSweepEnabled?: (id: string, enabled: boolean) => void }): Promise<number> {
    if (this.pendingFixes.length === 0) return 0;

    let applied = 0;
    const toApply = this.pendingFixes.splice(0);

    for (const fix of toApply) {
      if (fix.errorClass === 'sweep-consecutive-fail') {
        const sweepId = fix.context?.['sweepId'];
        if (typeof sweepId === 'string' && opts?.setSweepEnabled) {
          if (!SAFE_AUTO_DISABLE_SWEEP_IDS.has(sweepId)) {
            console.warn(
              `[log-monitor] refused unsafe autofix for core sweep '${sweepId}'; leaving advisory only`,
            );
            continue;
          }
          try {
            opts.setSweepEnabled(sweepId, false);
            const appliedFix: AppliedFix = {
              errorClass: fix.errorClass,
              action: fix.action,
              appliedAt: new Date(),
              context: fix.context,
            };
            this.appliedFixes.push(appliedFix);
            applied++;
            console.log(
              `[log-monitor] autofix applied: sweep-consecutive-fail → disable '${sweepId}'`,
            );
          } catch (err) {
            console.warn(
              `[log-monitor] autofix failed for sweep-consecutive-fail (sweep '${sweepId}'):`,
              err instanceof Error ? err.message : String(err),
            );
            // Re-enqueue so it is retried next drain cycle
            this.pendingFixes.push(fix);
          }
        } else {
          // setSweepEnabled not wired yet (e.g., during tests) — re-enqueue
          this.pendingFixes.push(fix);
        }
      }
      // Other error classes: advisory only, no action needed
    }

    return applied;
  }

  /**
   * Returns the current state for GET /api/diagnostics/log-monitor.
   */
  getState(): {
    events: LogEvent[];
    pendingFixes: PendingFix[];
    appliedFixes: AppliedFix[];
    safeAutoDisableSweepIds: string[];
  } {
    return {
      events: [...this.events],
      pendingFixes: [...this.pendingFixes],
      appliedFixes: [...this.appliedFixes],
      safeAutoDisableSweepIds: [...SAFE_AUTO_DISABLE_SWEEP_IDS],
    };
  }

  /**
   * Test-only: reset all in-memory state.
   */
  resetForTest(): void {
    this.events.length = 0;
    this.pendingFixes.length = 0;
    this.appliedFixes.length = 0;
    this.rateLimitMap.clear();
    this.failureMap.clear();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _isRateLimited(source: string): boolean {
    const now = Date.now();
    let entry = this.rateLimitMap.get(source);

    if (!entry || now - entry.windowStart.getTime() > RATE_LIMIT_WINDOW_MS) {
      entry = { count: 0, windowStart: new Date(), suppressedCount: 0 };
      this.rateLimitMap.set(source, entry);
    }

    entry.count++;

    if (entry.count > RATE_LIMIT_LOG_THRESHOLD) {
      entry.suppressedCount++;
      if (entry.suppressedCount === 1) {
        // Log once that we're now suppressing
        console.log(
          `[log-monitor] advisory: agent-sync-charter-warn rate-limited for '${source}' ` +
          `(>${RATE_LIMIT_LOG_THRESHOLD} occurrences in ${RATE_LIMIT_WINDOW_MS / 1000}s window)`,
        );
      }
      return true;
    }

    return false;
  }

  private _enqueueAutoFix(
    errorClass: ErrorClass,
    _source: string,
    context?: Record<string, string | number>,
  ): void {
    // Most error classes are advisory-only. Only sweep-consecutive-fail has an auto-fix,
    // and that is handled via recordSweepFailure() (programmatic, not pattern-based).
    // pglite-oid-stale is already handled at the call site via withPgliteOidRetry.
    // All others: log only, no enqueued action.
    void errorClass;
    void context;
  }
}

/** Singleton instance wired up in index.ts. */
export const logMonitor = new LogMonitor();
