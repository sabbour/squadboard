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

## Why we bypass `SquadCoordinator`

PRD Appendix A — the Coordinator's regex routing is fine for one-shot use; its parallel fan-out and ad-hoc handoffs are exactly what Squadboard exists to escape. We call `SquadClient.createSession()` directly from the deterministic engine.

## Roadmap I deliver against

- **Demo 3** — Squad onboarding (read `.squad/`, surface agents, hooks, cost)
- **Demo 4** — One-shot agent (first end-to-end SDK call from runWorker)
- **Demo 5** — Routing tier 1 (deterministic rules)
- **Demo 8** — Routing tiers 2 + 3 (`matchRoute()` + specifier agent)
- **Demo 14** — MCP + slash command (`engine_emit_final_output` + idempotent create)

## Learnings

<!-- Append learnings below -->
