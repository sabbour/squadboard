# Squad Decisions

## Active Decisions

### 2026-05-14T08:17:03Z: Project pivot — "foo" → Squadboard
**By:** Ahmed Sabbour (via Coordinator)
**What:** This repo is now the build for **Squadboard** — a local-first kanban + workflow board for Squad agents. Package `@sabbour/squadboard`, MIT, self-hosted.
**Why:** PRD landed at `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md` (~90KB, 15-demo roadmap). Original "foo" placeholder is retired.
**Stack:** Node + Express v5 · Postgres (embedded local / hosted cloud) + Drizzle · React 19 + Vite · WebSocket · Squad SDK · GitHub API.

### 2026-05-14T08:17:03Z: Team augmented for Squadboard
**By:** Ahmed Sabbour (via Coordinator)
**What:** Added 4 specialists to the existing 4-person team (Usual Suspects universe maintained):
- **Hockney** — Backend / Workflow Engine Dev
- **Kobayashi** — Squad SDK Integrator
- **Kujan** — Tester / QA (reject authority on durability + recovery contracts)
- **Redfoot** — DevRel / Docs (reject authority on user-facing copy)

Re-roled **Verbal** from "Interaction Dev" → "Real-time / WebSocket Dev" (project-scoped WS, event_log fan-out, since-id reconnect cursor, Live ops view feed).

Existing roles unchanged: McManus (Lead Architect), Keyser (Frontend Dev), Fenster (UX Designer).
**Why:** "foo"'s original 4 were a web-design team; Squadboard needs full-stack muscle.

### 2026-05-14T08:17:03Z: Five non-negotiable engine invariants (PRD §6.0)
**By:** Ahmed Sabbour (via PRD intake)
**What:**
1. `agent_run` is the only step that does LLM work. `peer_review`, tier-3 routing, and `split` desugar to `issue_runs` rows with distinct `kind` values.
2. **Single-spawner discipline.** The stepper alone spawns runs via `FOR UPDATE SKIP LOCKED`. The dispatcher only ticks/sweeps/wakes — never touches `issue_runs` except via sweepers.
3. Lease (90s TTL) + heartbeat (30s) is the authoritative liveness signal. `kill(pid, 0)` is an in-pod sanity check only.
4. Output schema validation happens at session end — after `sendAndWait` returns, before `recordRunCompletion`. Never on the post-tool-use hook.
5. `fan_out` and `split` materialize full child `workflow_runs` rows in one six-step transaction (issue + workflow_run + first step_run + issue_link + handoff_context + variables propagation). Children inherit `pinnedAgentRevisions` from parent.

**Enforcement:** Kujan has reject authority on PRs that violate these. Hockney owns implementation. McManus owns adjudication of any proposed change.

### 2026-05-14T08:17:03Z: Bypass `SquadCoordinator` (PRD Appendix A)
**By:** Ahmed Sabbour (via PRD intake)
**What:** The Squadboard engine reads `task.assignee` directly and calls `SquadClient.createSession()` for that one agent. Coordinator's regex routing and parallel fan-out are NOT used by the engine.
**Why:** Coordinator's parallel fan-out and ad-hoc handoffs are exactly what Squadboard exists to escape. We need deterministic, single-spawner orchestration with durable state.
**Owner:** Kobayashi.

### 2026-05-14T08:17:03Z: Postgres, not SQLite
**By:** Ahmed Sabbour (via PRD §6.13)
**What:** Storage is Postgres everywhere — embedded `embedded-postgres` (~50MB binary) for local install, hosted Postgres for cloud. Same Drizzle schema, same SQL surface (`FOR UPDATE SKIP LOCKED`, partial unique indexes, JSONB, recursive CTEs, tsvector).
**Why:** Same SQL across local + cloud is worth more than a smaller binary. SQLite was considered and rejected.
**Owner:** Hockney.

### 2026-05-14: PRD canonicalization
**By:** McManus (Lead Architect)
**What:** `docs/prd.md` (~12KB) is the canonical PRD for Squadboard. The research doc (`squad-web-design-v4.md`, 90KB) is the deep design appendix — implementation spec only. The five engine invariants are pasted verbatim into PRD §5. Roadmap = one-line-per-demo only. Verbal listed under re-roled title (Real-time / WebSocket Dev, not Interaction Dev).
**Next:** Redfoot to copy-pass for voice/clarity on `docs/prd.md`. Deep design file to be moved into repo proper (separate routing).

