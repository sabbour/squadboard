# Changelog

All notable changes to Squadboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **PostgreSQL-backed Squad StorageProvider adapter (default):** Squadboard now stores Squad state (agents, decisions, skills, ceremonies) in the same PostgreSQL database as product state by default, using local PGlite unless `DATABASE_URL` points to standalone PostgreSQL. Existing `.squad/` files import once into an empty DB-backed project; use `pnpm run dev:fs`, `squadboard init --squad-storage fs`, or `SQUADBOARD_SQUAD_STORAGE_PROVIDER=fs` for filesystem fallback. `squadboard init --write-mcp-config` writes a Copilot CLI MCP config so Copilot plus `squad.agent.md` use Squadboard as the shared-state broker. External Squad CLI direct database access still requires compatible upstream StorageProvider configuration; otherwise use the MCP bridge.
- **Cross-surface sync E2E coverage:** Playwright now launches both Squadboard backend and client for browser E2E, covers Team Sync status/repair flows, exercises an isolated filesystem-authoritative CLI-first server path, and includes deterministic plus opt-in live Copilot CLI ask-Squad coverage for generated agent projections.
- **Cross-surface Squad sync architecture & SDK contract:** Squadboard and CLI/Copilot are now designed as interchangeable peer clients over one authoritative Squad state source. The SDK contract (`packages/server/src/sdk/sync-ownership.ts`) defines storage modes (`postgresql` | `filesystem`), bootstrap semantics, artifact projection specs, and repair actions. Backend sync endpoints (`/api/projects/:projectId/squad-sync/*`) and the Settings -> Team Sync panel expose status and explicit repair actions so users can start projects in either Squadboard or CLI/Copilot and continue in the other without data loss.
- **Ceremony defaults as required invariant:** `.squad/ceremonies.md` must exist and contain seeded defaults (Simple Review, Bug Fix, RFC, Spike, Pair Programming). Empty or missing ceremonies are now health warnings and repair-required items, not valid steady states.
- **Coordinator parity foundation:** Coordinator input plumbing, deterministic routing prefilters, visible circuit-breaker decisions, spawn-prompt context, directive capture, automated Scribe close-out, Ralph monitor, and ceremony/worktree lifecycle metadata are now wired with focused coverage.
- **Close-out automation:** Removed the manual close-out button/API path; Scribe close-out now runs through daemon/coordinator lifecycle automation instead of an explicit user action.
- **Docs features IA:** Added a Docusaurus Features section with subsections for core orchestration, automation, integrations, operations, and current gaps.
- **Pre-alpha release readiness:** Added GitHub Actions CI for docs and npm package builds plus manual npm publishing workflow mechanics targeting the `prealpha` dist-tag.
- **Scenario tutorials:** Added Getting Started scenario tutorials backed by a Playwright screenshot spec that captures project setup, board triage, team casting, Consult, and import/template screens.
- **Squad Apps and imports docs:** Added user-guide pages explaining Squad Apps, template imports, built-in bundles, import safety, and the relationship to `bradygaster/squad`.
- **Architecture diagrams:** Enabled Mermaid in the docs site and added user sequence/topology diagrams for coordinator and import flows.
- **Docusaurus docs site:** Added a Hermes-style docs site package with getting-started, user guide, developer guide, reference, and LLM-readable entry points.
- **Setup lifecycle foundation:** Suggest Setup now uses an LLM-backed built-in bundle selector with deterministic fallback, and built-in template apply creates a fuller `.squad/` scaffold with roster, routing, casting state, agent history, and lifecycle badges.

### Changed

- **Getting Started rewrite:** Collapsed the nine fragmented scenario tutorials into four sequential tutorials that share one continuous Spark project (Connect → Cast → Run the launch wave → Connect Copilot CLI/Squad/MCP). Quickstart is now a true 10-minute end-to-end (capture → Ready → automatic pickup → inspect run → ceremony). Screenshots are now anchored to the step they actually illustrate. Sidebar and tutorial index updated to match.
- **Pre-alpha labeling:** Package metadata and top-level user-facing surfaces now explicitly identify Squadboard as pre-alpha software.
- **Consult scope:** Consult is now documented and typed as project-agent/model brainstorming only; legacy user-local-agent policy surfaces were removed from runtime, UI, agent prompts, templates, and docs.

### Fixed

- `pnpm start dev` now normalizes the compatibility `dev` argument instead of forwarding it into workspace dev scripts, preventing Docusaurus from treating `dev` as a docs path while keeping the docs dev server on port 3002.
- Server TypeScript build now passes after bringing stale tests/services up to the current agent schema and DB accessor patterns.

## Wave 10 — 2026-05-15

Dogfood loop, regression sweep, Fluent2 polish, feature gaps, and E1 gate verification.

### New

