# Keyser Agent — Compact History Summary

**Focus areas:** UI component patterns (Fluent2 canonicals, DnD, form styling), client API contracts, TypeScript enforcement.

**Key learnings:**
- Fluent2 page padding canon: `tokens.spacingHorizontalXXL + tokens.spacingVerticalXXL` (24px + 24px); use both axes explicitly.
- Sidebar bottom-anchor: `<div style={{ flex: 1 }} />` spacer in NavDrawerBody flex column.
- Error boundary per-row pattern for resilience (class component required, function-component `getDerivedStateFromError` N/A in React 18).
- Defensive `retry` callback in useQuery for 404 short-circuit (skip retry backoff when service not deployed).
- Explicit per-file `git add -- <path>` only; never `git add .` or glob patterns (prevents accidental file sweeps in parallel sessions).
- Fluent `<Field>` single-htmlFor footgun: binds all labels to first child. Use `<fieldset>` + `<legend>` for checkbox groups instead.
- `import.meta.env.DEV` in Vite client (not `process.env.NODE_ENV`; `process` not in scope).
- apiFetch content-type guard: defend both `!res.ok` AND JSON parse against non-JSON responses (catches SPA fallback HTML + error pages).

**Recent work:**
**Sidebar bottom-anchor pattern:** Fluent's `NavDrawerBody` is already
`display: flex; flex-direction: column` (and `flex: 1; overflow: auto`
from `useDrawerBodyStyles_unstable`). Drop a `<div style={{ flex: 1 }} />`
spacer between the top items and the section you want anchored to the
bottom. No CSS overrides needed.

**Two `marginLeft: 'auto'` siblings = visual middle-pin trap:** in a
flex row with three children where two carry `marginLeft: 'auto'`, the
middle child gets pinned to the visual centre instead of right-aligned.
Always pick a single right-aligned anchor; subsequent siblings ride
along with the natural flex gap.

**Project switcher = Fluent2 `Menu`:** replaced the plain navigate-to-/
button with a `Menu` + `MenuTrigger` + `MenuList` populated from
`useProjects()`. The selection handler swaps the project segment in
`location.pathname` while preserving the category segment after it
(via `extractProjectCategory()`), so switching from foo's Boards to bar
lands on bar's Boards. Unknown / non-project routes fall back to
`/projects/<id>/dashboard`. Sub-paths beyond the segment are dropped
intentionally — switching projects lands on the category root, not a
stale sub-resource id.

**WS reconnect `connect()` must cancel pending timers:** if `connect()`
runs while a reconnect timer is scheduled (e.g. route change during
backoff), the stale timer can fire after the new socket opens and
spawn a second competing socket. Added `cancelReconnect()` at the top
of `connect()` to drop the orphan timer. Pattern: any method that
restarts the connection lifecycle must cancel scheduled work from the
prior lifecycle.

### Lesson reinforced
Per-file `git add -- <path>` again. The repo currently has uncommitted
work from other agents (mcmanus history, server/index.ts, vite cache
churn). Per-file staging kept all four commits clean — only my
intentional changes landed.

## 2026-05-15 — M2 apiFetch guard + M3 Checkbox label-toggle (commit c7dde255)

**Fluent `<Field>` single-htmlFor footgun (⚠️ — share with team):**
Fluent2's `<Field>` generates one `htmlFor` and binds it to the **first** form control child. If you wrap multiple `<Checkbox>` siblings in a single `<Field>`, clicking ANY label routes the OS click event to that first input. The bug is invisible in code review — everything looks correct. Fix: use `<fieldset>` + `<legend>` for checkbox groups (semantically correct, no single binding). Add explicit `id` props to each `<Checkbox>` for belt-and-suspenders label isolation.

**`import.meta.env.DEV` not `process.env.NODE_ENV` in Vite client:**
The client package is a Vite app without `@types/node`. `process` is not in scope, so `process.env.NODE_ENV` fails tsc. Use `import.meta.env.DEV` for dev-only guards.

**apiFetch content-type strategy:**
Guard both branches — `!res.ok` AND the happy-path JSON parse — against non-JSON responses. Read the body first, check `content-type`, then either throw a diagnostic error (with first 200 chars) or parse. This catches Express SPA fallback (HTML-200) and HTML error pages (4xx/5xx) alike.

