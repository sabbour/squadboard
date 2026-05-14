# Keyser — History

## Core Context

- **Project:** A web design project (v4 iteration) for the Squad product site
- **Role:** Frontend Dev
- **Joined:** 2026-05-14T08:12:50.171Z

## Learnings

- **2026-05-14 Demo 1 frontend shell:** Vite 6 + React 19 + TypeScript. Tailwind v4. TanStack Query for server state. React Router v7. Pages: ProjectPicker (/, shows project cards, squad discovery modal), Board (/projects/:id/board, placeholder for Demo 2). Dark mode by default, GitHub-ish aesthetic. API client proxies to localhost:3000 via VITE_API_URL env or Vite dev server proxy. Custom components only — no component library. Fenster does visual passes.

- **2026-05-14 Project Pivot:** Web design project expanded to **Squadboard** — local-first kanban + workflow board for Squad agents. Team augmented from 4 to 10 members. New teammates: Hockney (Backend), Kobayashi (SDK), Kujan (QA), Redfoot (DevRel), plus Ralph (Coordinator) and Scribe (Logger). Verbal re-roled to Real-time/WebSocket Dev. Squadboard PRD adopted as source of truth; ready for Demo 1 work.

- **2026-05-14 Demo 2 kanban board:** @hello-pangea/dnd for drag-drop with optimistic updates. Five columns. IssueCard, KanbanColumn, CardDetail slide-over, BulkActionBar, FilterBar, CreateIssueModal, CommentList. Multi-select with bulk actions. Fenster's dark design system tokens applied.

- **2026-05-14 Demo 3 agents UI:** AgentGrid (two sections: active/disabled), AgentCard (initials avatar, model badge, status dot), AgentDetailPanel slide-over (Overview + Charter tabs, enable/disable toggle), HireAgentModal (kebab name validation, model selector). Updated Layout to enable Agents nav.

- **2026-05-14 Demo 4 run UI:** RunButton (agent selector dropdown + start run), RunStatusBadge (5 states with pulse animation), RunOutputPanel (SSE EventSource, terminal-style, auto-scroll), RunHistory (Runs tab in CardDetail), CostDisplay. Updated IssueCard footer + CardDetail tabs.
