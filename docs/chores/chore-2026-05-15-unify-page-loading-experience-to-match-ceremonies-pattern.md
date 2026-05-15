# Chore: Unify page-loading experience to match ceremonies pattern

| Field | Value |
|-------|-------|
| **Chore ID** | `chore-2026-05-15-unify-page-loading-experience-to-match-ceremonies-pattern` |
| **Created** | 2026-05-15 |
| **Effort** | medium |
| **Component** | ui |
| **Assigned to** | Keyser |
| **Status** | Backlog |

## Goal

Today every page rolls its own initial-load indicator and the same page sometimes ships 2-3 different patterns. Costs.tsx shows plain text "Loading project…", Settings.tsx mixes Caption1 + Spinner size=tiny + a padded div, CeremoniesReview.tsx itself uses 3 inconsistent variants. CeremonyList.tsx (the page Ahmed flagged as the reference) has the cleanest pattern: a centered Spinner with a contextual label. Codify that pattern as a shared <PageLoading> component (plus <SectionLoading> + <InlineLoading> for in-page cases), apply across all ~20 pages, and add a dev-only /__loading-gallery for reference. Includes 150ms anti-flash delay, role=status + aria-live=polite, and prefers-reduced-motion respect. Optional route-transition top ProgressBar pending Fenster's call.

## Implementation Notes

Plan: Wave 10 plan Stream K (`/home/asabbour/.copilot/session-state/4fa34ed1-d2fd-4363-8668-f63188a1cfe3/plan.md` and mirror at `.squad/squadboard/plans/wave-10.md`). 6 todos in SQL: k1-k6 with dependency edges (k1→k2→k3→k6, k1→k4, k2→k5). Owners: Fenster K1 visual call; Keyser K2/K3/K4; Redfoot K5 docs; Kujan K6 e2e. Lower priority — parked behind Wave 10 close-out (Stream E).

## Checklist

- [ ] Work done in worktree branch `squad/chore-2026-05-15-unify-page-loading-experience-to-match-ceremonies-pattern`
- [ ] No new user-facing docs required
- [ ] Merged to `main` — worktree removed