- **2026-05-15 Wave 11A — K1 (PageLoading component) — SILENT-SUCCESS:** Shipped canonical PageLoading, SectionLoading, InlineLoading components. Consumer smoke-test: Costs.tsx adopted canonical PageLoading. Components follow Fluent2 theming, integrate with tokens.*, support role attribute for accessibility. Merged from Wave 11A dispatch; committed as silent-success deliverable.

- **2026-05-15 Wave 11B — M2+M3 (Hire-team UI + apiFetch fix) — COMPLETE:** Fixed "Cast a Team" modal bugs (live bug report w/ HIGH priority).
  - **M2 (apiFetch Content-Type Guard):** Added defensive check on both error (`!res.ok`) and success paths. Before calling `JSON.parse()`, verify `content-type: application/json`. If not, throw human-readable diagnostic including HTTP status, actual content-type, and first 200 chars of body. Catches Express SPA fallback (HTML-200) and HTML error pages (4xx/5xx) — no more cryptic "Unexpected token '<'".
  - **M3 (HireTeamModal checkbox label-toggle bug):** Fluent `<Field>` wraps all 16 `<Checkbox>` siblings and emits single `htmlFor` pointing at first child (Lead). Every label click routed to Lead only. Fixed: replaced `<Field>` with `<fieldset>` + `<legend>` (semantically correct for checkbox groups) + explicit `id={`role-${r.id}`}` on every `<Checkbox>` for belt-and-suspenders label binding + added DEV-only invariant to throw if any two roles share the same id.
  - **Commit:** c7dde255 (both M2+M3 in one commit)
  - **Locked by:** Kujan M4 e2e regression suite (4 sub-tests green in 9.9s)

## 2026-05-15 — Wave 12 N3+N4 (Now global dashboard + flow clickable nodes)

**`react-router` not `react-router-dom`:** The client package does not install `react-router-dom` as a separate peer — it ships `react-router` v7 which re-exports everything. Always import from `'react-router'`. Any `from 'react-router-dom'` will typecheck-fail with "Cannot find module".

**`useQueries` fan-out pattern for cross-project aggregation:** When there's no server-side aggregate endpoint, `useQueries` from TanStack Query lets you fan out per-project queries in parallel. Each result has its own `isLoading`/`data` — reduce over `results` to aggregate. Set `staleTime: 60_000` and `retry: false` (don't hammer the server if one project's endpoint is down). If project count grows to 30+, push for a dedicated aggregate endpoint instead.

**ReactFlow `onNodeClick` preferred over node-level `onClick`:** For IssueFlowDag navigation, attaching `onNodeClick` at the ReactFlow canvas level (reading `node.data.projectId`, `node.data.issueId`) is cleaner than adding `useNavigate` to every node component. Node components stay pure/dumb; navigation logic lives in the parent.

**SVG `<g>` accessibility:** For clickable SVG groups, add `role="button"`, `tabIndex={0}`, `aria-label`, and `onKeyDown` (Enter/Space). Mouse-enter/leave on a child `<rect>` with `setAttribute('opacity', ...)` is the simplest hover effect in SVG without pulling in CSS-in-JS SVG helpers.

**CeremonyStepNode in editor context:** The VisualCanvas (ceremony editor) does NOT pass `projectId`/`ceremonyId` in node data, so the onClick guard (`Boolean(projectId && ceremonyId)`) keeps editor selection behavior intact. When the component is used in read-only contexts with those fields, navigation activates automatically.

**`PageLoading` for full-page loading states:** Now uses the canonical `PageLoading` component (with `header` prop) instead of inline spinners, consistent with CeremonyList canonical pattern.

## Wave 12 — Cast-Team Follow-On + Dogfood Loop (2026-05-15)

**Team deployment:** Hockney-2, Keyser-2, Fenster-2

