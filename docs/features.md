# Squadboard Features

## Workflow Engine

Deterministic, durable orchestration with recovery guarantees.

- **Durable workflow runs** — Row-locked stepper, lease + heartbeat liveness (90s TTL, 30s heartbeat). Crashes don't lose progress.
- **Single-spawner discipline** — Only the stepper spawns runs; dispatcher only ticks, sweeps, wakes. No race conditions.
- **Retry policy** — Configurable max attempts, exponential backoff. Wrapped steps survive transient failures.
- **Fan-out & branch** — Atomic child workflow materialization in one transaction. Pause/resume whole trees.
- **Wait primitives** — `wait_event` (webhook), `wait_timer` (sleep), `wait_merged` (GitHub PR merge).
- **Peer review & human approve** — N-of-M quorum gates. 4-verb cycle (open, review, resolve, verify) with threaded audit trail.
- **Output validation** — Schema check at session end, before final recording.
- **Five engine invariants** — Ensures crash safety, determinism, and auditability (see [Architecture](../prd.md#7-architecture)).

---

## Coordinator Parity

Durable server-owned equivalents for the Copilot CLI + [Squad](https://github.com/bradygaster/squad) driver loop.

- **Coordinator input parity** — Labels, parent links, priority, project rules, agent capabilities, recent run state, and routing rules feed one shared coordinator input builder.
- **Deterministic preflight/post-processing** — Named-agent routing, blocked parents, busy-agent ambiguity, backlog gating, thin issues, Ahmed-only operations, circuit-breaker skips, and confidence floors run outside the LLM and write visible routing decisions.
- **Spawn prompt fidelity** — Agent runs receive charter, team root, requester, current time, workspace path/mode, history and decisions read instructions, assigned skill addenda, MCP context, drop-box guidance, and validation expectations.
- **Directive memory loop** — Directives can be captured into `.squad/decisions/inbox/` with idempotency and fail-open MCP auditing.
- **Scribe close-out** — Daemon, coordinator, and ceremony lifecycle paths converge on the Scribe close-out service and expose close-out result metadata.
- **Opt-in Ralph monitor** — Disabled by default; when enabled, prioritizes untriaged squad issues, member-label pickup, assigned work, CI failures, review feedback, approved PRs, and drafts with audit output.

Known limit: Ralph's non-pickup GitHub actions are audited/planned rather than live auto-merged.

---

## Project Bundles

Ship a complete project (board + ceremonies + team + skills + tools + MCP) as a single artifact.

- **Universal bundle schema** — YAML + JSON, versioned. Portable across machines and teams.
- **6 built-in templates** — Reference bundles for common workloads (simple kanban, RFC review, incident ops, pair programming, research spike, bug triage).
- **Bundle CLI** — Import/export via `squadboard bundle import <path>` and `squadboard bundle export`.
- **Atomic load** — One command to populate project, ceremonies, team, skills, tools, MCP server config.

---

## Ceremonies

Named triggered processes with 5 curated built-in templates.

- **Built-in ceremonies** — Simple Review, Bug Fix, RFC, Spike, Pair-Programming Session. Each includes trigger type, workflow steps, and example use case.
- **Custom YAML** — Author `.squad/ceremonies/*.ceremony.yaml` for domain-specific flows. Trigger types: manual, scheduled (cron), GitHub event (label, PR, issue).
- **Workflow versioning** — Publish new workflow versions; ceremonies lock to a version. Swap workflows by updating ceremony reference.
- **Template curation** — Reduced from 9 to 5 templates; removed overlaps (feature, refactor, ops_incident, design_review, documentation_update, security_patch moved to community pool).

---

## GitHub Integration

Bi-directional sync and work monitoring with GitHub repositories.

**Phase 1 (W16 — shipped):**
- **Branch convention** — Automatically name and push feature branches from the board: `fix/{issueId}`, `feature/{issueId}`.
- **PR template** — Inject Squadboard issue context into PR description (links, checklist, agent who opened it).
- **Push branch** — `github_pr` step; automatically commit + push from workflow.
- **Create PR** — Open PR from pushed branch; block subsequent steps until merge.
- **Card badges** — Show PR status (open, draft, merged) on kanban card.

- **Comment on PR** — `github_comment` step.
- **Merge PR** — `github_pr_merge` step with merge strategy (squash, rebase, merge commit).
- **Settings panel** — UI/API for GitHub sync config (PAT or GitHub App, repo, branch strategy).
- **Ralph monitor decisions** — Opt-in audit of CI failures, review feedback, approved PRs, and draft PRs.

---

## Reliability

Backup, restore, and crash recovery.

- **Periodic backup** — On-disk snapshot of all runs, workflows, agents, settings.
- **Restore CLI** — `squadboard restore <backup.tar>` to load entire project state.
- **Restore UI** — Browser-based restore wizard for selecting backup date + preview.
- **6-invariant safety** — Schema + data validation during restore; orphaned refs cleaned.
- **PGlite + verified migration** — Embedded Postgres replaced with PGlite (no native binaries). Migration verified on startup.

---

## Real-time UI

Live visibility into running agents and workflow steps.

- **Live run drawer** — See agent output in real-time as steps execute. WebSocket push from engine to browser.
- **Activity feed** — Chronological log of run events (step started, agent output, approval gate opened, retry, complete).
- **Optimistic UI** — Card status updated instantly on board; synced from server when confirmed.
- **WS event fan-out** — Project-scoped subscriptions; server broadcasts state changes to all connected browsers in that project.
- **Reconnect cursor** — Resume WebSocket session after network drop; client resumes from last known server event ID.

---

## SDK + MCP

Programmatic access for agents and external tools.

**SDK** (`@sabbour/squadboard-sdk`):
- `SquadClient` — HTTP client with auth (run-scoped JWT or service account).
- `CharterCompiler` — Parse `.squad/` directory structure and agent charters.
- `CostTracker` — Calculate run cost in USD or GitHub Copilot multiplier equivalents.
- `EventBus` — Subscribe to workflow events (step started, completed, failed).
- `scribe.closeOut()` — Daemon helper to mark ceremony complete, generate summary, and optionally commit.

**MCP Server** (stdio + HTTP transports):
- 10 tools: `list_issues`, `create_issue`, `update_issue`, `run_agent`, `get_run_status`, `list_agents`, `slash_command`, `list_projects`, `list_inbox`, `capture`, `get_routing`.
- Project-scoped tools accept `projectId` from args or `x-project-id` HTTP header.
- Stdio transport for Copilot CLI + VS Code. HTTP transport for in-process embedding.

**Daemon mode** — `squadboard mcp --daemon` runs as background service for the coordinator.

---

## Conjure (Quick-Capture Inbox)

Freeform prompt router with intent classification.

- **Capture tool** — `/squadboard capture "Fix the login bug"` → routes through Conjure classifier.
- **Intent detection** — Classifies prompt as: project | issue | team | agent | skill | tool.
- **Draft or create** — For issue intents, creates board card immediately. For other intents, returns draft + routing hint for user confirmation.
- **Done prefix** — `capture "done: Fixed login bug (sha=abc123)"` → closes matching card by fuzzy title match.
- **Dogfood loop** — Copilot CLI directives can be captured to the Squadboard inbox. Coordinator fragments detect implementation directives and call `capture` on directive end.
- **Directive inbox** — Capture can also write idempotent decision-memory files to `.squad/decisions/inbox/`.

---

## Project Templates & Settings

Customize board structure, fields, and automation.

- **Column templates** — Custom statuses beyond default (backlog, todo, in_progress, in_review, done).
- **Custom fields** — Add project-level metadata (priority, estimate, owner, component, target release).
- **Team management** — Add agents, assign capabilities, enable/disable per-project.
- **Agent origins** — Distinguish project, virtual Copilot, and human members in API/UI metadata.
- **Skill registry** — Declare reusable skills (`code-review`, `architecture-audit`) that agents can run.
- **Tool registry** — Bind MCP tools or shell scripts to projects.
- **GitHub settings panel** — Configure auth (PAT or GitHub App), repo, and branch strategy.

---

## Database & Persistence

- **Embedded Postgres** — Auto-managed locally at `~/.squadboard/data`. No external DB setup needed.
- **PGlite** — Pure JavaScript Postgres replacement; ships pre-built binaries for all platforms (linux, darwin, windows; x64, arm64).
- **Drizzle ORM** — Schema as TypeScript; migrations versioned in `.squad/migrations/`.
- **Backup/restore** — Full DB snapshot in `.squad/backups/` or user-specified path.

---

## CLI

- **`squadboard init`** — Start server, open browser on localhost:5173.
- **`squadboard mcp`** — Start MCP stdio server (for Copilot CLI, VS Code).
- **`squadboard mcp --daemon`** — Background daemon for coordinator.
- **`squadboard bundle import <path>`** — Load project bundle.
- **`squadboard bundle export`** — Save project as template.
- **`squadboard restore <backup.tar>`** — Restore from backup.
- **`squadboard db:studio`** — Open Drizzle Studio (dev only).

---

## Remaining Gaps

Items still intentionally outside the current first-slice parity claim:
- Workflow Editor UI (visual step builder; roadmap Demo 11)
- Advanced fan-out patterns (conditional parallelism, dynamic child count)
- Webhook listener (for external `wait_event` callbacks)
- Cost-tracking dashboard (trending, per-agent cost, forecasting)
- Agent leaderboard (runs completed, avg cost, success rate)
- Burndown charts (sprint velocity)
- Custom merge strategies for PRs (squash-and-sign, fast-forward)
- Live Ralph auto-merge/remediation for non-pickup GitHub actions
- Scheduled backup to cloud storage (S3, Azure Blob)
- RBAC for multi-tenant setups (read-only, edit, admin roles)
- Audit log exports (CSV, JSON)

See [Roadmap](../prd.md#roadmap) for the full 15-demo vertical slice plan.
