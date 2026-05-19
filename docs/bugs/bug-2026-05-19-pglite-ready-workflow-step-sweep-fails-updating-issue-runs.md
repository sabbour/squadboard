# Bug: PGlite ready-workflow-step sweep fails updating issue_runs

| Field | Value |
|-------|-------|
| **Bug ID** | `bug-2026-05-19-pglite-ready-workflow-step-sweep-fails-updating-issue-runs` |
| **Reported** | 2026-05-19 |
| **Severity** | 🟠 high |
| **Component** | database |
| **Assigned to** | Hockney |
| **Status** | Fixed in working tree |

## Reproduction Steps

1. Start the server development process for packages/server.
2. Let the ready-workflow-step sweeper claim a workflow step/run.
3. Observe the server logs when claimAndRun updates issue_runs status to running.

## Expected Behavior

The sweeper claims and runs ready workflow steps without database constraint errors.

## Actual Behavior

packages/server dev logs `[sweep:ready-workflow-steps] claimAndRun failed: error: constraint 66350 is not a foreign key constraint` from PGlite while running `UPDATE issue_runs SET status = 'running', lease_expires_at = NOW() + INTERVAL '90 seconds', heartbeat_at = NOW(), started_at = NOW(), updated_at = NOW() WHERE id = $1`.

## Additional Context

PGlite stack trace reports code XX000, file ri_triggers.c, routine ri_LoadConstraintInfo, params include issue_runs id 21ce49b6-ed35-42c2-897d-3c8243bc28b9.

## Fix Checklist

- [x] Root cause identified and documented here
- [x] Fix implemented in the current dirty worktree (coordinator directed no branch/worktree for this bug)
- [x] Regression test added (Kujan sign-off required)
- [ ] Fix merged to `main` — worktree removed
- [x] This doc updated with resolution notes

## Resolution

### 2026-05-19T14:11:32.649-07:00 — Kujan test coverage sign-off

- Added `packages/server/src/__tests__/pglite-issue-runs-claim.test.ts`.
- Coverage: in-memory PGlite, bootstrapped schema plus forward migration SQL, one `issue_runs` row with dependent FK rows, then the exact ready-workflow claim update to `running`.
- Focused test passed: `pnpm --filter @sabbour/squadboard test -- --run src/__tests__/pglite-issue-runs-claim.test.ts`.
- Root cause and production fix remain Hockney-owned.

### 2026-05-19T14:11:32.649-07:00 — Hockney root cause and fix

- Root cause: the local PGlite catalog had stale RI triggers for `issue_run_events(run_id)` pointing at a non-canonical constraint OID. When `claimAndRun` updated `issue_runs`, PGlite loaded the adjacent unique constraint instead of the foreign key and failed in `ri_LoadConstraintInfo`.
- Fix: `packages/server/src/db/index.ts` now runs a PGlite-only startup repair that repoints the `issue_run_events` RI triggers at the canonical `issue_run_events_run_id_fkey` constraint before sweepers can claim runs.
- Additional regression coverage: `packages/server/src/__tests__/pglite-issue-run-events-catalog-repair.test.ts` reproduces the corrupted trigger catalog in an isolated PGlite data directory, verifies the pre-repair failure, then verifies the repair permits the `issue_runs` update.
- Validation: focused PGlite tests passed; `pnpm --filter @sabbour/squadboard build` passed; the local PGlite catalog was repaired and a rollback-wrapped `issue_runs` update check succeeded.
