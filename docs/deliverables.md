# Squadboard — Deliverables

> Source: docs/prd.md (canonical PRD). Deep design: squad-web-design-v4.md.
> Last updated: 2026-05-14

## Overview

Squadboard ships as 15 vertical demo slices — each installable, clickable, and adding one user-observable capability. Demos progress from Foundation (project bootstrap) through Engine Core (workflows, resilience) to Board UI (kanban, editing) to Workflow (fan-out, review) to Advanced (live ops, GitHub sync). After every demo the product is releasable.

## Dependency Graph

```
Layer 1 — Foundation
  Demo 1: Hello Squadboard (no deps)

Layer 2 — Engine Core
  Demo 4: One-shot agent ──────────── depends on 1, 3
  Demo 5: Routing tier 1 ─────────── depends on 4
  Demo 6: First workflow ──────────── depends on 5
  Demo 7: Resilience + cost ───────── depends on 6

Layer 3 — Board UI
  Demo 2: The board works ─────────── depends on 1
  Demo 3: Squad onboarding ────────── depends on 1
  Demo 11: Workflow editor ────────── depends on 6

Layer 4 — Workflow
  Demo 8: Routing tiers 2+3 ───────── depends on 5, 7
  Demo 9: Peer review ─────────────── depends on 6, 7
  Demo 10: Fan-out + handoff ──────── depends on 9

Layer 5 — Advanced
  Demo 12: Multi-user + Live ops ──── depends on 7, 10
  Demo 13: Dashboards ─────────────── depends on 12
  Demo 14: MCP + slash command ────── depends on 7, 6
  Demo 15: GitHub sync ────────────── depends on 12, 14

Sequencing: 1 → {2,3,4} → 5 → 6 → {7,11} → {8,9,14} → 10 → 12 → {13,15}
```

## Demos

---

### Demo 1 — Hello Squadboard

| Field | Value |
|-------|-------|
| **Goal** | `npx @sabbour/squadboard init` boots embedded Postgres and creates your first project |
| **Layer** | Foundation |
| **Depends on** | None |
| **Primary owner** | Hockney |
| **Secondary owners** | Kobayashi, Keyser |
| **Engine invariants touched** | None |
| **Postgres tables/schemas introduced** | `projects`, `settings`, initial migration scaffold |
| **Squad SDK surface** | `.squad/` discovery |

**Work items:**
- [ ] Scaffold Express v5 server + Vite React 19 SPA — Hockney
- [ ] Integrate `embedded-postgres` with startup/shutdown lifecycle — Hockney
- [ ] Drizzle ORM setup + initial migration (projects table) — Hockney
- [ ] `npx @sabbour/squadboard init` CLI entry point — Hockney
- [ ] `.squad/` directory discovery and project registration — Kobayashi
- [ ] Minimal shell UI: project picker, empty board placeholder — Keyser
- [ ] Validate embedded-postgres on arm64/linux/mac — Kujan
- [ ] Demo 1 script + quick-start in README — Redfoot

**Exit criteria:**
- `npx @sabbour/squadboard init` starts the server with embedded Postgres
- User can create/select a project linked to a `.squad/` directory
- Server starts in under 10 seconds on first run

**Known risks / open questions:**
- `embedded-postgres` binary size (~50MB) and platform coverage need early validation

---

### Demo 2 — The Board Works

| Field | Value |
|-------|-------|
| **Goal** | Real kanban board with drag-drop, comments, filters, and bulk-edit |
| **Layer** | Board UI |
| **Depends on** | Demo 1 |
| **Primary owner** | Keyser |
| **Secondary owners** | Fenster, Verbal |
| **Engine invariants touched** | None |
| **Postgres tables/schemas introduced** | `issues`, `comments`, `labels`, `issue_labels` |
| **Squad SDK surface** | None |