**This agent's contributions:**
- **N3: Now Page — Global Dashboard:** 6-stat-tile row (In-flight, Queued, Done today, Active projects, Cost MTD, Health) + live panels (sessions, issue runs, workflow runs) + 15-event activity feed + per-project mini-rollup grid. Client-side fan-out via `useQueries` TanStack Query. Files: `packages/client/src/pages/Now.tsx`, `packages/client/src/pages/ProjectFlow.tsx`, `packages/client/src/components/flow/AgentFlowGraph.tsx`, `packages/client/src/components/flow/IssueFlowDag.tsx`, `packages/client/src/components/flow/StepNode.tsx`, `packages/client/src/components/flow/nodes/CeremonyStepNode.tsx`.
- **N4: Clickable Flow Nodes:** Agent/Step/Ceremony nodes now navigable to `/projects/{projectId}/agents/{agentId}`, `/projects/{projectId}/board?focus={issueId}`, `/projects/{projectId}/ceremonies/{ceremonyId}` with keyboard+aria support (Enter, Space, tabIndex, role="button").

**Status:** 2/2 done. Build green (6.94s).

**Follow-ups:** Hockney to add agent detail route, run-detail route, and daily activity stats endpoint (as noted above).

---

## Wave 14 — q9 wave button reframed as post-daemon UX

**Date:** 2026-05-15T22:14:50-07:00  

Note: q9-end-wave-button reframed from primary to manual-override. After q7 (autonomous daemon) ships, q9 becomes the UI for forcing an immediate ceremony, ignoring the schedule. Lower priority than q7.

---

## Wave 15 — UI Bug Batch (commit 5f9fab1e)

**Date:** 2026-05-15T22:42:29.855-07:00

Three bugs landed in one commit cluster:

**Bug 1 — Use-template pre-fill (CeremonyEditor.tsx):**
- Templates.tsx passed `?template=<slug>` on navigate but CeremonyEditor never read it — form always blank.
- Fix: added `useSearchParams` + `useCeremonyTemplates()` call. `useEffect` on `[templateSlug, builtinTemplates]` pre-fills name / description / steps, auto-expands manual form. Invalid slug shows warning banner ("Template not found — starting with blank form."). Valid slug shows info banner ("Pre-filled from template.").

**Bug 2 — Conjure nav (Layout.tsx) — ROOT CAUSE FOUND:**
- Feature was fully functional at `/consult/new` since W10. Root cause: Wave 10 B2 relabeled every UI surface "Consult" when the product name was "Conjure." The nav item said "Consult", the button said "Consult" — no user looking for "Conjure" would find it. Regressed silently through W10, W11, W14 because no test covered nav label text.
- Fix: renamed `NavItem` label and top-bar `Button` text from "Consult" → "Conjure". Routes, keyboard shortcuts, and page component unchanged.

**Bug 3 — Scope dropdown help text (CeremonyEditor.tsx TriggerConfigForm):**
- Bare `<label>scope` replaced with `<Label>` + `<Dropdown>` + reactive `<Caption1>` help text per scope value + `<MessageBar intent="info">` for board/task scopes explaining narrowed-firing behaviour.
- Closes `h5-scope-clarify` and `w15-ceremony-scope-options-ux`.

**Key learnings:**
- `useSearchParams` from react-router is the correct hook for reading URL query params in Vite/react-router v7 (not `new URLSearchParams(window.location.search)`).
- Nav label regressions are invisible to router-level tests — the `value` prop (used for routing) was "consult" throughout; only the display text was wrong. Consider adding a smoke test that verifies visible nav label text matches product names.
- `useCeremonyTemplates()` is safe to call on both new and edit routes — React Query caches it and the pre-fill effect is guarded by `templateSlug` being null on edit routes.

## Team Update — undefined

Run: wave-15

- **mcmanus**: Universal Project Bundle (3rd escalation cleared)
- **hockney**: Stream I (backup/restore + W14 migration)

## Team Update — undefined

Run: wave-15-final

- **mcmanus**: Universal Project Bundle (3rd escalation cleared)
- **hockney**: Stream I (backup/restore + W14 migration)
- **scribe**: W15 close-out + SDK fidelity audit

## Wave 17 — W17 Settings Batch: Backup/Restore UI + GitHub Integration (commit 7b3930e6)

**Date:** 2026-05-15T22:42:29.855-07:00
**Branch:** keyser/w17-settings-backup-github

Two deliverables batched into one commit:

**Deliverable 1 — Backup & Restore section (w16-restore-ui):**
- `SystemBackupSection.tsx`: `useQuery` for backup list (30s refetch), useMutation for backup-now, RestoreDialog (custom radio list, warning MessageBar, confirmation checkbox, spinner, reload on success).
- `POST /api/system/restore` added to `routes/system.ts` — delegates to Hockney's `runRestore()`.
- Retain: static retention info card; W18 will add config editing.

