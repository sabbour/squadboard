### 2026-05-15 — FormulatePanel + handleFormulate pattern (feat/issues-formulate)

**FormulatePanel composition pattern:**
- Import `FormulatePanel` from `../formulate/FormulatePanel.tsx`
- Call `useFormulateXxx(projectId)` hook at the top of the component
- Hold `modelUsed: FormulateModelInfo | null` and `formulateError: string | null` in local state
- `handleFormulate(draft)` calls `formulate.mutate(draft, { onSuccess, onError })` — populate form fields on success, set error string on failure, never crash the dialog
- Place `<FormulatePanel ... compact />` at the TOP of the `<form>` body, before all other fields; use `compact` prop in dialogs ≤520px wide

**Label name→ID mapping:**
When the LLM returns `suggestedLabels: string[]` (names), map to IDs using:
```ts
const matched = suggestedLabels.flatMap((name) => {
  const found = labels?.find((l) => l.name.toLowerCase() === name.toLowerCase())
  return found ? [found.id] : []
})
```
Silently drop names that don't match any existing label.

**Express route ordering trap:**
`POST /formulate` MUST be registered BEFORE the parameterized `GET /:id` and `PATCH /:id` routes. Express matches in declaration order — registering it after `/:id` causes Express to capture "formulate" as an ID value.

**`{ ok, error }` envelope for formulate routes:**
Formulate routes use `{ ok: true, data: T }` / `{ ok: false, error }` envelopes (matching `apiFetch<Envelope<T>>`), not the bare `{ error }` shape used by `handleError()` in the rest of the routes file.

### 2026-05-15 — New Consult layout rebalance (style/consult-layout)

**CSS grid for compact config knobs:**
When a form has ≥4 small fields and one hero field, group the small ones in a `display: grid; gridTemplateColumns: '1fr 1fr'` block and render the hero below with `marginTop: tokens.spacingVerticalL`. This keeps the visual hierarchy: knobs at top, focal input front and center.

**Sidebar button full-width trap:**
A `flexDirection: 'column'` parent without `alignItems` defaults to `alignItems: 'stretch'`, making all children full-width. Fix: add `alignItems: 'flex-start'` to the parent container so buttons size to their content.

**PageHeader consistency:**
Every in-project pane should open with `<PageHeader>` from `components/layout/PageHeader.tsx`. Avoids divergent `<Title2>` + `<Body1>` bespoke headers with inconsistent spacing. The pane wraps as: `<div flexColumn height:100%> + <PageHeader /> + <scrollable content>`.

**Submit button disabled logic:**
"Disabled until draft OR agent selected (in agent mode)" = `disabled={isPending || (!draft.trim() && !(mode==='agent' && agentId))}`. This lets users start a session without a first message if they've picked an agent, but requires a draft for model-mode where there's no agent context to bootstrap.

## Recent team activity

New decisions merged to `.squad/decisions.md`:
- Demo 9 open question #2: `request_changes_policy` default is `'first'` (Hockney)
- Demo 12 open question #6: Optimistic concurrency for concurrent issue edits (Verbal)
- Demo 15 open question #8: GitHub issue mirroring OFF by default, opt-in per project (Hockney)

See `.squad/decisions.md` for full details.

Multi-agent fanout session completed 2026-05-15T12:35:00Z:
- 5 agents shipped (2 keyser rounds, mcmanus, hockney, verbal)
- 5 commits landed (42c120a0, d74c9622, d7cc2ada, 4d9fb813, base a97e2bce)
- 2 agents in flight (fenster, kobayashi)

Session log: `.squad/log/2026-05-15T12:35:00Z-squad-fanout.md`

## Recent team activity

**2026-05-15 Round 2 shipped:** Hockney (attachments backend), McManus (multi-modal frontend), Verbal (Consult chat fix), Fenster (typography sweep), Kobayashi (Ceremony Conjure UX), Keyser (layout rebalance). See `.squad/decisions.md` for Fluent2 canon, image bytea architecture, create-page pattern, react-markdown rendering.

## Learnings

### 2026-05-15 — Diagnostics + Heartbeat scaffolding (Phase 3)

**Defensive 404 handling in useQuery:**
Use the `retry` callback to short-circuit retries when `error.message.startsWith('API 404')`. This lets the UI immediately render an empty-state ("service not available yet") without waiting for the default retry backoff — critical when a backend service hasn't deployed yet.

