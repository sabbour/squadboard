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