- **Dogfood loop (A):** `capture` MCP tool auto-lands directives from this Copilot CLI session into the squadboard project inbox without requiring a project ID. Per-process `SQUADBOARD_DEFAULT_PROJECT_ID` env propagated through the MCP transport.
- **Team portability (B7):** `POST /api/projects/:id/team/export|import|save-as-template|instantiate-template` — envelope contract fixed; routes wired.
- **Disabled-agent enforcement (B9):** `GET /api/projects/:id/agents?status=` filter; `POST .../runs` returns 422 if agent is disabled/retired. `list_agents` MCP tool accepts explicit `status` arg. AgentGrid shows Active / Disabled / Retired buckets.
- **Non-tech roles (D1):** HireTeamModal exposes 7 non-tech roles (PM, Designer-Brand, Founder, Sales, Marketing, Customer Success, Research) alongside the 9 SDK base roles.
- **Curated skill import (D2):** Drag/drop `.md` onto Skills page → imports via `POST /api/projects/:id/skills/import-md` with provenance tracking.
- **Tool/MCP JSON import (D3):** Drag/drop `.json` onto Tools or MCP Servers pages → bulk import with provenance.
- **Ceremony trigger source (D4):** `triggerKind` badge visible in CeremonyEditor header.
- **GitHub Copilot cost model (D6):** `SQUADBOARD_COST_MODEL=gh_multipliers` or per-project override. Premium-request column in Costs table.
- **Save-template disk mirror (D7):** Every save-as-template writes `.squad/squadboard/templates/{kind}/{slug}.json` alongside the DB row.
- **AgentFlowGraph (D8+):** ProjectFlow defaults to agent-centric view with lineage edges.
- **EmptyState component:** Reusable Fluent2 empty-state used across Skills, Tools, MCP, Agents pages.
- **E2e specs 07–09:** Regression specs for B7 (team-portability envelope), B8 (Consult send guards), B9 (disabled-agent enforcement).

### Fixed

- **Project-from-template broken (B1):** `templatesRouter` now mounted at `/api/templates`; `projectPortabilityRouter` at `/api/projects/:id`. Template create end-to-end works.
- **Conjure replaces Capture (B2):** Blue "+ Capture" FAB removed from top bar. Consult/Conjure is the single intake surface.
- **Heartbeat never wired (B3):** Heartbeat page polls real sweep timestamps and renders a ticking last-tick time.
- **Project tile hover resize (B4):** `transform: none` locked on Card styles; box-shadow used for hover affordance (no reflow).
- **WebSocket reconnect status (B5):** Reconnecting badge cleared correctly; "Connected" badge reaches green within ~3 s.
- **Consult prefill empty (B6):** `?prefill=issue:<id>` loads issue context into seed message; run tail capped at 32 KiB to prevent oversized payload crash.
- **Consult send crash (B8):** Server caps `content` at 64 KiB (400 error); client wraps send in try/catch with inline MessageBar.
- **Team portability envelope (B7):** `/export` now returns `{ ok, data: { payload } }`; `/save-as-template` returns `{ ok, data: { template: { id, name, kind } } }`.

### Changed

- **AddProject dialog (C/B):** Single right-aligned `DialogActions` row across all 3 tabs (Create / Connect / Discover).
- **Consult page width (C):** Capped at 1280 px centered, matches canon page width.
- **Now page (C):** Rebuilt with Fluent2 Card sections, Badge, and tabular data; aggregates across projects.
- **ProjectPicker dropdown (C4):** Project name truncated at 320 px with ellipsis tooltip; no wrap.
- **CeremonyEditor (D5):** Prose tab removed; Formulate panel is the only prose-to-YAML entry point.
- **CostDashboard (C6):** Numeric columns right-aligned with `tabular-nums`; premium-request column conditionally visible.
- **Diagnostics/Heartbeat scope labels (C8):** "Global" vs "Project: {name}" badge always visible.
- **Flow tab default (D8):** Agent-centric view is now the default tab in ProjectFlow.

### Removed

- `packages/client/src/components/ceremony/ProseTab.tsx` — deleted (D5).
- Blue "+ Capture" button from Layout top bar — replaced by Consult/Conjure (B2).

## [0.1.0] — 2026-05-15 (Initial Hacking Phase Release)

### Added

- Kanban board with drag-drop cards, filters, bulk-edit, comment threads
- Deterministic workflow engine with YAML-defined steps
- Agent discovery and inline management from `.squad/`
- Isolated workspaces per run; parallel agents never collide
- Peer review + approvals (N-of-M quorum, 4-verb cycle)
- Fan-out and subtree workflows (atomic splits, pause/resume)
- Live ops view with real-time active runs, cost-per-run, activity feed
- Dashboards: agent leaderboard, cost burn, workflow funnel, burndown
- MCP integration for VS Code and GitHub Copilot CLI
- GitHub sync for issues and PRs
- Embedded Postgres (no external DB required)
- Production-ready build via `pnpm build`

### Documentation

- Product Requirements Document (`docs/prd.md`)
- Getting Started guide (root `README.md`)
- MCP tool reference (`packages/server/src/mcp/README.md`)
- Dogfood playbook (`.squad/dogfood.md`)

### Status

Hacking phase, pre-1.0. Self-hosted only. Breaking changes expected.

---

Generated with ❤️ by the Squadboard team.
