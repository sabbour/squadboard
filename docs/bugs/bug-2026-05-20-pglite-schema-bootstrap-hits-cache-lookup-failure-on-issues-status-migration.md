# Bug: PGlite schema bootstrap hits cache lookup failure on issues.status migration

| Field | Value |
|-------|-------|
| **Bug ID** | `bug-2026-05-20-pglite-schema-bootstrap-hits-cache-lookup-failure-on-issues-status-migration` |
| **Reported** | 2026-05-20 |
| **Severity** | 🟠 high |
| **Component** | database |
| **Assigned to** | Hockney |
| **Status** | Fixed locally |

## Reproduction Steps

1. Start the Squadboard dev server with the existing local PGlite data directory at /home/asabbour/.squadboard/data/pglite.
2. Let startup run through migration marker detection, PGlite boot, PGlite catalog repair, and schema bootstrap.
3. Observe backend logs during initDb/schema bootstrap.

## Expected Behavior

Startup should either complete schema bootstrap cleanly or detect/repair the specific PGlite catalog corruption affecting the issues.status migration without relying on a generic continue-with-existing-catalog fallback.

## Actual Behavior

Startup logs show PGlite boots, workflow_versions indexes are reindexed, then schema bootstrap is skipped because PGlite catalog corruption raises `cache lookup failed for attribute 0 of relation 0` while running `ALTER TABLE issues ALTER COLUMN status TYPE TEXT USING status::TEXT` inside the column_status enum migration block.

## Additional Context

Relevant log excerpt:
[migrate] Migration marker present at /home/asabbour/.squadboard/data/.migrated-to-pglite-v1 — already migrated
[pglite] booting WASM Postgres at /home/asabbour/.squadboard/data/pglite
[pglite] ready in 334ms
[db] reindexed PGlite workflow_versions indexes (2 indexes)
[db] PGlite catalog corruption prevented schema bootstrap; continuing with existing catalog: error: cache lookup failed for attribute 0 of relation 0
where: SQL statement "ALTER TABLE issues ALTER COLUMN status TYPE TEXT USING status::TEXT" PL/pgSQL function inline_code_block line 3 at SQL statement
query includes the column_status enum migration block, then column_meta semantic/is_default backfill.
This likely needs a targeted investigation into pg_attribute/catalog corruption around `issues.status`, whether the enum migration can be guarded more narrowly, and whether a safe repair/check should run before schema bootstrap.

## Fix Checklist

- [x] Root cause identified and documented here
- [x] Fix implemented on worktree branch `feat/project-danger-zone`
- [x] Regression covered by server build/startup path validation
- [ ] Fix merged to `main` — worktree removed
- [x] This doc updated with resolution notes

## Resolution

New catalogs now create `issues.status` as `TEXT` instead of the legacy `column_status` enum. The legacy enum migration was split out of the broad schema-bootstrap DDL block and now checks the actual column metadata before attempting `ALTER TABLE`; if PGlite catalog corruption prevents that compatibility-only step, startup logs a targeted warning and leaves the existing catalog untouched instead of failing the whole bootstrap.
