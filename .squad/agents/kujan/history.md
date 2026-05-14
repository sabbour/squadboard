# Kujan — History

## Core Context

- **Project:** Squadboard — local-first kanban + workflow board for [Squad](https://github.com/bradygaster/squad) agents
- **Package:** `@sabbour/squadboard` · Local install: `npx @sabbour/squadboard init` · MIT · Self-hosted
- **Role:** Tester / QA
- **Joined:** 2026-05-14T08:17:03Z
- **Hired by:** Ahmed Sabbour
- **PRD:** `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md`

## Critical contracts I defend

From PRD §6.0 (the five invariants):
1. `agent_run` is the only LLM-spawning step (`peer_review`, tier-3 routing, `split` desugar to it)
2. Single-spawner discipline (stepper-only via `FOR UPDATE SKIP LOCKED`)
3. Lease (90s TTL) + heartbeat (30s) is the authoritative liveness signal
4. Output schema validation happens at session end (after `sendAndWait`, before `recordRunCompletion`)
5. `fan_out` / `split` materialize full child `workflow_runs` in one six-step transaction

From PRD §6.7 (reliability discipline):
- `reapByLease`, `reapByPidOwnPod`, `applyTimeouts`, `checkBudgets` sweepers
- Declarative retry per step (`max_attempts`, `backoff_ms`, `on_exhausted: { goto: <step> }`)
- Crash recovery: pod restart → reap expired leases → step-level retry → stepper re-claims

## Test stack

- Vitest (fast, TS-native)
- `embedded-postgres` for integration runs (real Postgres, ~50MB binary)
- Synthetic agents (Kobayashi-built fixtures) for SDK contract tests
- E2E click-through via Playwright (gated to demo-eve runs in CI)

## Roadmap I deliver against

Every demo ships with a passing E2E test. Critical durability suites land in:
- **Demo 4** — workspace cleanup on completion + on crash
- **Demo 6** — workflow advances through all step types; retry policy fires
- **Demo 7** — kill the engine mid-run; verify reap + resume; verify budget pause
- **Demo 9** — peer review quorum (N-of-M with M-1 reviewers ⇒ outcome computed correctly)
- **Demo 10** — fan-out children atomicity; `pinnedAgentRevisions` propagation
- **Demo 14** — idempotent create (same key twice ⇒ one row)
- **Demo 15** — PR webhook durable cursor survives engine restart

## Learnings

<!-- Append learnings below -->
