# Verbal W25 — Sweep Animation Visualisation

**Author:** Verbal (Backend Dev / real-time / WebSocket specialist)
**Date:** 2026-05-16
**Commit:** `2fc72086`
**Status:** Shipped

---

## Decision

Heartbeat sweeps now broadcast a `sweep.tick` event over the existing
WebSocket infrastructure on every completion (success + error). A new
`SweepTimeline` React component subscribes to this channel and renders
animated pulses on a per-sweep horizontal lane. Mounted on both the
Heartbeat page (full mode) and the Now page (compact mode).

## Why

Heartbeat sweeps were a black box — operators had to refresh the
Heartbeat page (polling every 5s) and read a text log to know what
fired and when. There was no sense of liveness or cadence at a glance.

This change makes the heartbeat **visibly alive**: you can see ceremonies
firing every 5s, presence sweeps every 30s, and GitHub catch-up sweeps
every minute as pulses sliding from right to left across their lane.
On the Now page (operator's home screen) the compact mode shows the
4 most critical sweeps without taking much space.

## What changed

### Server

| File | Change |
|---|---|
| `packages/server/src/realtime/event-bus.ts` | extends `HeartbeatEventType` with `'sweep.tick'` |
| `packages/server/src/engine/heartbeat.ts` | `_runSweep()` emits `sweep.tick` on success + error (committed in Item 1's edit) |
| `packages/server/src/realtime/ws-server.ts` | adds an `onHeartbeat` handler that fans `sweep.tick` to every `__global__` subscriber |

`sweep.completed` and `sweep.error` remain server-internal — the
in-memory ring buffer at `services/heartbeat.ts` consumes those; the
Heartbeat page polls `/api/heartbeat/sweeps` for the history list. Only
`sweep.tick` flows over WS, keeping channel volume minimal.

### Client

| File | Change |
|---|---|
| `packages/client/src/realtime/ws-client.ts` | adds `'sweep.tick'` entry to `WsEventMap` |
| `packages/client/src/components/heartbeat/SweepTimeline.tsx` | NEW — full + compact modes, 6/4 lanes, 60 s sliding window, animated pulses, Fluent2-only |
| `packages/client/src/pages/Heartbeat.tsx` | adds a fourth `SectionCard` rendering `<SweepTimeline windowSizeMs={60_000} compact={false} />` |
| `packages/client/src/pages/Now.tsx` | adds a compact card after `ProjectMiniGrid` rendering `<SweepTimeline compact />` |

## WS event extension pattern (for future agents)

Three coordinated edits are required to add a new event type that flows
to global subscribers:

1. **Server union:** add the literal to `event-bus.ts` `HeartbeatEventType`
   (or the relevant `*EventType` for project-scoped events).
2. **Server fan-out:** in `ws-server.ts`, add a branch in `onBusEvent` or
   `onHeartbeat` that forwards the payload to `globalClients` (or to the
   relevant `rooms` Set for project-scoped events).
3. **Client typing:** add an entry to `WsEventMap` in `ws-client.ts` with
   the payload shape — TypeScript then enforces correct handlers.

The compact `sweep.tick` payload (`{sweepName, timestamp, agentsActivated,
durationMs, status}`) intentionally leaves the door open for future
agent-attribution metadata (`agentsActivated`) without a breaking change.

## Sweep lane registry (must stay in sync with `index.ts`)

| ID | Compact? | Label |
|---|---|---|
| `ceremonies-due`       | ✓ | Ceremonies |
| `ready-workflow-steps` | ✓ | Workflow Steps |
| `stuck-issue-runs`     | ✓ | Stuck Runs |
| `stale-presence`       |   | Presence |
| `idle-live-sessions`   |   | Live Sessions |
| `github-sync-overdue`  | ✓ | GitHub Sync |

If a new sweep is added to `index.ts`, also add it to `ALL_SWEEPS` in
`SweepTimeline.tsx` and (optionally) `COMPACT_SWEEPS`.

## Visual design

- Each lane = a `tokens.colorNeutralBackground3` track, 10 px tall
  (7 px compact).
- Pulses = circles, `tokens.colorBrandBackground` (success) or
  `tokens.colorPaletteRedBackground3` (error), with a matching halo
  ring, 10 px (6 px compact).
- Pulse animates in via CSS keyframes (`scale 0.4 → 1.25 → 1`, 0.4 s).
- A 2 s `setInterval` re-renders so the window slides smoothly and old
  pulses get pruned.
- Tooltip on hover shows `sweepName · durationMs · status`.

## Tradeoffs

- **DOM-not-canvas.** At 6 lanes × ~12 pulses/min the dot count stays
  under 100. A canvas implementation would be needed only if we ever
  flooded the channel with thousands of pulses.
- **No persistence.** Refresh wipes the visible window. Acceptable —
  the Heartbeat page already has a historical view via
  `/api/heartbeat/sweeps`.
- **No filter / pause.** First pass; can be added if Brady wants it.

## Verification

- `pnpm -r build` → all 7 packages green
- Component renders with no console warnings
- Compact mode visibly shorter (22 px rows vs 28 px) and 4 lanes
- No emojis anywhere; only Fluent2 icons (`ArrowSync20Regular`)
- ConjureModal, Consult button, top bar, collapsed nav untouched

## Follow-ups (optional)

- Add a "Pause" toggle so operators can freeze the window while
  inspecting a specific pulse.
- Surface `agentsActivated` once Lupita's coordinator-attribution work
  lands; the payload field already exists.
- Add an integration test that boots the server, fires a sweep, asserts
  a `sweep.tick` reaches a `__global__` WS subscriber.