**Deliverable 2 — GitHub Integration section (g5-3):**
- `SystemGitHubSection.tsx`: gh-not-installed banner (https://cli.github.com/), auth card (username/protocol/scopes from `gh auth status` parse), permission table (6 actions × required scope × granted status), branch convention display (Verbal's W16 decision), three dry-run test buttons.
- `GET /api/system/gh-auth-status` + `POST /api/system/gh-test` added to `routes/system.ts`.

**Settings.tsx:** Added 'backup' + 'github' to Section type + SECTIONS array + section renderers; used `DatabaseArrowRight20Regular` + `Branch20Regular` (no GH icon in Fluent2 — Branch is the closest semantic match).

**Key learnings this wave:**
- Fluent `<RadioGroup>` doesn't render metadata alongside each radio option cleanly — use a custom div-based radio pattern with `role="radio"` + `aria-checked` + `tabIndex` + `onKeyDown` for full a11y, and put the metadata (filename, size, date) inline.
- `gh auth status` writes to stderr, not stdout — must capture both stdout+stderr from execFileAsync. execFileAsync throws with `{ stdout, stderr }` on non-zero exit, so catch and read from the error object too.
- `MarkGithub16Regular` does not exist in `@fluentui/react-icons` — use `Branch20Regular` as the closest semantic match for GitHub/git.
- Pre-existing tsc errors in parallel agents' WIP files (Verbal's `runs.ts`, `GitActions.tsx`) will surface on `pnpm build` — isolate with `tsc --noEmit` and grep for your own file paths to confirm zero new errors.

## Team Update — undefined

Run: w17

- **verbal**: Stream G phase 2A (G2.3 comment + G2.5 merge PR with CI gate + G2.6 card badges)
- **redfoot**: 4 docs (README + ceremonies concept + features audit + MCP install)

## Wave 18 — W18 UX Polish: O6 Combobox + H6 Ceremonies Audit + O5 Consult Removal (build green)

**Date:** 2026-05-15T22:42:29.855-07:00

Three polish items from Ahmed's bug-bash intake landed in one pass:

**O6 — Project selector → Fluent2 Combobox (Layout.tsx):**
- Replaced `Menu`/`MenuTrigger`/`MenuPopover`/`Button` switcher with `Combobox` + `Option`/`OptionGroup`.
- Min 320px / max 480px, flex-shrink on narrow viewports.
- Searchable: `onInput` filters `allProjectsSorted` in real-time; exact-name match shows unfiltered list.
- Recent projects: last 5 IDs persisted to `localStorage['squadboard:recent-project-ids']`; shown as "Recent" `OptionGroup` at top; updated via `pushRecentId()` on every project switch.
- `onBlur` restores the current project name if user didn't pick anything.
- `Tooltip` wraps the Combobox, surfaces full name on hover for overflow cases.
- Removed: `Menu`/`MenuTrigger`/`MenuPopover`/`MenuList`/`MenuItem` + `ChevronDown16Regular`.

**H6 — Ceremonies page Fluent2 audit (CeremonyEditor.tsx):**
- `CeremonyList.tsx` was already Fluent2-compliant (tokens, PageHeader, proper button appearances, good empty state).
- Edit-mode header in `CeremonyEditor.tsx` had 3 issues: `var(--border)` → `tokens.colorNeutralStroke1`; raw `gap: 12` → `tokens.spacingHorizontalM`; hardcoded `#3fb950`/`#f85149` → `tokens.colorPaletteGreenForeground1`/`tokens.colorPaletteRedForeground1`.
- Empty-state convergence for Skills/Tools/MCP deferred to W19 (not trivial enough to batch here).

**O5 — Remove Consult button from work-item side view (CardDetail.tsx):**
- Removed `<Tooltip>`+`<Button>Consult</Button>` block from CardDetail panel header.
- Removed now-unused imports: `useNavigate`, `Button`, `Tooltip`, `Lightbulb20Regular`.
- Filed W19 follow-up: `conjure-workitem-deeplink` — implement `?context=workItem:{id}` in Conjure + "Investigate with Conjure" in CardDetail overflow menu.

