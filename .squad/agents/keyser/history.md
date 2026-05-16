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