**Work items:**
- [ ] Issues CRUD API (create, read, update, delete, reorder) — Hockney
- [ ] Comments API (markdown + mermaid rendering) — Hockney
- [ ] Labels + filter API — Hockney
- [ ] Five-column kanban board with drag-and-drop — Keyser
- [ ] Card component, comment drawer, bulk-action toolbar — Keyser
- [ ] Visual design: card styles, column layout, dark mode — Fenster
- [ ] Empty state designs for new boards — Fenster
- [ ] Board integration tests — Kujan

**Exit criteria:**
- Cards can be created, dragged between columns, commented on, labeled, and filtered
- Bulk actions (move, label, archive) work on multi-select

**Known risks / open questions:**
- None

---

### Demo 3 — Squad Onboarding

| Field | Value |
|-------|-------|
| **Goal** | Discover agents from `.squad/agents/`, hire new ones, edit, and disable |
| **Layer** | Board UI |
| **Depends on** | Demo 1 |
| **Primary owner** | Kobayashi |
| **Secondary owners** | Keyser, Fenster |
| **Engine invariants touched** | None |
| **Postgres tables/schemas introduced** | `agents` (mirrors file-on-disk) |
| **Squad SDK surface** | `.squad/agents/` file discovery, CharterCompiler |

**Work items:**
- [ ] Agent discovery: scan `.squad/agents/` directory, parse charter files — Kobayashi
- [ ] Agent CRUD API: hire, edit, disable (file-on-disk as source of truth) — Kobayashi
- [ ] Agent list UI: cards with role, status, capabilities — Keyser
- [ ] Agent detail panel: edit charter, toggle active/disabled — Keyser
- [ ] Agent visual design: avatars, status indicators — Fenster
- [ ] Agent discovery integration tests — Kujan

**Exit criteria:**
- Agents from `.squad/agents/` appear in the UI automatically
- User can hire (create), edit, and disable agents through the UI
- File-on-disk remains source of truth (UI writes back to disk)

**Known risks / open questions:**
- None

---

### Demo 4 — One-Shot Agent

| Field | Value |
|-------|-------|
| **Goal** | Pick an agent, click Run, watch it work in an isolated workspace |
| **Layer** | Engine Core |
| **Depends on** | Demo 1, Demo 3 |
| **Primary owner** | Hockney |
| **Secondary owners** | Kobayashi, Keyser |
| **Engine invariants touched** | Invariant 1 (`agent_run` is the only step that does LLM work), Invariant 2 (single-spawner), Invariant 3 (lease + heartbeat) |
| **Postgres tables/schemas introduced** | `issue_runs`, `workflow_runs`, `step_runs`, workspace tracking |
| **Squad SDK surface** | `SquadClient.createSession()`, workspace isolation (scratch/dir/worktree) |

**Work items:**
- [ ] Implement `runWorker` subprocess spawning with workspace isolation — Hockney
- [ ] Lease (90s TTL) + heartbeat (30s) mechanism — Hockney
- [ ] Stepper: claim work via `FOR UPDATE SKIP LOCKED`, spawn single run — Hockney
- [ ] SDK bridge: call `SquadClient.createSession()` directly (bypass Coordinator) — Kobayashi
- [ ] Run status UI: progress indicator, output stream — Keyser
- [ ] Isolated workspace strategies (scratch/dir/worktree) — Hockney
- [ ] Lease + heartbeat correctness tests — Kujan
- [ ] Single-spawner discipline tests — Kujan

**Exit criteria:**
- User can select an agent, assign it a card, and click Run
- Agent executes in an isolated workspace with lease/heartbeat liveness
- Run completes and result is visible on the card

**Known risks / open questions:**
- First demo exercising the SquadCoordinator bypass — needs careful SDK integration testing

---

### Demo 5 — Routing Tier 1