### 2026-05-14: Hacking phase workflow
**By:** Ahmed Sabbour (via Copilot)
**What:** We are in **hacking phase**. (1) Local git only. (2) Use worktrees per issue (`squad/{issue-number}-{slug}` branch). (3) No PRs. (4) Merge frequently into `main` locally. (5) Reviewer rejections (Kujan/Redfoot) happen inline on branch before merge, not via PR. Standard PR workflow resumes when user says "exit hacking phase".
**Why:** User directive — explicit team operating mode for current development phase.

### 2026-05-14: PRD copy pass approved
**By:** Redfoot
**What:** Copy pass on `docs/prd.md` complete and ✅ approved. 12,331 → 12,195 bytes (5 surgical edits). Tightened vision with active problem statement; simplified scope table grammar; improved architecture signal-to-noise; polished tech-stack links; removed instructional trailer. The 5 engine invariants verified paste-locked against `decisions.md`. 14-section structure intact. No follow-up issues flagged. Treat as final for hacking phase.
**Owner:** Redfoot (reject authority on user-facing copy).

### 2026-05-14: Top-level README authored
**By:** Redfoot
**What:** `README.md` at project root, 5,024 bytes. Hero banner uses `assets/squadboard-horizontal.svg` (full width, centered); smaller logo uses `assets/squadboard.svg` (bottom, inline with team names). 10 sections in show-before-tell order (quick-start precedes architecture). All content sourced from `docs/prd.md` — zero invention. Hacking-phase compliant: no Contributing/PR section, no CI badges, no npm badge. Honest status section notes "hacking phase, pre-1.0, breaking changes expected". Brand assets (both SVGs + square PNG) committed alongside.
**Source:** `decisions/inbox/redfoot-readme.md` (merged, inbox deleted).

### 2026-05-14: docs/deliverables.md is canonical work breakdown
**By:** McManus
**What:** `docs/deliverables.md` is the authoritative decomposition of the 15-demo roadmap. All agents reference it for owner assignments, dependencies, and exit criteria. Work items in this doc are the team's backlog for the hacking phase. The 5 engine invariants are tagged per demo so Kujan knows which durability tests each demo needs.
**Rationale:** Domain routing — Hockney owns engine/backend-primary demos (1, 4–10, 15). Kobayashi owns SDK-seam-primary demos (3, 14). Keyser owns UI-primary demos (2, 11, 13). Verbal owns real-time-primary demos (12). Every demo has secondary owners for cross-cutting work.

### 2026-05-14: docs/demos/ holds per-demo user-facing documentation
**By:** Redfoot
**What:** `docs/demos/` is the directory for per-demo user-facing documentation (15 stubs created, pattern: `demo-NN-{slug}.md`). Each stub includes status badge, layer, session time, outcome, prerequisites, "Run it" section, observables, and known gaps. Template discipline — every stub follows the same format. All claims sourced from PRD or marked TBD.
**Rationale:** McManus's `docs/deliverables.md` is the internal work breakdown; `docs/demos/` is what a developer running the demo sees. Hacking-phase compliant: no fake commands, no invented content. As each demo ships, the corresponding stub is updated in the same commit.

### 2026-05-14: docs/acceptance-criteria.md is the quality gate
**By:** Kujan
**What:** `docs/acceptance-criteria.md` defines functional + durability ACs per demo. A demo is NOT shippable until all its ACs have passing tests. Kujan has reject authority on any durability/recovery criterion. All 5 engine invariants are tagged in the demos that exercise them.
**Rationale:** Durability and recovery contracts are non-negotiable. If a PR lands without AC coverage, Kujan rejects, and a different agent (not the original author) writes the fix.

