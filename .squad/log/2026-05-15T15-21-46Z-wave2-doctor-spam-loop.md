# Session Log: Wave 2 Doctor + Spam Loop Guards

**Date:** 2026-05-15  
**Wave:** 2 (Doctor + Bug Fixes)  
**Scope:** QA investigation (4-part), Diagnostics Phase 3 (backend + frontend), Spam loop root cause + 3 defensive guards, Housekeeping (Fry archive, safeRelativeTime rollout)

---

## What Shipped ✅

### Phase 3: Diagnostics (Backend + Frontend)
- **Hockney:** `services/diagnostics.ts` + `routes/diagnostics.ts` — 8 parallel health checks, 5-second cache, `/api/diagnostics` + `/api/projects/:id/diagnostics` routes
- **Keyser:** Diagnostics UI pages (`/diagnostics`, `/diagnostics/:id`, `/heartbeat`), SYSTEM nav section, `useDiagnostics` hook auto-routing
- **Commits:** 13c34dca (Hockney swept by Keyser coordination snag), c6b5f992 (meta-record)

### Spam Loop: Confirmed Root Cause + 3 Defensive Guards
- **Verbal:** Root cause confirmed: `resolveAnchorIssue` picks most-recently-created issue, causing fan-out children to become ceremony anchors on next tick → recursive tree of grandchildren
- **Guard 1 (Dedup):** `services/issues.ts::createIssue` — check for non-archived duplicate within 60s before INSERT
- **Guard 2 (Sweep Backoff):** `services/ceremony-scheduler.ts` — loud errors + 1-hour nextFireAt backoff on ≥2 consecutive failures
- **Guard 3 (Concurrency + Title):** `engine/fan-out.ts` — `AND status = 'pending'` on step UPDATE + title compound check (prevent double-suffix)
- **Commit:** 504f4a57

### QA Investigation (4-Part Report)
- **Kujan:** Static code analysis — spam loop trajectory, fry orphan verification, formatDistanceToNow partial guard audit, WebSocket reconnect idempotency
- **Findings:** Loop driver confirmed as P0 follow-up (resolveAnchorIssue), 7 unguarded date callsites identified, Fry marked for archival
- **Commit:** a410b7f7

### Housekeeping
- **Coordinator:** Archived `.squad/agents/fry/` → `.squad/agents/_alumni/fry/` (commit c3bbd54c)
- **Fenster:** `utils/dates.ts` extraction + `safeRelativeTime` universal rollout (9 formatDistanceToNow + 4 toLocaleString callsites guarded) — commit a56bee9a

---

## What's Deferred (P0 + P1 + P2 + P3)

### P0 (Critical)
- **Fix `resolveAnchorIssue`** to exclude fan-out child issues (filter `issue_links` where `link_type = 'fan_out'`). This is the loop driver; defensive guards are stop-gaps only. Requires full workflow test coverage before deploy.

### P1 (High Priority)
- Add `UNIQUE` index on `(project_id, title)` with `WHERE archived = 0` (Drizzle migration)
- Persist ceremony-scheduler failure count to DB/Redis (restart resilience)

### P2 (Medium Priority)
- `materializeFanOut` add `child_workflow_run_ids` empty check pre-create (idempotency layer)

### P3 (Low Priority)
- `tickWorkflowAdvancement` add `FOR UPDATE SKIP LOCKED` on workflow runs (multi-instance deployment safety)

---

## Coordination Notes

**Keyser swept Hockney's server work** when both agents committed diagnostics changes in parallel (commit 13c34dca). Functional code verified OK; audit trail murky. **Action:** Future parallel sessions must use explicit `git add -- <path>` per-file to prevent unintended file sweeps. Cross-agent history updated with coordination snag note.

---

## Metrics

- **6 agents spawned** (Kujan, Hockney, Keyser, Coordinator, Fenster, Verbal)
- **6 commits** across wave 2 (a410b7f7, 13c34dca, c6b5f992, c3bbd54c, a56bee9a, 504f4a57)
- **4 inbox decisions merged** into decisions.md (kujan, hockney, keyser, verbal)
- **3 defensive guards** shipped (dedup, sweep backoff, concurrency + title)
- **1 P0 follow-up** confirmed (resolveAnchorIssue rewrite)
- **2 history.md files** updated with coordination snag (hockney, keyser)
- **1 agent archived** (Fry → _alumni/)
- **13 date callsites** hardened with safeRelativeTime/safeLocaleString

---

**Session Summary:** Diagnostics Phase 3 complete + spam loop root cause confirmed + 3 defensive guards shipped. Team coordination snag noted and mitigated. P0 loop driver fix deferred to next session (pending full test coverage). Orchestration readiness: high.
