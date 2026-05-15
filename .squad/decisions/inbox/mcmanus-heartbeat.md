# McManus Decision Log — Heartbeat Sweep Registry (Phase 3)

**Date:** 2026-05-15  
**Author:** McManus (Lead Architect)  
**Commit:** feat(engine): heartbeat sweep registry replaces dispatcher tick (Phase 3)

---

## 1. Sweep Interface Shape

```typescript
interface Sweep {
  id: string;           // kebab-case identifier; used in routes + event payloads
  intervalMs: number;   // milliseconds between automatic runs
  enabled: boolean;     // runtime toggle — PATCH /api/heartbeat/sweeps/:id
  run(): Promise<SweepResult>;
}

interface SweepResult {
  acted: number;        // rows/records touched (reclaimed, marked, evicted, etc.)
  errors: number;       // sub-items that failed within this pass
  details?: string;     // optional human-readable summary for logs / UI
}
```

**Rationale:** Kept intentionally minimal. `acted` and `errors` give the UI enough signal to colour-code sweep health without forcing each sweep to emit a custom type. `details` is a free-form string rather than a typed map to avoid over-engineering at this stage.

---

## 2. Per-Sweep Intervals

| Sweep ID              | Interval | Replaces / Wraps                                              |
|-----------------------|----------|---------------------------------------------------------------|
| `stuck-issue-runs`    | 30 s     | sweepExpiredLeases + sweepOrphanedRuns + sweepExpiredStepLeases + sweepOrphanedWorkflowRuns + sweepReviewTimeouts |
| `idle-live-sessions`  | 60 s     | New — marks `active` live_sessions with no activity in 10 min as `idle` |
| `stale-presence`      | 30 s     | New — evicts in-memory presence records older than 60 s       |
| `ready-workflow-steps`|  5 s     | tickWorkflowAdvancement + claimAndRun (Stepper)               |
| `github-sync-overdue` | 60 s     | New — one-off pull for projects whose lastGithubSyncAt > 5 min ago |
| `ceremonies-due`      |  5 s     | sweepDueSchedules() from ceremony-scheduler.ts                |

**Interval rationale:**
- 5 s for the hot paths (workflow advancement, ceremonies) to match the old dispatcher cadence.
- 30 s for lease/presence cleanup — these are crash-recovery paths, not latency-sensitive.
- 60 s for idle-session and GitHub sync — both tolerate a minute of lag.

---

## 3. Dispatcher Deprecation Strategy

`dispatcher.ts` is **kept around but unused** for one release cycle. The import in `index.ts` was removed (the `dispatcher` singleton is still exported from the file but never called).  
- A `// DEPRECATED: replaced by engine/heartbeat.ts (Phase 3). Kept for one release cycle for rollback safety.` comment was added at the top of the file.  
- Rollback: revert `index.ts` to call `dispatcher.start()` / `dispatcher.stop()` instead of heartbeat — no other files need touching.  
- Planned deletion: next minor release after Phase 3 ships to production without incident.

---

## 4. EventBus Integration

Two new event types were added to `event-bus.ts`:

```typescript
type HeartbeatEventType =
  | 'heartbeat.sweep.completed'   // payload: { sweepId, result: SweepResult, durationMs }
  | 'heartbeat.sweep.error';      // payload: { sweepId, error: string, durationMs }
```

Both are emitted with `projectId = '__heartbeat__'` (a synthetic scope key) so they flow through the existing WS fan-out infrastructure without special-casing. Clients that want to observe sweep telemetry can subscribe with `{ projectId: '__heartbeat__' }`.

The approach mirrors how consult sessions use `consult:<sessionId>` as a synthetic project key — zero infrastructure changes needed.

---

## 5. Functional Completeness Note

The old dispatcher tick bundled 7 operations. The 6 new sweeps cover all 7:

| Old tick operation         | New sweep                |
|----------------------------|--------------------------|
| sweepExpiredLeases         | stuck-issue-runs (30 s)  |
| sweepOrphanedRuns          | stuck-issue-runs (30 s)  |
| sweepExpiredStepLeases     | stuck-issue-runs (30 s)  |
| sweepOrphanedWorkflowRuns  | stuck-issue-runs (30 s)  |
| sweepReviewTimeouts        | stuck-issue-runs (30 s)  |
| tickWorkflowAdvancement    | ready-workflow-steps (5 s)|
| claimAndRun (Stepper)      | ready-workflow-steps (5 s)|

No functionality was dropped.
