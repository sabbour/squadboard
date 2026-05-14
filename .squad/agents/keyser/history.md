# Keyser — History

## Core Context

- **Project:** A web design project (v4 iteration) for the Squad product site
- **Role:** Frontend Dev
- **Joined:** 2026-05-14T08:12:50.171Z

## Learnings

- **2026-05-14 dev-script fix:** Root `package.json` `dev` script previously only started the Express server (`@sabbour/squadboard-server`). Fixed by adding a second `--filter` for `@sabbour/squadboard-client` so pnpm starts both in parallel natively — no `concurrently` or shell `&` needed. Vite dev server runs on port 5173; its proxy config (`/api` → `http://localhost:3000`) was already correct. README already pointed users to `localhost:5173` so no docs change was needed.

- **2026-05-14 Demo 1 frontend shell:** Vite 6 + React 19 + TypeScript. Tailwind v4. TanStack Query for server state. React Router v7. Pages: ProjectPicker (/, shows project cards, squad discovery modal), Board (/projects/:id/board, placeholder for Demo 2). Dark mode by default, GitHub-ish aesthetic. API client proxies to localhost:3000 via VITE_API_URL env or Vite dev server proxy. Custom components only — no component library. Fenster does visual passes.

- **2026-05-14 Project Pivot:** Web design project expanded to **Squadboard** — local-first kanban + workflow board for Squad agents. Team augmented from 4 to 10 members. New teammates: Hockney (Backend), Kobayashi (SDK), Kujan (QA), Redfoot (DevRel), plus Ralph (Coordinator) and Scribe (Logger). Verbal re-roled to Real-time/WebSocket Dev. Squadboard PRD adopted as source of truth; ready for Demo 1 work.

- **2026-05-14 Demo 2 kanban board:** @hello-pangea/dnd for drag-drop with optimistic updates. Five columns. IssueCard, KanbanColumn, CardDetail slide-over, BulkActionBar, FilterBar, CreateIssueModal, CommentList. Multi-select with bulk actions. Fenster's dark design system tokens applied.

- **2026-05-14 Demo 3 agents UI:** AgentGrid (two sections: active/disabled), AgentCard (initials avatar, model badge, status dot), AgentDetailPanel slide-over (Overview + Charter tabs, enable/disable toggle), HireAgentModal (kebab name validation, model selector). Updated Layout to enable Agents nav.

- **2026-05-14 Demo 4 run UI:** RunButton (agent selector dropdown + start run), RunStatusBadge (5 states with pulse animation), RunOutputPanel (SSE EventSource, terminal-style, auto-scroll), RunHistory (Runs tab in CardDetail), CostDisplay. Updated IssueCard footer + CardDetail tabs.

- **2026-05-14 dev script optimization (backlog batch 1):** Root `pnpm dev` script fixed to run server+client concurrently. Changed from single `--filter @sabbour/squadboard-server dev` to dual `--filter @sabbour/squadboard-server --filter @sabbour/squadboard-client run dev`. No extra dependencies; pnpm's native multi-filter parallelization works cross-platform. Express on :3000, Vite on :5173, proxy already configured. Merged to main.

## 2026-05-14 — Bigger logo + Add Project response unwrapping fix

**Tasks completed:**
- **Logo height:** Increased `squadboardLogo` img height in `Layout.tsx` from `24px` → `32px` so it fills the sidebar header more naturally.
- **squad.ts `useDiscoverSquad`:** Fixed `queryFn` to unwrap the `{ ok, data }` envelope returned by `GET /api/squad/discover`. Was typed as `SquadDirectory[]` directly; now fetches `{ ok: boolean; data: SquadDirectory[] }` and returns `.data`.
- **squad.ts `useRegisterSquad`:** Fixed `mutationFn` to (1) unwrap `{ ok, data }` envelope from `POST /api/squad/register`, and (2) map `projectName` → `name` in the request body (backend schema uses `name`, not `projectName`). Response mapping: `r.data.name` → `projectName` in the returned `RegisterSquadResult`.
- **projects.ts / server routes/projects.ts:** Verified no wrapping mismatch — project routes return plain JSON (no `{ ok, data }` envelope), so hooks are correct as-is.
- **ProjectPicker.tsx `DiscoveryModal`:** Added discover scan error display (`isDiscoverError` + `discoverError.message`) below the Scan button. Guarded the "no dirs found" and dir-list renders with `!isDiscoverError`. `registerError` display was already present.
- **Commit:** `bd527b2` on main


