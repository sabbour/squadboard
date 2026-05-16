# Kobayashi — Wave 22 Loading follow-ups decision log

**Agent**: Kobayashi (SDK + data-shapes specialist)
**Wave**: 22
**Date**: 2026-05-16T01:40:00-07:00
**Commits**: `b84cbc9d` (K5) · `e64a1fca` (K7)

---

## K5 — Dev-only `/__loading-gallery` route

### Files created / modified

| File | Action |
|---|---|
| `packages/client/src/components/loading/LoadingGallery.tsx` | **Created** — gallery page component |
| `packages/client/src/App.tsx` | **Modified** — import + `{import.meta.env.DEV && <Route path="__loading-gallery" …/>}` |
| `packages/client/README.md` | **Created** — "Loading patterns" section |

### Gallery route

- URL: `/__loading-gallery`
- Gating: `{import.meta.env.DEV && <Route …/>}` — zero cost in production bundle
- Components rendered:
  - `RouteProgressBar` — description + live instance
  - `PageLoading` × 3 variants (default, custom label, large size)
  - `SectionLoading` × 3 variants (no label, label, medium size)
  - `InlineLoading` × 3 variants (default, with label, small size)
  - `ActionLoading` × 2 variants (default, with label)
- Wraps in `<PageHeader title="Loading patterns gallery" />` using the existing layout component

---

## K7 — ActionLoading component + sweep

### Files created / modified

| File | Action |
|---|---|
| `packages/client/src/components/loading/ActionLoading.tsx` | **Created** — wraps `<Spinner size="tiny" />` for button-icon slot |
| `packages/client/src/components/loading/index.tsx` | **Modified** — export added |

### Button-spinner sweep sites (3 files, 4 call-sites)

| File | Location | Before | After |
|---|---|---|---|
| `packages/client/src/pages/CeremonyList.tsx` | Line ~143 (PageHeader action) | `<Spinner size="tiny" />` | `<ActionLoading label="Ending wave…" />` |
| `packages/client/src/pages/CeremonyList.tsx` | Line ~249 (Dialog action) | `<Spinner size="tiny" />` | `<ActionLoading label="Ending wave…" />` |
| `packages/client/src/components/formulate/FormulatePanel.tsx` | Line ~99 (Formulate button) | `<Spinner size="tiny" />` | `<ActionLoading label="Formulating…" />` |
| `packages/client/src/components/agents/HireTeamModal.tsx` | Lines ~425, ~438 (Cast Team + Hire) | `<Spinner size="tiny" />` | `<ActionLoading label="Casting…/Hiring…" />` |

### Design decisions

- **Size `tiny`**: matches the existing ad-hoc pattern universally used in button `icon` props across the codebase. `extra-small` is reserved for `InlineLoading` (body text context).
- **`role="status"` + `aria-busy`**: consistent with the other loading components in the family.
- **`display: contents`**: the wrapper `<span>` is invisible to layout so the spinner sits cleanly in the button-icon slot without adding margins.
- **Unused `Spinner` import removed** from `FormulatePanel.tsx` and `HireTeamModal.tsx` after sweep. `CeremonyList.tsx` retains `Spinner` because line 184 still uses `<Spinner label="Loading ceremonies…" />` (a SectionLoading candidate for a future wave).

### Known not-swept sites (left for future waves)

- `packages/client/src/pages/ProjectPicker.tsx` — 3 more tiny spinners
- `packages/client/src/components/settings/SystemBackupSection.tsx` — 3 more
- `packages/client/src/components/settings/SystemGitHubSection.tsx` — 2 more
- `packages/client/src/components/GitHubActivityFeed.tsx` — 1 more (non-button, in text)
- `packages/client/src/pages/LiveSession.tsx` — 1 more

These were not touched to keep the PR surgical. A future sweep wave can address them.

---

## Pre-existing build failures (not introduced by this wave)

The following TypeScript errors existed before this wave and are owned by Keyser-w22:
- `src/components/conjure/ConjureModal.tsx` — unused `useCallback`
- `src/pages/Inbox.tsx` — `openConjure`, `Wand20Regular`, `ChatHelpRegular` not found

No new errors were introduced by K5 or K7 changes.
