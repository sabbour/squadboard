# Verbal — History

## Core Context

- **Project:** Squadboard (local-first kanban + workflow board for Squad agents)
- **Role:** Real-time / WebSocket Dev (re-roled from Interaction Dev on 2026-05-14)
- **Joined:** 2026-05-14T08:12:50.174Z

## Learnings

- **2026-05-14 Re-role + Team Expansion:** Transitioned from Interaction Dev → Real-time/WebSocket Dev for Squadboard backend. Web design project evolved to full-stack SaaS kanban app. Team expanded from 4 to 10 members: new hires Hockney (Backend API), Kobayashi (SDK), Kujan (QA), Redfoot (DevRel), plus Ralph (Coordinator) and Scribe (Logger). Focus now: WebSocket real-time sync layer for collaborative kanban board updates. Squadboard PRD 15-demo roadmap is source of truth.
- **2026-05-15 Global WS scope + cross-project aggregator (Phase 19 Now view):** Built the `/now` Uber Dashboard. Key patterns discovered / established:
  - **Global WS subscription via `projectId: '__global__'`**: The existing `subscribeRoom()` mechanism (originally added for Phase 17 consult sessions) is the right primitive for global subscriptions — it sends `{ type: 'subscribe', projectId: '__global__' }` and the server routes that to its `globalClients` set. No new protocol message type needed.
  - **`eventBus.subscribeGlobal(handler)`**: A typed convenience wrapper around `eventBus.on('event', handler)` that returns an unsubscribe function. Useful for server-side code (e.g., future analytics services) that needs to tap the full event stream without direct EventEmitter API.
  - **Cross-project aggregator pattern**: Three raw SQL queries (via `getPool()`) with JOINs to `projects` give us `projectName` in a single roundtrip each. Drizzle is great for simple queries but raw SQL is cleaner when joining 3–4 tables with optional relations (nullable `workflowVersionId`). Timestamps always serialized via `.toISOString()` regardless of Hockney's schema-level fix status.
  - **`safeRelativeTime` guard**: Copied from `RoutingLogTable.tsx` into `Now.tsx` (not extracted to a shared util yet — wait until a 3rd consumer appears before extracting).
  - **Click-row navigation conventions**: Live session → `/projects/:id/sessions/:sessionId`; issue run → `/projects/:id/board?focus=:issueId`; workflow run → `/projects/:id/flow?run=:runId`. Consistent with how the Dashboard's Phase 12 Now section links to the flow board.
  - **`useNowFeed` fusion pattern**: `useQuery` with `refetchInterval: 15_000` as safety net + `useEffect` subscribing to `NOW_TRIGGER_EVENTS` (session.started/completed/error, run.started/completed, workflow.advanced) that invalidate the query cache. Full invalidate (not surgical cache update) is correct here: the feed covers all projects so surgical update would require per-event projectId routing which adds complexity without meaningful latency improvement for this use case.

## Recent team activity

New decisions merged to `.squad/decisions.md`:
- Demo 9 open question #2: `request_changes_policy` default is `'first'` (Hockney)
- Demo 12 open question #6: Optimistic concurrency for concurrent issue edits (Verbal)
- Demo 15 open question #8: GitHub issue mirroring OFF by default, opt-in per project (Hockney)

See `.squad/decisions.md` for full details.

Multi-agent fanout session completed 2026-05-15T12:35:00Z:
- 5 agents shipped (2 keyser rounds, mcmanus, hockney, verbal)
- 5 commits landed (42c120a0, d74c9622, d7cc2ada, 4d9fb813, base a97e2bce)
- 2 agents in flight (fenster, kobayashi)

Session log: `.squad/log/2026-05-15T12:35:00Z-squad-fanout.md`


## Recent team activity

