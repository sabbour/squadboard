## W22 Lesson — Conjure Misdiagnosis Correction

**Date:** 2026-05-16  
**Wave:** 22

The Conjure misdesign lesson: W15/W19/W21 all misdiagnosed Conjure as a label problem on the Consult surface rather than a missing modal. The root causes were:

1. The classifier file (`conjure-classifier.ts`) existed, creating the false impression that "Conjure is implemented — just needs UI"
2. The design spec lived in `decisions-archive.md` (lines 1666–1960), not `decisions.md` — agents reading only `decisions.md` missed the canonical design
3. No verbatim spec quotes in W15/W19/W21 close-out docs — the absence of quotes was the single best leading indicator of misdiagnosis

**Hardening for future work:**
- **ALWAYS quote the spec verbatim** — minimum 3 consecutive lines — in any decision doc closing out a feature. Absence of quotes is a red flag that the agent inferred from code rather than reading the actual spec.
- **Before claiming a missing feature is shipped,** verify that the component file named in the spec actually exists in the codebase. If the spec says "build ConjureModal.tsx," search for ConjureModal.tsx. If it doesn't exist, it's not shipped, no matter what labels you renamed.
- **Mention both decisions.md AND decisions-archive.md** when dispatching agents against design specs. Archive content is just as authoritative as live decisions, but it's easy to miss.

This wave's Keyser-w22 correctly quoted 3 spec lines verbatim in the close-out doc — this pattern should be mandatory for all future feature closures.

---

## W23 Lesson — Fluent Icon Sweep at Scale

**Date:** 2026-05-16  
**Wave:** 23  

**UI — Fluent icon sweep (Ahmed 2026-05-16 directive): 106 glyphs → Fluent icons across 41 files.** Pattern: 40-entry systematic mapping table established (✓→Checkmark, ✗→Dismiss, ⚠→Warning, etc.). Structural changes (Pill icon prop, KIND_ICON maps, SVG text fallback). Keep the mapping table for re-use.

**Takeaway:** React components can't go in JSX-incompatible props (Badge text, Dropdown Option, toast strings). SVG `<text>` requires unicode outside emoji ranges. Always run grep to verify zero violations post-sweep. Document exceptions (markdown, tests) explicitly.



---

## W24 Close-Out

**Date:** 2026-05-16  
**Status:** Completed

### Summary

Keyser delivered W24 UX feature set: Conjure↔Consult re-swap + collapsible left navigation. Multiple commits (6cd1ae15, 55b4383f, 0f6315f9). Self-committed with proper co-author attribution. Build verified green before commit.

### Lineage

- **Todo 1:** w24-ux-conjure-consult-swap (Commit: 6cd1ae15)
  - Top-bar button: Conjure wand → Consult (ChatHelp icon)
  - Left-nav Consult entry removed
  - Route `/consult/new` still exists via top-bar button

- **Todo 2:** w24-ux-collapsible-nav (Commit: 6cd1ae15)
  - Collapse/expand toggle for left sidebar
  - Icons-only when collapsed (56–64px width)
  - Persists to localStorage (`squadboard.nav.collapsed`)
  - Smooth CSS transition (200ms ease)
  - Tooltips on icons when collapsed
  - Section headers hidden when collapsed

### Build Status

✓ Green (tsc + vite, 7.05s, zero type errors)

### Pattern

No orphan-completion. Keyser self-committed with proper workflow.

---

## Compaction Note

This history file exceeds 15KB. Older waves (W1–W20) are archived in `.squad/decisions.md`.
Current focus: W21–W24. For earlier context, search `.squad/decisions.md` by wave number.

---

## W24 Lessons — Conjure/Consult Re-Swap + Collapsible Nav

**Date:** 2026-05-16
**Wave:** 24
**Commits:** 6cd1ae15 (Item A — Conjure→Consult swap + nav removal), 55b4383f (Item B — collapsible nav, empty commit — changes were in first commit since both items were in Layout.tsx)

### Conjure/Consult Re-Swap — Pattern

This is the **2nd correction in 3 waves** (W22 put Conjure in the top bar; W24 reverts it to Consult). What would have prevented it:

