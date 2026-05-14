# Squadboard — Product Requirements Document

> A local-first kanban + workflow board that orchestrates Squad agents with durable, deterministic, crash-recoverable workflows.

---

## 1. Vision

Running multiple Squad agents today means tracking work in heads, Notion, or GitHub Issues and keeping them manually in sync. Handoffs are text-matched and sometimes missed. Parallel fan-outs silently drop children. Engine crashes lose in-flight state. Cost is a monthly surprise.

Squadboard gives you a board for visibility, a workflow engine for determinism, and a Live ops view for real-time awareness — local-first by default, GitHub at the seams when you ship.

---

## 2. Target users

| Persona | Need |
|---------|------|
| **Solo developers** (1–3 agents) | A board instead of terminal logs; reliable single-agent runs with retry |
| **Small teams** (shared `.squad/`) | Workflow gates (peer review, approval, fan-out) without reinventing them in prompts |
| **Agent builders** | Workflows as first-class versioned artifacts — auditable, demonstrable, composable |

If you have one agent and one task at a time, `squad chat` is the right tool. The moment you have N agents, M tasks, K handoffs — that's Squadboard.

---

## 3. Scope — what's in v1

| # | Capability | Key detail |
|---|-----------|------------|
| 1 | Project onboarding | `npx @sabbour/squadboard init` — embedded Postgres, `.squad/` discovery, multi-project |
| 2 | Kanban board | Five columns, drag-drop, comments (markdown + mermaid), labels, filters, bulk actions |
| 3 | Agent management | Discover from `.squad/agents/`, hire, edit, disable — file-on-disk as source of truth |
| 4 | Isolated workspaces | Scratch / dir / worktree per run; parallel agents never collide |
| 5 | Deterministic workflows | YAML-defined steps, versioned, composable; engine is sole spawner |
| 6 | Routing pipeline | Tier 1 (rules) → Tier 2 (matchRoute) → Tier 3 (specifier agent) → human triage |
| 7 | Crash recovery | Lease + heartbeat, sweepers, declarative retry, no in-flight state loss |
| 8 | Peer review + approvals | N-of-M quorum, 4-verb cycle, threaded audit trail, reviewer lockout |
| 9 | Fan-out + subtrees | Atomic child materialization, subtree pause/resume, progress pills |
| 10 | Live ops view | Header summary strip, active-runs grid, durable activity feed — real-time via WebSocket |
| 11 | Dashboards | Agent leaderboard, cost burn, workflow funnel, burndown — all from existing tables |
| 12 | GitHub sync | Push branches, open PRs, post check runs, ingest Issues via webhook |
| 13 | MCP + slash command | `engine_*` tools for agents; idempotent creates; `/squadboard` CLI command |

---

## 4. Non-goals

| Not building | Why |
|---|---|
| Multi-runtime adapter SDK | Squad-only by design — deeper integration, lower surface |
| Org chart / reports_to for agents | Code teams are flat; a role field per agent suffices |
| Goals layer above issues | Workflow templates + labels cover the practical need |
| Multi-tenant SaaS | One user/team per install in v1 |
| Agent marketplace | Workflows + agents are local files; no sharing surface |
| Slack / Teams notifications | Deferred post-v1; @-mentions + dashboard cover the need |
| DSPy / self-improvement loop | Needs feedback data Squad doesn't yet collect |
| Hot-reload of routing.md | Restart-only in v1; changes are rare |
| Cloud deploy prescription | Local-first; cloud is "when we want it," not v1 |
| Standalone dispatcher daemon | Single-process is simpler at code-team scale |
| Cross-repo workflows | One repo per project in v1 |

---

## 5. Five non-negotiable engine invariants

These are binding contracts. No PR may violate them without an explicit override decision in `.squad/decisions.md`.

