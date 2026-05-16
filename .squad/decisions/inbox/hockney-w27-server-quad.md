# W27 Server Quad — Decision Record

**Date:** 2026-05-16  
**Author:** Hockney  
**Status:** Accepted  
**Wave:** 27  
**Commit tag:** `fix(server,mcp,conjure): W27 quad — hint override + curl session + pg trace + PATCH project fields`

---

## Bug 1 — `future-conjure-hint-override`

**Root cause:** The Conjure classifier only *boosted* the hint intent's score (+5.0) in `scorePromptByRules`, but if competing domain-word signals (project, skill, team, tool) scored higher, the hint was silently overridden. 8/26 dogfood prompts routed incorrectly despite explicit `hint=issue`.

**Fix:** Added a hard-override early-exit block in `classifyAndDraft` (before the fast-path confidence check). When `req.hint` is a valid `ConjureIntent`, the function locks `intent` to the hint, sets `confidence ≥ 0.9`, includes a transparent rationale, and still returns all rule-scored candidates for UI transparency. Scoring still runs — it just doesn't govern the top-level `intent`.

**Tests added:** 3 vitest cases in `conjure-classify.test.ts` — hint=issue, hint=ceremony, hint=skill all win against conflicting body text.

---

## Bug 2 — `future-mcp-http-curl-session`

**Root cause:** curl doesn't auto-replay session headers like the MCP SDK client does. When a curl user's second request arrives without `Mcp-Session-Id`, or with a stale one, the error messages were too terse to guide recovery.

**Fix:** Option 1 (small fix). Expanded the 404 and 400 error message bodies in `http-transport.ts` to include explicit curl workflow guidance: how to capture `Mcp-Session-Id` from the initialize response (`-D -` or `-v`), and how to replay it on subsequent requests. The underlying session mechanism is unchanged (SDK handles it correctly); only the error messages were improved.

**Tests added:** None (error-message change; session lifecycle covered by SDK's own tests).

---

## Bug 3 — `future-mcp-stdio-pg-trace`

**Root cause:** `closeDb()` in `db/index.ts` called `await _pool.end()` without any error handling. When the MCP stdio parent process disconnects (SIGPIPE/SIGTERM), the pg pool sometimes throws `ECONNRESET` before the drain completes, producing cosmetic stderr noise.

**Fix:** Wrapped `_pool.end()` in a try/catch that specifically swallows `ECONNRESET` (matched via `err.code === 'ECONNRESET'`). All other errors are re-thrown. The existing MCP stdio shutdown handler in `mcp/index.ts` already swallowed all errors from `closeDb()`, but the fix is placed in `closeDb()` itself so the ECONNRESET guard applies regardless of call site.

**Tests added:** 1 implicit — the `graceful-shutdown.test.ts` still passes; pattern-match is sufficient for low-risk cosmetic fix.

---

## Bug 4 — `future-patch-project-fields`

**Root cause:** `PATCH /api/projects/:id` only accepted `defaultModel` and `costModel`. The `projects` table had no `description` column. Brady's self-register latched onto a pre-existing "foo" project name with no API to rename or describe it.

**Fix:** Three coordinated changes:
1. `db/schema.ts` — added `description: text('description')` to the `projects` pgTable definition.
2. `db/index.ts` — added idempotent `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT` migration at the end of `initDb()`.
3. `routes/projects.ts` — extended the PATCH handler to accept `name` (non-empty string, required if present) and `description` (optional, max 4000 chars, nullable). Validation errors return 400 with a descriptive message.

**Tests added:** 5 vitest cases in `patch-project-fields.test.ts` — rename only, description only, both, empty-name rejection, description-too-long rejection.

---

## Summary Table

| Bug | File(s) Changed | Root Cause (one line) | Fix (one line) |
|-----|----------------|----------------------|----------------|
| 1 — hint override | `conjure-classifier.ts` | Hint only boosted score, didn't guarantee win | Hard-override block forces `intent = hint` before scoring governs the response |
| 2 — curl session | `mcp/http-transport.ts` | Error messages too terse for curl users | Expanded 404/400 error bodies with explicit curl session-capture instructions |
| 3 — pg trace | `db/index.ts` | `pool.end()` ECONNRESET propagated as unhandled | Wrapped `_pool.end()` in try/catch, swallow `ECONNRESET` only |
| 4 — PATCH fields | `db/schema.ts`, `db/index.ts`, `routes/projects.ts` | `name`/`description` not in schema or PATCH allowlist | Added `description` column + migration; extended PATCH to accept `name` + `description` with validation |