**Error boundary per-row pattern:**
Wrap each `<CheckCard>` in a `class CheckCardErrorBoundary extends React.Component` rather than a single page-level boundary. This means one malformed server response row won't blank the entire list. The class approach is required because `getDerivedStateFromError` has no function-component equivalent in React 18.

**Fluent icon naming (24px):**
The `@fluentui/react-icons` package uses the pattern `{Name}24Regular` (size before variant), e.g. `Heart24Regular`, `HeartPulse24Regular`. The shorthand `Heart24Regular` and `HeartPulse24Regular` both exist at 24px. Generic `Pulse24Regular` does NOT exist — use `HeartPulse24Regular` instead.

**Top-level system routes:**
Diagnostics and Heartbeat are system-scoped, not project-scoped. Route them top-level (`/diagnostics`, `/heartbeat`) with an additional project-scoped alias (`/projects/:id/diagnostics`) that mirrors the server API path. Do NOT nest them under Settings — Settings is configurational, Diagnostics is operational.

**SYSTEM nav section header:**
Added `<NavSectionHeader>SYSTEM</NavSectionHeader>` above the global nav items (Diagnostics, Heartbeat), rendered before project-specific groups. This is consistent with the `WORK / SQUAD / OPERATIONS` group convention for project nav.

**Cache-bust mutation pattern:**
`useRunDiagnostics` appends `?bust=${Date.now()}` to the query string to force the server to bypass any result caching, then calls `queryClient.setQueryData` with the result to update the cache optimistically without a refetch round-trip.

**2026-05-15T15:21:46Z — Coordination snag: Parallel commit swept Hockney's work**

When both Keyser and Hockney committed diagnostics work in parallel (Phase 3, commit 13c34dca), Keyser's staging accidentally swept Hockney's server files into the same commit. Functional code verified OK, but the audit trail is murky — one commit SHA contains both agents' changes. This happened because explicit `git add -- <path>` per-file was not used; Keyser's broader staging glob (likely `git add packages/` or similar) swept uncommitted server work. **Action for future parallel sessions:** Always use `git add -- <path1> <path2> ...` (bracket notation, one file per add) for intentional changes. Never use `git add .` or `git add <directory>/`. Always run `git status` before committing to verify ONLY your changes are staged. This prevents accidental file sweeps and keeps audit trails clean.


## 2026-05-15 Phase 19 client surfaces (commit 8eb337dd)

**5 surfaces shipped in one wave:**

1. `api/templates.ts` (NEW) — 13 React Query hooks for full portability contract.
2. `pages/Templates.tsx` — Extended with 4-tab TabList (Ceremonies / Workflows / Teams / Projects), URL search-param state (`?tab=`), TemplateGrid with Apply/Delete, DragImportZone with payload.kind validation.
3. `pages/Agents.tsx` — Export team / Import team / Save as template buttons in agents-tab header.
4. `pages/Settings.tsx` — New "Portability" sidebar section with Export / Import / Save as template rows.
5. `pages/ProjectPicker.tsx` — "Create from template" CTA (DocumentCopy icon) beside "Add Project", opens CreateFromTemplateModal.
6. `pages/CeremonyEditor.tsx` — "Save as template" (Dialog) + "Export YAML" (triggerTextDownload) buttons in ceremony header.

**TypeScript:** `npx tsc --noEmit` passes clean — zero errors, no `any`.

**Coordination note for Hockney:** `useImportWorkflow` calls `POST /api/projects/:id/ceremonies/import` which is NOT in the Phase 19 contract. The hook degrades gracefully (will 404 until Hockney ships the endpoint). Also `useSaveWorkflowAsTemplate` calls `/api/projects/:id/ceremonies/:ceremonyId/save-as-template` — Hockney should confirm this route.

### Lesson (reinforced)
**Explicit `git add -- <path>` per file; never let parallel agents' files leak into my commits.**
Always run `git status --short -- packages/client/` first. Stage each file individually. NEVER use `git add .` or `git add packages/` or any directory pattern. This is critical when Hockney, Kobayashi and others have uncommitted server changes in the working tree simultaneously.

## Phase 19 – Wave 2 (Hockney r5 contract alignment) — commit 2363ece6

