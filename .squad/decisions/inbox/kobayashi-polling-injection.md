# Decision: Inject run-status polling guidance into squad.agent.md

**Date:** 2026-05-21T11:23:00.591-07:00  
**Author:** Kobayashi  
**Requested by:** Ahmed  
**Status:** ✅ IMPLEMENTED

---

## Context

`packages/server/src/routes/squad-sync.ts` already injects Squadboard MCP detection guidance plus ceremony delegation rules into `.github/agents/squad.agent.md`. The injected guidance told Squad CLI to call `squadboard_run_agent(...)`, but it did not explain how to wait for completion or read final output.

There was also a retrofit gap: repos that already had the older injected hint (`squadboard_*`) would hit the `already_present` guard and never receive the new polling instructions.

## Decision

Extend the injected ceremony delegation guidance with an explicit polling section that tells the coordinator to:

- capture `run.id` from `squadboard_run_agent`,
- poll `squadboard_get_run_status({ runId })` every 5–10 seconds,
- continue while status is `pending` or `running`,
- stop on `completed` or `failed`,
- read `run.output` or `run.errorMessage`,
- treat runs that exceed 10 minutes as stalled.

## Implementation details

1. Added a reusable `POLLING_BLOCK` template string and appended it inside `CEREMONY_DELEGATION`.
2. Updated the injection guard to distinguish between:
   - fully up-to-date files (`squadboard_*` + polling guidance) → skip,
   - older injected files (`squadboard_*` without polling guidance) → append only the polling block,
   - files with no Squadboard MCP hint yet → run the normal injection path.
3. Tightened `hasSquadboardMcpHints()` so onboarding drift detection now requires both the Squadboard detection hint and polling guidance.

## Why this shape

- **Coordinator guidance must be actionable.** Telling the agent to delegate without telling it how to observe completion leaves the workflow half-specified.
- **Retrofit must be safe.** Existing repos should gain only the missing polling instructions instead of duplicating the full hint block.
- **Status should reflect the full contract.** If polling guidance is missing, sync status should treat the agent projection as drifted rather than silently healthy.

## Verification

- Ran `cd packages/server && pnpm build 2>&1 | tail -20`
- Result: build passed successfully