| Field | Value |
|-------|-------|
| **Goal** | Auto-assign cards to agents via deterministic `.squad/routing.md` rules |
| **Layer** | Engine Core |
| **Depends on** | Demo 4 |
| **Primary owner** | Hockney |
| **Secondary owners** | Kobayashi |
| **Engine invariants touched** | Invariant 1 (routing desugars to `issue_runs` with distinct `kind`) |
| **Postgres tables/schemas introduced** | Routing rules cache/state |
| **Squad SDK surface** | `.squad/routing.md` parsing |

**Work items:**
- [ ] Routing tier 1 engine: parse `.squad/routing.md`, match rules deterministically — Hockney
- [ ] Route resolution → `issue_runs` row creation with correct `kind` — Hockney
- [ ] Routing.md parser/compiler — Kobayashi
- [ ] Auto-assignment UI indicator on cards — Keyser
- [ ] Routing rule match tests — Kujan

**Exit criteria:**
- Cards are auto-assigned to agents based on `.squad/routing.md` rules
- Tier 1 routing is deterministic and auditable

**Known risks / open questions:**
- PRD states hot-reload of routing.md is restart-only in v1 (non-goal)

---

### Demo 6 — First Workflow

| Field | Value |
|-------|-------|
| **Goal** | YAML workflows with the bundled `simple` template (route → run → approve) |
| **Layer** | Engine Core |
| **Depends on** | Demo 5 |
| **Primary owner** | Hockney |
| **Secondary owners** | Kobayashi, Redfoot |
| **Engine invariants touched** | Invariant 1, Invariant 2, Invariant 4 (output schema validation at session end) |
| **Postgres tables/schemas introduced** | `workflows`, `workflow_versions`, step catalogue rows |
| **Squad SDK surface** | HookPipeline (output validation hook) |

**Work items:**
- [ ] YAML workflow parser + JSON Schema validation — Hockney
- [ ] Step catalogue: `route`, `agent_run`, `approve` step types — Hockney
- [ ] Workflow versioning: immutable versions, `pinnedAgentRevisions` — Hockney
- [ ] Output schema validation at session end (Invariant 4) — Hockney
- [ ] HookPipeline integration for output validation — Kobayashi
- [ ] Bundled `simple` workflow template — Redfoot
- [ ] Workflow execution integration tests — Kujan
- [ ] Workflow YAML authoring guide — Redfoot

**Exit criteria:**
- User can attach the `simple` workflow template to a card
- Workflow executes: route → agent_run → approve (manual approval gate)
- Output schema validation fires at session end per Invariant 4

**Known risks / open questions:**
- Open question #1: When to snapshot `pinnedAgentRevisions` — at workflow start or per step? (Recommended: per step at step start. Must decide by Demo 6.)

---

### Demo 7 — Resilience + Cost

| Field | Value |
|-------|-------|
| **Goal** | Survive engine crashes with no data loss; show live per-run cost |
| **Layer** | Engine Core |
| **Depends on** | Demo 6 |
| **Primary owner** | Hockney |
| **Secondary owners** | Kobayashi, Kujan |
| **Engine invariants touched** | Invariant 2 (single-spawner), Invariant 3 (lease + heartbeat), all invariants under crash scenarios |
| **Postgres tables/schemas introduced** | Sweeper state, cost tracking columns on `issue_runs` |
| **Squad SDK surface** | CostTracker integration |

**Work items:**
- [ ] Sweeper implementation: detect expired leases, reclaim orphaned runs — Hockney
- [ ] Declarative retry policy (per step type) — Hockney
- [ ] Dispatcher tick loop: sweep → wake → advance (5s cadence) — Hockney
- [ ] CostTracker SDK integration: per-run cost accumulation — Kobayashi
- [ ] Cost display in UI (per-run, per-agent) — Keyser
- [ ] Crash recovery test suite: kill process mid-run, verify recovery — Kujan
- [ ] Zero-data-loss invariant tests (no orphaned `issue_runs`) — Kujan

