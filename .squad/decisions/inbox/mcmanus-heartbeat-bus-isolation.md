# Decision: Heartbeat Bus Isolation

**Date:** 2026-05-15  
**Author:** McManus (Lead Architect)  
**Status:** Implemented

## Context

`engine/heartbeat.ts` emitted `heartbeat.sweep.completed` / `heartbeat.sweep.error`
through the shared project `EventBus` with `projectId: '__heartbeat__'` — a synthetic
server-wide sentinel. `services/ceremony-dispatcher.ts` listens to ALL events on that
bus and called `findMatchingCeremonies(event.projectId, ...)`, which passed
`'__heartbeat__'` directly to a Postgres UUID column → `22P02` error every 5 s.

## Decision: Option A — Separate `'heartbeat'` channel

`emitHeartbeatEvent()` now emits on the `'heartbeat'` EventEmitter channel instead
of the shared `'event'` channel. Use `eventBus.on('heartbeat', handler)` or the
new `eventBus.onHeartbeat(handler)` helper to subscribe.

**Why Option A over Option B:**
- Heartbeat events are server-wide infrastructure telemetry, not project events.
  Sharing the bus (even with `projectId: null`) would still require every subscriber
  to understand and guard against the null-project convention.
- The `'event'` channel contract is: every payload has a valid UUID `projectId`.
  Putting a non-UUID there violates that contract for all existing subscribers.
- No consumer was using the heartbeat bus events via WS or REST; the Heartbeat UI
  polls `GET /api/heartbeat` (reads internal state map) — no subscriber migration needed.

## Dispatcher Guard Pattern

In addition to the primary fix, `ceremony-dispatcher.ts` now has **two** defensive layers:

1. **Early type guard in `handleEvent`:** if `event.type.startsWith('heartbeat.')` → return immediately. This is belt-and-suspenders: heartbeat events no longer reach this handler via the `'event'` channel, but guards against future regressions.

2. **UUID guard in `findMatchingCeremonies`:** validates `projectId` against
   `/^[0-9a-f]{8}-...-[0-9a-f]{12}$/i` before issuing any DB query. Returns `[]`
   and logs a `debug`-level warning if the projectId is not UUID-shaped. This prevents
   ANY future synthetic sentinel (e.g. `consult:<id>`, `__global__`, etc.) from
   crashing the Postgres query.

**Rule for future contributors:** Any code that emits on the `'event'` channel MUST
supply a genuine project UUID in `projectId`. Server-wide / cross-project events
should use a separate named channel (e.g. `'heartbeat'`, `'global'`) or use
`subscribeGlobal()` on the consuming side with a UUID pre-check.
