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

### 2026-05-15 — QA investigation: spam loop, agent registry, client crashes

Conducted read-only investigation into four suspected issues (dispatched by Squad coordinator):

1. **Issue Spam Loop (A)**: Traced four createIssue callsites: `ceremony-scheduler.ts::sweepDueSchedules()`, `consult-stream.ts::acceptProposeIssue()`, `consult-stream.ts::acceptProposeConversation()`, and `inbox.ts::publishInboxItem()`. The ceremony scheduler uses correct two-phase idempotency (tentative + canonical `nextFireAt` pattern). **consult-stream has no retry logic or title mutation** — both calls are direct pass-through to `createIssue()`. The title appending pattern observed (`... — verbal — fenster`) likely originates in a caller's error handler or retry middleware outside these files. **Verdict**: Medium-confidence needs-fix; Verbal to audit retry paths.

2. **Fry Agent Dir (B)**: Found `.squad/agents/fry/` on disk with learnings from 2026-05-14 (frontend audit). **Not registered in `.squad/team.md` or `.squad/casting/registry.json`** — it's an orphan. Recommend archiving to `_alumni/` or removing if learnings are integrated elsewhere. High-confidence confirmed.

3. **formatDistanceToNow Crash (C)**: **RoutingLogTable.tsx has proper guard** (lines 21–30): `Number.isNaN()` check + try/catch around `formatDistanceToNow()`. Durable fix verified. **However, 7 other callsites** (CommentList, CardDetail, DeliverableCard, AgentDetailPanel, ReviewPanel, Now.tsx) call `formatDistanceToNow()` directly without guards — they remain vulnerable if timestamps are malformed. Recommend Hockney apply the same guard pattern universally.

4. **WebSocket Reconnect (D)**: ws-client.ts is **clean and verified**. Proper cleanup of handlers (set to null), idempotent cleanup method, no StrictMode races, no retry-inside-render. One socket per session, sensible backoff in `scheduleReconnect()`. No action needed.

Full findings in `.squad/decisions/inbox/kujan-investigation-2026-05-15.md`.

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

### 2026-05-15 — Wave 10 E1 gate: verification, regressions fixed, committed

Completed the Wave 10 E1 gate sweep (Steps 1–8) on commit `c9c2c44c`.

**Build:** `pnpm -r build` across cli/server/client — ALL GREEN. One non-blocking Vite chunk-size warning (client bundle >500 KB).

**Unit tests:** No test runner exists yet (no Vitest config in any package). Noted as test-pyramid gap.

**E2E suite (pre-fix):** 4/27 passing. Two confirmed Wave 10 regressions:
1. B7 (07-team-portability): server returned HTML (SPA fallback) — `teamPortabilityRouter`, `projectPortabilityRouter`, `templatesRouter` all imported but never mounted with `app.use()`.
2. B9 (09-disabled-agent): `assertColumnExists('todo')` failed on fresh projects — `POST /api/squad/create` does NOT seed `column_meta`; `GET /columns` does (via `seedDefaults()`).

**Fixes:**
- `packages/server/src/index.ts`: Added 3 missing `app.use()` mounts after conjure router.
- `packages/e2e/tests/09-disabled-agent.spec.ts`: Call `GET /columns` in test setup to seed defaults; pass `column: 'backlog'` to `createIssue()`.
- `.gitignore`: Added log files and playwright artifact dirs.

**E2E post-fix (on fresh build, port 3009):** 11/11 B7+B8+B9 tests GREEN. UI browser tests (01–04) remain failing — pre-existing environment issue (WSL inotify + Chromium headless), not Wave 10 regressions.

**AC smoke-walk:** All 21 ACs verified via source code inspection. No failures found.

**Key WSL constraint learned:** `tsx watch` does NOT pick up file changes on Windows-mapped WSL2 paths (`/home/asabbour/GitWSL/...`) because inotify doesn't fire for cross-FS writes. Workaround: build then start `node dist/index.js` on a separate port for verification. Ahmed must restart the dev server after pulling commits to see route changes take effect.

**Router mounting discipline:** Any router that is `import`ed but missing an `app.use()` mount silently falls through to the SPA fallback (`res.sendFile('index.html')`). Tests will see `SyntaxError: Unexpected token '<'` when parsing the HTML response as JSON. Always grep `index.ts` for unmatched imports after adding a new router file.

**Column seeding:** Fresh projects from `POST /api/squad/create` have zero `column_meta` rows. `GET /api/projects/:id/columns` auto-seeds 5 default columns via `seedDefaults()`. Always call this in test setup before creating issues, or issue creation will fail with "Column does not exist for this project".
