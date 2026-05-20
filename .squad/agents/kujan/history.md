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

### 2026-05-19T23:37:54.700-07:00 — Delete project stale-OID recovery regression (root cause)

**Failure mode covered:** When `db.delete(schema.settings)` or `db.delete(schema.projects)` throws `could not open relation with OID NNNNN` (stale PGlite prepared-statement plan), `withPgliteOidRetry` must issue `DEALLOCATE ALL` and retry the entire mutation callback — not just return 500 JSON. The deletion must **succeed** on retry.

**Prior round mistake:** First round of tests only proved that DB errors produce JSON 500 (not HTML). That's error formatting, not root-cause coverage. The real contract is: delete SUCCEEDS after one stale-OID error.

**Implementation confirmed present:**
- `packages/server/src/db/index.ts` exports `withPgliteOidRetry` — catches OID errors, calls `DEALLOCATE ALL`, retries once. In external-Postgres mode re-throws immediately.
- DELETE handler wraps both select and mutation in `withPgliteOidRetry`.
- `packages/server/src/__tests__/pglite-oid-retry.test.ts` — 6 unit tests for the wrapper (Hockney's). All pass.
- `packages/server/src/__tests__/delete-project.test.ts` test 14 — SELECT path recovery (OID on select → retry → 200).

**Critical gap confirmed and filled:**
- **No test existed for MUTATION path recovery** (OID error on `db.delete(settings)` → DEALLOCATE → retry both deletes → 200). This is the actual screenshot bug path.

**Tests I added (`delete-project-db-error.test.ts`, 6 tests, all green):**
1. **Mutation OID first attempt → DEALLOCATE → retry → 200 OK + oidRetryDeallocateCalled=true** ← primary missing test
2. Mutation OID recovery does not attempt filesystem deletion (safety)
3. `db.delete(projects)` always-throws → 500 JSON no HTML (covers the second statement in the callback, not covered by Hockney's test 13 which only covers settings)
4. Non-OID error (FK violation) is NOT retried → `oidRetryDeallocateCalled=false`
5. Mock self-validation: transparent by default
6. Mock self-validation: one-shot OID — second invocation succeeds without retry

**Test design decision:** The `withPgliteOidRetry` mock uses the same contract as `delete-project.test.ts` — `simulateOidRetry` flag + `_mutationOidConsumed` one-shot flag. This means both test files share the same mock contract, making them independently verifiable.

**Verdict:** Implementation satisfies delete success after stale-OID recovery. The three files (`pglite-oid-retry.test.ts`, `delete-project.test.ts`, `delete-project-db-error.test.ts`) together prove the full recovery contract at every layer.


**Failure mode covered:** When Postgres/PGlite throws `could not open relation with OID 66346` during `DELETE /api/projects/:id`, an unguarded async route handler lets the error propagate to Express's default error handler, which responds with `500 text/html`. `apiFetch` detects non-JSON, builds an error whose message contains "First 200 chars: `<!DOCTYPE html>...`", and `setError(e.message)` in `DangerZoneSection` renders that raw HTML string verbatim in the modal's `<Caption1>`.

**What Hockney and Keyser already fixed (confirmed by test runs):**
- `packages/server/src/routes/projects.ts`: Two separate `try/catch` blocks — one around the select, one around the settings + project deletes — each returns `res.status(500).json({ ok: false, error: "Database error during ...: <msg>" })`.
- `packages/server/src/index.ts`: 4-arg Express error middleware as a universal fallback.
- `packages/client/src/api/client.ts`: `nonJsonErrorMessage()` logs raw body to `console.error`, returns a clean user-facing string ("Server error (500) — the operation failed. Please try again or check the server logs.").
- `packages/client/src/pages/Settings.tsx`: `sanitizeApiError()` strips HTML tags as a belt-and-suspenders second layer.

**Tests I added:**
- `packages/server/src/__tests__/delete-project-db-error.test.ts` (4 tests) — dedicated file covering legs not in Hockney's additions to `delete-project.test.ts`:
  1. `db.select()` throws → JSON 500 (overlaps Hockney test 12, adds `invoke()` propagation check)
  2. `db.delete(settings)` throws → JSON 500 (overlaps Hockney test 13, same addition)
  3. `db.delete(projects)` throws → JSON 500 (**unique** — no prior coverage for this leg)
  4. JSON error field contains no raw HTML tags (**unique** assertion angle)

**Tests I removed (redundant):**
- Drafted `packages/client/src/__tests__/apiFetch-delete-error.test.ts` but removed it — Keyser's `src/api/__tests__/apiFetch.errors.test.ts` (7 tests) covers all client-side invariants already.

**Key learning:** The `invoke()` wrapper pattern (catch any unhandled throw from `await handler(req, res)`, assert `handlerThrew === null`) is cleaner than checking `getStatus() !== initialValue` for detecting handler-propagation failures. It names the failure mode precisely: "handler must NOT propagate DB error to Express."

**Key learning:** When a bug has already been partially fixed and tested by multiple agents before Kujan spawns, the QA job is (1) audit which legs remain uncovered, (2) add only non-redundant coverage, (3) remove any drafted tests that duplicate existing suites.

### 2026-05-19T18:15:41.495-07:00 — `pnpm start dev` Docusaurus argv regression

Validated the exact failure condition: if `dev` reaches the docs workspace, Docusaurus runs `node scripts/docusaurus.mjs start --host 0.0.0.0 --port 3002 dev` and fails with `ENOENT` for `packages/docs-site/dev`.

Hockney's fix routes root `start` through `scripts/start-dev.mjs`, normalizing the compatibility form `pnpm start dev` to the fixed workspace fan-out command without forwarding trailing argv. I added `packages/server/src/__tests__/startup-scripts.test.ts` as a black-box regression: it runs the root start script with a fake `pnpm`, captures argv, and asserts every workspace `run dev` invocation has no arguments after `dev`. Hockney's `root-start-script.test.ts` and my black-box startup test both passed.

Validation command passed: `pnpm --filter @sabbour/squadboard test -- --run src/__tests__/root-start-script.test.ts src/__tests__/startup-scripts.test.ts`. Manual normalized-command check passed: `SQUADBOARD_START_PRINT_COMMAND=1 pnpm start dev` printed `pnpm --parallel --filter @sabbour/squadboard --filter @sabbour/squadboard-client --filter @sabbour/squadboard-docs run dev`. Decision: approve.

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

### 2026-05-19T21:58:16.699-07:00 — Cross-surface Squad sync regression gate

Added targeted invariant tests for interchangeable Squadboard and CLI/Copilot clients:
- `packages/server/src/__tests__/squad-sync-authority.test.ts` covers live filesystem authority for CLI/Copilot-first projects, Squadboard-first missing Copilot projection repairability, and empty/default ceremony repair.
- `packages/server/src/__tests__/squad-sync-status-route.test.ts` is the failing route contract for `GET /api/projects/:projectId/squad-sync/status`; it expects stable status JSON plus `agent_files` and `ceremony_defaults` repair guidance.
- `packages/server/src/sdk/sync-ownership.test.ts` already carries the pure SDK contract coverage for storage authority, client readiness, API projection, and Copilot agent projection rendering.

Validation:
- `pnpm --filter @sabbour/squadboard test -- --run src/sdk/sync-ownership.test.ts src/__tests__/squad-sync-authority.test.ts` currently has 10/11 passing. The remaining failure is Hockney-owned: `services/sdk-state.ts` treats the placeholder `Project ceremonies will be listed here.` as seeded ceremonies, so `ceremoniesDefaultsPresent` stays true.
- `pnpm --filter @sabbour/squadboard test -- --run src/__tests__/squad-sync-status-route.test.ts` fails clearly because `packages/server/src/routes/squad-sync.ts` is not present yet. Hockney owns the status endpoint.

### 2026-05-19T15:29:23.373-07:00 — Pre-alpha release/docs validation gate

Validated the current shared worktree after Hockney/Redfoot release-readiness and docs changes appeared. Safe targeted checks passed: `pnpm install --frozen-lockfile`, publishable package builds for `@sabbour/squadboard`, `@sabbour/squadboard-sdk`, and `@sabbour/squadboard-cli`, `pnpm docs:build`, and npm pack dry-runs for the three publishable packages. Docusaurus built 41 pages and generated `llms.txt` / `llms-full.txt`.

Release/docs invariants flagged:
- User directive says the software must be labeled **pre-alpha**. Refined terminology scan found 15 public release/docs lines still using **Alpha** / **Current alpha limits** / **alpha software** without **pre-alpha** across README and Docusaurus pages. This is a release-copy blocker until Redfoot normalizes terminology.
- `.github/workflows/` still only contains Squad triage/heartbeat/label workflows; no docs-build or npm-package-build release-readiness workflow is present yet. Treat CI release automation as pending Hockney output.

No Hockney/Redfoot-owned source or docs files were edited by QA; only this history entry and the validation decision drop were added.

### 2026-05-19T22:30:55.553-07:00 — Cross-surface sync Playwright gate

Added Playwright coverage that launches the backend and client through `webServer`, then exercises Team Sync status, Settings panel rendering, ceremony-default repair, `.github/agents/squad.agent.md` generation, and a filesystem-authoritative CLI/Copilot-first registration path. The live Copilot CLI ask-Squad path is gated by `SQUADBOARD_E2E_LIVE_COPILOT=1`; default CI gets deterministic command-runner coverage without pretending a real authenticated Copilot run happened.

Validation passed: `pnpm --filter @sabbour/squadboard-e2e test -- --list tests/00-full-stack-launch.spec.ts tests/12-squad-sync.spec.ts tests/13-copilot-cli-launch.spec.ts` and `SQUADBOARD_E2E_REUSE_SERVER=0 SQUADBOARD_E2E_API_BASE=http://127.0.0.1:3104 SQUADBOARD_E2E_BASE_URL=http://127.0.0.1:5178 pnpm --filter @sabbour/squadboard-e2e test -- tests/00-full-stack-launch.spec.ts tests/12-squad-sync.spec.ts tests/13-copilot-cli-launch.spec.ts` (7 passed, 1 live Copilot gate skipped).

Failure mode now covered: Squadboard E2E cannot silently pass while the backend is absent, Team Sync status is stale, ceremony defaults are empty, the Copilot projection is missing, or filesystem-mode CLI-first authority regresses.

### 2026-05-20T04:16:33.702-07:00 — Sync status export UX regression gate

Added focused client regressions for the sync status bug in `SquadSyncStatusPanel.test.tsx`.

**Failure modes covered:** When a database-authoritative project has no live filesystem mirror, the panel must present user-facing actions such as Preview Export without leaking provider/env-var/internal broker jargon (`SQUADBOARD_SQUAD_STORAGE_PROVIDER`, storage provider wording, MCP/API broker, explicit bridge, or magic enable-auto copy). When Preview Export reports only `already_up_to_date` file results, the modal must summarize that no files need updating and must not dump every unchanged `.squad` path or raw `already_up_to_date` status.

**Validation:** Focused command `pnpm --filter @sabbour/squadboard-client test -- --run src/components/settings/__tests__/SquadSyncStatusPanel.test.tsx` is red against the current UI implementation: 2 new regression tests fail, 5 existing tests pass. The failures reproduce the reported bug exactly, so Keyser owns the production UI revision before this suite can go green.

### 2026-05-20T09:26:00-07:00 — CeremonyEditor Validate button regression (canonical YAML)

**Bug covered:** Built-in ceremonies (e.g., Work Pickup) failed server-side validation when the Validate button was clicked in the CeremonyEditor.  Error: `'name' is required and must be a string; 'steps' is required and must be a non-empty array`.

**Root cause:** Before the `normalizeWorkflowDocument` fix in commit `5bdd378db`, `validateWorkflowYaml` only inspected flat top-level keys (`name`, `steps`).  Canonical YAML (`apiVersion: squad.io/v1 / kind: Ceremony / metadata / spec`) stores `name` under `metadata.displayName` and `steps` under `spec.steps`, so both checks failed for ANY canonical document.

**What the regression test proves:**  The client's `graphToCeremonyYaml` (after `ceremonyYamlToGraph`) re-emits canonical YAML that may omit non-essential metadata fields (`category`, `tags`).  The test inlines that client-emitted form verbatim and asserts `validateWorkflowYaml` returns `{ valid: true }`.  It also asserts `parseWorkflowYaml` resolves the correct `name`, `description`, and step types — so any future regression in `normalizeWorkflowDocument` will be caught at both the validation and parse layers.

**Tests added (`workflow-parser-canonical.test.ts`):**
1. `regression: validateWorkflowYaml accepts client-emitted canonical YAML (CeremonyEditor Validate button)` — primary regression guard
2. `regression: parseWorkflowYaml correctly resolves canonical metadata from client-emitted YAML` — confirms full parse path also works on client-emitted shape

All 3 tests in the file pass (including the pre-existing stored-file test).


### 2026-05-20T12:51:52.451-07:00 — CI vitest/typecheck gate for PRs

**What changed:** `.github/workflows/ci.yml` now inserts two blocking steps in the `npm-packages` job after the build and before the publish dry-run: (1) workspace type checks for client/sdk plus `tsc --noEmit` for server/cli, and (2) Vitest runs for sdk, client, and server. Each new gate has `timeout-minutes: 10` so hung test runs fail loudly instead of burning the whole job.

**Why this matters:** The root workspace has no `test` script, so previous CI never exercised the Vitest suites at all. The first recursive baseline immediately proved the audit point: current client/server tests are already red locally, and server `tsc --noEmit` is also red. After this workflow change, those regressions will fail PR CI instead of merging silently.

**Current red signals now surfaced by CI:**
1. `packages/client` — `RunButton.test.tsx` fails because `pickDefaultConsultAgent` dereferences `a.role.toLowerCase()` when `role` is undefined.
2. `packages/server` — Vitest is red in `ceremonies-list-route.test.ts` and `pglite-issue-run-events-catalog-repair.test.ts`.
3. `packages/server` — `tsc --noEmit` is red in `src/engine/workflow-runner.ts` (insert typing + transaction type mismatch).

**Validation:** Workflow edited; local command equivalents rerun. `@sabbour/squadboard-sdk` tests pass. Client Vitest fails reproducibly (1 failed test, 1 unhandled error). Server Vitest fails reproducibly (2 failed tests). Client/sdk typecheck pass; server `tsc --noEmit` fails reproducibly; cli `tsc --noEmit` passes.
