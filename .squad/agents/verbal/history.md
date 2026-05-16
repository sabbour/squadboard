## W22 Lesson — Classifier Extension Pattern

**Date:** 2026-05-16  
**Wave:** 22

Classifier extension pattern from Verbal-w22:

1. **Define canonical enum** of all intents. Start with existing 6, add new 4 (ceremony, mcp-server, inbox-item, consult). Use a const array as the source of truth: `export const ALL_INTENTS = ['project', 'issue', ...] as const`

2. **Implement rule-based scorer** for each intent. Give each intent a heuristic weight (4–5 for strong signals, 2–3 for weak). Fast-path fires when confidence ≥ 0.55 (CONFIDENCE_THRESHOLD).

3. **Implement LLM fallback** that returns top-3 candidates with confidence + reason + draft. If LLM returns legacy single-intent format, complement with rule-based runners-up (up to 3 total).

4. **Backward-compat field aliasing:** Accept both `prose` (preferred) and `prompt` (deprecated alias). Prefer `prose` when both sent. Accept both flat (`projectId`, `projectName`, `knownProjectNames`, `hint`) and nested (`context: { currentProjectId, currentProjectName }`) request shapes; flat takes precedence.

5. **Test coverage must span:** heuristic fast-path (all intents), LLM happy path (top-3 parsing), LLM degradation (legacy single-intent), backward-compat aliases, edge cases (ambiguous prompts, no matches, etc).

**Result for W22:** 56 tests, all passing. Coexistence of Keyser-w22's modal works seamlessly; modal automatically uses `candidates` array when present, gracefully falls back if not.


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
