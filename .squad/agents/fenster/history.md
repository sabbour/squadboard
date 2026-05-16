# Fenster — History

## Core Context

- **Project:** A web design project (v4 iteration) for the Squad product site
- **Role:** UX Designer
- **Joined:** 2026-05-14T08:12:50.172Z

## Learnings

- **2026-05-15 F1 Templates nav:** Compound segments (e.g. `ceremonies/templates`) work in the `PROJECT_NAV_GROUPS` array — `handleNavItemSelect` concatenates the full segment to `/projects/${id}/`, so no route change is needed. `getSelectedValue()` sort-by-length correctly highlights the longer compound segment over its parent. Icon: `DocumentBulletList24Regular`. Label: "Templates". Position: OPERATIONS group, after Ceremonies.

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

---

## 2026-05-15 — Project name relocated to top header

**Task:** The project name was hidden/clipped in the sidebar after the recent sidebar overhaul. Relocated it to the global top header bar so it is persistently visible.

**Changes made:**
- `packages/client/src/components/Layout.tsx` — the only file modified.
  - Added `ChevronDown16Regular` icon import.
  - Replaced ad-hoc `projectName` + `justifyContent: flex-end` styles with Fluent2-compliant `topBarLeft`, `topBarRight`, and `projectSwitcher` styles using `tokens.fontWeightSemibold`, `tokens.spacingHorizontalS`, and slot targeting (`'& .fui-Button__text'`) for truncation.
  - Removed sidebar `projectName` div — it was the clipping culprit and was redundant.
  - Restructured `topBar` to `space-between` layout: project switcher on the left, Inbox/Consult/Capture on the right.
  - Project switcher is a `Button appearance="subtle"` with `ChevronDown16Regular` (after); clicking navigates to `/` (ProjectPicker page).
  - Graceful empty state: switcher hidden when `projectName === null`.

**Decision doc:** `.squad/decisions/inbox/fenster-project-name-header.md`

**TypeScript:** `npx tsc --noEmit` passed clean.

---

## Wave 5 Update (2026-05-15T10:18:00Z)

**Run:** fenster-2  
**Model:** claude-sonnet-4.6  
**Task:** Project name relocation to header bar

**Outcome:**
- Relocated active project name from sidebar to top-left header
- Placement: left of action buttons (Inbox / Consult / Capture), anchored to left edge
- Typography: Fluent2 compliant (upgraded from custom 14px)
- Commit: `7c0c4e93`
- Decision: `.squad/decisions/inbox/fenster-project-name-header.md`

**Status:** COMPLETE — no follow-up needed for Phase 19. Ready for next wave.


---

## Wave 6 (2026-05-15T10:18:00Z) — fenster-4 (retry after fenster-3 timeout)

**Run:** fenster-4  
**Task:** Fluent2 redesign of Ceremonies list + New Ceremony create flow

**Note:** fenster-3 completed all code changes in the working tree but timed out before committing. This wave is a clean commit pass — verified TS, then committed.

**Commits:**
- `c07ad75d` — `fix(ui): migrate Ceremonies list to Fluent2 (DataGrid + PageHeader + Badges)` — CeremonyList.tsx + CeremonyBadges.tsx
- `2974fbb2` — `fix(ui): tighten New Ceremony create flow (Conjure-first, hide advanced)` — CeremonyEditor.tsx

**Key decisions:**
- Pattern A (Conjure-first) for /new create flow
- Hand-rolled table → Fluent DataGrid; plain div eyebrow → PageHeader
- Trigger column: TriggerBadge; Kind column: KindBadge (both in CeremonyBadges.tsx)
- Advanced accordion: Description + Kind
- Fixed unclosed JSX fragment bug + unused Dismiss16Regular import

**Decision doc:** `.squad/decisions/inbox/fenster-ceremony-pages-fluent2.md`

**Status:** COMPLETE — TypeScript clean, two commits landed.

---

## 2026-05-15 — Conjure UX Design Spec

**Task:** Replace Capture with Conjure — a smarter creation flow that classifies user intent and routes to the appropriate entity type.