**Trigger:** Hockney updated 11 portability endpoints to `{ ok, data }` envelope; 2 project endpoints (`/import`, `/instantiate-template/:id`) now require `squadPath` in request body.

**Changes:**
- `api/templates.ts`: Added `ApiEnvelope<T>` + `unwrapEnvelope<T>()`; updated all hooks to unwrap; added `squadPath` param to `useImportProject` + `useInstantiateProjectTemplate`; return types simplified (no longer nested `.project`).
- `pages/Settings.tsx`: Replaced direct-import flow with `ImportProjectDialog` collecting `squadPath` + file picker; fixed `result.name` reference.
- `pages/ProjectPicker.tsx`: Added `squadPath` state + input to `CreateFromTemplateModal`; fixed `result.id` navigation reference.
- `pages/Templates.tsx`:
  - Replaced `ApplyNameDialog` with `ApplyTemplateDialog` that conditionally shows `squadPath` field for project kind.
  - `handleApply` now accepts `(tpl, name?, squadPath?)` and passes `squadPath` to `instantiateProject`.
  - Fixed `result.id` navigation reference (was `result.project.id`).
  - Rewrote `DragImportZone`: project file drops now park the payload and display an inline `squadPath` prompt before calling `importProject.mutateAsync`; kind-validation factored into `validateKind()`.
  - Removed stale `useCallback` import.

**TypeScript:** Passed 0 errors before commit.

**Lesson reinforced:** Explicit per-file `git add -- <path>` only; never `git add .`.

---

## Wave 5 Update (2026-05-15T10:18:00Z)

**Run:** keyser-3 (PARTIAL)  
**Model:** claude-sonnet-4.6  
**Task:** Column UI Batch A (dynamic list) + Batch B (add/remove UX)

**Outcome:**
- **Batch A — COMPLETE:**
  - Built dynamic column list component
  - Commit: `c6dfcd6c`
  - Renders available columns per project, supports add/remove UX
  - Decision: `.squad/decisions/inbox/keyser-phase19-client.md` (TabList URL state contract)
  
- **Batch B — TIMED OUT:**
  - No commits yet
  - Retry scheduled as keyser-5 (in flight — not logged in this round)

**Status:** PARTIAL COMPLETE — Batch A landed. Batch B retrying as keyser-5.


---

## 2026-05-15 — keyser-3 timeout / keyser-4 Batch B completion

**keyser-3** timed out partway through the columns feature task. Batch A landed cleanly as commit `c6dfcd6c` ("feat(board): dynamic column list — KanbanBoard consumes useColumnMeta") before the timeout.

**keyser-4** picked up from where keyser-3 left off and shipped Batch B as commit `e4d87359` ("feat(board): add/remove/reorder columns in ColumnSettingsPanel + CaptureModal dropdown"):

- `ColumnSettingsPanel.tsx`: DnD reorder, add column inline form, delete with confirm + reassign, make-default star, semantic badge + select, 480px drawer, updated reset confirm text.
- `CaptureModal.tsx`: replaced hardcoded COLUMNS with `useColumnMeta(projectId)` + static fallback for empty projectId.

TypeScript (`npx tsc --noEmit`) was clean before commit.

## 2026-05-15 — UI bundle: 5 fixes in one wave

Five small UI fixes Ahmed batched together. Per-file commits, TS clean.

| Fix | File(s) | Commit |
|-----|---------|--------|
| 1. Fluent2 spacing on CeremonyList | `pages/CeremonyList.tsx` | `8b3f7197` |
| 2. Widen Consult form (880→1200) | `pages/Consult.tsx` | `16414e90` |
| 3+5. Project switcher Menu + System anchored bottom | `components/Layout.tsx` | `d72fd8a7` |
| 4. PresenceBar alignment + WS stale-timer fix | `pages/Board.tsx`, `realtime/ws-client.ts` | `5673d57b` |

### Patterns worth remembering

**Fluent2 page padding canon (per Fenster's typography canon):** every
list/data surface needs `tokens.spacingHorizontalXXL` + `tokens.spacingVerticalL`
on the scroll container so content breathes against the sidebar. Empty
states use `spacingHorizontalXXL` + `spacingVerticalXXL`. Never use a single
axis token (`padding: tokens.spacingVerticalXXL`) for both axes — that's
semantically wrong even when the px value happens to be the same.

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