**Key learnings:**
- Fluent2 `Combobox` `value` prop controls the text in the input; use `onBlur` to restore the display name if the user abandons without selecting.
- `selectedOptions` on Combobox takes an array of option `value` strings — pass `[currentProjectId]` to mark the active project.
- `OptionGroup` with `label={undefined}` renders without a group header — useful when there are no recent projects.
- After removing a CTA from a component, always grep for *all* the now-unused imports it pulled in (Tooltip, navigate, icon) — tsc `noUnusedLocals` will catch them at build time but it's cleaner to fix proactively.

**Files changed:** `Layout.tsx`, `CeremonyEditor.tsx`, `CardDetail.tsx`
**Build:** ✓ green — `tsc -b && vite build` in 6.71s, zero errors.

## Wave 19 — W19 Triple: O7 Formulate bug + Conjure deeplink + End-wave button (build green)

**Date:** 2026-05-15T22:42:29.855-07:00

Three items from Ahmed's intake batched into one pass:

**O7 — Formulate ceremony grammar bug:**
- Root cause: `buildProseAuthorPrompt` used `- agent_run: { ... }` shorthand which LLMs parse as a YAML mapping key, not as `type: agent_run`. `validateWorkflowYaml` rejected the output because `type:` was missing from every step.
- Fix 1: Rewrote the prompt step schema section to show explicit `type:` indented YAML + a concrete two-step example (`Daily Standup`).
- Fix 2: `apiFetch` (client.ts) now parses `{ error: "..." }` JSON bodies and throws with the inner string, so users see a clean error instead of `API 502: {"error":"..."}`.
- Removed narrative path: `'narrative'` filtered from both kind dropdowns in CeremonyEditor via `deprecated: true` on `CEREMONY_KIND_OPTIONS`; `handleConvert`, `convertToast`, `convertCeremony`, `useConvertCeremony` all deleted. Backend routes kept (shared SDK infra). Existing `kind='narrative'` ceremonies remain read-only in the UI.

**conjure-workitem-deeplink — Conjure deep-link from CardDetail:**
- Added `…` overflow menu to the CardDetail panel header (`Menu`/`MenuTrigger`/`MenuPopover`/`MenuList`/`MenuItem`, Fluent2).
- "Investigate in Conjure" item navigates to `/projects/${projectId}/consult/new?prefill=issue:${issue.id}` using the existing Phase 17 prefill mechanism (no Consult.tsx changes needed).
- Prefill maps: title + body → Conjure input, labels + runs → context block, git PR → reference. Non-fatal fallback (blank session) on fetch failure is already in Consult.tsx.

**Q9 — Manual End-wave button (CeremonyList.tsx):**
- "End wave" button added to CeremonyList page header toolbar (left of "New ceremony"), with `Flag20Regular` icon.
- Confirmation `Dialog`: explains Scribe close-out, primary "End wave" + Cancel.
- `POST /api/projects/:projectId/ceremonies/invoke` endpoint added to ceremonies route; delegates to `invokeBuiltInCeremony('scribe-close-out', ctx)`.
- Toast: "Running Scribe close-out…" → "Wave closed ✓ (commit abc1234)" on success, error message on failure. Auto-dismisses in 8s.
- Button disabled + spinner while running.

**Key learnings:**
- LLM prompt YAML schema shorthand (`- stepType: { ... }`) is fatally ambiguous — always provide a verbatim YAML block with the actual keys the validator expects.
- When removing a mutation hook from a component, also check: the import, the `const x = useHook()` declaration, all useCallback closures that reference it, all state variables it drives (toast/result state), and all JSX that renders that state.
- `apiFetch` error unwrapping: parse the body as JSON first; if `body.error` is a string, throw that — users never need to see the raw `{"error":"..."}` envelope.
- Fluent2 `Menu`/`MenuTrigger` wraps a raw `<button>` cleanly; no need for `<Button appearance="...">` as the trigger when matching an existing icon-button pattern.

**Files changed:** `services/ceremony-translator.ts`, `api/client.ts`, `pages/CeremonyEditor.tsx`, `components/board/CardDetail.tsx`, `pages/CeremonyList.tsx`, `routes/ceremonies.ts`
**Build:** ✓ green — client `tsc -b && vite build` ✓; server `tsc` ✓

---

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

