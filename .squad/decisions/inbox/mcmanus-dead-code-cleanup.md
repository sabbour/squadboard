# McManus — server dead-code cleanup

**Date:** 2026-05-20
**Author:** McManus
**Status:** Completed cleanup pass

## Deleted

- `packages/server/src/engine/dispatcher.ts`
  - Deleted after removing a stray unused import from `packages/server/src/index.ts`.
- `packages/server/src/services/irl-gallery.ts`
  - No importers outside itself.
- `packages/server/src/services/user-paths.ts`
  - No importers.
- `packages/server/src/services/starter-ceremony-loader.ts`
  - Runtime-dead; only covered by its dedicated test.
- `packages/server/src/__tests__/starter-ceremony-loader.test.ts`
  - Deleted with the dead loader it covered.
- `packages/server/src/data/starters/bug-triage/triage-review.workflow.yaml`
- `packages/server/src/data/starters/content-creation/editorial-review.workflow.yaml`
  - Both YAML assets were only reachable through the deleted starter ceremony loader.
- Metadata cleanup:
  - Removed the deleted YAML filenames from `packages/server/src/data/starters/bug-triage/meta.json`
  - Removed the deleted YAML filenames from `packages/server/src/data/starters/content-creation/meta.json`

## Skipped

- `packages/server/src/services/irl-mapper.ts`
  - Still live. `packages/server/src/routes/starters.ts` imports and calls `materialiseIrlPlan()`, and `packages/server/src/services/starter-projects.ts` imports its `IrlProvisioningPlan` type.

## Validation

- `pnpm --filter @sabbour/squadboard build` ✅
- `pnpm --filter @sabbour/squadboard test -- --run` ⚠️ pre-existing failures remain, but no new cleanup-specific failures were introduced.
