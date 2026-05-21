# Decision: Primary onboard-to-squadboard repair action

**Date:** 2026-05-21  
**Author:** Hockney  
**Status:** ✅ IMPLEMENTED

---

## Summary

Squad sync now exposes a single primary `onboard-to-squadboard` repair action that runs the three onboarding repairs in sequence: write `.mcp.json`, seed built-in ceremonies, import custom `ceremonies.md` entries, then rebuild `.squad/ceremonies.md` once at the end.

---

## Why

Settings needed one obvious onboarding button instead of three separate backend repair actions. The composite action reduces UI branching while preserving the existing lower-level actions for targeted recovery and testing.

---

## Decisions Made

1. **Composite action is additive, not a replacement.**
   - `write-mcp-config`, `seed-ceremony-defaults`, and `import-ceremonies-from-md` remain independently callable.
2. **Sequence is fixed and deterministic.**
   - `.mcp.json` write first, then DB seeding, then markdown import.
3. **Rebuild `.squad/ceremonies.md` once at the end.**
   - Avoids repeated file churn and ensures the final file reflects the post-import DB state with delegation hints.
4. **Non-fatal sub-step failures do not short-circuit the run.**
   - The composite result aggregates all child changes so the UI can show partial progress plus the failure reason.
5. **Expose only the composite onboarding action for onboarding repairs.**
   - `write-mcp-config`, `seed-ceremony-defaults`, and `import-ceremonies-from-md` stay callable on the backend but are hidden from the status action list so Settings shows one onboarding CTA.
6. **The composite action is listed first in status.**
   - Settings can treat it as the primary onboarding CTA while still exposing unrelated repairs underneath.
7. **Reconciliation rides on the existing status endpoint.**
   - `GET /squad-sync/status` now returns `onboardingSync` with `mcpConfigPresent`, `ceremoniesSeeded`, `squadAgentPresent`, `inSync`, and `driftedFields`, so the frontend can poll one read-only surface for drift.
