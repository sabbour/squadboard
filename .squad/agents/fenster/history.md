# Fenster — History

## Core Context

- **Project:** A web design project (v4 iteration) for the Squad product site
- **Role:** UX Designer
- **Joined:** 2026-05-14T08:12:50.172Z

## Learnings

- **2026-05-14 Project Pivot:** Web design project expanded to **Squadboard** — local-first kanban + workflow board for Squad agents. Team augmented from 4 to 10 members. New teammates: Hockney (Backend), Kobayashi (SDK), Kujan (QA), Redfoot (DevRel), plus Ralph (Coordinator) and Scribe (Logger). Verbal re-roled to Real-time/WebSocket Dev. Squadboard PRD adopted as source of truth; ready for Demo 1 work.

- **2026-05-14 Fluent 2 Design Spec:** Full UI audit completed. Found 30+ emoji/text-symbol usages across 55 component files. Produced comprehensive spec at `.squad/agents/fenster/fluent-design-spec.md`. Key findings:
  - **Icons:** 25 distinct emoji → Fluent icon mappings. `@fluentui/react-icons` not yet installed (must add). Active-state icons: swap Regular → Filled variants.
  - **Components:** 40 custom patterns mapped to Fluent equivalents. Highest impact: `<DrawerOverlay>` for CardDetail, `<Dialog>` for all 3 modals, `<Toaster>` for ConflictToast, `<NavDrawer>` for sidebar.
  - **Dark theme conflict:** `webLightTheme` is wired but codebase uses GitHub dark palette (`#0d1117`, `#161b22`, etc.). Token migration depends on dark theme decision first.
  - **Hardcoded hex:** 103× `#8b949e` (muted text), 80× `#30363d` (borders), 63× `#e6edf3` (foreground) — all have direct token equivalents.
  - **Phase order for Keyser:** Icons (P0, ~2h) → Panels/Modals (P0, ~4h) → Toast/Toolbar (P1) → Cards/Buttons (P1) → Badges (P1) → Tables/Data (P2) → Typography/Tokens (P2).
  - **NavDrawer caveat:** Nav components are in `@fluentui/react-components/unstable`. Recommended stable approach: keep `<nav>` wrapper, use `makeStyles` with tokens, swap emoji for icons.

## Learnings — 2026-05-15 Typography + Spacing Sweep

- **Fluent2 Typography Component Map:**
  - `Title2` → top-level landing page titles (e.g. ProjectPicker "Projects")
  - `Subtitle1` → in-project page titles (used inside `PageHeader` with `size="standard"`)
  - `Subtitle2` → card/panel/drawer section titles (AgentDetailPanel agent name, SectionHeader in Settings)
  - `Body1Strong` → primary item labels (skill name, tool name, issue title); renders ~14px semibold
  - `Body1` → body copy, loading states (~14px regular)
  - `Caption1` → secondary metadata, captions, small muted labels; replaces raw `fontSize: '11px'`/`'12px'`
  - `Caption1` with `textTransform: 'uppercase'` + `fontWeight: tokens.fontWeightSemibold` → section category labels (replaces `<h2>` with raw font-size)
  - All components default to `display: inline` — always add `style={{ display: 'block' }}` or `as="div"/"p"` when block layout is needed.

- **When to use Strong variants:** Use `<Body1Strong>` instead of `<Body1>` + `fontWeight: 600` whenever the *entire* text run is semibold. Reserve explicit `fontWeight: tokens.fontWeightSemibold` for mixed-weight inline contexts.

- **The orphan global stylesheet trap:** `globals.css` had a `body { font-family: ...; font-size: 14px; line-height: 1.5; }` rule. This wins over FluentProvider's `webLightTheme` typography cascade because CSS specificity. Removing those rules (keeping only `-webkit-font-smoothing: antialiased`) lets Fluent2 own the type scale cleanly. The fix is always: *remove body-level font rules; let FluentProvider be the only source of truth.*

- **FluentProvider check habit:** Confirm `FluentProvider` wraps the app in `main.tsx` before any token migration. If it's missing, ALL `tokens.*` values fall back to undefined — worst possible outcome.

- **var(--*) coexistence:** `var(--surface)`, `var(--border)`, `var(--bg)`, `var(--accent)` are layout/structural colors that predate Fluent2 tokens — they're fine to keep. Only text-color `var(--text)` / `var(--text-muted)` should be migrated to `tokens.colorNeutralForeground*`.

- **Canon artifact:** `.squad/decisions/inbox/fenster-typography-canon.md` — full table of typography components, spacing tokens, color tokens, and global CSS guidance for this project.

## Recent team activity

**2026-05-15 Round 2 shipped:** Hockney (attachments backend), McManus (multi-modal frontend), Verbal (Consult chat fix), Fenster (typography sweep), Kobayashi (Ceremony Conjure UX), Keyser (layout rebalance). See `.squad/decisions.md` for Fluent2 canon, image bytea architecture, create-page pattern, react-markdown rendering.
