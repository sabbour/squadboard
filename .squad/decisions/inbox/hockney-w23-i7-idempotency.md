# Hockney W23 — I7: Idempotency Keys on Capture + MCP Writes

**Date:** 2026-05-16  
**Author:** Hockney (platform/reliability/data)  
**Wave:** 23  
**Stream:** I  

---

## Schema Changes

### `inbox_items`
- **Removed** global `UNIQUE` constraint on `idempotency_key` (was `inbox_items_idempotency_key_key`).
- **Added** project-scoped partial unique index:  
  `CREATE UNIQUE INDEX inbox_items_project_idempotency_uq ON inbox_items (suggested_project_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
- Drizzle schema annotation updated: `.unique()` removed from `idempotencyKey` column (enforcement is now at DB index level).

### `issues`
- **Added** nullable column: `idempotency_key TEXT`
- **Added** project-scoped partial unique index:  
  `CREATE UNIQUE INDEX issues_project_idempotency_uq ON issues (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
- Drizzle schema: `idempotencyKey: text('idempotency_key')` added.

### `dispatches`
- The W20 verbal mention of "dispatches" maps to `copilot_auto_assign_dispatches`, which already has its own idempotency guard `(rule_id, issue_id)`. No change needed.

---

## Key Generation Algorithm (MCP layer)

```
idempotencyKey = sha256(projectId + '\0' + normalizedPrompt).slice(0, 32)
```

- `projectId` is the resolved project UUID (or empty string if absent).
- `normalizedPrompt` is `prompt.trim()`.
- Result is a 32-char lowercase hex string.
- **Same call, same content → same key** → deduped on retry.
- **Different explicit keys** for semantically distinct calls → distinct rows.

Applied in `handleCapture()` in `packages/server/src/mcp/server.ts` when
the caller omits an `idempotencyKey` argument.

---

## HTTP Header / Body Convention

Both routes accept the key from two sources (header takes precedence):

| Source | Format |
|--------|--------|
| HTTP header | `Idempotency-Key: <uuid-or-hash>` |
| JSON body | `{ "idempotencyKey": "<uuid-or-hash>" }` |

**Routes updated:**
- `POST /api/inbox` — returns `201` on create, `200` on duplicate hit.
- `POST /api/projects/:projectId/issues` — same status convention.

---

## Coordinator Dogfood: Two-Flow Pattern

When a coordinator calls `capture` for both intake and close-out of the
same directive, recommended explicit key derivation:

```
intake key    = sha256(directiveId + ':intake').slice(0, 32)
close-out key = sha256(directiveId + ':closeout').slice(0, 32)
```

Documented in `.squad/dogfood.md` under "Wave 23 — I7".

---

## Tests

**5 new Vitest tests** in `packages/server/src/__tests__/`:

| File | What it covers |
|------|---------------|
| `idempotency-capture.test.ts` | POST same payload + same key → 1 row, second response is existing (created=false) |
| `idempotency-mcp.test.ts` | sha256 key derivation: same content → same key; different content → different key; 32-char hex |
| `idempotency-distinct-keys.test.ts` | Same payload, two distinct explicit keys → 2 rows |
| `idempotency-no-key.test.ts` | No key → legacy path, no dedup check, insert always proceeds |
| `idempotency-cross-project.test.ts` | Same key in different projects → 2 rows (index is project-scoped) |

---

## Files Touched

| File | Change |
|------|--------|
| `packages/server/src/db/schema.ts` | Added `idempotencyKey` to `issues`; removed `.unique()` from `inboxItems.idempotencyKey` |
| `packages/server/src/db/index.ts` | W23 migration block: `issues.idempotency_key` column + two partial unique indexes |
| `packages/server/src/services/inbox.ts` | `CreateInboxInput` + `idempotencyKey`; `createInboxItem` returns `{item, created}`; project-scoped dedup |
| `packages/server/src/routes/inbox.ts` | POST `/api/inbox` reads `Idempotency-Key` header / body; 200 vs 201 |
| `packages/server/src/routes/issues.ts` | POST `/api/projects/:id/issues` reads `Idempotency-Key` header / body; 200 vs 201 |
| `packages/server/src/services/issues.ts` | `createIssue` now checks `idempotency_key` column + stores it on insert; legacy title-prefix fallback kept |
| `packages/server/src/mcp/server.ts` | `handleCapture` auto-generates sha256 key; project-scoped dedup check |
| `packages/server/src/sdk/consult-stream.ts` | Updated two callers of `createInboxItem` for new `{item, created}` return shape |
| `.squad/dogfood.md` | Added W23 I7 deterministic intake/close-out key guidance |
| `.squad/decisions/inbox/hockney-w23-i7-idempotency.md` | This file |

---

## Defensive Backup Paths

- Pre-migration backup: `~/.squadboard/backups/pre-w23-idempotency-20260516-013835/`
- Migration is idempotent: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `DROP CONSTRAINT` wrapped in `DO $$ IF EXISTS … END $$`.

---

## SDK Note

`packages/squadboard-sdk` has no HTTP write surface (it's a pure
file-system / scribe SDK). The `idempotencyKey` is exposed via the
MCP `capture` tool parameter and the HTTP route header/body convention.
A dedicated SDK HTTP client with typed `idempotencyKey` is deferred.

---

## Follow-ups

- **SDK HTTP client**: If a `squadboard-sdk` HTTP write client is added in a future wave,
  expose `idempotencyKey?: string` on each write method.
- **`report_bug` / `add_feature` / `add_chore` MCP tools**: These tools do not exist
  yet in the MCP server; all issue creation goes through `capture`. When dedicated write
  tools are added, wire the same auto-generation pattern.
