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

