---
name: "pglite-regression-testing"
description: "Write PGlite catalog/trigger regressions without touching persistent data"
domain: "quality,database"
confidence: "medium"
source: "Kujan regression coverage on 2026-05-19T14:11:32.649-07:00"
---

# PGlite Regression Testing

## Context

Use this when a bug depends on PGlite behavior that mocks cannot represent: foreign-key triggers, catalog metadata, migration DDL, enum changes, `ON CONFLICT`, or timestamp/interval SQL.

## Pattern

1. Boot `new PGlite()` with no data directory so the test is in-memory and isolated.
2. Mock the server DB module only enough for `getPglite()` to return that in-memory instance.
3. Call the real `initDb(PGLITE_SENTINEL)` with persistent side effects disabled, such as charter backfill and automatic migration snapshotting.
4. Manually apply forward SQL files from `packages/server/src/db/migrations/` through the pool adapter when the invariant requires migrated schema coverage.
5. Seed the smallest row graph that activates the relevant constraints.
6. Exercise the failing SQL path directly and assert the durable invariant, not just absence of throw.

## Guardrails

- Do not use the persistent `~/.squadboard/data/pglite` directory in tests.
- Do not create migration snapshots as a side effect of test setup.
- Do not replace PGlite with mocks when the failure is catalog, trigger, or SQL-protocol specific.

## Catalog Repair Pattern

Use this when a persistent PGlite cluster has stale RI trigger metadata:

1. Reproduce in an isolated project-local data directory, then close and reopen PGlite so trigger/syscache state is loaded from disk.
2. Assert the exact failing SQL path before repair.
3. Repair before any retry on the same fresh connection; once a connection has loaded bad RI metadata from a failed update, close it and reopen before validating the repair.
4. Scope direct `pg_trigger`/`pg_constraint` surgery to PGlite mode only. External PostgreSQL must not receive catalog edits.
5. Validate with the production update path and a rollback-wrapped check when touching persistent local data.
