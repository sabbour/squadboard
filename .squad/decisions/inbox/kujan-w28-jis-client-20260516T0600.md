# Wave 28 JIS Client — useRunStream + LiveRunViewer

**Author:** Kujan (client specialist)
**Date:** 2026-05-16T06:00:00-07:00
**Wave:** W28
**Todos closed:** JIS-T7, JIS-T8

---

## Decision Summary

Shipped `useRunStream` hook and `LiveRunViewer` component as a single coherent commit.

---

## Key Findings

### WS Room Key — Surprising

The spec suggested the room key might be `issue-run:{runId}`. **It is not.**

`eventBus.emitIssueRunEvent(type, projectId, payload)` routes `issue.run.*` events via the **projectId** room — same room as board/issue/run events. There is no dedicated per-run room. The client hook filters by `payload.runId === runId` at the handler level.

**Implication:** A client subscribed to a project room receives all `issue.run.*` events for that project. This is fine for single-run viewer pages. If N viewers for N runs are ever open simultaneously, all will receive all events and filter locally — a non-issue at hacking-phase scale.

**No action required now.** If per-run isolation becomes necessary (e.g., N concurrent viewers under high event rate), the server can introduce a `issue-run:{runId}` room key via a `subscribeRoom` pattern identical to `consult:{sessionId}`.

---

## WsEventMap Additions

Added 9 typed event shapes to `WsEventMap` in `ws-client.ts`:

```
issue.run.start      | { runId, seq, agentName?, model? }
issue.run.turn       | { runId, seq, role?, content? }
issue.run.token      | { runId, seq, inputTokens?, outputTokens?, model?, cost? }
issue.run.tool_call  | { runId, seq, toolName?, args? }
issue.run.tool_result| { runId, seq, toolName?, result? }
issue.run.metric     | { runId, seq, [key: string]: unknown }
issue.run.finish     | { runId, seq, durationMs?, outputSummary? }
issue.run.error      | { runId, seq, message? }
issue.run.steered    | { runId, seq, message, actor }
```

---

## Files Changed

- `packages/client/src/realtime/ws-client.ts` — added 9 `issue.run.*` types to `WsEventMap`
- `packages/client/src/hooks/useRunStream.ts` — NEW hook (T7)
- `packages/client/src/hooks/__tests__/useRunStream.test.ts` — NEW 16 tests
- `packages/client/src/components/runs/LiveRunViewer.tsx` — NEW component (T8)
- `packages/client/src/components/runs/__tests__/LiveRunViewer.test.tsx` — NEW 18 tests
- `packages/client/src/App.tsx` — added route `/projects/:projectId/issues/:issueId/runs/:runId/live`

---

## Test Delta

| Suite | Before | After |
|---|---|---|
| useRunStream | — | +16 |
| LiveRunViewer | — | +18 |
| Total | 53 | 92 (87 mine pass; 5 pre-existing Jude failures unchanged) |

---

## Reconnect Seam (T10 note)

`useRunStream` already handles the reconnect path:
1. On `wsClient` state → `reconnecting`: sets `status = 'reconnecting'`
2. On `wsClient` state → `connected` (from reconnecting): fetches `since_seq=lastSeq`
3. Deduplicates by `(eventType, seq)` key before appending

T10 can polish the UX (retry button, backoff indicator) without touching the data layer.