**Designed:**
- Single-input → backend classifies → pre-filled per-intent form → routed creation flow
- 6 intents: project, issue, team, agent, skill, tool
- Icon: `Sparkle20Regular` (already in use for AI actions)
- Keyboard shortcut: `Cmd+K` (replaces `c`)
- Folder rename: `inbox/` → `conjure/`
- Component renames: `CaptureFab` → `ConjureFab`, `CaptureModal` → `ConjureModal`
- Fluent2 compliant: `<Dialog>`, `<Input>`, `<Textarea>`, `<Dropdown>`, `<Badge>`, `<MessageBar>`
- Capture deprecation: Inbox page gets deprecation banner, no data migration needed

**Spec:** `.squad/agents/fenster/conjure-design.md`

**Decision doc:** `.squad/decisions/conjure/fenster-conjure-design.md`

**Commit:** `4d68d06e`

**Status:** DESIGN COMPLETE — ready for Keyser implementation.

- **2026-05-15 Wave 11B — F1 (Templates nav) — IN-FLIGHT:** Re-dispatched (was pending from Wave 11A timeout). Building templates navigation surface to expose `.squad/templates/casting-reference.md` and per-role charter templates.

---

## 2026-05-15 — N6: Review Policy UX Overhaul

**Task:** Make the Review Policy settings page understandable.

**Files changed:**
- `packages/client/src/components/settings/ReviewPolicySection.tsx`
- `packages/client/src/components/reviews/ReviewPolicyPicker.tsx`
- `docs/review-policy.md` (new)
- `.squad/decisions/inbox/fenster-n6-review-policy-ux.md` (new)

**Key UX changes:**
- "Currently effective" → "Active policy" with clear sub-description
- Added "Learn more →" link pointing to `docs/review-policy.md`
- Warnings now use Fluent2 `MessageBar intent="warning"` instead of raw emoji
- Errors use `MessageBar intent="error"`
- Added live "Policy preview" dashed strip while editing (shows `describePolicy()` output)
- Footer hint uses `tokens.colorNeutralForeground3` + second learn-more link
- All picker controls wrapped in Fluent2 `Field` with `hint` text
- Advanced section grouped into two sub-groups: "Approval rules" + "Timing & escalation"
- All labels renamed from API jargon to user language
- Contextual sub-hints for select options (shown inline under the dropdown)
- "Need help? Read the policy reference." at bottom of advanced panel

**Learnings:**
- `Caption1 as="div"` is NOT supported — Fluent2 text components only accept inline element types. Use `as="p"` or `as="span"`, or use `style={{ display: 'block' }}` to force block layout.
- `Body1Strong as="div"` also not supported — use `as="p"` or omit `as` and wrap in a block parent.
- `Field` component from `@fluentui/react-components` v9 is available and works well — `hint` prop accepts a string and renders under the label.
- JSX attribute strings (`hint="..."`) cannot contain unescaped ASCII double quotes — use smart quotes, or switch to JSX expression `hint={...}`.
- Build failures in `AgentFlowGraph.tsx`/`IssueFlowDag.tsx`/`CeremonyStepNode.tsx` are pre-existing (missing `react-router-dom`), NOT caused by N6 work.

**TypeScript:** Clean on all changed files (0 errors in `ReviewPolicySection.tsx`, `ReviewPolicyPicker.tsx`).

**Decision doc:** `.squad/decisions/inbox/fenster-n6-review-policy-ux.md`

**Status:** COMPLETE — no commit (Wave 12 Scribe will commit at close-out).

## Wave 12 — Cast-Team Follow-On + Dogfood Loop (2026-05-15)

**Team deployment:** Hockney-2, Keyser-2, Fenster-2

**This agent's contributions:**
- **N6: Review Policy UX Clarify:** Plain-English labels, two-group settings (Approval rules + Timing & escalation), live policy preview strip (dashed, shows human-readable policy on edit), Learn more links to new `docs/review-policy.md`. Files: `packages/client/src/components/settings/ReviewPolicySection.tsx`, `packages/client/src/components/reviews/ReviewPolicyPicker.tsx`, `docs/review-policy.md`.

**Status:** 1/1 done. Typecheck clean.

**Follow-ups:** Ahmed to nod on preset-save UI and "unanimous approval" label rename consideration.

---

## Wave 14 — q9 wave button reframed as post-daemon UX

**Date:** 2026-05-15T22:14:50-07:00  

Note: q9-end-wave-button reframed from primary to manual-override. After q7 (autonomous daemon) ships, q9 becomes the UI for forcing an immediate ceremony, ignoring the schedule. Lower priority than q7.

