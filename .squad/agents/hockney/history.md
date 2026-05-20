# Hockney Agent History

**Last summarized:** 2026-05-20T13:26:25Z
**Archive:** See `history-archive.md` for full history

## Quick Summary

**Total waves:** 6

## Latest Activity



## 2026-05-20: P0 Fix Wave Deployment

Landed 3 critical backend fixes:

1. **SQL injection hardening** (commit 9fb89bcce): Replaced `sql.raw()` UUID array splice in `sweepExpiredStepLeases()` with Drizzle `inArray()` for parameterized queries.
2. **Workflow advancement atomicity** (commit 8813a41f7): Wrapped step completion, review-run creation, fan-out state changes, handoffs, and cursor advancement in a single Drizzle transaction.
3. **Worker hard timeout** (commit 16c1715fc): Added wall-clock timeout path for `runWorker` SDK runs, propagated timeout control into the Squad SDK bridge, introduced terminal `timed_out` state.

**Result:** Build ✅ All P0 fixes passing.

**Follow-up:** Pre-existing red suites are now CI blockers thanks to Kujan's vitest/typecheck gates. Hockney has no red signals from these fixes.

