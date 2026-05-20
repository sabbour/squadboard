# Bug: Squad Sync status page exposes implementation plumbing instead of cross-client guidance

| Field | Value |
|-------|-------|
| **Bug ID** | `bug-2026-05-20-squad-sync-status-page-exposes-implementation-plumbing-instead-of-cross-client-guidance` |
| **Reported** | 2026-05-20 |
| **Severity** | 🟠 high |
| **Component** | ui |
| **Assigned to** | Keyser |
| **Status** | Resolved |

## Reproduction Steps

1. Open a Squadboard project that has sync projection artifacts present.
2. Navigate to Project settings -> Squad Sync.
3. Review the status page shown in the attached screenshot.

## Expected Behavior

The page should explain, in user-facing terms, where the project lives, whether CLI/Copilot can continue from it, and the next handoff action to take. Implementation details such as database providers, filesystem mirror internals, .squad artifact inventories, and repair/export jargon should not be the primary UX.

## Actual Behavior

The page leads with 'No live filesystem mirror — explicit bridge required', describes PostgreSQL/PGlite storage, shows required/recommended .squad artifacts, and frames export as manual repair work. The result reads like diagnostics instead of a workflow for interchangeable Squadboard and CLI/Copilot use.

## Additional Context

Image: /mnt/c/Users/asabbour/AppData/Local/Temp/copilot-image-c25bcf.png. User feedback: 'this whole page doesn't make sense'. Acceptance: hide provider/mirror/artifact plumbing from the primary panel; keep diagnostics only behind an advanced disclosure; preserve preview export behavior and focused regression coverage.

## Fix Checklist

- [ ] Root cause identified and documented here
- [ ] Fix implemented on worktree branch `squad/bug-2026-05-20-squad-sync-status-page-exposes-implementation-plumbing-instead-of-cross-client-guidance`
- [ ] Regression test added (Kujan sign-off required)
- [ ] Fix merged to `main` — worktree removed
- [ ] This doc updated with resolution notes

## Resolution

**Resolved:** 2026-05-20T11:50:58Z  
**Root cause:** The primary page rendered implementation-level artefacts as first-class content — a "Source of truth" label, a "PostgreSQL-backed" storage card, required/recommended `.squad` artifact checklists, a "Projection gaps found"/"No projection gaps reported" heading, and "Repair actions"/"Manual export actions" section titles. These answered internal SDK questions, not the user's cross-client workflow questions.

**Files changed:**
- `packages/client/src/components/settings/SquadSyncStatusPanel.tsx`
  - `driftTitle` fallbacks renamed: "Projection gaps found" → "Sync files need attention"; "No projection gaps reported" → "Sync files up to date"
  - `driftMessage` fallbacks cleaned: removed "Drift hashes are not exposed yet." and "artifact gaps" jargon
  - FactCard label "Source of truth" → "Lives in"
  - Action section heading: "Repair actions" → "Repair needed"; "Manual export actions" → "Sync to CLI/Copilot"
  - "No repair actions reported. Refresh after backend sync routes are available." → "No sync actions needed right now."
  - Artifact checklists and drift detail card moved into a `<details>` Diagnostics disclosure, out of primary view
  - Primary content wrapped in `data-testid="squad-sync-primary"` so tests can scope assertions cleanly
- `packages/client/src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx`
  - Added `primary view does not expose implementation jargon`: asserts `squad-sync-primary` is free of "projection gaps", "Repair actions", "Manual export actions", "source of truth", "Drift hashes", "artifact gaps"
  - Added `primary view answers the three cross-client questions`: asserts "Lives in", CLI/Copilot copy, and "Sync to CLI/Copilot"/"Preview Export" action are present
  - All 9 tests pass (7 original + 2 new)

**Validation:** `pnpm --filter @sabbour/squadboard-client test -- --run src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx` → 9/9 ✓
