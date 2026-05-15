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
