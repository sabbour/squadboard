# Decision: Project Name Relocation to Top Header

**Date:** 2026-05-15  
**Author:** Fenster (UX Designer)  
**Status:** Implemented

---

## What changed

The active project name was previously rendered inside the sidebar's `NavDrawerBody` as a plain `<div>` with a custom font-size (`'14px'` — a Fluent2 violation). It was clipped/hidden by the sidebar's overflow at certain sidebar heights.

It has been relocated to the **top header bar** (`topBar` div in `Layout.tsx`), on the **left side** of the bar — anchored to the left edge, with the action buttons (Inbox / Consult / Capture) remaining on the right.

---

## Placement decision

**Left of the action buttons, right of the implicit sidebar boundary.**

The topBar spans the full width of the `main` column (everything to the right of the sidebar). Positioning the project name at the far left of this column mirrors the convention of many multi-project tools (Linear, Notion, GitHub): app logo/nav is left, current context label is the next thing you see, global actions are right.

No logo was added to the topBar — the Squadboard wordmark already sits in the sidebar header and remains there. The project name therefore acts as the "current context" breadcrumb for the main content area.

---

## Sidebar version: removed

The old sidebar `projectName` div has been **removed entirely**. Rationale:

- It was the clipping-prone element that prompted this ticket.
- The section headers (`WORK`, `SQUAD`, `OPERATIONS`) already scope the sidebar nav items to "this project" — a redundant label above them added noise without value.
- Keeping both (sidebar + header) would create a confusing duplication. The header is more persistent (always visible even when scrolling page content), so it's the canonical location.

---

## Fluent2 components used

| Concern | Component / Token |
|---|---|
| Project switcher button | `Button` (`appearance="subtle"`, `iconPosition="after"`) |
| Switch affordance icon | `ChevronDown16Regular` from `@fluentui/react-icons` |
| Typography weight | `tokens.fontWeightSemibold` (Body1Strong equivalent) |
| Right-side button gap | `tokens.spacingHorizontalS` (8 px) |
| Truncation | `'& .fui-Button__text': { overflow: hidden, textOverflow: ellipsis, whiteSpace: nowrap }` on the `projectSwitcher` makeStyles slot |

No ad-hoc `fontSize` or `px` spacing values were introduced in the new styles. The `maxWidth: '240px'` on `projectSwitcher` is a layout bound (not a typography token) — acceptable per Fluent2 canon for container sizing.

---

## Empty-state behaviour

When `projectName === null` (either no project is selected, e.g. on `/projects`, or the project fetch failed), the switcher button is **not rendered**. The `topBarLeft` div collapses to zero width. The `justifyContent: space-between` on `topBar` then pushes the right-side buttons flush-right — identical visually to the pre-change state.

---

## Truncation at narrow widths

The `projectSwitcher` button is constrained to `maxWidth: 240px`. At very narrow viewport widths the button will reach that cap, and the internal text span truncates with an ellipsis (`text-overflow: ellipsis`). The chevron icon remains visible. The full project name is available via the `title` attribute on the button.
