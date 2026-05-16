# Kujan W28 JIS Final — Decision Record

**Agent:** Kujan (client specialist)
**Wave:** W28
**Timestamp:** 2026-05-16T05:58-07:00
**Commit:** (see SHA in PR)

## Scope completed

### JIS-T9 — Watch button on running board cards
- `IssueCard.tsx`: Added `Eye20Regular` Watch button, visible only when `activeRun?.status === 'running'`
- Navigation uses `useNavigate` (react-router) → `/projects/:pid/issues/:iid/runs/:rid/live`
- Button has `data-testid="watch-run-button"` + `aria-label="Watch live run"`
- Test: `IssueCard.WatchButton.test.tsx` — 6 scenarios covering show/hide/navigation

### JIS-T10 — WS reconnect with event replay
- `useRunStream.ts` enhanced:
  - `reconnectFailuresRef` tracks consecutive `'reconnecting'` state transitions
  - After 3 WS socket failures: status → `'error'`, error message set
  - `retry()` resets counter, clears error, calls `wsClient.connect(projectId)`
  - Catch-up GET on `connected` stays as-is; GET failure keeps `'reconnecting'` (socket up, replay failed)
  - `retry()` exposed in `RunStreamResult` interface
- `LiveRunViewer.tsx`: error banner now shows Retry button wired to `retry()`
- Reconnect detection mechanism: **`wsClient.onStateChange`** (existing singleton lifecycle hook)

### JIS-T12 — Tests
- `useRunStream.test.ts`: +5 tests (T10 coverage) → total 21 tests in file
- `IssueCard.WatchButton.test.tsx`: 6 new tests
- `11-jump-into-session.spec.ts`: 5 E2E scenarios (smoke, header, steer bar, Watch button visibility, Watch button navigation with route mock)

## Decisions made

1. **3-strike counting**: Counted at the WS state level (`'reconnecting'` transitions), not at the HTTP GET level. GET failures keep `'reconnecting'` status (socket is live, data replay just failed).

2. **Catch-up GET failure**: Does NOT count toward the failure cap. The WS connection is healthy; the GET failure is a transient HTTP issue. User remains in `'reconnecting'` banner and future WS events still arrive.

3. **retry()**: Calls `wsClient.connect(projectId)` — the WS client handles the full reconnect cycle. The hook just resets its local counter.

4. **Watch button placement**: Next to RunButton in the card footer. Uses Fluent `<Button appearance="subtle" icon={<Eye20Regular />}>` — no text, icon-only, title tooltip.

## Test count
- Client unit: 93 → 111 (+18)
- E2E: +5 scenarios (11-jump-into-session.spec.ts, requires dev server)

## Limitations
- E2E tests requiring a live server (`pnpm test` from `packages/e2e`) need a running Squadboard server on `http://localhost:3000`. If unavailable, tests will timeout via Playwright config.
- The `CeremonyAudit.tsx` typecheck error is pre-existing from concurrent Keyser work (out of scope for this commit).
