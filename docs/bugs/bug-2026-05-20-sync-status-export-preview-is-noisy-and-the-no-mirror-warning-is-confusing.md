# Bug: Sync status export preview is noisy and the no-mirror warning is confusing

| Field | Value |
|-------|-------|
| **Bug ID** | `bug-2026-05-20-sync-status-export-preview-is-noisy-and-the-no-mirror-warning-is-confusing` |
| **Reported** | 2026-05-20 |
| **Severity** | 🟠 high |
| **Component** | ui |
| **Assigned to** | Keyser |
| **Status** | Fixed in current worktree |

## Reproduction Steps

1. Open a project that uses database-backed Squadboard storage without a live filesystem mirror.
2. Open the sync/status portability panel.
3. Click Preview Export or the repair/export preview action.
4. Inspect the preview modal and the no-live-filesystem-mirror warning banner.

## Expected Behavior

The export preview should summarize meaningful changes and clearly say when no files need updating. The sync warning should explain the user choice in concise product language with an obvious next action, not internal provider/environment implementation details.

## Actual Behavior

The Preview Export modal says the repair/export was skipped but then dumps many unchanged file paths marked already_up_to_date. The warning banner says "No live filesystem mirror — explicit bridge required" and includes long internal copy about SQUADBOARD_SQUAD_STORAGE_PROVIDER, MCP/API brokers, Preview Export, and no magic enable-auto switch, which is confusing to end users.

## Additional Context

Screenshots showed a modal titled "Preview Export" filled with unchanged .squad paths such as .squad/.secret_key and agent history/charter files, plus a sync banner with technical wording. User reaction: "?? ?????"

## Fix Checklist

- [x] Root cause identified and documented here
- [x] Fix implemented in current worktree (worktree mode disabled for this spawn)
- [x] Regression test added (Kujan sign-off required)
- [ ] Fix merged to `main` — worktree removed
- [x] This doc updated with resolution notes

## Resolution

Root cause: the sync panel rendered every dry-run file result as a user-visible detail, including `unchanged` / `already_up_to_date` no-op rows, and its database-backed status copy exposed provider/env-var implementation details instead of the user choice.

Files changed:
- `packages/client/src/components/settings/SquadSyncStatusPanel.tsx` — concise “Ready through Squadboard” copy, export/repair-specific modal labels, and no-op preview filtering with a compact unchanged-file summary.
- `packages/client/src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx` — regression coverage for provider-jargon-free copy and unchanged export previews that do not dump `.squad` paths.

Validation:
- `pnpm --filter @sabbour/squadboard-client test -- SquadSyncStatusPanel.test.tsx`
- `pnpm --filter @sabbour/squadboard-client typecheck`
