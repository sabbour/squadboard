# Kobayashi Agent History

**Last summarized:** 2026-05-20T13:26:25Z
**Archive:** See `history-archive.md` for full history

## Quick Summary

**Total waves:** 3

## Latest Activity



## 2026-05-20: P0 Fix Wave Deployment

Landed 3 critical SDK fixes:

1. **Charter prompt injection hardening** (commit b0efdd65c): Replaced raw charter interpolation with stable wrapper. Injected charter inside `<charter>...</charter>` boundaries. XML-escaped charter payload to prevent boundary breaks. Capped charter input at 8k characters with truncation warning.

2. **sendAndWait timeout** (commit b0efdd65c): Added 120-second hard timeout around `client.sendAndWait()` in squad-client.ts. Failure mode is explicit: `sendAndWait timeout after 120s`. `client.disconnect()` runs in finally so hung runs don't hold bridge open indefinitely.

3. **Dead code removal** (commit b0efdd65c): Deleted `packages/server/src/sdk/hook-pipeline.ts`. `globalPipeline`/`registerOutputValidationHook()` had zero callers. Output-schema enforcement already happens exclusively through `recordRunCompletion()` in output-validator.ts.

**Result:** Build ✅ Regression test added and passing. All P0 fixes deployed.

---

## W31 Wave 2 — Related to cleanup wave

**Date:** 2026-05-20T13:26:25.229-07:00  
**Status:** Other agents' cleanup: McManus (server), Keyser (client), Kujan (tests), Redfoot (docs)

## Learnings

### 2026-05-20: SDK JSDoc + README (commit 14866667)

- **All exported symbols now documented.** Before this wave, exported interfaces and types in `bundle/schema.ts`, `close-out.ts`, and `step-8-health-report.ts` had field-level docs but no interface-level JSDoc one-liner. Added one-liners to all ~20 types.
- **`closeOut()` had no JSDoc.** It's the primary API surface — added full JSDoc with `@param`, `@returns`, and a complete `@example` showing health report integration.
- **`squadboard` const needed a doc.** The namespace object at `index.ts:16` is the first thing a consumer sees in IntelliSense. Added a one-liner + example.
- **README was a stub.** The previous README listed types in bullet form with no parameter tables or working examples. Rewrote as a full API reference: parameter tables, code examples for every function, and a clear SDK-comparison table.
- **Mirror contract reminder.** The `MIRROR CONTRACT` comment in `primitives.ts` is load-bearing — it forbids changing thresholds here and requires squad.agent.md to be the source of truth. Honored this: all JSDoc for `archiveDecisionsBySize` and `summarizeHistoryIfLarge` repeat the exact byte thresholds and reference the spec.
- **Typecheck gate used.** `pnpm typecheck` (tsc --noEmit) passed cleanly after all edits. Good habit — JSDoc `@example` blocks with broken syntax can sometimes confuse tooling.

---

## Wave 4 — SDK Documentation Complete

**Date:** 2026-05-20T14:00:00Z  
**Status:** Delivered & Logged ✅  
**Session Log:** `.squad/log/2026-05-20-wave4-docs-sdk.md`

### Orchestration

- Created `.squad/orchestration-log/2026-05-20-kobayashi-wave4.md`
- Merged inbox decision into `.squad/decisions.md`
- All 6 files (5 source + README) documented and linked in session log

### Outcome

Public SDK is now fully documented:
- 32+ exported symbols have JSDoc (interfaces + functions)
- README includes parameter tables, working examples, and bundle types reference
- SDK vs `@bradygaster/squad-sdk` comparison table included
- Typechecks clean
- No JSDoc on internal/private helpers (per spec)

**Coverage:** 100% of public API surface documented. Ready for external teams.
