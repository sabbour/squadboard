# Verbal — Session History

**Last Updated:** 2026-05-20T13:09:21Z

## Executive Summary

Real-time networking specialist. Core focus: WebSocket architecture, presence protocol, event fan-out, authentication. Owns the event streaming layer connecting clients to server state updates. Recent major work includes authentication audit, presence protocol repair, payload limits, and project-scoped subscription validation. P0 wave (May 20) closed two critical gaps: zero-auth vulnerability on WS upgrade and completely broken presence message types.

**Key domains:**
- WebSocket server setup and upgrade path
- JWT authentication on WS connections
- Event fan-out and room-scoped subscription
- Presence protocol (cursor tracking, joined/left/updated events)
- Heartbeat/ping-pong and reconnect logic
- Payload limits and backpressure handling

**Current status:** All P0 fixes deployed. Presence is now functional. Auth is enforced on upgrade.

---

## W29 — Coordinator Caching + Strategy + Reviews

**Date:** 2026-05-16  
**Wave:** 29  
**Status:** Completed

### Contributions

**Coordinator Stack (MC-4, MC-11, MC-14)**
- **MC-4:** LRU + TTL decision cache — 128-entry capacity, 60s TTL, `hashCoordinatorInput()` deduplication. Input hash prevents spurious misses on structurally-identical differently-serialized inputs. 8 tests. Commit: `46692db7`.
- **MC-11:** Batch dispatch — `batchDispatchViaCoordinator()` atomically routes N inputs → coordinator → N decisions. Integration tests pass; fallback chain not yet wired (BUG-1 deferred to W30). Commit: `48478c513`.
- **MC-14:** Charter-identity extraction — `extractCharterIdentity(charterPath)` returns `{ name, hash }` for charter fingerprinting. Commit: `f5e9526fb`.

**Launch Reviews**
- **Security Review:** Led YELLOW verdict review; identified C-1 (credentials fallback), C-3 (prompt injection), C-4 (auth+CSRF). Deferred to W30. Commit: `55eeb7560`.

### Lessons

1. **Input deduplication via content hash is essential for caching.** Different serializations of same input (JSON key order, whitespace) prevent cache hits. Use `JSON.stringify` with sorted keys or canonical serializer.
2. **TTL + capacity tuning is wave-dependent.** 60s TTL covers wave-scope decision consistency. For cross-wave patterns, increase TTL or add warm-start cache pre-load from decisions.md.
3. **Fallback chain wiring is deferred complexity.** MC-9 supports `COORDINATOR_FALLBACK_MODELS` env but dispatch core doesn't wire it. W30 task: add try-catch loop through fallback chain.

---

## W25 Lessons — Heartbeat Config + Sweep Timeline Viz

**Date:** 2026-05-16
**Wave:** 25
**Commits:** `3583d07e` (config), `2fc72086` (viz)

### Heartbeat infrastructure file map (for future agents)

The heartbeat is split across **3 server layers** + **1 routes file**:

| Layer | Path | Purpose |
|---|---|---|
| **Engine** | `packages/server/src/engine/heartbeat.ts` | `Heartbeat` class: registry, scheduler, `register()`, `start()`, `stop()`, `tick()`, `_runSweep()`, `setSweepEnabled()`, and now `getEffectiveIntervals()`. Emits `heartbeat.sweep.completed` / `heartbeat.sweep.error` / `sweep.tick` via `eventBus.emitHeartbeatEvent()`. |
| **Engine — sweeps** | `packages/server/src/engine/sweeps/*.ts` | One file per sweep (`stuck-issue-runs`, `idle-live-sessions`, `stale-presence`, `ready-workflow-steps`, `github-sync-overdue`, `ceremonies-due`). Each exports a `Sweep` object: `{id, intervalMs, enabled, run()}`. |
| **Engine — sweeper** | `packages/server/src/engine/sweeper.ts` | Raw DB sweep helpers used by the sweep files. |
| **Service** | `packages/server/src/services/heartbeat.ts` | In-memory ring buffer + `getRecentSweeps()` + `getHeartbeatSnapshot()`. Subscribes to `eventBus.onHeartbeat` as a side-effect at import time — `index.ts` must `import './services/heartbeat.js'` BEFORE `heartbeat.start()` so the first tick is captured. |
| **Routes** | `packages/server/src/routes/heartbeat.ts` | HTTP plane: `GET /`, `/status`, `/sweeps?since=`, `POST /sweeps/:id/run`, `PATCH /sweeps/:id`, and now `GET /config`. |
| **Wiring** | `packages/server/src/index.ts` (lines ~48–170) | Imports the sweeps, calls `applyHeartbeatConfig()`, then `heartbeat.register()` 6× then `heartbeat.start()`. |
| **W25 config** | `packages/server/heartbeat.config.json` + `packages/server/src/engine/heartbeat-config.ts` | NEW — editable per-sweep overrides, loaded once at boot, applied before `register()`. |