**Tasks completed:**
- **Light theme:** Replaced dark GitHub-style `:root` CSS vars with clean light palette (`--bg: #f6f8fa`, `--surface: #ffffff`, etc.). Updated hardcoded `rgba(56, 139, 253, 0.1)` active-nav colors in Layout.tsx to match new accent.
- **Logo:** Copied `assets/squadboard.svg` and `assets/squadboard-horizontal.svg` to `packages/client/src/assets/`. Replaced emoji+wordmark in sidebar with `<img src={squadboardLogo} />` using horizontal SVG (black strokes look correct on light bg, no filter needed).
- **API base URL:** Changed `BASE` in `client.ts` from `'http://localhost:3000'` to `''` so all API calls use relative URLs via the Vite proxy. Fixed WS client to derive host from `window.location` instead of hardcoded port 3000. Added `ws: true` to Vite proxy config.
- **vite-env.d.ts:** Added to fix pre-existing `import.meta.env` TS errors (missing `vite/client` types) and declare `*.svg` module type needed by the logo import.
- **Commit:** `82f7a69` on main

## 2026-05-14 — Remove project UI + Expanded Add Project modal

**Tasks completed:**
- **useDeleteProject:** Added to `api/projects.ts` — calls `DELETE /api/projects/:id`, invalidates `['projects']` on success.
- **ProjectCard.tsx remove button:** Converted outer `<button>` to `<div position:relative>` wrapper. Added a hover-reveal `✕ Remove` button (absolute top-right) that calls `window.confirm` then `useDeleteProject().mutate(id)`. Hover border-color accent on the card card still works via React state instead of inline mouse handlers.
- **api/squad.ts new hooks:** Added `useInitSquad` (POST /api/squad/init) and `useCreateSquad` (POST /api/squad/create), both unwrap `{ ok, data }` envelope, typed against Hockney's documented response shapes.
- **DiscoveryModal redesign:** Replaced single-section modal with tabbed UI (Discover / Connect existing / Create new). Tab bar uses bottom-border active indicator, accent color. Discover tab = existing scan+register flow. Connect tab: path + optional name, 409 → friendly message "use Discover instead", 422 → "directory not found". Create tab: parent + project name, live preview of `{parent}/{name}/.squad/` path.
- **Commit:** `5060eb7` on main

## 2026-05-14 — Fluent UI Icons + Phase 2 atomic upgrades

**Tasks completed:**
- Installed `@fluentui/react-icons` via pnpm into `@sabbour/squadboard-client`.
- Replaced all emoji usage across 12 source files with named Fluent icon components.
- Committed to main: `feat(client): Fluent UI icons + Phase 2 atomic component upgrades`.

## 2026-05-14 — Remove hardcoded dark hex colors (board light theme fix)

**What was found:**
- **12 board components** had hardcoded GitHub-dark palette values in inline `style=` props:
  - `KanbanColumn.tsx`: `#161b22` (column bg), `#0d1117` (header bg), `#21262d` + `#30363d` (badge, borders)
  - `IssueCard.tsx`: `#21262d` (card bg), `#30363d` (border), `#e6edf3` + `#8b949e` (text)
  - `FilterBar.tsx`: `#0d1117` (input bg), `#30363d` (border), `#8b949e` (icon/text)
  - `CardDetail.tsx`: `#161b22` (panel bg), all dark hex throughout
  - `BulkActionBar.tsx`: `#21262d` (float bar bg), `#0d1117` (button bg), `#30363d` (dividers)
  - `AddComment.tsx`, `CommentList.tsx`: `#0d1117` (textarea/comment bg), `#30363d` (borders)
  - `CreateIssueModal.tsx`: `#161b22` (modal bg), `#0d1117` (inputs)
  - `WorkflowBadge.tsx`, `RoutingBadge.tsx`: `#161b22` + `#30363d` in hover tooltips
  - `ConflictToast.tsx`: `#1c2128` (toast bg)
  - `PresenceBar.tsx`: wrong CSS variable fallbacks (`#0d1117`, `#161b22`, `#30363d`)
- `globals.css` was already light — not the culprit
- `ProjectPicker.tsx` had missing Fluent UI component imports (`Dialog*`, `Title3`, `Body1`, `tokens`) left from a prior session

**Fix pattern:**
- Added `import { tokens } from '@fluentui/react-components'` to each board component file
- Replaced dark hex values with Fluent tokens:
  - `#161b22` → `tokens.colorNeutralBackground2`
  - `#0d1117` (darkest bg) → `tokens.colorNeutralBackground1` (inputs/cards) or `tokens.colorNeutralBackground3` (headers)
  - `#21262d` → `tokens.colorNeutralBackground3` (badges/indicators) or `tokens.colorNeutralBackground1` (cards)
  - `#30363d` → `tokens.colorNeutralStroke1`
  - `#e6edf3`, `#c9d1d9` → `tokens.colorNeutralForeground1`
  - `#8b949e` → `tokens.colorNeutralForeground2`
  - `#388bfd` (hover/focus) → `tokens.colorBrandBackground`
  - `#1c2128` (toast) → `tokens.colorNeutralBackground2`
