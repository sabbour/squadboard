# Verbal Agent History

**Last summarized:** 2026-05-20T13:26:25Z
**Archive:** See `history-archive.md` for full history

## Quick Summary

**Total waves:** 9

## Latest Activity



## 2026-05-20: P0 Fix Wave Deployment

Landed 2 critical WebSocket fixes:

1. **WebSocket upgrade auth** (commit ccca60cee): Moved `/api/ws` authentication to HTTP upgrade path. Accepts JWT from `Authorization: Bearer <token>` or `?token=<token>`. Validates with same auth helper used by REST middleware. Added `maxPayload: 64 * 1024` to prevent DoS. Client now bootstraps with `?token=` when authToken is present.

2. **Presence protocol canonicalization** (commit 65dedda8f): Fixed broken presence feature. Client→server: `presence.cursor`. Server→client: `presence.updated`. Added `projectId` to all presence events. Implemented sender exclusion on fan-out. Presence now requires active subscription.

**Result:** Build ✅ Presence protocol now works end-to-end. WS is now auth-gated and payload-limited.

**Follow-up:** CI gates from Kujan have exposed no new regressions from these fixes.

