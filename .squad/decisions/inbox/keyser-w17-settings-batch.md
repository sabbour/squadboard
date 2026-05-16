# Decision: W17 Settings Batch — Backup/Restore UI + GitHub Integration

**Date:** 2026-05-15T22:42:29.855-07:00
**Author:** Keyser (Frontend Dev)
**Wave:** 17
**Status:** Shipped
**Branch:** keyser/w17-settings-backup-github
**Commit:** 7b3930e6

---

## Summary

Two new Settings sections shipped as one PR — Backup & Restore and GitHub Integration.

---

## Files Touched

| File | Change |
|------|--------|
| `packages/client/src/pages/Settings.tsx` | +2 nav items (backup, github), section renderers, icon imports |
| `packages/client/src/components/settings/SystemBackupSection.tsx` | New — backup list, Back-up-now, RestoreDialog |
| `packages/client/src/components/settings/SystemGitHubSection.tsx` | New — auth card, permissions table, branch convention, test buttons |
| `packages/server/src/routes/system.ts` | +POST /api/system/restore, +GET /api/system/gh-auth-status, +POST /api/system/gh-test |

---

## Deliverable 1 — Backup/Restore UI (w16-restore-ui)

### Backup section

- `GET /api/system/backups` → lists files in `~/.squadboard/backups/` (newest first), showing filename, timestamp, size.
- "Back up now" → `POST /api/system/backup` → inline `MessageBar intent="success"` with filename + size + duration. Error path shows `MessageBar intent="error"`.
- Static retention info card: "7 most-recent kept (configurable in `~/.squadboard/config.json`). Editing via UI planned for W18."

### Restore flow

1. User clicks **Restore…** — disabled when no backups exist.
2. `RestoreDialog` opens (Fluent2 `<Dialog>`):
   - Radio-select list of backups (custom radio UI, not Fluent `RadioGroup`, to allow per-row metadata display). Defaults to most recent.
   - `MessageBar intent="warning"` with the 6 safety invariants: daemon stop → pre-restore copy at `pglite.pre-restore-{ts}/` → replace → restart. Plus "rollback preserved / irreversible from UI" note.
   - `<Checkbox>` with label "I understand. Restore." — Submit disabled until checked.
3. Submit → `POST /api/system/restore { backupPath }` → spinner in button.
4. Success → `window.location.reload()` after 800ms (daemon restart invalidates all React Query caches anyway).
5. Failure → `MessageBar intent="error"` with server error text.

### Server (POST /api/system/restore)

Delegates to `runRestore(backupPath, { quiet: true })` from `packages/server/src/scripts/restore.ts`. Returns `ok`, `message`, `rollbackPath`, `durationMs`. Daemon-running check is enforced by `runRestore` (checks `daemon.pid`).

---

## Deliverable 2 — GitHub Integration Section (g5-3)

### Layout decisions

- **Install banner** takes the entire section if `gh` not found — prominent `MessageBar intent="warning"` with call-to-action button linking to https://cli.github.com/ (Redfoot's docs page link to be swapped in when it lands).
- **Authentication card**: status line shows ✓ / ✗ with username + protocol from `gh auth status` parse. Scopes shown inline. Re-authenticate / Logout buttons open gh CLI docs in new tab (can't shell interactively from browser — noted this is a known limitation).
- **Required permissions table**: static action→scope matrix, crossed with parsed token scopes for live ✓ / ⚠ status. Rows: Push branch (repo), Create PR (repo), Comment issue (repo), Merge PR (repo), Trigger workflow (workflow), Manage webhooks (admin:repo_hook).
- **Branch convention**: displays both formats from Verbal's W16 decision (`squad/{agent}/{slug}` and `squad/ceremony/{slug}-{id}`) plus protected-branch list in monospace code blocks.
- **Test connectivity**: three dry-run probe buttons. Each button shows a per-result caption (✓ / ✗ + message). Probes are read-only: auth-status check (push), `gh pr list --limit 1` (PR), `gh run list --limit 1` (workflow).

### Server endpoints

**GET /api/system/gh-auth-status**
- Checks `gh --version` first; returns `{ installed: false }` if not found.
- Shells `gh auth status --hostname github.com`, captures stdout+stderr (gh writes auth status to stderr).
- Parses: username from "account X", protocol from "Git operations protocol: X", scopes from "Token scopes: 'a', 'b'".
- Returns `{ installed, authenticated, username, protocol, scopes, permissions[] }`.

**POST /api/system/gh-test { test: 'push' | 'pr' | 'workflow' }**
- `push`: re-runs auth status, checks "Logged in" presence.
- `pr`: `gh pr list --limit 1 --json number` (read-only).
- `workflow`: `gh run list --limit 1 --json databaseId` (read-only).

### Stubs in place

No stubs needed — the backend endpoints are fully implemented in this PR. If Verbal needs to extend them for Stream G Phase 2, he can PR on top.

---

## Coordination Notes

- **Verbal (W17)**: `gh-auth-status` and `gh-test` endpoints are now in `routes/system.ts`. His `runs.ts` / `GitActions.tsx` uncommitted changes have a pre-existing tsc error (`stdout.trim()` type issue) — not introduced by this PR, and the client build is clean.
- **Redfoot (W17)**: Install banner currently links to `https://cli.github.com/`. When Redfoot ships a `/docs/setup/github-cli` page, update the `href` in `SystemGitHubSection.tsx` `GhInstallBanner`.

---

## Build Status

- Client: ✓ `tsc -b && vite build` (6.70s, zero errors in new files)
- Server: `routes/system.ts` has zero tsc errors; `runs.ts` has pre-existing error from Verbal's WIP.
