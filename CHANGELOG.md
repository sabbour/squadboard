# Changelog

All notable changes to Squadboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