### 2026-05-14: Demo 1 backend scaffold choices
**By:** Hockney
**What:** pnpm workspaces monorepo. Express v5 + TypeScript ESM. embedded-postgres data dir: ~/.squadboard/data. Drizzle ORM for schema management. CLI package with `squadboard init` command. Port 3000.
**Details:**
- `packages/server` — Express v5, TypeScript ESM, embedded-postgres on port 54321, Drizzle ORM + pg driver
- `packages/cli` — `squadboard init` command, TCP-probes port 3000 before opening browser
- Bootstrap schema runs `CREATE TABLE IF NOT EXISTS` on server startup (Demo 1 pragmatic); proper `pnpm db:generate && pnpm db:push` supersedes this
- Wired Kobayashi's `/api/squad/register` to real DB insert (upsert by path column) — removed sidecar-only stub
- `embedded-postgres` data dir `~/.squadboard/data`, internal port 54321 (avoids clash with system Postgres on 5432)
- Client dist path: `packages/server/dist` → `../..` → `packages/client/dist` (Keyser's build output)

### 2026-05-14: .squad/ discovery strategy
**By:** Kobayashi
**What:** Discovery scans home dir (depth 3) + common dev dirs (~/src, ~/code, ~/projects, ~/dev, ~/workspace). Validation: must have team.md. Auto-registration creates projects row. Manual path entry also supported via GET /api/squad/validate.

### 2026-05-14: Demo 1 frontend stack
**By:** Keyser
**What:** Vite 6 + React 19 + TypeScript ESM. Tailwind CSS v4. TanStack Query v5. React Router v7. Dark mode first (GitHub palette). No component library — custom components only. Fenster does visual passes. API client proxies to localhost:3000.

### 2026-05-14: Demo 2 — Issues/Comments/Labels schema
**By:** Hockney
**What:** issues.status uses pgEnum (backlog/todo/in_progress/in_review/done). position integer for column ordering. Soft delete via archived flag. Bulk action via POST /bulk. Move endpoint recalculates positions.
**Details:**
- Issues table: status enum (backlog/todo/in_progress/in_review/done), position ordering, soft-delete via archived flag
- Comments table: markdown body, threaded per issue
- Labels table: per-project, colored badges, many-to-many issue_labels join table
- 14 endpoints: POST/GET issues, POST issue, PUT/DELETE issue, POST move, POST bulk, POST/GET comments, POST comment, DELETE comment, GET/POST labels, POST add-label, DELETE label-link
**Owner:** Hockney (backend)

### 2026-05-14: Demo 2 — Kanban board UI
**By:** Keyser
**What:** @hello-pangea/dnd for drag-drop (maintained react-beautiful-dnd fork). Optimistic updates on drag. CardDetail as right slide-over (not page nav). Multi-select via checkbox. BulkActionBar at bottom when selection active. Five fixed columns matching DB enum.
**Details:**
- Five-column board (backlog/todo/in_progress/in_review/done) with drag-and-drop persistence
- IssueCard component: labels, assignee avatar, comment count, multi-select checkbox
- CardDetail: right-side slide-over with full card view, comments, label picker
- BulkActionBar: move/archive batch operations when items selected
- FilterBar: title search + label filter chips
- CreateIssueModal, CommentList (react-markdown + remark-gfm), AddComment
**Owner:** Keyser (frontend)

### 2026-05-14: Agent sync strategy (Demo 3)
**By:** Kobayashi
**What:** File-on-disk is source of truth. DB is a sync mirror (upsert on hash change). Hire creates files first, then DB row. Disable = status='disabled' in DB, file untouched. Charter changes detected via md5 hash. chokidar watches for live reload.
**Rationale:** Ensures agent state persists cleanly across server restarts and team collaboration — no divergence between filesystem and database.

### 2026-05-14: Agents UI pattern (Demo 3)
**By:** Keyser
**What:** Agents page uses grid layout (not list). Two sections: Active + Disabled. AgentDetailPanel is 520px slide-over (wider than board's 480px for charter editing). Charter editing is raw textarea (no Monaco in Demo 3 — Monaco lands in Demo 11). HireAgentModal validates kebab-case name.
**Rationale:** Grid scales better for scanning agents; dual sections clarify state at a glance. Wider panel accommodates charter editing; raw textarea keeps Demo 3 lean.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
- The five engine invariants above are non-negotiable without an explicit decision entry overriding them
