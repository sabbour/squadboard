/**
 * services/heartbeat.ts — Wave 10 B3
 *
 * Thin "service" layer over the existing engine/heartbeat sweep registry.
 *
 * Responsibilities:
 *  - Subscribe to `eventBus.onHeartbeat` and persist a bounded in-memory ring
 *    buffer of recent sweep results (completed + errored) so the Heartbeat
 *    page can render a feed of "Sweeps acted on" without polling per-sweep
 *    detail endpoints.
 *  - Provide a `getRecentSweeps({ since })` accessor used by
 *    GET /api/heartbeat/sweeps.
 *  - Provide a `getSnapshot()` helper that combines the registry status with
 *    last-error + ring-buffer summaries used by GET /api/heartbeat/status.
 *
 * The actual sweep scheduling lives in `engine/heartbeat.ts`. We do not
 * re-implement it here; we wrap it. This file is also crash-safe on a fresh
 * install: it touches no database, so it works before any project rows exist.
 */

import { eventBus } from '../realtime/event-bus.js';
import { heartbeat } from '../engine/heartbeat.js';
import type { SweepResult } from '../engine/heartbeat.js';

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

const RING_CAPACITY = 200;

export interface SweepEvent {
  /** Monotonic increment for stable client cursoring. */
  seq:        number;
  ts:         string;          // ISO timestamp
  sweepId:    string;
  outcome:    'completed' | 'error';
  durationMs: number;
  result?:    SweepResult;     // present when outcome === 'completed'
  error?:     string;          // present when outcome === 'error'
}

let nextSeq = 1;
const ring: SweepEvent[] = [];

function push(evt: SweepEvent): void {
  ring.push(evt);
  if (ring.length > RING_CAPACITY) ring.shift();
}

// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------

export interface RecentSweepsQuery {
  /** Return only entries with `seq > since`. Defaults to all. */
  since?: number;
  /** Cap the number of returned entries (most recent first). */
  limit?: number;
  /** When set, only hide events that explicitly report other project ids. */
  projectId?: string;
}

export function getRecentSweeps(query: RecentSweepsQuery = {}): {
  sweeps:    SweepEvent[];
  cursor:    number; // largest seq currently in the buffer
  capacity:  number;
} {
  const since = query.since ?? 0;
  const limit = query.limit ?? RING_CAPACITY;
  const filtered = ring
    .filter((e) => e.seq > since)
    .filter((e) => {
      if (!query.projectId) return true;
      const projectIds = e.result?.projectIds;
      return !projectIds?.length || projectIds.includes(query.projectId);
    })
    .slice(-limit);
  const cursor = ring.length > 0 ? ring[ring.length - 1].seq : 0;
  return { sweeps: filtered, cursor, capacity: RING_CAPACITY };
}

export interface HeartbeatSnapshot {
  active:     boolean;       // service is running (sweeps registered + scheduled)
  lastTickAt: string | null;
  lastError:  string | null;
  sweeps:     ReturnType<typeof heartbeat.getStatus>['sweeps'];
  recent: {
    sweeps:   SweepEvent[];
    cursor:   number;
    capacity: number;
  };
}

export function getHeartbeatSnapshot(projectId?: string): HeartbeatSnapshot {
  const status = heartbeat.getStatus();
  // The sweep registry currently has no public `running` accessor; infer it
  // from the presence of any registered sweeps that have a `nextRunAt` (set
  // only after start() schedules them).
  const active = status.sweeps.some((s) => Boolean(s.nextRunAt));
  return {
    active,
    lastTickAt: status.lastTickAt ?? null,
    lastError:  status.lastError ?? null,
    sweeps:     status.sweeps,
    recent:     getRecentSweeps({ limit: 50, projectId }),
  };
}

// ---------------------------------------------------------------------------
// Wire eventBus.onHeartbeat into the ring buffer.
//
// The subscribe call is idempotent at module-evaluation time: the module is a
// singleton, so the listener is attached exactly once for the process. This
// must run before heartbeat.start() so we don't miss the first sweep ticks.
// ---------------------------------------------------------------------------

let subscribed = false;
let _unsubscribe: (() => void) | null = null;

export function startHeartbeatHistory(): void {
  if (subscribed) return;
  subscribed = true;
  _unsubscribe = eventBus.onHeartbeat((evt) => {
    // W27 Bug 1: Only persist heartbeat.sweep.completed / heartbeat.sweep.error.
    // sweep.tick is a transient WS-only event for the SweepTimeline animation;
    // it uses a different schema (sweepName/status) and must NOT enter the ring
    // buffer. Letting it through caused phantom "unknown error" rows because the
    // client reads sweepId (undefined) and outcome falls through to 'error'.
    if (evt.type !== 'heartbeat.sweep.completed' && evt.type !== 'heartbeat.sweep.error') {
      return;
    }
    try {
      const payload = evt.payload as {
        sweepId:    string;
        durationMs: number;
        result?:    SweepResult;
        error?:     string;
      };
      const base: SweepEvent = {
        seq:        nextSeq++,
        ts:         new Date().toISOString(),
        sweepId:    payload.sweepId,
        outcome:    evt.type === 'heartbeat.sweep.completed' ? 'completed' : 'error',
        durationMs: payload.durationMs,
      };
      if (evt.type === 'heartbeat.sweep.completed') {
        base.result = payload.result;
      } else {
        base.error = payload.error ?? 'unknown error';
      }
      push(base);
    } catch (err) {
      // Never let history bookkeeping take down the heartbeat itself.
      console.error('[heartbeat-history] failed to record sweep event:', err);
    }
  });
}

// Auto-start on module import. Cheap (one event-bus subscription) and
// guarantees we don't miss sweeps if a caller forgets to call this.
startHeartbeatHistory();

// ---------------------------------------------------------------------------
// Test escape hatch — do NOT call outside of vitest.
// Resets the ring buffer + seq counter + subscribed flag so unit tests can
// start from a clean slate without re-requiring the whole module.
// ---------------------------------------------------------------------------

/** @internal vitest only — resets module-level ring-buffer state. */
export function _resetHeartbeatServiceState(): void {
  ring.length = 0;
  nextSeq = 1;
  // Detach the current listener so the next startHeartbeatHistory() call
  // registers a fresh one (prevents accumulating duplicate listeners in tests).
  if (_unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
  subscribed = false;
}
