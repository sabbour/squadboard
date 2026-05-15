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

### 2026-05-14: Engine core architecture (Demo 4)
**By:** Hockney
**What:** Dispatcher tick=5s (sweep→wake→advance). Stepper uses raw SQL FOR UPDATE SKIP LOCKED (Drizzle doesn't support it). Lease TTL=90s, heartbeat=30s. Three workspace strategies: scratch (tmpdir), dir (~/.squadboard/workspaces), worktree (stubbed for Demo 4). SSE stream uses 1s DB poll for Demo 4 (real pipe streaming in Demo 12). Sweeper runs on every tick. Invariants 1, 2, 3 now enforced.
**Details:**
- Schema: issueRuns, workflowRuns, stepRuns + status/strategy enums
- Dispatcher: 5s tick loop (sweep → wake → advance)
- Stepper: claim-and-run with raw SQL FOR UPDATE SKIP LOCKED
- Sweeper: reclaim expired leases + orphaned runs on crash/restart
- Workspace: scratch (tmpdir), dir (~/.squadboard/workspaces), worktree (stubbed)
- Routes: POST/GET issue runs, GET run status, POST cancel, GET SSE stream

### 2026-05-14: SDK bridge architecture (Demo 4)
**By:** Kobayashi
**What:** executeAgentRun() is the ONLY function the engine calls for LLM work (Invariant 1 enforced). SquadCoordinator bypass confirmed: engine calls SquadClient.createSession() directly. SDK gracefully degrades to stub when @sabbour/squad-sdk not installed. OutputStreamer streams chunks to DB. CostTracker records per run.
**Details:**
- executeAgentRun(): single entry point, reads charter, calls SquadClient directly
- SquadClient: @sabbour/squad-sdk wrapper with graceful stub fallback
- OutputStreamer: incremental SQL COALESCE append to issue_runs.output
- CostTracker: per-run token + cost recording

### 2026-05-14: Run status UI pattern (Demo 4)
**By:** Keyser
**What:** RunOutputPanel uses EventSource (SSE) for real-time output. Terminal-style display (#0d1117 bg, monospace, green text). RunHistory tab added to CardDetail. RunButton in IssueCard footer. CostDisplay shows $X.XXX · N tokens. Running state uses animated pulse badge.
**Details:**
- RunButton: agent selector dropdown + start/cancel/done states
- RunOutputPanel: SSE EventSource, terminal-style, auto-scroll
- RunStatusBadge: 5 states with animated pulse on Running
- RunHistory: collapsible run list in CardDetail Runs tab
- CostDisplay: $X.XXX · N tokens format
- Updated: IssueCard footer, CardDetail tabs, KanbanColumn/Board prop threading

### 2026-05-14: Demo 5 — Routing Tier 1 architecture
**By:** Hockney
**What:** Routing desugars to issue_runs kind='agent_run' (Invariant 1). Rules loaded from routing.md into routing_rules cache table. Match order: label > keyword > catchall. Hot-reload is restart-only (v1 non-goal). resolveRoute returns null for Tier 2/3 escalation (Demo 8).

### 2026-05-14: Demo 5 — routing.md parse strategy
**By:** Kobayashi
**What:** Parser reads actual .squad/routing.md table format. MatchType inferred from pattern: label: prefix → label, * → catchall, else keyword. Priority = file order. matchRule() used by Hockney's router.ts. RoutingBadge shows auto-assignment provenance on IssueCard.

### 2026-05-14: Demo 14 — MCP server binding (Open Question #7 resolution)
**By:** Kobayashi (SDK Integrator)
**What:** The MCP server is implemented as a **stdio server** (not TCP), spawned as a separate process via `squadboard mcp`. This supersedes the "same process, localhost TCP" proposal from the deliverables brief — stdio is simpler, requires no port management, and is the standard transport for MCP hosts (Claude Desktop, Cursor, etc.).

- Entry point: `packages/server/dist/mcp/index.js`
- Transport: stdio (JSON-RPC 2.0 over stdin/stdout, stderr for logs)
- Started via: `squadboard mcp` CLI command
- MCP tools exposed: `squadboard_list_issues`, `squadboard_create_issue`, `squadboard_run_agent`, `squadboard_get_run_status`, `squadboard_list_agents`, `squadboard_slash_command`
- SDK: `@modelcontextprotocol/sdk@^1.29.0` (installed in `packages/server`)
- Slash handler: `packages/server/src/mcp/slash-handler.ts` — parses `/squadboard <cmd>` strings, returns markdown
- Express stays on port 3000; no MCP TCP port needed.

**Rationale:** stdio avoids port conflicts, firewall issues, and is the de-facto MCP convention. Claude Desktop config snippet printed to stderr on `squadboard mcp` startup.

### Demo 9 open question #2 resolution: `request_changes_policy` default
**By:** Hockney
**What:** `request_changes_policy` on `approve` workflow steps defaults to `'first'` — the first reviewer who requests changes blocks the workflow and re-queues the prior agent_run step with feedback injected. This mirrors GitHub PR semantics.
**Allowed values:** `'first'` (default) | `'majority'` (strict majority must request changes to block) | `'all'` (every reviewer must request changes to block).
**Interaction with `quorum`:** `quorum: { n: 2, of: 3 }` requires ≥ N approvals before the policy is evaluated. A `'first'` request_changes short-circuits regardless of quorum — the veto lands the moment any single reviewer requests changes.
**Why 'first':** Safety over convenience. One reviewer seeing a problem is enough to stop the train. Teams wanting permissive gates can opt into `'majority'` or `'all'` explicitly.
**Enforced at:** `peer-reviewer.ts::shouldBlock()` + `workflow-runner.ts::handleApproveStep()`.
**Owner:** Hockney.


- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
- The five engine invariants above are non-negotiable without an explicit decision entry overriding them

### Demo 12 open question #6 resolution: Optimistic concurrency for concurrent issue edits
**By:** Verbal (Real-time / WebSocket Dev)
**What:** Concurrent edit conflicts on issues are resolved using an **optimistic concurrency token** — a `version INTEGER NOT NULL DEFAULT 1` column on the `issues` table.
**Protocol:**
- Every `GET /api/projects/:projectId/issues/:id` response includes `version`.
- `PATCH /api/projects/:projectId/issues/:id` — if the request body includes `version`, the update is conditional: `WHERE id = ? AND version = ?`. If zero rows are updated (mismatch), the server returns `409 { error: 'conflict', currentVersion: N }`. The client must re-fetch and re-apply its edit.
- On every successful PATCH the server increments `version` atomically: `SET version = version + 1`.
- If `version` is omitted from PATCH, the legacy path runs (no concurrency check) — backward compatible.
**Why optimistic (not pessimistic):**
- Lock-free reads; no deadlock risk.
- Conflicts are rare on a kanban board; rejecting and re-fetching is cheap.
- Works across multiple tabs without server-side session state.
**Implementation:** `routes/issues.ts` PATCH handler; `db/schema.ts` + `db/index.ts` migration.
**Owner:** Verbal.

### Demo 15 open question #8 resolution: GitHub issue mirroring is OFF by default, opt-in per project
**By:** Hockney (Backend / Workflow Engine Dev)
**What:** GitHub issue mirroring (push Squadboard issues to GitHub Issues) is **disabled by default** on every project. It becomes active only when explicitly enabled via `PUT /api/projects/:id/github` with a valid PAT + owner + repo.
**Mechanism:**
- `projects.github_sync_enabled BOOLEAN DEFAULT FALSE` — gate column; sync hooks short-circuit immediately if false.
- `projects.github_token TEXT` — GitHub Personal Access Token, stored in plaintext in Postgres.
- `projects.github_owner TEXT`, `projects.github_repo TEXT` — target repository.
- `PUT /api/projects/:id/github { token, owner, repo }` enables sync and starts a 60 s pull loop.
- `DELETE /api/projects/:id/github` disables sync and stops the pull loop.
**Security note:** Token stored in plaintext is acceptable for the local-first hacking phase (Postgres is embedded and not exposed). **Production deployments MUST use a secrets manager** (e.g., AWS Secrets Manager, Azure Key Vault, HashiCorp Vault) and store only a secret reference in the DB column. This is a known tech debt item; do not ship to multi-tenant cloud without addressing it.
**Why opt-in:** Teams using Squadboard for internal planning should not be required to expose their issues to GitHub. Mirroring is an advanced integration — opting in is the safe default.
**Owner:** Hockney.
**Files:** `packages/server/src/github/client.ts`, `sync.ts`, `sync-hook.ts`, `routes/github-sync.ts`, `db/schema.ts`, `db/index.ts`.

### 2026-05-15: Coordinator session-state snapshot
**By:** Ahmed Sabbour (via Copilot CLI / Squad coordinator)
**What:** Durable snapshot of mid-session state — what was just dispatched, what has shipped, what's open. Triple-recorded across `plan.md`, `todos` SQL table, and this file so the session can resume from any of the three.

**Why:** User directive — *"You need to track all this somewhere durable in case the session crashes."* Compaction has already happened twice this session; rotating snapshots prevents replanning loss.

**Snapshot:**

- **Recently shipped (this segment):**
  - `42c120a0` feat(issues): Formulate with AI on the New Issue dialog (Keyser)
  - `a97e2bce` fix(ui): build break + 204 cache + Routing crash + sidebar/Consult overhaul

- **In flight (5 background agents):**
  - ⚛️ Keyser → Consult page layout rebalance (`pages/Consult.tsx`)
  - 🎨 Fenster → Fluent2 typography + spacing consistency sweep (app-wide)
  - 🏛 McManus → Customizable kanban columns slice (column_meta table + drawer)
  - 🔧 Hockney → Timezone "7 hours ago" bug (withTimezone:true on user-facing timestamps)
  - 📡 Verbal → Uber Now view `/now` (cross-project aggregator + global WS scope + page)

- **Open bugs not yet dispatched:** issue spam loop (createIssue mutation runaway), `fry/` agent dir investigation, `p1-verify` smoke pass.

- **Active machinery:** `manage_schedule` schedule #1 (10-min recurring status pings).

**Resume rule:** if compaction or crash strikes, the next session can rebuild from `plan.md → "Session in flight — coordinator snapshot (2026-05-15 05:20 PDT)"` plus `SELECT * FROM todos WHERE id LIKE 's-%'`.

**Forward-compatibility:** all 5 in-flight agents are independent — no inter-agent file conflicts. They will each commit atomically with explicit `git add` paths. Merge order doesn't matter.

### 2026-05-14: New chore extension
**By:** Ahmed (via Copilot)
**What:** Added squadboard-chore extension for housekeeping tasks that aren't bugs or features, with no docs requirement.
**Why:** Productize the chore workflow alongside add-feature and report-bug.