### Sweep lane registry (must stay in sync — server `index.ts` ↔ client `SweepTimeline.tsx`)

| Sweep ID | intervalMs | Compact lane? |
|---|---|---|
| `ceremonies-due`       | 5000  | ✓ |
| `ready-workflow-steps` | 5000  | ✓ |
| `stuck-issue-runs`     | 30000 | ✓ |
| `stale-presence`       | 30000 |   |
| `idle-live-sessions`   | 60000 |   |
| `github-sync-overdue`  | 60000 | ✓ |

When adding a new sweep:
1. Create `packages/server/src/engine/sweeps/<id>.ts` exporting `Sweep`.
2. Import + `heartbeat.register()` in `index.ts`.
3. Add a row to `heartbeat.config.json` (defaults override).
4. Add an entry to `ALL_SWEEPS` in `packages/client/src/components/heartbeat/SweepTimeline.tsx` (and optionally `COMPACT_SWEEPS`).

### WS event extension pattern (used for `sweep.tick`)

Three coordinated edits to add a typed event that flows to global subscribers:

1. **Server union** — add the literal to the relevant `*EventType` in `event-bus.ts` (e.g., `HeartbeatEventType`).
2. **Server fan-out** — add a forwarder in `ws-server.ts`. For heartbeat events: subscribe via `eventBus.onHeartbeat()` (separate channel from `'event'`), filter by `evt.type`, and `send(client.ws, type, payload)` for each `globalClients` entry. For project-scoped events: they flow through `onBusEvent → broadcast(projectId, …)` automatically because they go on the `'event'` channel.
3. **Client typing** — add a key to `WsEventMap` in `ws-client.ts` so `wsClient.on('sweep.tick', handler)` is type-safe.

The cross-channel split (`'event'` vs `'heartbeat'`) is intentional: heartbeat events carry no `projectId` and would crash the room-routing logic if emitted on `'event'`. Future cross-cutting events (e.g., `daemon.tick`) should follow the same pattern — separate EventEmitter channel + dedicated `eventBus.on<Foo>()` API.

### Config-file design pattern (loader-then-applier)

The W25 `heartbeat-config.ts` shape is a reusable pattern for "user-editable JSON tunables":

1. `loadFooConfig()` — read once, cache, swallow ENOENT (silent) + parse errors (warn).
2. `applyFooConfig(targets)` — pure mutator that takes the runtime objects (sweeps, agents, whatever) and applies overrides. Logs each effective change.
3. `_resetFooConfigCache()` — underscore-prefixed test escape hatch so vitest can re-mock `node:fs.readFileSync` between cases.
4. `getEffectiveFooConfig(targets)` — snapshot for an introspection HTTP endpoint.
5. Add the JSON file to `package.json` `files` so it ships in the npm artifact.

This avoids env-var sprawl, gives operators a single source of truth, and stays out of the database.

### Animation in Fluent2 components — keyframes workaround

Fluent2's `makeStyles` does not expose `@keyframes` natively (you can use `animationName`, but defining the keyframes requires a `<style>` tag or a CSS file). For one-off pulse animations the cleanest path is:

```tsx
return (
  <div className={styles.root}>
    <style>{`@keyframes sweepPulse { ... }`}</style>
    ...
  </div>
)
```

The inline `<style>` is global once mounted; mounting the component twice doesn't double-register the keyframe (browsers dedupe by name). For >1 animation, extract to a CSS module instead.


---

## W25 Close-Out

