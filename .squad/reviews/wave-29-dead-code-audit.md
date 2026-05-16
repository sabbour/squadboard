# Wave 29 Dead Code & Orphan Audit (GPT-5.5)

**Reviewer**: Keaton via GPT-5.5
**Date**: 2026-05-16
**Scope**: All packages except .squad/templates, node_modules, dist, .git

## Top findings (high confidence)

1. `packages/server/src/routes/dashboard.ts:72` — Global dashboard API router is never mounted. Evidence: route file exists, but `packages/server/src/index.ts:196-283` mounts many routers and never imports/mounts `./routes/dashboard.js`; repo search found no `/api/dashboard` client calls. Recommended action: delete the route or mount it intentionally under `/api/dashboard`.
2. `packages/client/src/components/EmptyBoard.tsx:3` — Empty board component has no inbound imports. Evidence: grep for `EmptyBoard` only returns its own declaration. Recommended action: remove, or wire it into `Board` if the empty state is still desired.
3. `packages/client/src/components/board/CommentComposer.tsx:43` — Full comment composer + mention dispatch UI appears orphaned. Evidence: grep for `CommentComposer` only returns this file; comments UI currently uses other components. Recommended action: delete after confirming no planned comment-entry surface depends on it.
4. `packages/client/src/components/workflows/ApproveStepPolicyInspector.tsx:219` — Review-policy inspector component and its YAML parser/splicer exports have no consumers. Evidence: grep for `ApproveStepPolicyInspector` only returns this file. Recommended action: remove or integrate into `CeremonyEditor` before preserving.
5. `packages/client/src/components/workflows/TemplatePicker.tsx:38` — Workflow template picker is unreferenced. Evidence: grep for `TemplatePicker` only returns its own file; current ceremony/template flow uses `Templates` and editor pages. Recommended action: delete or wire into new/edit flow.
6. `packages/client/src/components/workflows/WorkflowList.tsx:21` — Legacy workflow list component is unreferenced. Evidence: grep for `WorkflowList` only returns this file; `App.tsx:62-70` routes ceremonies/workflows to page components, not this component. Recommended action: remove with the legacy workflows cleanup.
7. `packages/client/src/components/workflows/WorkflowStepFlow.tsx:33` — Legacy SVG workflow visualizer is unreferenced. Evidence: grep for `WorkflowStepFlow` only returns this file; newer ceremony graph/canvas components exist. Recommended action: remove if no hidden story/demo imports it.
8. `packages/electron/src/main/ipc.ts:25-41` — Electron IPC handlers are explicit L2 stubs (`health.check`, `projects.list`, `projects.create`) returning static data. Evidence: file header says “v1 stubs” and “wired to real server functions in L3-L5”; recent log shows Electron scaffold landed W24. Recommended action: either implement against the HTTP API or remove stub-only channels from shipped builds.
9. `packages/electron/src/renderer/index.ts:1-37` — Electron renderer is an L2 scaffold stub with inline health UI and global `checkHealth`. Evidence: header says production bypasses it and “L3 will wire the real React client here and remove this stub.” Recommended action: delete once packaged renderer uses client dist consistently, or replace with real bootstrap.
10. `packages/server/src/db/.deprecated/postgres.ts:1-127` — Deprecated embedded-postgres implementation remains as a full alternate DB bootstrap. Evidence: under `.deprecated`, imports `embedded-postgres`, and production uses `pglite.ts`; no non-deprecated imports found. Recommended action: archive outside source or delete after migration support window.
11. `packages/server/src/db/pglite.ts:23-28` — Stale TODO says to write a one-time migrator, but `packages/server/src/index.ts:90-120` already runs `scripts/migrate-from-legacy-pg.ts` before PGlite boot. Recommended action: remove/update the stale TODO and any obsolete migration design text.
12. `packages/server/src/scripts/pglite-spike.ts:1-18` — PGlite feasibility spike remains in source after PGlite shipped. Evidence: no package script invokes it; comments identify it as a one-off feasibility prove-out; schema copied inside is likely stale. Recommended action: delete or move to historical notes.
13. `packages/server/src/scripts/seed-wave10-backlog.ts:1-18` — Wave 10 dogfood seed script is stale and partly misleading. Evidence: no package script invokes it; comments refer to embedded postgres on port 54321 while import aliases now point to PGlite. Recommended action: delete or rewrite as a maintained fixture seeder.
14. `packages/server/src/db/schema.ts:292` — `step_runs.retry_delay` appears reserved but unread. Evidence: only schema/bootstrap/spike references (`retryDelay|retry_delay`); comment says “reserved for future use.” Recommended action: drop if no retry scheduler will use it soon.
15. `packages/server/src/db/schema.ts:417` — `issue_workflows.attached_at` appears write-only/default-only. Evidence: only schema/bootstrap/spike references (`attachedAt|attached_at`). Recommended action: drop or surface in audit/history UI.

## Categories

### Unreferenced exports

- `packages/client/src/components/EmptyBoard.tsx:3` — default export has no inbound imports.
- `packages/client/src/components/board/CommentComposer.tsx:43` — default export has no inbound imports.
- `packages/client/src/components/workflows/ApproveStepPolicyInspector.tsx:137,181,219,324` — parser/splicer/component/header re-export have no external consumers.
- `packages/client/src/components/workflows/TemplatePicker.tsx:38` — default export has no inbound imports.
- `packages/client/src/components/workflows/WorkflowList.tsx:21` — default export has no inbound imports.
- `packages/client/src/components/workflows/WorkflowStepFlow.tsx:33` — default export has no inbound imports.

