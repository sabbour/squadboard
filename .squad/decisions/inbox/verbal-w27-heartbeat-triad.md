# W27 Heartbeat Triad — Root Cause + Fix Summary

**Date:** 2026-05-16T03:38:30-07:00  
**Wave:** 27  
**Author:** Verbal  
**Commit:** (see below — fix(heartbeat,ws): W27 triad — phantom error rows + duplicate keys + WS proxy)

---

## Bug 1 — Phantom "unknown error" twin rows in "Sweeps acted on"

**Root cause:** `services/heartbeat.ts#startHeartbeatHistory()` subscribed to ALL heartbeat events via `eventBus.onHeartbeat()`. Both `heartbeat.sweep.completed` and `sweep.tick` went through the same handler. `sweep.tick` carries `{ sweepName, status, agentsActivated, durationMs }` — completely different from the `{ sweepId, outcome, result, error }` schema `SweepEvent` expects. So `payload.sweepId` was `undefined`, and the `outcome` fell through to `'error'` (else branch). Every sweep tick produced one valid row + one phantom "unknown error" row at the same timestamp.

**Fix:** In `startHeartbeatHistory()`, added an early-return guard: `if (evt.type !== 'heartbeat.sweep.completed' && evt.type !== 'heartbeat.sweep.error') return;`. `sweep.tick` now bypasses the ring buffer entirely — it remains a WS-only transient event for the SweepTimeline animation.

**File changed:** `packages/server/src/services/heartbeat.ts`

---

## Bug 2 — React duplicate-key warnings (seq 397, 398, 399, 400…)

**Root cause:** Same as Bug 1. Because `sweep.tick` events were entering the ring buffer, each sweep tick incremented `nextSeq` **twice** — once for the real completed/error event and once for the phantom tick entry. The client renders `<div key={e.seq}>` on the merged event list. Two ring-buffer entries sharing adjacent seqs aren't the issue; the issue was React seeing *two rows with the same effective display position*, and since merged+deduplication wasn't happening, prior seqs from old events collided in the 20-item window slice.

**Fix:** Eliminating the phantom entries (Bug 1 fix) means the seq counter only increments for `completed`/`error` events. No more paired phantom entries, no more duplicate keys.

**File changed:** `packages/server/src/services/heartbeat.ts` (same fix as Bug 1)

---

## Bug 3 — WebSocket fails to connect (ws://localhost:5173/api/ws)

**Root cause:** The Vite dev proxy had `ws: true` on the broad `/api` entry with an `http://localhost:3000` target. Vite's proxy router uses first-match ordering; because `/api` caught everything, WebSocket upgrade requests to `/api/ws` were handled by the generic HTTP proxy handler. The HTTP handler doesn't properly perform the WS handshake, so the connection was closed before it was established.

**Fix:** Extracted proxy rules to `packages/client/src/proxy-config.ts` and added a **dedicated `/api/ws` entry** before `/api`:
```ts
'/api/ws': { target: 'ws://localhost:3000', ws: true, changeOrigin: true },
'/api':    { target: 'http://localhost:3000', changeOrigin: true },
```
The more-specific `/api/ws` path now matches first and correctly upgrades the connection. The `/api` catch-all no longer carries `ws: true` (avoids double-upgrade confusion).

**Files changed:** `packages/client/vite.config.ts`, `packages/client/src/proxy-config.ts` (new)

---

## Tests added

| File | Tests | Coverage |
|---|---|---|
| `packages/server/src/__tests__/heartbeat-w27-triad.test.ts` | 7 | Bug 1: tick excluded from ring (4 cases); Bug 2: unique seq / monotonic / cursor (3 cases) |
| `packages/client/src/__tests__/vite-proxy-ws.test.ts` | 5 | Bug 3: /api/ws exists, ws:true, ws:// target, port 3000, /api no ws |

**Total new tests:** 12  
**Total after W27:** 472 (464 server + 8 client)

---

## Pattern captured for team

- **`sweep.tick` is WS-only** — it must never enter ring buffers or REST responses. Only `heartbeat.sweep.completed` / `heartbeat.sweep.error` carry the `SweepEvent` schema.
- **Vite WS proxy needs a dedicated, more-specific path entry** before the HTTP catch-all. `ws: true` on a broad path with an `http://` target silently fails WebSocket upgrades.
- **Escape hatch pattern for singleton service state in tests:** store the unsubscribe function from `onHeartbeat()` in a module-level variable; `_reset*()` calls it before resetting the `subscribed` flag, preventing listener accumulation across test cases.