**Date:** 2026-05-16

Shipped two W25 items:

### Item 1: Heartbeat Configurability

Per-sweep cadence config via `heartbeat.config.json` + `GET /api/heartbeat/config` endpoint + 11 vitest cases.
Brady can now tune intervalMs, scale defaults by multiplier, or disable sweeps without code changes.

**Commit:** 3583d07e

### Item 2: Sweep Animation Visualization

`SweepTimeline` component renders animated pulses on per-sweep horizontal lanes (full-width on /heartbeat, compact 4-lane on /now).
New `sweep.tick` WebSocket event broadcasts sweep completions in real-time.
Heartbeat is now visibly alive — operators can see liveness at a glance.

**Commit:** 2fc72086

See `.squad/decisions.md` for full details.

---

## W26 Lessons — Auto-assign Routing Fix + To Do Pickup Sweep

**Date:** 2026-05-16
**Wave:** 26

### Two-bug P0: "add card → run" loop broken

#### Bug A: Auto-assign to Fenster

**Root cause**: `matchRule` keyword filter was `w.length > 3`, allowing 4-char words like `"type"` and `"icon"` to match. Fenster's routing pattern `"Visual design, UX flows, color/type/icon system, empty states"` contained both, so any issue mentioning TypeScript types or icons routed to Fenster.

**Fix**: Changed filter to `w.length > 4` (min 5 chars). Also:
- `resolveRouteTier3` fallbacks now return `null` (human triage) instead of `activeAgents[0]` (arbitrary first agent).
- All agent queries in `router.ts` now include `ORDER BY name ASC` for determinism.
- MCP `handleRunAgent` without `agentId` uses least-loaded agent (subquery counting pending+running runs) instead of undefined `LIMIT 1` order.

#### Bug B: Heartbeat doesn't pick up To Do items

**Root cause**: No sweep scanned `issues` with `status='todo'` and no active `issue_run`. `claimAndRun()` only claims existing pending runs — it doesn't create them.

**Fix**: New `pickup-todos` sweep (10 s cadence) scans uncovered To Do items and creates pending `issue_run` rows using Tier-2 keyword scoring, falling back to least-loaded agent when no match.

### New sweep infrastructure map addition

| Sweep ID | intervalMs | Purpose |
|---|---|---|
| `pickup-todos` | 10000 | Dispatch unattended To Do items |

### Canonical assignment rule going forward

New items start **unassigned** unless a label or strong keyword rule matches on creation. The `pickup-todos` sweep auto-dispatches To Do items within 10 s using Tier-2 scoring or least-loaded fallback. Tier-3 LLM failures now fall through to human triage (no silent first-agent assignment).

### Test coverage

10 new vitest cases: 7 for Bug A (matchRule word-length, label/catchall unaffected) + 3 for Bug B (Tier-2 dispatch, idempotency, least-loaded fallback). 434 total tests passing.

**Decision file:** `.squad/decisions/inbox/verbal-w26-autoassign-and-heartbeat-pickup.md`

---

## W26 Learning 1: Keyword Router Length Tuning

**Date:** 2026-05-16  
**Commit:** 910cb14c

Tier-1 keyword router had `word.length > 3` filter, allowing 4-letter generics like "type", "icon", "view", "live" to participate in matching. These words are ubiquitous in codebases, causing false-positive routing to design agent (Fenster). Fix: raised threshold to `> 4` (5+ chars minimum). Keywords like "design" (6), "flows" (5), "color" (5) still participate; generics dropped. Rule: use length tuning to prune common words; test against actual routing table entries.

**Pattern:** Router keyword length thresholds must be tested against real agent patterns. 4 chars = too many false positives; 5+ is stable.

---

## W26 Learning 2: To Do Queue Without Initial Routing

**Date:** 2026-05-16  
**Commit:** 910cb14c

When Tier-1 routing fails (no label/keyword match), issues landed in To Do with no `issue_run` created. Existing "ready-workflow-steps" sweep only claimed existing pending runs, so unrouted items sat dormant forever. Solution: new `pickupTodosSweep` (10s interval) scans To Do without active runs, tries Tier-2 keyword scoring, falls back to least-loaded agent distribution. Pattern: for async queuing, separate "create run" (POST-time) from "claim and run" (sweep-time). Multiple tiers of scoring across different sweeps gives graceful degradation (Tier-1 sync → Tier-2 async → least-loaded fallback).

