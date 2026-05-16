# Decision: W25 Collapsible Nav Regression Fix

**Agent:** Keyser (Frontend Dev)  
**Date:** 2026-05-16  
**Commit:** f5d03f4f  

## What Was Fixed

### Bug 1 — Collapse toggle alignment (expanded state)
The `navCollapseToggle` wrapper div used `justifyContent: 'center'` unconditionally.
Added a second style `navCollapseToggleExpanded` with `justifyContent: 'flex-end'` and `paddingInlineEnd: tokens.spacingHorizontalS`.
Applied via `mergeClasses(styles.navCollapseToggle, !navCollapsed && styles.navCollapseToggleExpanded)`.
Result: toggle sits at the right edge of the sidebar header when expanded (push-away affordance), centered when collapsed.

### Bug 2 — NavItems not clickable in collapsed mode
**Root cause:** All collapsed-mode `NavItem`s were rendered with no children (e.g., `<NavItem icon={...} value="projects" />`).
Fluent UI's `NavItem` uses its children content as the inner button/link element. Without children, there is no DOM click target — clicks silently die. The surrounding `Tooltip relationship="label"` only wires up `aria-labelledby`, it does NOT create a click target.

**Option chosen: A (minimal diff, hidden span)**  
Every collapsed `NavItem` now receives a hidden `<span>` as children:
```tsx
<NavItem icon={<Home24Regular />} value="projects">
  <span className={styles.navLabelHidden}>Projects</span>
</NavItem>
```
`navLabelHidden: { display: 'none' }` suppresses the text visually.
The click target exists in the DOM, `handleNavItemSelect` fires, selected state renders, keyboard nav works, tooltips still show.

Affected items: Projects, Now, all PROJECT_NAV_GROUPS (Dashboard, Board, Flow, Agents, Skills, Tools, MCP Servers, Ceremonies, Templates, Costs), Diagnostics, Heartbeat, Settings.

## Why Option A (not B or C)

- **Option B** (rely on parent overflow:hidden to clip text) is fragile — the 56px width might not perfectly clip all label widths and could cause flicker during the CSS transition.
- **Option C** (NavItem as="button") was not verified; NavDrawer preview components don't document this prop.
- **Option A** is deterministic: CSS `display:none` is guaranteed to hide the text without affecting the click target or layout.

## Rule for Future Agents

> **DO NOT render Fluent `NavItem` without children in any clickable context.**  
> The Tooltip+NavItem-without-children pattern silently breaks click handling.  
> Always pass children (even a hidden span) to keep the click target alive.