1. **Read the most recent directive in `decisions/inbox/` BEFORE reading the spec.** W22 correctly followed the spec at the time. W24 is a product decision, not a spec violation. No amount of spec-reading would have caught it — only reading the latest human directive would have.
2. **Treat top-bar buttons as product-level decisions, not dev-level layout.** Before changing any top-bar button (add/remove/relabel), re-read the last 3 directives in `decisions/inbox/` regardless of what the spec says.
3. **Checklist for Conjure/Consult entry-point changes:** (a) re-read canonical Conjure spec at `decisions-archive.md` lines 1666–1960; (b) read the most recent directive in `decisions/inbox/`; (c) verify Board FAB, keyboard shortcuts, and ConjureModal are untouched.

### NavDrawer Collapse — Approach Used

**Approach: Hybrid CSS-width + conditional Tooltip wrapping.**
- Applied a `navDrawerCollapsed` makeStyles class (`width: 56px; minWidth: 56px; overflow: hidden`) to the NavDrawer when collapsed, with a CSS `transition: 'width 200ms ease'` in the base `navDrawer` style.
- Conditionally rendered each NavItem's label text (`{navCollapsed ? null : 'Label'}`) to hide text when collapsed.
- Wrapped every NavItem in a Fluent `<Tooltip>` with `positioning="after"` and `hideDelay={0}` when collapsed, for proper hover hints.
- Logo image hidden when collapsed (`{!navCollapsed && <div ...logo...>}`) since the horizontal image would overflow 56px.
- NavSectionHeaders hidden when collapsed (`{!navCollapsed && <NavSectionHeader>...`).
- localStorage key: `'squadboard.nav.collapsed'` (boolean string).

**Why not pure CSS (approach 1):** CSS-only couldn't handle Tooltip wrapping — Tooltip requires a proper React component tree child. The hybrid gives a smooth width transition (CSS) with proper Tooltip UX (conditional JSX).

**Why not full conditional render (approach 2):** Would duplicate all NavItem logic. The hybrid keeps a single NavDrawer component tree, with only label text + Tooltip rendering conditionally.

**Caveat for testers:** Fluent NavItem with no children (collapsed state) renders icon-only. The selected highlight still works via `selectedValue` on NavDrawer. Section headers are absent in collapsed state — no grouping visual — acceptable for 56px icon-only mode.

---

## W25 — Collapsed Nav Regression Fix (commit f5d03f4f)

**Date:** 2026-05-16  
**Wave:** 25

### Bug 1 — Toggle alignment when expanded

The `navCollapseToggle` wrapper was always `justifyContent: 'center'`. Added `navCollapseToggleExpanded` with `justifyContent: 'flex-end'` + `paddingInlineEnd: tokens.spacingHorizontalS`, applied via `mergeClasses` when `!navCollapsed`. Toggle now right-aligns when expanded (push-away affordance) and stays centered when collapsed.

### Bug 2 — NavItems not clickable in collapsed mode ⚠️ (CRITICAL LESSON)

**Root cause:** `<NavItem icon={...} value="..." />` with no children renders no inner button/link DOM element. Fluent UI's `NavItem` uses its children as the click target. Without children, the component renders an orphaned icon with no interactive wrapper — clicks never reach `onNavItemSelect`.

**The broken W24 pattern:**
```tsx
<Tooltip content="Projects" relationship="label" positioning="after" hideDelay={0}>
  <NavItem icon={<Home24Regular />} value="projects" />
</Tooltip>
```
`Tooltip relationship="label"` only wires up `aria-labelledby`. It does NOT add a click target. This pattern silently killed every collapsed nav click.

**Fix — Option A (hidden span):** Always render children, hide text with CSS:
```tsx
<NavItem icon={<Home24Regular />} value="projects">
  <span className={styles.navLabelHidden}>Projects</span>
</NavItem>
```
`navLabelHidden: { display: 'none' }` in makeStyles. The span keeps the click target alive in the DOM; CSS suppresses the visible text. Selected state, tooltips, and keyboard nav all still work.

### Learnings

- **NEVER render Fluent `NavItem` without children in any clickable context.** Without children, the click target does not exist — clicks silently die. No runtime error, no console warning.
- **`Tooltip relationship="label"` ≠ click target.** It only sets aria-labelledby. It does not wrap the child in a button.
- **Option A (hidden span) is the right pattern for icon-only nav:** deterministic, keyboard-accessible, tooltip-compatible, minimal diff.


---

## W25 Close-Out

**Date:** 2026-05-16

Shipped W25 collapsible-nav regression fix. Two bugs:
1. NavItems in collapsed mode had no DOM click targets (fixed with hidden span children).
2. Collapse toggle was center-aligned instead of right-aligned in expanded state (fixed with `navCollapseToggleExpanded` style).

**Commit:** f5d03f4f

See `.squad/decisions.md` for full details.