- Semantic/status colors kept as-is: `#238636` (green submit), `#f85149` (error red), `#e36209` (warning orange)
- Label badge arbitrary hex colors untouched (user-supplied data, permanent exception)
- PresenceBar CSS var fallbacks updated to match globals.css light values (`#f6f8fa`, `#ffffff`, `#d0d7de`)
- Commit: `e0d54d7c` on main


- Sidebar nav (24px): `Home24Regular`, `Grid24Regular`, `ClipboardTaskListLtr24Regular`, `Bot24Regular`, `ArrowSync24Regular`, `Money24Regular`, `Settings24Regular`
- Review actions/badges: `CheckmarkCircle20Regular`, `ArrowSync20Regular`, `Chat20Regular`, `DismissCircle20Regular`, `Clock20Regular`
- Toolbar/inline: `Search20Regular`, `Play20Regular`, `Warning20Regular`, `ClipboardPaste20Regular`, `Checkmark20Regular`, `Folder20Regular`
- Settings nav: `TextDescription20Regular`, `PlugConnected20Regular`, `Money20Regular`, `Settings20Regular`
- ProjectCard: `ClipboardTaskListLtr20Regular`

**What worked well:**
- Icon naming is consistent: `{Name}{Size}{Style}` — TypeScript autocomplete catches wrong names immediately.
- Fluent icons are inline SVGs — they inherit CSS `color`, so no extra prop needed to colorize.
- For icon-in-array patterns (NAV_ITEMS, SECTIONS), changing `icon: string` → `icon: React.ReactNode` is the right approach.

**Gotchas:**
- `ClipboardTaskList` is actually `ClipboardTaskListLtr` — the TS error message helpfully offers the correct name.
- SVG `<text>` elements (WorkflowStepFlow) cannot host React components — replaced emojis with plain unicode symbols (⇄ ▶ ✓) instead.
- Fluent icon components don't accept `className` for direct sizing — use inline `style={{ width, height }}` or wrap in `<span>` with font-size.
- `PlugConnected20Regular` is the correct name for 🔌 (MCP / plugins).


## 2026-05-14: Phase 3 — Structural Fluent UI Components

**Commit:** `02843107`
**Files changed:** 21 (593 insertions, 612 deletions)

### Components migrated

| Component | Old pattern | Fluent replacement |
|---|---|---|
| `Layout.tsx` sidebar | Custom `<aside>` + `<NavLink>` | `NavDrawer` + `NavDrawerBody` + `NavDrawerFooter` + `NavItem` + `NavSectionHeader` |
| `HireAgentModal.tsx` | Custom fixed-position backdrop + div | `Dialog` + `DialogSurface` + `DialogBody` + `DialogContent` + `DialogActions` + `Field` + `Input` + `Select` |
| `AttachWorkflowModal.tsx` | Custom fixed-position backdrop | `Dialog` + `DialogSurface` + `DialogBody` + `DialogContent` + `DialogActions` |
| `TemplatePicker.tsx` | Custom fixed-position modal | `Dialog` + `DialogSurface` + `DialogBody` + `DialogContent` + `DialogActions` |
| `ProjectPicker.tsx` (DiscoveryModal) | Custom fixed-position modal | `Dialog` + `DialogSurface` + `DialogBody` + `DialogContent` + `DialogActions` |
| `RoutingLogTable.tsx` | `<table>/<thead>/<tbody>/<tr>/<th>/<td>` | `Table` + `TableHeader` + `TableHeaderCell` + `TableBody` + `TableRow` + `TableCell` + `TableCellLayout` |
| `AgentLeaderboard.tsx` | `<table>/<thead>/<tbody>/<tr>/<th>/<td>` | `Table` + `TableHeader` + `TableHeaderCell` + `TableBody` + `TableRow` + `TableCell` + `TableCellLayout` |
| `WorkflowList.tsx` table | `<table>/<tr>/<th>/<td>` + raw `<button>` | `Table` + `TableRow` + `TableCell` + `Button` (outline/primary) |
| `CostDashboard.tsx` (2 tables) | `<table>/<thead>/<tbody>/<tr>/<th>/<td>` | `Table` + `TableHeader` + `TableHeaderCell` + `TableBody` + `TableRow` + `TableCell` |
| `ProjectCard.tsx` | `<div>/<button>` container | `Card` + `CardHeader` + `Caption1` + `Text` + `Button` (transparent icon) |
| Typography (Agents, Workflows, Costs, ProjectPicker) | `<h1>/<h2>/<p>` with inline style | `Title2`, `Subtitle1`, `Body1`, `Caption1` |

