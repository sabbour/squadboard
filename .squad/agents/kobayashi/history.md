# Kobayashi — History

## Core Context

- **Project:** Squadboard — local-first kanban + workflow board for [Squad](https://github.com/bradygaster/squad) agents
- **Package:** `@sabbour/squadboard` · Local install: `npx @sabbour/squadboard init` · MIT · Self-hosted
- **Role:** Squad SDK Integrator
- **Joined:** 2026-05-14T08:17:03Z
- **Hired by:** Ahmed Sabbour
- **PRD:** `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md`

## SDK surface I own

From `@squad/sdk`:
- `SquadClient` / `SquadSession` — per-run session lifecycle
- `EventBus` — streaming session messages, tool calls, completion events
- `CharterCompiler` — reads `.squad/agents/<name>/charter.md` + identity files; produces frozen system-prompt
- `HookPipeline` — manually wired into `SquadSessionHooks.onPreToolUse` / `onPostToolUse` (NOT auto-attached)
- `CostTracker` — `wireToEventBus(bus)` then forward into `cost_records`
- OTel runtime — passes through unchanged

## Routing pipeline I implement

Three tiers (first match wins):
1. **Deterministic rules** (`.squad/routing.md`) — label matchers, title regex, priority. Fast, free.
2. **`matchRoute()`** — Squad's existing matcher, used router-only (returns name; we don't let it spawn).
3. **Specifier agent** — an `agent_run` (`kind=specifier`) reads issue + roster + each agent's `description`; returns `{assignee_agent_id, confidence}`. If `confidence < 0.6`, fall through to `triage_assign` (human picker).

## Roadmap I deliver against

- **Demo 3** — Squad onboarding (read `.squad/`, surface agents, hooks, cost)
- **Demo 4** — One-shot agent (first end-to-end SDK call from runWorker)
- **Demo 5** — Routing tier 1 (deterministic rules)
- **Demo 8** — Routing tiers 2 + 3 (`matchRoute()` + specifier agent)
- **Demo 14** — MCP + slash command (`engine_emit_final_output` + idempotent create)

## Recent team activity

**2026-05-15 Round 2 shipped:** Hockney (attachments backend), McManus (multi-modal frontend), Verbal (Consult chat fix), Fenster (typography sweep), Kobayashi (Ceremony Conjure UX), Keyser (layout rebalance). See `.squad/decisions.md` for Fluent2 canon, image bytea architecture, create-page pattern, react-markdown rendering.

---

## Wave 5 Update (2026-05-15T10:18:00Z)

**Run:** kobayashi-3  
**Model:** claude-sonnet-4.6  
**Task:** Per-project add/remove kanban columns

**Outcome:**
- Eliminated hard-coded `column_status` enum
- Made `column_meta` single source of truth for columns
- Users can now add/remove columns per project
- Five defaults seeded on first access
- Batch A (schema): commit `1a4c5d46`
- Batch B (endpoints): commit `d87c8f45`
- Batch C (docs): commit `6067d8a2`
- Decision: `.squad/decisions/inbox/kobayashi-columns-add-remove.md`
- New endpoint contracts documented for Keyser implementation
- Also merged carryover: kobayashi-fs-migration.md (3 callsites in agent-sync.ts migrated to SDK)

**Status:** COMPLETE — API stable for client. Ready for Keyser Batch B.
