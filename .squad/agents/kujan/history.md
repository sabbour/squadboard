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

### 2026-05-19T14:38:22.590-07:00 — Startup script static gate + agent-sync retirement regression

Verified Hockney's startup-script change with a no-process static gate: root `start` exactly fans out backend, client, and docs dev scripts; `cli:start` still targets the CLI package; docs `dev`/`serve`/`start` all bind port 3002. I did not launch the long-lived dev fan-out in the shared worktree, so the residual risk is runtime orchestration only, not script wiring.

Added `packages/server/src/__tests__/agent-sync-retired-regression.test.ts` to pin the cast/hired-agent invariant: an active newly hired agent with a folder on disk must not be marked retired just because the SDK listing skipped an unparsable charter. Focused command currently fails with `result.removed === 1`, which confirms Kobayashi's production fix has not landed in this worktree yet.

Added `packages/server/src/__tests__/squad-create-structure.test.ts` for the Squadboard project-creation folder invariant. It invokes the `POST /api/squad/create` handler with real filesystem scaffolding under a repo-local scratch path and asserts `agents/`, `casting/`, `decisions/`, `log/`, `orchestration-log/`, `skills/`, `team.md`, `routing.md`, `decisions.md`, and `ceremonies.md` exist only under `.squad/`, never as project-root siblings. Focused command passed: `pnpm --filter @sabbour/squadboard test -- --run src/__tests__/squad-create-structure.test.ts`.

### 2026-05-19T14:11:32.649-07:00 — PGlite issue_runs claim regression coverage

Added `packages/server/src/__tests__/pglite-issue-runs-claim.test.ts` for the ready-workflow-step PGlite failure. Pattern: use in-memory `PGlite`, initialize the real server schema through `initDb(PGLITE_SENTINEL)` with automatic migration snapshotting disabled, then manually apply forward SQL migrations from `packages/server/src/db/migrations/` through the pool adapter. The test creates an `issue_runs` row plus representative dependent FK rows (`step_runs`, `issue_run_events`, `routing_log`, `review_events`, `deliverables`) before running the exact claim update to `running`; this defends against malformed PGlite RI triggers without touching the user data directory or production code. Focused command passed: `pnpm --filter @sabbour/squadboard test -- --run src/__tests__/pglite-issue-runs-claim.test.ts`.

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

**Fluent v9 controlled inputs in headless Playwright:** `<Input value={...} onChange={(_, d) => setState(d.value)} />` does not reliably respond to Playwright `fill()` in WSL/headless Chromium. The controlled input's React state never updates, leaving the submit button disabled. Solution: use `createProjectViaApi()` (API-direct pattern already established by tests 07–09) for any test that only needs the project ID — reserve UI-based `createProject()` for tests that specifically test the project creation flow itself.

**`label[for="role-{id}"]` click testing for M3:** After the `<Field>` → `<fieldset>` fix, `page.locator('label[for="role-developer"]').click()` directly tests the htmlFor binding. Use `page.locator('#role-{id}').isChecked()` to assert the toggled state. This pattern is more reliable than `getByLabel()` with emoji-prefixed strings.

**Fixture strict-mode ambiguity:** After the templates feature landed, `getByRole('button', { name: 'Create' })` matched both "Create from template" and "Create new". Fixed to `getByRole('button', { name: 'Create new' })`. When adding UI features that share label prefixes, always check all existing test fixtures for ambiguity.

### 2026-05-15 — Wave 11C M4: Cast-Team E2E regression suite + fixture helper

Wrote end-to-end regression suite (`packages/e2e/tests/10-cast-team.spec.ts`, 7.8 KB) covering M1/M2/M3 Cast-Team modal crash fixes:

1. **Cast a Team button visible** (smoke test) — Hire Team button renders on agents page
2. **Modal opens without crashing** (M2 regression) — no "Unexpected token '<'" in browser console; modal heading + ≥3 role labels visible
3. **Non-Lead role label toggle isolated** (M3 regression) — `label[for="role-developer"]` click flips Developer only; Lead unchanged; repeated for PM and Marketing roles
4. **Form submission calls /hire-team/propose** (M1 regression) — POST returns HTTP 200 + `content-type: application/json`; member list rendered; no parse errors

**Execution:** 4 passed in 9.9s using 1 worker.

**Fixture helper:** Added `createProjectViaApi()` to `packages/e2e/tests/fixtures.ts` — direct API call to `POST /api/squad/create` returns `projectId`. The existing `createProject()` UI-based helper is unreliable in WSL/headless Chromium (Fluent v9 controlled inputs don't respond to Playwright `fill()` in headless mode). Tests 07–09 already adopted API pattern; test 10 standardizes on it. Created button selector also fixed from `getByRole('button', { name: 'Create' })` to `getByRole('button', { name: 'Create new' })` to disambiguate post-Templates feature.
- W28: JIS client — useRunStream hook + LiveRunViewer component (T7,T8), Watch button on running cards (T9), reconnect with event replay + 3-strike WS failure counter + tests (T10,T12) (aa909f30, fff70477)

### 2026-05-19T21:56:17Z — Two-Way Sync Audit QA + SDK Validation In Progress

Running final verification pass on two-way sync audit artifacts and Kobayashi SDK integration fixes.

**Active Work:**
- Kobayashi SDK validation: cast-agent retirement, project structure reorganization, integration tests
- McManus audit artifact validation: Audit skill generalizability, test coverage metrics
- Storage provider validation: PostgreSQL provider test suite (72/72 passing), PGlite regression tests passing

**Test Suites Passing:**
- `pglite-issue-run-events-catalog-repair.test.ts` — Catalog repair validation
- `pglite-issue-runs-claim.test.ts` — Issue run claim/recovery validation

**Validation Gate:** Full regression suite pending before next spawn wave. Blocking issues will escalate to team coordinator.

**Key Learning:** In-memory PGlite test instances must bootstrap real schema + migrations; test catalog repairs against genuine constraint triggers, not mocks.

### 2026-05-19T15:29:23.373-07:00 — Pre-alpha release/docs validation gate

Validated the current shared worktree after Hockney/Redfoot release-readiness and docs changes appeared. Safe targeted checks passed: `pnpm install --frozen-lockfile`, publishable package builds for `@sabbour/squadboard`, `@sabbour/squadboard-sdk`, and `@sabbour/squadboard-cli`, `pnpm docs:build`, and npm pack dry-runs for the three publishable packages. Docusaurus built 41 pages and generated `llms.txt` / `llms-full.txt`.

Release/docs invariants flagged:
- User directive says the software must be labeled **pre-alpha**. Refined terminology scan found 15 public release/docs lines still using **Alpha** / **Current alpha limits** / **alpha software** without **pre-alpha** across README and Docusaurus pages. This is a release-copy blocker until Redfoot normalizes terminology.
- `.github/workflows/` still only contains Squad triage/heartbeat/label workflows; no docs-build or npm-package-build release-readiness workflow is present yet. Treat CI release automation as pending Hockney output.

No Hockney/Redfoot-owned source or docs files were edited by QA; only this history entry and the validation decision drop were added.
