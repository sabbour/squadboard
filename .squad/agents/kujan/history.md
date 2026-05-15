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

### 2026-05-14
Wrote `docs/acceptance-criteria.md` — 572 lines, 15 demo sections, functional + durability ACs throughout. Key insight: Demos 1–3 and 13 are UI-only or read-only — durability ACs are minimal or absent (4 demos total). Demos 4–12, 14–15 all touch the workflow engine and require invariant coverage (11 demos with durability ACs). Invariants I-2 (single-spawner) and I-3 (lease/heartbeat) appear in the most demos (6–7 each) and will be the hardest to exercise reliably in CI — they need real clock control (fake clock or time-warp) or process-kill harnesses; neither is trivially parallelizable in a shared `embedded-postgres` environment. Biggest quality risk: Demo 10 (fan-out) has the most complex durability surface — the six-step transaction (I-5) requires a kill-mid-transaction harness that no other demo needs, and it's the only place where partial rollback correctness must be proven end-to-end.

### 2026-05-14 — Playwright E2E setup
Set up `packages/e2e/` with Playwright 1.60.0 (latest stable at task time, chosen over 1.49 since pnpm resolved a newer compatible version). Config targets Vite dev server at `http://localhost:5173` (not 3000 — that's the backend; Vite proxies `/api` there).

28 tests across 4 spec files listed cleanly against Chromium only.

Key decisions:
- **Selector strategy**: text content + ARIA roles + `placeholder` attributes as primary. No `data-testid` attributes exist in the codebase yet — used real UI strings read directly from component source. `getByTitle('Create issue')` for the column + button, `getByPlaceholder('Issue title')` for the create modal, `getByRole('button', { name: ... })` for all CTAs.
- **Drag-and-drop** (`@hello-pangea/dnd`): marked `test.fixme` — synthetic pointer events for DnD libs require careful setup and the column droppable IDs aren't stable enough to anchor yet.
- **Bulk selection**: marked `test.fixme` — UI selection is Shift+click only; no checkbox exposed on `IssueCard` yet.
- **Agent discovery from `.squad/`**: marked `test.fixme` — requires seed fixtures on the test machine.
- **Demo coverage**: Demos 1 ✓ (full), Demo 2 ✓ (partial — move via drag is fixme), Demo 3 ✓ (hire + routing tabs). Demos 4–15 not yet covered.
