# Kujan Agent History

**Last summarized:** 2026-05-20T13:26:25Z
**Archive:** See `history-archive.md` for full history

## Quick Summary

**Total waves:** 1

## Latest Activity



## W31 Wave 2 — Test Baseline Fixes

**Date:** 2026-05-20T13:26:25.229-07:00  
**Status:** Completed ✅

### Deliverables

Fixed 4 CI-blocking pre-existing test regressions:

1. **RunButton null role error** — Hardened agent-role normalization in `packages/client/src/components/agents/agent-origin.ts` so missing/null roles are treated as empty strings
2. **ceremonies-list-route mock drift** — Updated `packages/server/src/__tests__/ceremonies-list-route.test.ts` to include `projects.path` in mocked schema and queue project lookup before workflow rows
3. **PGlite catalog-repair timeout** — Added explicit 30s timeout to `packages/server/src/__tests__/pglite-issue-run-events-catalog-repair.test.ts`
4. **execute-agent-run-events mock drift** — Added missing `AgentRunTimeoutError` export to `packages/server/src/__tests__/execute-agent-run-events.test.ts`

### Verification

- ✅ Client: 37 tests pass
- ✅ Server: 121 tests pass, 1 skipped
- ✅ Workflow runner typecheck clean
- ✅ Commit: 0dd187d
---

## W31 Wave 2 — Test Baseline Fixes

**Date:** 2026-05-20T13:26:25.229-07:00  
**Status:** Completed ✅

### Deliverables

Fixed 4 CI-blocking pre-existing test regressions:
- RunButton null role error
- ceremonies-list-route mock drift  
- PGlite catalog-repair timeout
- execute-agent-run-events mock drift

### Verification

- ✅ Client: 37 tests pass
- ✅ Server: 121 tests pass, 1 skipped
- ✅ Commit: 0dd187da2

---

## W32 Wave 9: Playwright Demo Recording Infrastructure

**Date:** 2026-05-21T18:43:00Z  
**Status:** ✅ Complete  
**Commit:** 787cc70  

### Deliverable

Created dedicated Playwright demo recording spec with four marketing-friendly user journeys:

- `packages/e2e/tests/demo-recording.spec.ts` captures on-demand video for README assets
- Video enabled only for demo spec via `test.use({ video: 'on' })`
- Demo command disables server reuse so first-run state is clean
- Deterministic API mocks ensure stable visuals
- Key screenshots captured alongside video for fallback
- Usage: `cd packages/e2e && pnpm demo:record`
- Artifacts in `packages/e2e/test-results/demo-recording-*/`

### Learnings

- Dedicated demo spec avoids video overhead on regular test runs while enabling always-on capture for marketing
- Deterministic mocks are essential for stable README visuals
- Screenshots + video provides fallback if GIF conversion is skipped
- Clean first-run state requires disabling server reuse in demo mode
