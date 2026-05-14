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