**Pattern:** Queue items without initial routing. Async sweeps + fallback assignment prevent data loss.

---

## W26 Learning 3: Deterministic Fallback Ordering

**Date:** 2026-05-16  
**Commit:** 910cb14c

`resolveRouteTier3` fallback picked `activeAgents[0]` (undefined order, often alphabetical luck). MCP `run_agent` with no `agentId` used `LIMIT 1` without `ORDER BY` (database randomness). Fixed by: (a) making all agent queries `ORDER BY name ASC` for determinism, (b) changing Tier-3 fallback from arbitrary pick to `null` (human triage), (c) MCP pick uses least-loaded subquery with name tiebreak. Rule: never pick arbitrarily. Explicit order BY or explicit null.

**Pattern:** Fallback agent selection must be deterministic (ORDER BY name) or explicit null (human triage). No unnamed picks.

---

## W26 Deferred to W27: Three Heartbeat Console Bugs

**Date:** 2026-05-16

Brady's screenshot revealed three bugs in the heartbeat surface:
1. Phantom "unknown error" twin rows (sweep.tick schema mismatch with sweep.completed in same buffer)
2. React duplicate-key warnings 397-400+ (two events per tick, same seq counter)
3. WS connection fails on dev (Vite proxy not forwarding ws:// upgrades)

Verbal owns all three. Routing deferred to W27; W26 closes with these noted for immediate next-wave priority.

---

## W27 Lessons — Heartbeat Console Triad Fix

**Date:** 2026-05-16T03:38:30-07:00
**Wave:** 27
**Commit:** (fix(heartbeat,ws): W27 triad — phantom error rows + duplicate keys + WS proxy)

### Three bugs, one surface, one commit

#### Bug 1: Phantom "unknown error" rows in "Sweeps acted on"

**Root cause:** `startHeartbeatHistory()` subscribed to ALL heartbeat events via `eventBus.onHeartbeat()`. `sweep.tick` has schema `{sweepName, status, agentsActivated, durationMs}` but the handler read `payload.sweepId` (undefined) and inferred `outcome = 'error'` (else branch). Result: every tick produced a phantom row alongside the real completed row.

**Fix:** Early-return guard in the `onHeartbeat` callback: skip any event type other than `heartbeat.sweep.completed` / `heartbeat.sweep.error`. `sweep.tick` stays WS-only.

**File:** `packages/server/src/services/heartbeat.ts`

#### Bug 2: React duplicate-key warnings

**Root cause:** Same as Bug 1 — the phantom entries consumed seq values, creating paired entries that caused React reconciliation collisions in the 20-item window render.

**Fix:** Resolved automatically by Bug 1 fix. No separate change needed.

#### Bug 3: WebSocket fails to connect (ws://localhost:5173/api/ws)

**Root cause:** Vite proxy had `ws: true` on the broad `/api` entry with `http://` target. First-match routing caused WebSocket upgrade requests to `/api/ws` to be handled by the HTTP catch-all, which doesn't perform the WS handshake.

**Fix:** Extracted proxy rules to `src/proxy-config.ts`. Added `/api/ws` entry with `ws://localhost:3000` target BEFORE `/api`. Removed `ws: true` from `/api`.

**Files:** `packages/client/vite.config.ts`, `packages/client/src/proxy-config.ts` (new)

### Key patterns

1. **`sweep.tick` is WS-only** — never persists to ring buffers or REST. Use `heartbeat.sweep.completed`/`heartbeat.sweep.error` for persistence.
2. **Vite WS proxy:** dedicated `/api/ws` entry must come before the HTTP `/api` catch-all; use `ws://` target for clarity.
3. **Singleton service test reset pattern:** store the `onHeartbeat()` unsubscribe fn in a module-level variable; `_reset*()` calls it before clearing `subscribed`, preventing listener stacking across test cases.

### W27 Stats
- 12 new tests (7 server + 5 client)
- 472 total tests passing (464 server + 8 client)
- `pnpm -r build` green
- W28: JIS foundation (T1,T5,T6) — issue_run_events schema + bigserial, active session registry, events query endpoint (f62e1bd6); JIS stream (T2,T3,T4) — RunningIssueSessionImpl + bridge event emission (start/turn/metric/finish or error) + steer endpoint validation (a92f6d39)

## Learnings

### 2026-05-20: Deep WebSocket & Real-time Code Review

**Findings report:** `.squad/decisions/inbox/verbal-deep-review-websocket.md`

Key learnings from the audit:

1. **Zero auth on WS upgrade.** The `WebSocketServer` constructor has no `verifyClient` callback and the `_req: IncomingMessage` is ignored. JWT validation mentioned in the PRD was never implemented. Must add before any multi-tenant deployment.

2. **Client↔Server event name drift is real.** Three event names are mismatched: client sends `type: 'presence'` but server expects `presence.cursor`; client listens for `presence.updated` but server emits `presence.moved`; client defines `run.failed`/`run.cancelled` but server only emits `run.completed`. Cursor presence is completely broken. Lesson: event name contracts must be tested end-to-end, not just typed.

3. **Reconnect cursor only covers consult sessions.** The `resubscribe` + `lastSeq` path in ws-server.ts only replays from the SSE buffer (consult events). Regular project events (issue lifecycle, run output) have zero reconnect replay. The `useRunStream` hook works around this via a 5s poll interval, but `useRealtimeBoard` has no such fallback — board clients silently miss events on disconnect.

4. **`_flowHeartbeatLastEmit` map never evicts.** The throttle map grows per-instance but entries are never removed when instances finish. Same pattern in `sse-stream.ts` where `buffers` and `seqCounters` maps grow per-session without cleanup. Both are slow leaks.

5. **No `maxPayload` on WebSocketServer.** Default is 100 MiB. Combined with no auth, this is a trivial DoS vector.

6. **WS `send()` has no backpressure.** Fire-and-forget `ws.send(JSON.stringify(...))` with no bufferedAmount check. Slow clients accumulate unbounded send buffers until the 15s ping/pong terminates them.

7. **Dead code pattern: typed-but-never-emitted events.** `presence.snapshot`, `assistant.thinking.start/stop`, `run.failed`, `run.cancelled` are all typed in `WsEventMap` with handlers registered, but the server never emits them. This happens when client-side types are written speculatively before the server surface exists.

### 2026-05-20: P0 WS auth + presence protocol fix

1. **Auth belongs on the upgrade, not the message loop.** The fix moved WS auth to `httpServer.on('upgrade')`, rejects missing/invalid tokens before `handleUpgrade()`, and carries verified claims into the connection state. `maxPayload` is capped at 64 KiB there too.
2. **JWT scope must become room scope.** Once the token yields a `projectId`, every client message that names a room/project must be checked against that single allowed project. The WS fast path cannot invent broader access than the token grants.
3. **Canonical event names must be shared, not inferred.** Presence only came back once both directions agreed on one pair: client message `presence.cursor`, server broadcast `presence.updated`. The payload also needed `projectId` on every emitted event or the client silently filtered everything out.
4. **Exclude-sender fan-out needs explicit bookkeeping.** Because presence updates travel through the in-process event bus, the sender socket has to be tracked and removed at broadcast time; comments alone do not create exclusion semantics.

---

## 2026-05-20: P0 Fix Wave Deployment

Landed 2 critical WebSocket fixes:

1. **WebSocket upgrade auth** (commit ccca60cee): Moved `/api/ws` authentication to HTTP upgrade path. Accepts JWT from `Authorization: Bearer <token>` or `?token=<token>`. Validates with same auth helper used by REST middleware. Added `maxPayload: 64 * 1024` to prevent DoS. Client now bootstraps with `?token=` when authToken is present.

2. **Presence protocol canonicalization** (commit 65dedda8f): Fixed broken presence feature. Client→server: `presence.cursor`. Server→client: `presence.updated`. Added `projectId` to all presence events. Implemented sender exclusion on fan-out. Presence now requires active subscription.

**Result:** Build ✅ Presence protocol now works end-to-end. WS is now auth-gated and payload-limited.

**Follow-up:** CI gates from Kujan have exposed no new regressions from these fixes.

