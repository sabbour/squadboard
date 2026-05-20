# Kobayashi P0/P1 SDK fixes

**Date:** 2026-05-20T12:51:52-07:00  
**Author:** Kobayashi  
**Status:** Implemented

## What changed

1. Hardened `packages/server/src/sdk/squad-client.ts` so charter content loaded from disk is no longer injected raw into the system prompt.
   - Added a stable wrapper prompt.
   - Injected charter text inside `<charter>...</charter>` boundaries.
   - XML-escaped charter payload so embedded tags cannot terminate the boundary or masquerade as higher-priority instructions.
   - Capped charter prompt input at 8,000 characters and emit a warning when truncation occurs.
2. Added a 120-second hard timeout around `client.sendAndWait(...)` in `squad-client.ts`.
   - Failure mode is explicit (`sendAndWait timeout after 120s`).
   - `client.disconnect()` still runs in `finally`, so hung runs do not hold the bridge open indefinitely.
3. Deleted `packages/server/src/sdk/hook-pipeline.ts`.
   - `globalPipeline`/`registerOutputValidationHook()` had no callers.
   - Output-schema enforcement already happens in `packages/server/src/services/output-validator.ts` via `recordRunCompletion()` before run finalization.

## Decision rationale

### Charter prompt injection

Invariant: **host-owned system prompt composition must preserve the boundary between coordinator instructions and developer-authored charter content.**

Raw charter interpolation let a malicious or malformed charter inject literal XML/HTML-like delimiters into the top-level system prompt. Wrapping plus escaping keeps the charter readable to the model while preventing boundary breaks such as `</charter><system>...`.

The 8k cap is defense in depth: oversized charters should not silently dominate token budget or create unpredictable truncation downstream.

### HookPipeline

Invariant: **there must be one authoritative completion-validation path.**

`HookPipeline` never ran. Wiring it in now would duplicate `recordRunCompletion()` or introduce a second place that could disagree on pass/fail semantics. Since the singleton had zero consumers and no startup registration path, deletion is safer than speculative activation.

### sendAndWait timeout

Invariant: **a single provider stall must not pin an issue run forever.**

The 120-second timeout is long enough for normal agent turns but finite enough to fail closed when the provider or SDK hangs.