### Orphaned UI features

- Legacy workflow UI components above appear disconnected from current routing (`App.tsx:62-70`) and current ceremony editor/canvas surfaces.
- Electron scaffold UI (`packages/electron/src/renderer/index.ts:1-37`) is not the real React app and is explicitly described as removable after L3.

### Stubs / not-implemented

- `packages/electron/src/main/ipc.ts:25-41` returns static IPC results for health/project list/create.
- `packages/electron/src/renderer/index.ts:1-37` is a health-check scaffold, not product UI.

### Routes never mounted

- `packages/server/src/routes/dashboard.ts:72` is not mounted in `packages/server/src/index.ts:196-283` and no `/api/dashboard` consumer was found.
- `packages/server/src/routes/consult-sse.ts:14` initially looked suspicious as a route file not mounted directly, but it is intentionally imported by `routes/consult.ts:38` and mounted at `consultRouter.get('/:sessionId/stream', ...)`.

### .deprecated/ directories

- `packages/server/src/db/.deprecated/postgres.ts:1-127` is a full embedded-postgres implementation retained under `.deprecated`. It is likely safe to remove once Brady confirms legacy migration no longer needs code archaeology.

### Legacy migrations / shims

- `packages/server/src/scripts/migrate-from-legacy-pg.ts:1-36` is a one-time legacy embedded-PG to PGlite migrator. It is still boot-wired (`index.ts:97-100`), so not dead yet, but should have an explicit removal criterion.
- `packages/server/src/db/pglite.ts:147-180` keeps deprecated `startEmbeddedPostgres` / `stopEmbeddedPostgres` aliases. They are still used by `mcp/index.ts` and old scripts, so remove only after updating call sites.
- `packages/server/src/db/pglite.ts:23-28` has a stale migration TODO superseded by the actual migrator.

### Duplicate implementations

- Slug/kebab helpers are duplicated in `routes/ceremonies.ts:86`, `sdk/consult-stream.ts:1013`, `utils/ceremony-roundtrip.ts:95`, `services/templates/template-storage.ts:33`, `services/skills.ts:217`, `services/casting-engine.ts:316`, and `services/irl-mapper.ts:489`. These are not all dead, but divergence risk is high.
- JSON-fence parsing is hand-rolled in several server services (`formulator`, `ceremony-translator`, `inbox`, `coordinator/llm-client`, `coordinator/batch`). Consider centralizing before more LLM parsers land.

### Suspicious DB columns

- `packages/server/src/db/schema.ts:292` / `retry_delay` — no runtime read/write beyond schema/bootstrap/spike; comment says reserved.
- `packages/server/src/db/schema.ts:417` / `attached_at` — no runtime read/write beyond schema/bootstrap/spike.

### Stale tests

- No high-confidence tests importing deleted modules were found in the spot check. Current tests mostly align with active W27-W29 features. Risk remains around legacy workflow tests vs ceremony aliases, but not enough evidence to call dead.

## Lower-confidence suspects

- `packages/server/src/scripts/smoke-loop-mcp.ts:1-21` — Wave 10 smoke script is not in package scripts, but may still be useful as a manual MCP smoke.
- `packages/server/src/scripts/verify-migration.ts:1-9` — looks script-like, but is still called by `cli/migrate.ts`, so keep.
- `packages/server/src/scripts/migrate-from-legacy-pg.ts:1-36` — one-time migrator is legacy by design but still boot-wired; decide a date/version to remove.
- `packages/server/src/db/pglite.ts:147-180` deprecated aliases are shims, but still referenced by MCP and seed code.
- Hidden file inputs with `display: 'none'` in client pages look intentional upload controls, not dead UI.

## Methodology

- Reviewed `git log --oneline -100 main` for recent W20-W29 context; recent work heavily touched coordinator, ceremonies, streaming, PGlite, and Electron scaffold.
- Enumerated scoped files: `packages/server/src` 357 files, `packages/client/src` 183, `packages/squadboard-sdk/src` 7, `packages/electron/src` 9.
- Excluded `.squad/templates/**`, `node_modules/**`, `dist/**`, and `.git/**` from searches.
- Reconciled server route files against `app.use(...)` mounts in `packages/server/src/index.ts`.
- Grepped for telltale terms: `stub`, `deprecated`, `legacy`, `TODO remove`, `not implemented`, route mounts, low-reference UI components, and low-reference DB columns.
- Used in-repo grep only; public SDK consumers outside this repo were not considered, so exported SDK types may be externally live.
- This is intentionally not exhaustive; findings prioritize high-signal cleanup candidates and may have false positives where code is kept for roadmap work.

## Recommendations

1. Delete or mount `routes/dashboard.ts`; it is the clearest server orphan.
2. Remove unreferenced client components (`EmptyBoard`, `CommentComposer`, legacy workflow components) in one PR with a client typecheck.
3. Decide whether Electron L2 scaffold code is still on the roadmap; otherwise remove/replace static IPC and renderer stubs.
4. Set a removal policy for embedded-postgres migration artifacts (`.deprecated/postgres.ts`, stale PGlite TODO, deprecated aliases, one-time migrator).
5. Drop or use suspicious DB columns (`retry_delay`, `attached_at`) before they become permanent schema baggage.
6. Centralize slugify and JSON-fence parsing helpers to prevent duplicate logic from becoming future dead-code traps.
