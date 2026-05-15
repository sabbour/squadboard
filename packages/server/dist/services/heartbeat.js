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
// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------
const RING_CAPACITY = 200;
let nextSeq = 1;
const ring = [];
function push(evt) {
    ring.push(evt);
    if (ring.length > RING_CAPACITY)
        ring.shift();
}
export function getRecentSweeps(query = {}) {
    const since = query.since ?? 0;
    const limit = query.limit ?? RING_CAPACITY;
    const filtered = ring.filter((e) => e.seq > since).slice(-limit);
    const cursor = ring.length > 0 ? ring[ring.length - 1].seq : 0;
    return { sweeps: filtered, cursor, capacity: RING_CAPACITY };
}
export function getHeartbeatSnapshot() {
    const status = heartbeat.getStatus();
    // The sweep registry currently has no public `running` accessor; infer it
    // from the presence of any registered sweeps that have a `nextRunAt` (set
    // only after start() schedules them).
    const active = status.sweeps.some((s) => Boolean(s.nextRunAt));
    return {
        active,
        lastTickAt: status.lastTickAt ?? null,
        lastError: status.lastError ?? null,
        sweeps: status.sweeps,
        recent: getRecentSweeps({ limit: 50 }),
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
export function startHeartbeatHistory() {
    if (subscribed)
        return;
    subscribed = true;
    eventBus.onHeartbeat((evt) => {
        try {
            const payload = evt.payload;
            const base = {
                seq: nextSeq++,
                ts: new Date().toISOString(),
                sweepId: payload.sweepId,
                outcome: evt.type === 'heartbeat.sweep.completed' ? 'completed' : 'error',
                durationMs: payload.durationMs,
            };
            if (evt.type === 'heartbeat.sweep.completed') {
                base.result = payload.result;
            }
            else {
                base.error = payload.error ?? 'unknown error';
            }
            push(base);
        }
        catch (err) {
            // Never let history bookkeeping take down the heartbeat itself.
            console.error('[heartbeat-history] failed to record sweep event:', err);
        }
    });
}
// Auto-start on module import. Cheap (one event-bus subscription) and
// guarantees we don't miss sweeps if a caller forgets to call this.
startHeartbeatHistory();
//# sourceMappingURL=heartbeat.js.map