---

## W26 — Four-Bug Batch (commit 53cba6eb)

**Date:** 2026-05-16  
**Wave:** 26

### Bug 1 (P0) — Routing tab crash

**Root cause (two paths):**
1. API returning non-array (e.g. `{ error: "..." }` with HTTP 200) → `entries.map is not a function`
2. `entry.score` arriving as a string from the server → `entry.score.toFixed is not a function`

**Fix pattern:**
- `RoutingLogTable`: `Array.isArray(entries)` guard; `typeof entry.score === 'number'` check.
- `Agents.tsx`: Added `RoutingErrorBoundary` class component (React class component for error boundary, matching existing `CheckCardErrorBoundary` in Diagnostics.tsx). Wraps the entire routing tab — future crashes show inline error + Retry instead of crashing the app.

**Lesson:** When the server might return `200 OK` with an error object instead of the typed array, React Query treats it as valid data. Defensive `Array.isArray` in list components is always warranted when `refetchInterval` is active.

### Bug 2 — Action buttons opening side panel

**Root cause:** Footer row (assignee + RunButton) was inside `<div onClick={() => onOpen(issue)}>`. All clicks in the footer propagated to open the detail panel.

**Fix pattern:** Move footer OUTSIDE the clickable-title div. Add `stopPropagation` on footer for defense in depth. Restructure assignee to a Reassign button with inline agent picker dropdown (same dropdown pattern as RunButton). New `useAssignIssue` hook in issues.ts sends `PATCH /api/projects/:id/issues/:id` with `{ assigneeId }`.

**Lesson:** Any interactive element inside an `onClick` wrapper needs `stopPropagation`. Always audit new UI features for accidental nesting inside card click zones.

### Bug 3 — "Investigate in Conjure" dead button

**Fix:** Remove the entire Menu/overflow block from CardDetail panel header. When the only MenuItem in a Menu is dead, remove the whole Menu — don't leave a "..." trigger that does nothing.

**Lesson:** Dead action buttons should be removed immediately, not hidden or disabled. `navigate()` to a route that doesn't work is a silent failure that confuses users.

### Bug 4 — Heartbeat nav scope regression (3rd recurrence)

**Root cause:** `handleNavItemSelect('heartbeat')` hardcoded `/heartbeat` regardless of project context.

**Fix:** `id ? /projects/${id}/heartbeat : /heartbeat` — same pattern used for `diagnostics`. Added matching `includes('/heartbeat')` check in `getSelectedValue` so the nav item highlights correctly when on `/projects/:id/heartbeat`.

**Lesson:** Every new nav item in Layout.tsx must be audited for project-scope preservation. The W22 directive ("no jarring scope changes") applies to ALL nav items, not just the ones explicitly called out. A checklist should be added to Layout.tsx PR reviews: "Does every nav item preserve `/projects/:id/` prefix when in project context?"

---

## W26 — Run Button Regression Fix (post-batch-1)

**Date:** 2026-05-16  
**Wave:** 26

### Root Cause

The W26 four-bug batch (commit `53cba6eb`) correctly moved the RunButton outside the `onClick→onOpen` title wrapper. The click handler itself was NOT dropped — `startRun.mutate` fires when Run is clicked. The regression was a **visual feedback gap**:

- **Before W26:** Clicking Run also triggered `onOpen(issue)` (panel opened as incidental side-effect), giving Brady immediate visual confirmation.
- **After W26:** The footer's `stopPropagation` correctly blocks the panel open, but the button's `style` only responded to `activeAgents.length === 0`, NOT to `startRun.isPending`. The button became `disabled` while looking identical — Brady saw nothing happen and concluded "Run is broken."

Confirmed: click IS firing, API call IS being made. No downstream dispatch/heartbeat issue.

### Fix

`RunButton.tsx`:
- `data-testid="task-run-button"` added.
- `cursor` and `opacity` styles now include `startRun.isPending` in the condition.
- Button text changes to `Starting…` while pending (was `▶ Run` even when disabled).
- Background dims slightly while pending for visual affordance.

### Test Infrastructure Added

No test runner existed in `packages/client`. Added vitest + @testing-library/react + jsdom + @testing-library/user-event. 3 tests written and passing for RunButton.

### Lesson

When visual feedback depends on an incidental side-effect of a bug (panel opening because Run was inside the onOpen wrapper), fixing the bug removes that feedback. Always audit every interactive element for its OWN visual confirmation path — don't rely on ambient side-effects to signal state changes.