**2026-05-15 Spam-loop investigation + defensive fixes (autopilot):** Investigated runaway `createIssue` producing progressively-compounded titles (`Foo — verbal — verbal — fenster`). Found **two compounding vectors**:
1. **`resolveAnchorIssue` (ceremony-scheduler.ts line 131)** uses `ORDER BY created_at DESC LIMIT 1` — it picks the newest issue in the project, which is the just-created fan-out child. Every subsequent ceremony tick runs a new workflow for a child, fanning it out again. **This is the primary loop driver.**
2. **No `AND status = 'pending'` guard** on the `UPDATE step_runs SET status = 'splitting'` inside `materializeFanOut`'s raw SQL transaction — concurrent dispatcher ticks can both claim the same step and each create a full set of child issues.
Shipped three defensive guards: (a) `createIssue` 60-s dedup check, (b) ceremony-scheduler loud errors + 1-h backoff on repeated failure, (c) fan-out concurrency guard (`rowCount=0` bail) + title compound guard (suffix check before appending label). Follow-up P0: fix `resolveAnchorIssue` to exclude `fan_out` child issues. See `.squad/decisions/inbox/verbal-spam-loop-rootcause.md`.

**2026-05-15T15:21:46Z — P0 follow-up tracked: resolveAnchorIssue root-cause fix**

The spam loop defensive guards shipped (3 guards: dedup, sweep backoff, concurrency + title) are stop-gaps. The actual loop driver is `resolveAnchorIssue` in `ceremony-scheduler.ts` (line 131), which picks the most-recently-created issue as the ceremony's anchor. After fan-out materializes children (e.g., `Foo — verbal`), that child becomes the newest issue. On the next cron tick, a new ceremony run anchors to the child, which itself fans out again, creating grandchildren (`Foo — verbal — verbal`). **P0 Fix:** Exclude fan-out child issues from anchor selection by filtering `NOT EXISTS (SELECT 1 FROM issue_links WHERE child_issue_id = issues.id AND link_type = 'fan_out')`. This fix is deferred to next session pending full workflow test coverage (to prevent false negatives). Root cause analysis and defensive guards documented in `.squad/decisions.md` under "spam loop — confirmed root cause" entry. Owners: Verbal (P0 fix investigation) + Kujan (durability test coverage).


---

## 2026-05-15T08:21:46.164-07:00 — p5-consult: Consult events wired into live session stream

**Task:** Wire `@bradygaster/squad-sdk/sharing/consult` SDK events into the live session stream so consult requests/responses flow as session events and render inline in AgentActivityFeed.

**Files changed:**
- `packages/server/src/realtime/event-bus.ts` — added `consult.request`, `consult.response`, `consult.error` to `SessionEventType`
- `packages/server/src/sdk/squad-stream.ts` — added `onConsultRequest()`, `onConsultResponse()` handlers; expanded `publish()` type union; registered SDK listeners in `attachListeners()`
- `packages/client/src/api/sessions.ts` — added three new event types to `LiveSessionEvent.type` union
- `packages/client/src/components/sessions/AgentActivityFeed.tsx` — added `ConsultRow` component + rendering branches for all three event types

**Decision record:** `.squad/decisions/inbox/verbal-consult-stream-wiring.md`

**Outcome:** SDK notes — `sharing/consult.d.ts` doesn't exist in SDK 0.9.4; wiring is forward-compatible. TypeScript clean on both packages (3 pre-existing server errors in McManus's heartbeat/sweeps territory untouched).

## Team update (2026-05-15T16:09:55Z — Wave 3)

Consult stream wiring (r2, commit 546081cb): 3 SessionEventType events (consult.request/response/error) now emit on existing `'event'` channel with standard routing via emitSessionEvent(). SDK listeners registered in squad-stream.ts with flexible fallback key sequences; forward-compatible for SDK evolution. AgentActivityFeed renders consult rows inline (left/right aligned, 💬?/💬↩/💬⚠ icons). Pattern: consult event types in Phase 5 live session are distinct from Phase 17 standalone consult mode (which uses consult:<sessionId> routing).

---

## Wave 14 — q7-coordinator-server-agent queued

**Date:** 2026-05-15T22:14:50-07:00  
**Spawned by:** Copilot Coordinator  
**Task:** q7-coordinator-server-agent  

Dispatched in Wave 14: Standalone coordinator daemon. Q6=B (autonomous daemon model) now ratified. Daemon will:
- Schedule ceremony cadence (cron-like)
- Invoke ceremonies via Scribe SDK
- Commit/push outputs
- Detect standalone-only conditions (avoid double-fire with CLI)

Manual override button (q9) will be built on top as Wave 15 follow-up.

