# W24 UX Corrections — Keyser Close-Out

**Date:** 2026-05-16
**Branch:** keyser/w17-settings-backup-github
**Author:** Keyser (Frontend Dev)

---

## Item A — Conjure→Consult Top-Bar Swap + Remove Consult from Left Nav

**Tag:** w24-ux-conjure-consult-swap
**Commit:** 6cd1ae15

### What changed

- **Top-bar button:** `Wand20Regular` / "Conjure" (opens ConjureModal) replaced with `ChatHelp20Regular` / "Consult" (navigates to `/projects/:id/consult/new` when in a project, `/consult/new` globally).
- **Left nav:** `<NavItem value="consult">Consult</NavItem>` removed. The route `/consult/new` still exists and is reachable via the top-bar button or deep link.
- **`handleNavItemSelect`:** `value === 'consult'` case removed (no longer reachable from sidebar).
- **`getSelectedValue()`:** `/consult` pathname detection retained — if a user navigates directly to `/consult/*`, the sidebar won't highlight a non-existent item (returns `'consult'` but no NavItem has that value, so nothing lights up; harmless).
- **Imports removed:** `ChatHelp24Regular` (was the left-nav icon), `Wand20Regular` (was top-bar).
- **Import added:** `ChatHelp20Regular` (20px, matches Mail20Regular sibling in top-bar).
- **W22 code comment** about Conjure top-bar removed.

### NOT changed

- `ConjureModal.tsx` — untouched.
- `ConjureContext.tsx` — untouched.
- `Board.tsx` FAB — still opens ConjureModal.
- Keyboard shortcuts (`c`, `?`, `Ctrl+K`) — still open ConjureModal.
- `/consult/new` route component — untouched.

### Smoke test checklist for testers

- [ ] Press `c` from a non-input field → ConjureModal opens
- [ ] Press `?` → ConjureModal opens
- [ ] Press `Ctrl+K` → ConjureModal opens
- [ ] Click "+" FAB on Board → ConjureModal opens
- [ ] Click "Consult" in top bar (inside a project) → navigates to `/projects/:id/consult/new`
- [ ] Click "Consult" in top bar (no project selected) → navigates to `/consult/new`
- [ ] Left sidebar has no "Consult" item

---

## Item B — Collapsible Left Navigation

**Tag:** w24-ux-collapsible-nav
**Commit:** 6cd1ae15 (bundled with Item A — both in Layout.tsx)

### What changed

- **State:** `navCollapsed: boolean` initialized from `localStorage.getItem('squadboard.nav.collapsed') === 'true'`.
- **Persistence:** `toggleNav()` writes `localStorage.setItem('squadboard.nav.collapsed', String(next))` on every toggle.
- **CSS:** `navDrawerCollapsed` makeStyles class (`width: 56px; minWidth: 56px; overflow: hidden`). Base `navDrawer` style gains `transition: width 200ms ease`.
- **Toggle button:** `ChevronDoubleLeftRegular` (collapse) / `ChevronDoubleRightRegular` (expand) button at top of `NavDrawerBody`. `appearance="subtle"`.
- **Collapsed rendering:**
  - Each NavItem wraps in `<Tooltip positioning="after" hideDelay={0}>` when collapsed.
  - NavItem children are `null` when collapsed (icon-only).
  - `NavSectionHeader` elements hidden when collapsed.
  - Logo image hidden when collapsed (horizontal image overflows 56px).
- **Approach:** Hybrid CSS-width + conditional Tooltip JSX (not full conditional render). NavDrawer component tree stays singular; only label text and Tooltip wrapping are conditional.

### Smoke test checklist for testers

- [ ] Toggle button collapses sidebar smoothly (~200ms)
- [ ] Toggle again expands
- [ ] Reload page → collapsed state persists (or not, depending on what you left it at)
- [ ] Collapsed: icons visible, no text labels, hover on icon shows Tooltip with label
- [ ] Collapsed: selected item still highlighted
- [ ] Expanded: normal layout, section headers visible, no regressions
- [ ] Top bar position unaffected by collapse (main content reflows automatically)

### Caveats

- Section headers (WORK, SQUAD, OPERATIONS, SYSTEM) are absent in collapsed state — no grouping visual. Expected for icon-only mode.
- Logo is hidden when collapsed. No compact logo variant exists — a small icon-only logo could be added in a future wave.
- The empty `55b4383f` commit is a bookkeeping artifact (Item B was already in 6cd1ae15).

---

## Build Status

`pnpm -C packages/client build` → ✓ green (tsc + vite, 7.05s, zero type errors)
