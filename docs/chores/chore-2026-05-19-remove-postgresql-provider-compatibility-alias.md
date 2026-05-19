# Chore: Remove PostgreSQL provider compatibility alias

| Field | Value |
|-------|-------|
| **Chore ID** | `chore-2026-05-19-remove-postgresql-provider-compatibility-alias` |
| **Created** | 2026-05-19 |
| **Effort** | small |
| **Component** | config |
| **Assigned to** | Hockney |
| **Status** | Backlog |

## Goal

Remove the legacy pglite compatibility alias from Squadboard's PostgreSQL StorageProvider configuration so only canonical `postgresql` selects DB-backed Squad storage explicitly, then document the default PostgreSQL launch and explicit filesystem fallback for existing Squad repos.

## Implementation Notes

Keep filesystem storage as an explicit fallback. Update provider tests and docs. Add one-command launch recipes for default PostgreSQL, external `DATABASE_URL`, and `--squad-storage fs`; explain existing `.squad` one-time import behavior.

## Checklist

- [ ] Work done in worktree branch `squad/chore-2026-05-19-remove-postgresql-provider-compatibility-alias`
- [ ] No new user-facing docs required
- [ ] Merged to `main` — worktree removed