**Exit criteria:**
- Engine crash mid-run → restart → run resumes from last checkpoint with no data loss
- Per-run cost is tracked and displayed in the UI
- No orphaned `issue_runs` after any crash scenario

**Known risks / open questions:**
- Single-process limit: high concurrency may hit Node event-loop ceiling (monitor here, defer to v2)

---

### Demo 8 — Routing Tiers 2+3

| Field | Value |
|-------|-------|
| **Goal** | matchRoute fallback + LLM specifier agent + human triage for unroutable cards |
| **Layer** | Workflow |
| **Depends on** | Demo 5, Demo 7 |
| **Primary owner** | Hockney |
| **Secondary owners** | Kobayashi |
| **Engine invariants touched** | Invariant 1 (tier-3 routing desugars to `issue_runs` with `kind: 'route'`) |
| **Postgres tables/schemas introduced** | Triage queue, routing audit log |
| **Squad SDK surface** | SquadClient for LLM specifier agent session |

**Work items:**
- [ ] Tier 2: `matchRoute` programmatic fallback — Hockney
- [ ] Tier 3: LLM specifier agent (spawns as `issue_runs` with `kind: 'route'`) — Hockney
- [ ] Human triage queue for unroutable cards — Hockney
- [ ] Specifier agent SDK session wiring — Kobayashi
- [ ] Triage UI: unroutable cards queue with manual assign — Keyser
- [ ] Routing tier escalation tests — Kujan

**Exit criteria:**
- Tier 1 miss → Tier 2 (`matchRoute`) fallback → Tier 3 (LLM specifier) → human triage
- Each tier transition is logged and auditable

**Known risks / open questions:**
- Open question #3: Hot-reload of routing.md? (Answer: restart-only for v1)

---

### Demo 9 — Peer Review

| Field | Value |
|-------|-------|
| **Goal** | N-of-M quorum approvals, 4-verb cycle, threaded audit trail, reviewer lockout |
| **Layer** | Workflow |
| **Depends on** | Demo 6, Demo 7 |
| **Primary owner** | Hockney |
| **Secondary owners** | Keyser, Kobayashi |
| **Engine invariants touched** | Invariant 1 (`peer_review` desugars to `issue_runs` with distinct `kind`) |
| **Postgres tables/schemas introduced** | `peer_reviews`, `review_verdicts`, `review_threads` |
| **Squad SDK surface** | HookPipeline (review hooks) |

