# Scribe — History

## Core Context

- **Project:** A web design project (v4 iteration) for the Squad product site
- **Role:** Session Logger
- **Joined:** 2026-05-14T08:12:50.176Z

## Learnings

- **2026-05-14 Inbox Merge:** Merged 2 decisions into decisions.md: (1) PRD canonicalization (McManus) — `docs/prd.md` is canonical, research doc is deep design appendix; (2) Hacking-phase workflow (user) — local git only, worktrees per issue, no PRs, merge frequently to main. Updated team history files + committed.
- **2026-05-14 Round 2 commit:** Merged Redfoot's PRD copy pass decision into decisions.md. Committed her 5 edits to `docs/prd.md` (~1% shrink). Local-only (hacking phase). No follow-up issues.
- **2026-05-14 Round 3 commit:** Merged Redfoot's top-level README decision into decisions.md. Committed README (5,024 bytes) + brand assets (both SVGs + square PNG). Skipped Windows NTFS metadata `:Zone.Identifier` and `:sec.endpointdlp` files — these are DLP scanner artifacts that leak into WSL, never commit them. Deleted inbox file. Updated both agent histories. Local-only (hacking phase).
- **2026-05-14 Round 4 commit:** Merged 3 parallel inbox decisions (McManus deliverables decomp, Redfoot demo stubs, Kujan acceptance criteria). Committed docs/ decomposition tree — `docs/deliverables.md` (22K), 15 demo stubs in `docs/demos/` (767 total lines), `docs/acceptance-criteria.md` (43K). Updated `.squad/decisions.md` with 3 new anchor decisions. Cleared all inbox files. All agent history files updated.
- **2026-05-14 Round 5 (Demo 1 scaffold):** Merged 3 Demo 1 decisions into decisions.md: Hockney (backend/server/CLI), Kobayashi (squad-discovery), Keyser (client shell). Staged packages/server, packages/client, packages/cli monorepo + root config files. Committed Demo 1 scaffold.
- **2026-05-14 Round 6 (Demo 2 commit):** Merged 2 Demo 2 decisions into decisions.md: Hockney (issues/comments/labels schema + 14-endpoint CRUD API), Keyser (kanban board UI with drag-drop, CardDetail slide-over, bulk actions, FilterBar). Staged all backend schema/routes/services changes and all frontend board components. Committed "Demo 2 — The Board Works".
- **2026-05-14 Round 7 (Demo 3 commit):** Merged 2 Demo 3 decisions into decisions.md: Kobayashi (CharterCompiler, agent-sync + chokidar, 7-endpoint agents CRUD API + agents DB schema), Keyser (agents grid UI + detail panel slide-over + hire modal + charter editor + status badges). Staged packages/server (DB, services, routes, package.json), packages/client (API, pages, components, Layout, App), and agent history files. Committed "Demo 3 — Squad Onboarding (agent discovery + management)".
- **2026-05-14 Round 8 (Demo 4 commit):** Merged 3 Demo 4 decisions into decisions.md: Hockney (engine core: Dispatcher 5s tick, Stepper FOR UPDATE SKIP LOCKED, Sweeper lease reclaim, Workspace strategies, Schema additions, routes), Kobayashi (SDK bridge: executeAgentRun single entry, SquadClient bypass, OutputStreamer, CostTracker), Keyser (run UI: RunButton, RunOutputPanel SSE, RunStatusBadge with pulse, RunHistory, CostDisplay, CardDetail integration). All engine invariants 1-3 now enforced. Staged backend engine files, SDK bridge, routes, DB schema, client run components, and all agent history files. Committed "Demo 4 — One-Shot Agent (engine core)".
- **2026-05-14 Round 9 (Demo 5 commit):** Merged 2 Demo 5 decisions into decisions.md: Hockney (routing engine: router.ts loadRoutingRules/resolveRoute/createRoutedRun, routing_rules table, kind enum on issueRuns, routing API routes, auto-route hook on POST /issues), Kobayashi (routing-compiler: parseRoutingFile+matchRule, RoutingBadge, routing test panel in Agents.tsx). Staged all backend routing engine files, DB schema updates, API routes, client routing badge + test panel. Committed "Demo 5 — Routing Tier 1 (deterministic auto-assignment)".