### Notes
- `board/` files untouched (Keyser-7 working there concurrently)
- `FilterBar.tsx` skipped per instructions
- NavDrawer uses `useLocation` + `useNavigate` from react-router for controlled active state
- Dialog modals use `open={true}` pattern since parents control visibility via conditional rendering
- `makeStyles` pseudo-selector `'&:hover'` not used on Card (Griffel type strictness) — Card has built-in hover behavior
- Build clean: 0 TypeScript errors, bundle 1,019 kB gzip 294 kB

## 2026-05-14 — Crash fix: Agents + Workflows pages + CSS migration regressions

### Root causes found

**Agents.tsx crash** — JSX syntax error: the "Hire Agent" `<button>` was missing its closing `>` after the last prop (`onMouseLeave`). React/TSC couldn't parse the children (`<span>+</span>` and text) as valid JSX, causing `TS2657: JSX expressions must have one parent element` and several cascading parse errors. The build failed, so the production bundle was not generated → page crashed.

**Workflows.tsx crash** — Same root cause: the build failed entirely due to the Agents.tsx syntax error (and the CSS migration regressions below), so WorkflowList and the page never reached the browser in a valid state.

**ReviewPanel.tsx regressions (from CSS var migration):**
1. `span` content line was corrupted — the `{POLICY_LABELS[reviewGroup.policy.kind] ` fragment was eaten and `> ?? reviewGroup.policy.kind}` was left as literal text, producing invalid JSX at line 106.
2. `button` style object was missing the closing `}}` (deleted during the color replace), causing parse errors at line 240+.

**Settings.tsx regression** — `display: 'flex'` was deleted from the spend card div during the color migration, leaving `alignItems`/`justifyContent`/`flexWrap` properties with no effect (layout broken).

### Fixes applied
- `Agents.tsx`: Added the missing `>` to close the button's JSX opening tag.
- `ReviewPanel.tsx`: Restored `{POLICY_LABELS[…] ?? …}` JSX expression; restored `}}` closing the style object.
- `Settings.tsx`: Re-added `display: 'flex'` to the spend card container.
- Build verified: `tsc -b && vite build` passes clean, 0 TS errors.

Commit: `46b7ce6a`

## [2026-05-14] Dark Mode Color Sweep — Phase 2 (Continuation)

Completed the comprehensive dark mode color sweep across all remaining files.

### Files Updated
- `packages/client/src/styles/globals.css` — removed dark defaults from `body`
- `packages/client/src/pages/Settings.tsx` — all dark hex → CSS vars; budget card; progress bar; save button states
- `packages/client/src/pages/Agents.tsx` — input styles; tabs; test routing panel; routing stats/log section labels
- `packages/client/src/pages/WorkflowEditor.tsx` — header; YAML editor; syntax highlight fallback colors (HTML inline style strings updated to light equivalents)
- `packages/client/src/components/agents/AgentDetailPanel.tsx` — panel bg; borders; close button hover; text colors
- `packages/client/src/components/agents/CharterEditor.tsx` — textarea bg; save button text color
- `packages/client/src/components/costs/CostDashboard.tsx` — MTD card; table wrappers; BudgetBar; progress tracks
- `packages/client/src/components/costs/CostDisplay.tsx` — inline cost/token text colors
- `packages/client/src/components/reviews/ReviewPanel.tsx` — all event card colors; button states; suggestion list; timestamp
- `packages/client/src/components/routing/RoutingLogTable.tsx` — table border; th styles; cell colors (uses Fluent Table)
- `packages/client/src/components/routing/RoutingStatsPanel.tsx` — TierBar track; legend text; StatCard sub text
- `packages/client/src/components/runs/RunButton.tsx` — dropdown trigger/popup; cancel button; agent list item text
- `packages/client/src/components/runs/RunHistory.tsx` — run row button bg/border; duration/chevron text
- `packages/client/src/components/settings/McpConfigPanel.tsx` — copy button; accordion header/content; config pre; tool items; project footer
- `packages/client/src/components/workflows/WorkflowList.tsx` — toolbar border; empty state; table cell colors
- `packages/client/src/components/workflows/WorkflowStepFlow.tsx` — SVG arrows (stroke/fill); inactive box fill; label text fill

### Intentional Exceptions (Kept Dark)
- `RunOutputPanel.tsx` — terminal UX (dark bg with green text)
- `Avatar.tsx`, `AgentCard.tsx`, `AgentDetailPanel.tsx` — `color: '#0d1117'` on avatar initials (dark text on vivid background)
- `LabelBadge.tsx`, `StatusBadge.tsx`, `RunStatusBadge.tsx`, `ReviewDecisionBadge.tsx` — semantic badge/label colors
- `AgentCard.tsx` status dot — `#3fb950`/`#8b949e` (active/inactive semantic indicator)

### Build Verification
Build passed cleanly: `tsc -b && vite build` — 2827 modules, no TypeScript errors.