**Work items:**
- [ ] Peer review step type: N-of-M quorum logic — Hockney
- [ ] 4-verb approval cycle (approve, request_changes, comment, dismiss) — Hockney
- [ ] Reviewer lockout (can't review own work) — Hockney
- [ ] Threaded audit trail storage — Hockney
- [ ] Review UI: verdict panel, thread view, quorum progress — Keyser
- [ ] HookPipeline review hooks — Kobayashi
- [ ] Quorum edge-case tests — Kujan

**Exit criteria:**
- Peer review step blocks workflow until N-of-M reviewers approve
- 4-verb cycle works with threaded audit trail
- Reviewer lockout prevents self-review

**Known risks / open questions:**
- Open question #2: Default `request_changes_policy`? (Recommended: `first`, matching GitHub PR semantics. Must decide by Demo 9.)

---

### Demo 10 — Fan-Out + Handoff

| Field | Value |
|-------|-------|
| **Goal** | Subtask splitting with isolated worktrees, subtree pause/resume, progress pills |
| **Layer** | Workflow |
| **Depends on** | Demo 9 |
| **Primary owner** | Hockney |
| **Secondary owners** | Kobayashi, Keyser, Verbal |
| **Engine invariants touched** | Invariant 5 (atomic child materialization in six-step transaction) |
| **Postgres tables/schemas introduced** | `issue_links`, `handoff_context`, variables propagation columns |
| **Squad SDK surface** | `pinnedAgentRevisions` inheritance |

**Work items:**
- [ ] `fan_out`/`split` step: six-step atomic transaction (Invariant 5) — Hockney
- [ ] Child workflow_run materialization with full row set — Hockney
- [ ] `pinnedAgentRevisions` inheritance from parent — Hockney
- [ ] Subtree pause/resume mechanics — Hockney
- [ ] Handoff context propagation — Kobayashi
- [ ] Progress pills UI (parent shows child progress) — Keyser
- [ ] Subtree real-time status updates — Verbal
- [ ] Six-step transaction atomicity tests — Kujan
- [ ] Orphan detection after crash during fan-out — Kujan

**Exit criteria:**
- `fan_out` materializes child workflows atomically (all-or-nothing)
- Children inherit `pinnedAgentRevisions` from parent
- Subtree can be paused/resumed; parent shows progress pills

**Known risks / open questions:**
- Most complex single transaction in the system — needs careful testing under concurrent load

---

### Demo 11 — Workflow Editor

| Field | Value |
|-------|-------|
| **Goal** | Monaco YAML editor + React Flow graph viz + templates gallery + versioning |
| **Layer** | Board UI |
| **Depends on** | Demo 6 |
| **Primary owner** | Keyser |
| **Secondary owners** | Fenster, Redfoot |
| **Engine invariants touched** | None (editor is UI-only; engine validates on save) |
| **Postgres tables/schemas introduced** | None new (uses `workflows`, `workflow_versions`) |
| **Squad SDK surface** | None |

**Work items:**
- [ ] Monaco YAML editor integration with JSON Schema validation — Keyser
- [ ] React Flow graph visualization of workflow steps — Keyser
- [ ] Templates gallery UI — Keyser
- [ ] Workflow versioning UI (version list, diff view) — Keyser
- [ ] Editor visual design, dark mode — Fenster
- [ ] Bundled workflow templates (3-5 common patterns) — Redfoot
- [ ] Editor usability tests — Kujan

**Exit criteria:**
- User can author/edit workflows in Monaco with live YAML validation
- Graph visualization shows step DAG in real-time as YAML changes
- Templates gallery offers pre-built workflow patterns

**Known risks / open questions:**
- PRD risk: "Users author broken workflows that are hard to debug" — JSON Schema validation + graph viz mitigate

---

### Demo 12 — Multi-User + Live Ops

| Field | Value |
|-------|-------|
| **Goal** | GitHub OAuth, WebSocket fan-out, Live ops view, inbox |
| **Layer** | Advanced |
| **Depends on** | Demo 7, Demo 10 |
| **Primary owner** | Verbal |
| **Secondary owners** | Hockney, Keyser |
| **Engine invariants touched** | None directly (ops view reads state, doesn't mutate) |
| **Postgres tables/schemas introduced** | `users`, `sessions`, `event_log` (WebSocket cursor source) |
| **Squad SDK surface** | EventBus integration for real-time events |

**Work items:**
- [ ] GitHub OAuth integration (login, user sessions) — Hockney
- [ ] WebSocket server: project-scoped, `since-id` reconnect cursor — Verbal
- [ ] EventEmitter fan-out from engine events to WS clients — Verbal
- [ ] Live ops view: header summary strip, active-runs grid, activity feed — Verbal
- [ ] Inbox: per-user notification stream — Verbal
- [ ] Multi-user presence indicators — Keyser
- [ ] WebSocket reconnection + cursor tests — Kujan

**Exit criteria:**
- Multiple users can log in via GitHub OAuth
- Board updates in real-time via WebSocket (no polling)
- Live ops view shows active runs, summary strip, and durable activity feed

**Known risks / open questions:**
- Open question #6: Concurrent edit resolution? (Recommended: optimistic concurrency token + reject + reload. Must decide by Demo 12.)

---

### Demo 13 — Dashboards

| Field | Value |
|-------|-------|
| **Goal** | Agent leaderboard, cost burn, workflow funnel, burndown — all from existing tables |
| **Layer** | Advanced |
| **Depends on** | Demo 12 |
| **Primary owner** | Keyser |
| **Secondary owners** | Fenster, Hockney |
| **Engine invariants touched** | None |
| **Postgres tables/schemas introduced** | None new (dashboard queries read existing tables) |
| **Squad SDK surface** | None |

**Work items:**
- [ ] Dashboard query API: leaderboard, cost burn, funnel, burndown — Hockney
- [ ] Chart components (leaderboard, cost burn chart, funnel, burndown) — Keyser
- [ ] Dashboard layout and responsive design — Fenster
- [ ] Query performance optimization (target: <2s on 10k issues) — Hockney
- [ ] Dashboard render performance tests — Kujan

**Exit criteria:**
- All four dashboard charts render from existing table data
- Charts render in < 2s on a project with 10k issues
- Dashboard is accessible from main navigation

**Known risks / open questions:**
- None

---

### Demo 14 — MCP + Slash Command

| Field | Value |
|-------|-------|
| **Goal** | `engine_*` MCP tools for agents, idempotent creates, `/squadboard` CLI command |
| **Layer** | Advanced |
| **Depends on** | Demo 7, Demo 6 |
| **Primary owner** | Kobayashi |
| **Secondary owners** | Hockney, Redfoot |
| **Engine invariants touched** | All (MCP tools exercise the full engine surface) |
| **Postgres tables/schemas introduced** | None new (MCP is an interface layer) |
| **Squad SDK surface** | MCP server binding, `engine_*` tool definitions |

**Work items:**
- [ ] MCP server: same process, localhost TCP binding — Hockney
- [ ] `engine_*` tool definitions (create_issue, start_workflow, get_status, etc.) — Kobayashi
- [ ] Idempotency: all create operations safe under 10× replay — Kobayashi
- [ ] `/squadboard` CLI command entry point — Kobayashi
- [ ] MCP tool documentation — Redfoot
- [ ] Idempotency replay tests (10× create same entity) — Kujan

**Exit criteria:**
- Agents can call `engine_*` MCP tools to create issues, start workflows, query status
- All create operations are demonstrably idempotent under 10× replay
- `/squadboard` CLI command works for common operations

**Known risks / open questions:**
- Open question #7: Engine MCP server binding? (Recommended: same process, localhost TCP. Must decide by Demo 14.)

---

### Demo 15 — GitHub Sync

| Field | Value |
|-------|-------|
| **Goal** | Push branches, open PRs, post check runs, ingest Issues via webhook |
| **Layer** | Advanced |
| **Depends on** | Demo 12, Demo 14 |
| **Primary owner** | Hockney |
| **Secondary owners** | Kobayashi, Verbal |
| **Engine invariants touched** | None directly (GitHub adapter is a side-effect layer) |
| **Postgres tables/schemas introduced** | `github_sync_state`, webhook event queue |
| **Squad SDK surface** | None |

**Work items:**
- [ ] GitHub adapter: push branches, open PRs, post check runs — Hockney
- [ ] Webhook receiver: ingest GitHub Issues into Squadboard — Hockney
- [ ] Rate limit handling: respect headers, queue pushes, exponential backoff — Hockney
- [ ] Webhook event real-time propagation — Verbal
- [ ] GitHub sync configuration UI — Keyser
- [ ] GitHub API integration tests (mock) — Kujan
- [ ] GitHub sync setup guide — Redfoot

**Exit criteria:**
- Squadboard can push branches and open PRs on GitHub
- Check runs are posted for workflow completions
- GitHub Issues can be ingested via webhook into the board

**Known risks / open questions:**
- Open question #8: Mirror Squadboard issues to GitHub Issues by default? (Recommended: off by default, opt-in per project. Must decide by Demo 15.)
- GitHub API rate limits under high webhook volume

---
