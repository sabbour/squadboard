# Keyser W26 UI Bug Batch

**Date:** 2026-05-16  
**Author:** Keyser (Frontend Dev)  
**Wave:** 26  
**Commit:** 53cba6eb  
**Status:** Shipped

---

## Bug 1 (P0): Routing page crash in Agents section

**Root cause:** Two compounding issues:
1. `RoutingLogTable` received non-array data from the server (e.g., `{ error: "..." }` with HTTP 200), causing `entries.map is not a function` to throw.
2. `entry.score.toFixed(2)` crashed when the server returned `score` as a string instead of a number.

**Fix:**
- `RoutingLogTable.tsx`: Changed empty-state guard to `!Array.isArray(entries) || entries.length === 0` — handles any non-array response shape.
- `RoutingLogTable.tsx`: Changed score render to `typeof entry.score === 'number' ? entry.score.toFixed(2) : Number(entry.score).toFixed(2)` — handles string scores.
- `Agents.tsx`: Added `RoutingErrorBoundary` class component wrapping the entire routing tab content. Future render crashes degrade gracefully with a "Retry" affordance instead of crashing the app.

**Status:** Fixed

---

## Bug 2: Reassign + Run actions open side panel instead of acting

**Root cause:** Classic event bubbling. The footer row (assignee avatar + RunButton) was nested inside `<div onClick={() => onOpen(issue)}>`. Any click in the footer area propagated up and opened the detail panel.

**Fix — IssueCard.tsx:**
- Moved the footer div OUTSIDE the `onClick={onOpen}` wrapper. The title/labels/badges area remains clickable-to-open; the footer is not.
- Added `onClick={(e) => e.stopPropagation()}` on the footer div as a belt-and-suspenders guard.
- Replaced the static assignee `<Avatar>` with a **Reassign button**: clicking the avatar (or `PersonSwap20Regular` icon when unassigned) opens an inline agent picker dropdown. Selecting an agent calls `useAssignIssue` (new hook, `PATCH /api/projects/:id/issues/:issueId` with `{ assigneeId }`). Dropdown closes on outside click via `useEffect` + `ref`.
- RunButton already shows a "Done" flash and pulse indicator; propagation fix ensures it no longer opens the panel.

**New API hook:** `useAssignIssue(projectId)` added to `packages/client/src/api/issues.ts`.

**Status:** Fixed

---

## Bug 3: "Investigate in Conjure" dead button removed

**File:** `packages/client/src/components/board/CardDetail.tsx`

The "Investigate in Conjure" MenuItem was the sole item in the panel header's overflow Menu. The button navigated to `/projects/:id/consult/new?prefill=issue:…` which Brady confirmed does nothing.

**Removed:**
- Entire `<Menu>…</Menu>` block (MenuTrigger, MenuPopover, MenuList, MenuItem)
- `useNavigate` import and `navigate` variable (only used for this button)
- `Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, Tooltip` from Fluent imports
- `MoreHorizontal20Regular, Lightbulb20Regular` from icon imports

**Preserved:** Conjure FAB on board, Consult top-bar button, ConjureModal — untouched. Only the dead CardDetail button is gone.

**Status:** Fixed

---

## Bug 4 (W22 regression): Heartbeat nav takes user out of project scope

**Root cause:** `handleNavItemSelect` in `Layout.tsx` hardcoded `navigate('/heartbeat')` regardless of whether the user was inside a project (`/projects/:id/*`). This is the third recurrence of the W22 "jarring scope change" directive.

**Fix — Layout.tsx:**
- `handleNavItemSelect` for `'heartbeat'`: now navigates to `/projects/${id}/heartbeat` when `id` is set, otherwise `/heartbeat`.
- `getSelectedValue`: added early `location.pathname.includes('/heartbeat')` check inside the `id`-scoped block so `/projects/:id/heartbeat` correctly highlights the Heartbeat nav item.

**Pattern:** Same scope-preserving logic already applied to `diagnostics` nav item — Heartbeat now matches.

**Status:** Fixed

---

## Scope Guard

- Server / engine code: untouched (Hockney + Verbal own W26 backend items)
- Conjure design: intact (FAB on board, Consult top-bar button, ConjureModal — all unchanged)
- W25 collapsed-nav fix: intact (Layout.tsx navLabelHidden pattern not touched)
- No emojis introduced — Fluent2 icons only
