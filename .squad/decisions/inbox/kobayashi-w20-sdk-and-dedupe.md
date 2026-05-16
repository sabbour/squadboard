# Kobayashi — Wave 20 SDK + Dedupe Decision Record

**Agent**: Kobayashi (SDK / packaging / distribution)  
**Wave**: 20  
**Datetime**: 2026-05-16T00:11:44-07:00  
**Branch**: keyser/w17-settings-backup-github

---

## 1. Spec Drift Detection — Step 8 HEALTH REPORT

### Method
Ran: `rg "^##? Step 8" .github/agents/squad.agent.md`  
**Result**: `NOT_FOUND`

### What the spec had (before this wave)
Line 946 of `.github/agents/squad.agent.md` (in the Scribe spawn prompt):
```
8. HEALTH REPORT: Log decisions.md before/after size, inbox count processed, history files summarized.
```
This is a minimal "log" instruction — no artifact write, no file path, no structured content.

### Decision: Path B (upstream drift)
The spec does NOT have step 8 as a proper artifact-write section. Drift is on the upstream side. Action taken:
1. **Updated `.github/agents/squad.agent.md`** — step 8 rewritten with full HEALTH REPORT artifact spec (path: `.squad/health/YYYY-MM-DD/wave-{N}-{session}.md`, 6 content sections a–f, returns `healthReportPath`).
2. **Mirrored into SDK** as `packages/squadboard-sdk/src/scribe/steps/step-8-health-report.ts`.
3. **Updated orchestrator** `close-out.ts` — added `healthReport` option and `healthReportPath` to result.
4. **Added Vitest test** `src/scribe/__tests__/step-8.test.ts` — 12 tests, all pass.

**Upstream PR note**: Out of scope per task (don't touch PR #1124). Local `squad.agent.md` updated only.

---

## 2. Files Shipped

### SDK
| File | Status |
|------|--------|
| `packages/squadboard-sdk/src/scribe/steps/step-8-health-report.ts` | NEW — `writeHealthReport()` primitive |
| `packages/squadboard-sdk/src/scribe/__tests__/step-8.test.ts` | NEW — 12 Vitest tests (24 total incl. dist) |
| `packages/squadboard-sdk/src/scribe/close-out.ts` | MODIFIED — integrates step 8 |
| `packages/squadboard-sdk/src/scribe/index.ts` | MODIFIED — exports `writeHealthReport` + new types |
| `packages/squadboard-sdk/tsconfig.json` | MODIFIED — excludes `__tests__` from TS build |
| `packages/squadboard-sdk/package.json` | MODIFIED — adds `vitest ^4.1.6` devDep + `test` script |

### Server
| File | Status |
|------|--------|
| `packages/server/src/cli/dedupe-cards.ts` | NEW — `squadboard cards dedupe` CLI |
| `packages/server/src/routes/system.ts` | MODIFIED — adds `POST /api/system/dedupe` endpoint |
| `packages/server/src/db/schema.ts` | MODIFIED — adds `archivedAt`, `archivedReason` to issues |
| `packages/server/src/db/index.ts` | MODIFIED — Wave 20 migration for `archived_at`, `archived_reason` |

### Spec
| File | Status |
|------|--------|
| `.github/agents/squad.agent.md` | MODIFIED — step 8 full HEALTH REPORT artifact spec |

---

## 3. Dedupe Report

**Command**: `npx tsx src/cli/dedupe-cards.ts --dry-run --project-id <foo-uuid>`

**Live state** (confirmed via `GET /api/system/db-counts`):
```json
{
  "issues": 0,
  "projects": 1
}
```

**Dry-run result**:
```json
{
  "dryRun": true,
  "projects": {},
  "groups": []
}
```

**Reason**: PGlite cluster has 0 issues — the legacy Postgres → PGlite migration (tracked by `migrate.ts`) has not yet run to completion for the `issues` table (verify CLI shows: source=225, dest=0). No duplicates exist in the PGlite target.  

**No real dedupe executed** because there is nothing to dedupe.

**CLI design verified**: When server is running (holds PGlite exclusively), the CLI detects it via `GET /api/health` and delegates to `POST /api/system/dedupe`. When server is not running, CLI boots PGlite directly. Both paths are idempotent.

Per-project report: `{ kept: N, archived: M }` (N=0, M=0 for all projects in live system).

---

## 4. Build / Test Results

- `pnpm build` (SDK): ✅ clean
- `pnpm test` (SDK): ✅ 24/24 tests pass (12 source + 12 dist)
- `pnpm exec tsc --noEmit` (server): ✅ no errors in my files (1 pre-existing error in `github-git-ops.ts` from Keyser's w17 work, not my lane)
- `pnpm run test` (server `src/__tests__/`): ✅ 4/4 pass

---

## 5. Schema Changes

Added to `issues` table (Wave 20 migration, idempotent `IF NOT EXISTS`):
- `archived_at TIMESTAMPTZ` — when soft-deleted by dedupe
- `archived_reason TEXT` — e.g. `'dedupe:bulk-port-vs-seed-backlog'`

---

## 6. Upstream PR

Not filed — `bradygaster/squad` PR is out of scope per Wave 20 brief (don't touch PR #1124). The local `squad.agent.md` has been updated as the canonical source; upstream sync is deferred.
