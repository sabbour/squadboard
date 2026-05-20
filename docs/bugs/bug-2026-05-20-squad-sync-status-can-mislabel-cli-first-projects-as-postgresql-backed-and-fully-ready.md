# Bug: Squad Sync status can mislabel CLI-first projects as PostgreSQL-backed and fully ready

| Field | Value |
|-------|-------|
| **Bug ID** | `bug-2026-05-20-squad-sync-status-can-mislabel-cli-first-projects-as-postgresql-backed-and-fully-ready` |
| **Reported** | 2026-05-20 |
| **Severity** | 🟠 high |
| **Component** | sdk |
| **Assigned to** | Kobayashi |
| **Status** | Fixed |

## Reproduction Steps

1. Start with an existing project that was initialized and used from Squad CLI/Copilot with a populated `.squad/` directory.
2. Register/open that project in Squadboard.
3. Open Settings -> Team Sync / Squad Sync.
4. Observe the status cards and storage/source-of-truth labels.

## Expected Behavior

The status should distinguish the project authority from the server runtime. CLI/Copilot-first filesystem projects should show filesystem `.squad/` as the authority unless they have been explicitly imported into Squadboard DB authority, and readiness should describe what is and is not continuously synced.

## Actual Behavior

The UI can show green readiness checks and report PostgreSQL-backed storage for projects that appear to be CLI/Copilot-first filesystem projects, which implies sync is fully working when it may only mean the server runtime uses PGlite/PostgreSQL and required projection artifacts are present.

## Additional Context

Current status envelope uses global storage provider resolution (`SQUADBOARD_SQUAD_STORAGE_PROVIDER`, default postgresql) rather than project-origin/authority detection. The UI labels this as storage mode/source of truth, so existing filesystem projects can look database-backed and fully ready. The existing contract also says `mirrorBehavior: none` and `continuousSync: false`, so green checks should not be interpreted as live bidirectional sync.

## Fix Checklist

- [x] Root cause identified and documented here
- [x] UI mitigation implemented on worktree branch `feat/project-danger-zone`
- [x] Regression test added for not overclaiming live sync
- [x] Regression test added for CLI/Copilot-first project-origin authority detection
- [ ] Fix merged to `main` — worktree removed
- [x] This doc updated with resolution notes

## Resolution

Squad Sync now treats `continuousSync: false` in PostgreSQL/PGlite mode as a **manual bridge**, not a green “live two-way sync” state. The dashboard also surfaces this status, and Settings separates manual export actions from required repair actions.

McManus added project-aware authority detection so status and SDK state no longer rely only on `SQUADBOARD_SQUAD_STORAGE_PROVIDER`. New Squadboard-first projects persist `projects.storage_provider_mode = 'postgresql'`; newly registered existing `.squad/` directories persist `filesystem`. Legacy rows are inferred from evidence: imported `squad_storage` rows indicate DB authority, while a populated filesystem `.squad/` with no DB rows stays filesystem-authoritative. Regression coverage now verifies CLI/Copilot-first filesystem projects are not labeled as PostgreSQL-backed or `squad_storage` authoritative.

Follow-up UX truthfulness fixes are included: project diagnostics report Squad Sync authority/health, the Dashboard Squad Sync tile opens Settings -> Squad Sync, manual bridge copy explains there is no continuous sync toggle, and repair buttons run preview-only dry runs that list proposed changes before any future apply flow can mutate files.
