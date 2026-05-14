# Decision: Fluent 2 Design Spec — Adopt Icon + Component Mapping

**Date:** 2026-05-14  
**By:** Fenster (UX Designer)  
**Spec file:** `.squad/agents/fenster/fluent-design-spec.md`  
**Owner for implementation:** Keyser  
**Reject authority:** Fenster (visual), Kujan (accessibility)

---

## What

Comprehensive Fluent 2 design spec produced after auditing all 55 component/page files in `packages/client/src/`. Covers:

1. **25 emoji → Fluent icon mappings** (from `@fluentui/react-icons`, not yet installed)
2. **40 custom component → Fluent component mappings** with priority ordering
3. **Typography migration** — 7 size/weight patterns → Fluent typography components
4. **Token migration** — top 30 hardcoded hex values mapped to `tokens.*`
5. **Layout spec** — sidebar nav recommendation (stable vs. NavDrawer)
6. **8-phase implementation plan** for Keyser

## Key Decisions Required

### 1. Dark Theme (BLOCKING for token migration)
The app has `webLightTheme` wired but uses the GitHub dark palette everywhere (`#0d1117` background etc.). Token migration cannot proceed without resolving:
- **Option A:** Switch to `webDarkTheme` from `@fluentui/react-components` (closest match)
- **Option B:** Author a custom dark theme object mapping Fluent token names to GitHub palette hex values
- **Option C:** Defer token migration; do icons + component structure first

**Recommendation:** Option B — custom theme object gives full control. Takes ~1h. Unblocks everything.

### 2. `@fluentui/react-icons` Install
Must run: `pnpm --filter @squadboard/client add @fluentui/react-icons`  
**No code change possible until this is in.**

### 3. NavDrawer vs. Stable Nav
NavDrawer is in `@fluentui/react-components/unstable`. Spec recommends stable approach for hacking phase (keep `<nav>`, use `makeStyles` + Fluent tokens + icons). Full NavDrawer migration when it stabilizes.

## Phase 1 for Keyser (Immediate)
Install `@fluentui/react-icons` and execute the icon swap pass (Phase 1 in spec, ~2h):
- Layout.tsx nav: 7 icons
- FilterBar: Search20Regular
- IssueCard: Comment16Regular  
- RunButton: Play16Regular, Checkmark16Regular, ChevronDown12Regular
- All dismiss/close buttons: Dismiss20Regular / Dismiss16Regular
- ConflictToast: Warning20Filled
- ReviewDecisionBadge: CheckmarkCircle16Regular, ArrowSync16Regular, Clock16Regular
- EmptyBoard: GridDots28Regular
- ProjectCard: FolderRegular

This is the **highest impact / lowest risk** change. Zero behavior change, eliminates all emoji.