1. **`agent_run` is the only step that does LLM work.** `peer_review`, tier-3 routing, and `split` desugar to `issue_runs` rows with distinct `kind` values.
2. **Single-spawner discipline.** The stepper alone spawns runs via `FOR UPDATE SKIP LOCKED`. The dispatcher only ticks/sweeps/wakes — never touches `issue_runs` except via sweepers.
3. **Lease (90s TTL) + heartbeat (30s) is the authoritative liveness signal.** `kill(pid, 0)` is an in-pod sanity check only.
4. **Output schema validation happens at session end** — after `sendAndWait` returns, before `recordRunCompletion`. Never on the post-tool-use hook.
5. **`fan_out` and `split` materialize full child `workflow_runs` rows in one six-step transaction** (issue + workflow_run + first step_run + issue_link + handoff_context + variables propagation). Children inherit `pinnedAgentRevisions` from parent.

**Enforcement:** Kujan has reject authority. Hockney owns implementation. McManus adjudicates proposed changes.

---

## 6. Roadmap — 15 demoable thin slices

Squadboard ships vertical slices, not horizontal phases. Every demo is installable, clickable, and adds one user-observable capability. After every demo the product is releasable. Full demo specs: [deep design §7](../research/squad-web-design-v4.md#7-roadmap--15-demoable-deliverables).

| # | Demo | One-line goal |
|---|------|--------------|
| 1 | Hello Squadboard | `npx @sabbour/squadboard init` boots; create your first project |
| 2 | The board works | Real kanban — drag, comment, filter, bulk-edit |
| 3 | Squad onboarding | Discover agents from `.squad/`, hire new ones, edit, disable |
| 4 | One-shot agent | Pick an agent, click Run, watch it work in an isolated workspace |
| 5 | Routing tier 1 | Auto-assign cards via deterministic `.squad/routing.md` rules |
| 6 | First workflow | YAML workflows with the bundled `simple` template (route → run → approve) |
| 7 | Resilience + cost | Survive engine crashes; show live per-run cost |
| 8 | Routing tiers 2+3 | matchRoute fallback + LLM specifier + human triage |
| 9 | Peer review | N-of-M quorum, 4-verb approvals, threaded audit trail |
| 10 | Fan-out + handoff | Subtask splitting, isolated worktrees, subtree pause/resume |
| 11 | Workflow editor | Monaco YAML + React Flow viz + templates gallery + versioning |
| 12 | Multi-user + Live ops | GitHub OAuth, WebSocket fan-out, Live ops view, inbox |
| 13 | Dashboards | Agent leaderboard, cost burn, funnel, burndown — all from existing tables |
| 14 | MCP + slash command | `engine_*` tools, idempotent creates, `/squadboard` CLI |
| 15 | GitHub sync | Push PRs, post check runs, ingest Issues via webhook |

---

## 7. Architecture at a glance

Single Node.js process running Express v5. The browser (React 19 SPA) talks HTTP + WebSocket to the engine. The engine owns Postgres (embedded locally, hosted in cloud). Agent runs execute as `runWorker` subprocesses — each owns its workspace, writes heartbeats directly to the DB, and emits final output via MCP. The dispatcher ticks every ~5s (sweep, wake, advance); the stepper claims work via `FOR UPDATE SKIP LOCKED` and is the sole spawner. [Full topology](../research/squad-web-design-v4.md#61-topology-in-one-picture) in the deep design.

**Key architectural decision:** We bypass `SquadCoordinator` and call `SquadClient.createSession()` directly. The Coordinator's parallel fan-out and ad-hoc handoffs are what Squadboard exists to replace with deterministic, durable orchestration. [See decisions.md](../.squad/decisions.md).

---

## 8. Tech stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js + Express v5 |
| Database | **Postgres** — embedded (`embedded-postgres` ~50MB) locally, hosted in cloud. Same Drizzle schema everywhere. SQLite was considered and rejected. [See decisions.md](../.squad/decisions.md). |
| ORM | Drizzle ORM |
| Frontend | React 19 + Vite (SPA) |
| Real-time | WebSocket (project-scoped, `since-id` reconnect cursor) |
| Agent runtime | Squad SDK (`SquadClient`, `CharterCompiler`, `HookPipeline`, `CostTracker`, `EventBus`) |
| VCS / CI seam | GitHub API (contents, PRs, checks, issues, webhooks) |
| Package | `@sabbour/squadboard` · `npx @sabbour/squadboard init` · MIT |

---

## 9. Team & ownership

| Agent | Role | Owns |
|-------|------|------|
| **McManus** | Lead Architect | Architecture, decisions, cross-cutting PR review |
| **Hockney** | Backend / Workflow Engine Dev | Engine internals, dispatcher/stepper/spawner, Postgres, sweepers, GitHub adapter |
| **Kobayashi** | Squad SDK Integrator | SDK bridge, CharterCompiler/HookPipeline/CostTracker wiring, MCP tools |
| **Keyser** | Frontend Dev | React UI, kanban board, components, drawers, layout |
| **Verbal** | Real-time / WebSocket Dev | WS server, `since-id` cursor, EventEmitter fan-out, Live ops view feed |
| **Fenster** | UX Designer | Visual design, UX flows, color/type/icon system, empty states |
| **Kujan** | Tester / QA | Tests, durability contracts, recovery, regression suites (reject authority) |
| **Redfoot** | DevRel / Docs | README, guides, demo scripts, workflow cookbook (reject authority on copy) |

Support roles: **Ralph** (Work Monitor), **Scribe** (Session Logger — silent/background).

---

## 10. Success criteria

| Criterion | Measure |
|-----------|---------|
| All 15 demos shipped | Each demo's exit criterion met per deep design §7 |
| Install-to-first-card | Under 5 minutes from `npx @sabbour/squadboard init` to a card running an agent |
| Zero data loss | No orphaned `issue_runs` or lost workflow state across engine restart |
| Dashboard query performance | All charts render in < 2s on a project with 10k issues |
| Idempotency | All `engine_*` create operations demonstrably safe under 10× replay |

---

## 11. Dependencies & risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Squad SDK shape changes | Breaking changes to `SquadClient`, `EventBus`, or `CharterCompiler` force engine rewrites | Pin SDK version; Kobayashi owns the seam; adapter layer isolates |
| `embedded-postgres` viability | Binary size (~50MB), platform coverage (arm64/linux/mac/windows), startup time | Validate early in Demo 1; fallback = hosted Postgres with connection string |
| GitHub API rate limits | Webhook ingestion + PR creation at scale | Respect rate headers; queue pushes; exponential backoff |
| Single-process limits | High concurrency (many parallel runs) may hit Node event-loop or memory ceiling | Monitor in Demo 7+; v2 can split dispatcher if needed |
| Workflow YAML complexity | Users author broken workflows that are hard to debug | JSON Schema validation, graph viz, templates gallery, startup validation |
| Agent prompt drift | Agents emit unexpected output shapes, breaking downstream steps | Standardized metadata convention + output schema validation at session end |

---

## 12. Open questions

These are pending product decisions. None blocks Demo 1. Each needs a team decision before the relevant demo ships.

| # | Question | Recommended default | Decide by |
|---|----------|-------------------|-----------|
| 1 | When to snapshot `pinnedAgentRevisions` — at workflow start or per step? | Per step at step start | Demo 6 |
| 2 | Default `request_changes_policy` on peer_review? | `first` (matches GitHub PR semantics) | Demo 9 |
| 3 | Hot-reload of routing.md? | Restart-only for v1 | Demo 8 |
| 4 | Silent-run watchdog aggressiveness? | None in v1 — lease+heartbeat covers process death | Post-Demo 15 |
| 5 | Approval auto-expire? | Never in v1; approvals wait until acted on | Post-Demo 15 |
| 6 | Concurrent edit resolution? | Optimistic concurrency token + reject + reload | Demo 12 |
| 7 | Engine MCP server binding? | Same process, localhost TCP | Demo 14 |
| 8 | Mirror Squadboard issues to GitHub Issues by default? | Off by default, opt-in per project | Demo 15 |

Full context for each: [deep design §8](../research/squad-web-design-v4.md#8-open-questions).

---

## 13. Deep design reference

Every detail of how Squadboard works — schema, step catalogue, SDK wiring, workspace strategies, memory layers, reliability discipline, GitHub adapter, metrics pipeline, user journeys, and the full feature catalogue — lives in the deep design document:

**→ [`squad-web-design-v4.md`](../research/squad-web-design-v4.md)**

This PRD is the executive view. The deep design is the implementation spec.
