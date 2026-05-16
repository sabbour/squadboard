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

- **2026-05-15 Wave 11B — M2+M3 (Hire-team UI + apiFetch fix) — IN-FLIGHT:** Dispatched parallel tasks to fix "Cast a Team" modal bugs (live bug report w/ screenshot, HIGH priority). M2: defensive apiFetch wrapper to surface server 404/error responses clearly. M3: htmlFor binding fix (Fluent Field wrapping multiple Checkboxes was binding all labels to the Lead checkbox; fixed via Field-per-role or removing htmlFor). Started concurrently with Hockney M1 (server routes) to unblock M4 (Kujan e2e regression).
