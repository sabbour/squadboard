# Squadboard — Acceptance Criteria

> These are the contracts each demo must satisfy before merging to main.
> Kujan has reject authority on any durability/recovery criterion.
> Source: docs/prd.md. Engine invariants from decisions.md (paste-locked).
> Last updated: 2026-05-14

## How to read this document

Each demo section lists:
- **Functional AC** — what the feature does in the happy path
- **Durability AC** — what happens when things go wrong (engine invariant coverage)
- **Test type** — which layer of the test pyramid covers it (unit/integration/durability/E2E)
- **Invariants exercised** — which of the 5 engine invariants this demo touches

A demo is **not shippable** until all ACs have corresponding passing tests.

### Engine invariant reference (paste-locked from decisions.md)

| # | Invariant |
|---|-----------|
| I-1 | `agent_run` is the ONLY LLM step — `peer_review`/tier-3 routing/`split` desugar to `issue_runs` rows with distinct `kind` values |
| I-2 | Single-spawner — stepper-only via `FOR UPDATE SKIP LOCKED`; dispatcher only ticks/sweeps/wakes |
| I-3 | Lease (90s TTL) + heartbeat (30s) is authoritative liveness — `kill(pid, 0)` is sanity-check only |
| I-4 | Output schema validation at session end — after `sendAndWait`, before `recordRunCompletion`; never on post-tool-use hook |
| I-5 | `fan_out`/`split` materialize full child `workflow_runs` in one six-step transaction (issue + workflow_run + first step_run + issue_link + handoff_context + variables propagation); children inherit `pinnedAgentRevisions` from parent |

---

## Demo 1 — Hello Squadboard

**Goal:** `npx @sabbour/squadboard init` boots; create your first project.

### Functional AC

- [ ] Given a machine with Node.js installed, when `npx @sabbour/squadboard init` is executed, then the CLI completes without error, `embedded-postgres` starts within 10 seconds, and a browser tab opens (or a URL is printed) pointing to `http://localhost:<port>`.
- [ ] Given Squadboard is running, when the user submits the create-project form with name `'Test Project'`, then a row exists in the `projects` table with `name='Test Project'` and the project card appears in the project list within 500ms of submission.
- [ ] Given Squadboard is running with an existing project, when the user navigates to the project, then the board view loads with the five default columns (Backlog, Todo, In Progress, In Review, Done) and no error state.
- [ ] Given `npx @sabbour/squadboard init` has been run previously, when it is run again in the same directory, then it detects the existing install, skips re-initialization, and starts the server without clobbering any data.

### Durability AC

> No workflow engine runs in Demo 1. Durability scope is limited to Postgres startup and init idempotency.

- [ ] **Failure mode: Postgres fails to start on first boot.** Given `embedded-postgres` cannot bind its port (port in use), when `init` is run, then the CLI emits a human-readable error naming the port conflict and exits with a non-zero code. The `projects` table must not be partially initialized.
- [ ] **Failure mode: init interrupted mid-schema-migration.** Given the schema migration is killed at an arbitrary statement, when Squadboard is restarted, then Drizzle migrations re-run from the last completed checkpoint and the DB reaches a consistent state without manual intervention.

### Engine invariants exercised

None — UI/init-only demo. No `workflow_runs` or `issue_runs` rows are created.

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (init + boot) | E2E (Playwright + child_process) | Kujan |
| Functional AC 2 (create project) | E2E (Playwright) | Kujan |
| Functional AC 3 (board columns) | E2E (Playwright) | Kujan |
| Functional AC 4 (idempotent init) | Integration (CLI harness) | Kujan |
| Durability AC 1 (port conflict) | Integration (process harness) | Kujan |
| Durability AC 2 (migration interrupted) | Durability (kill + restart harness) | Kujan |

---

## Demo 2 — The board works

**Goal:** Real kanban — drag, comment, filter, bulk-edit.

### Functional AC

- [ ] Given a project board with 3 columns and a card in column 1, when the user drags the card to column 3, then the card's `status` column in the `issues` table updates within 200ms and the card persists in column 3 after page reload.
- [ ] Given a card is open, when the user submits a comment containing a Mermaid diagram block, then the comment renders the diagram (not raw text) in the card thread within 500ms.
- [ ] Given a board with 10 cards across columns, when the user applies a label filter for label `'bug'`, then only cards with that label are visible, cards without it are hidden, and the filter state persists across page reload (URL-encoded or localStorage).
- [ ] Given a board with 5 cards, when the user selects 3 cards via bulk-select and changes their label to `'urgent'`, then all 3 `issues` rows have `labels` updated in a single DB transaction and the board reflects the change without individual card reloads.

### Durability AC

> No workflow engine in Demo 2. Durability scope = concurrent drag-drop writes.

- [ ] **Failure mode: two users drag the same card simultaneously.** Given two browser tabs both drag card X to different columns, when both drops land within the same 100ms window, then exactly one column assignment wins (last-write via optimistic concurrency token), the card is in a valid column in both views after WebSocket sync, and no `issues` row has `status=null`.

### Engine invariants exercised

None — UI-only demo.

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (drag-drop) | E2E (Playwright drag) | Kujan |
| Functional AC 2 (Mermaid comment) | E2E (Playwright) | Kujan |
| Functional AC 3 (filter + persist) | E2E (Playwright) | Kujan |
| Functional AC 4 (bulk-edit transaction) | Integration (DB assertion) | Kujan |
| Durability AC 1 (concurrent drag) | Durability (two-tab Playwright) | Kujan |

---

## Demo 3 — Squad onboarding

**Goal:** Discover agents from `.squad/agents/`, hire new ones, edit, disable.

### Functional AC

- [ ] Given a `.squad/agents/` directory with 3 agent subdirectories each containing a `history.md`, when the user opens the Agents page, then all 3 agents are listed with their names and roles parsed from `history.md` within 1 second of page load.
- [ ] Given the Agents page, when the user fills in the hire-agent form with name `'TestBot'` and role `'Tester'`, then a new `.squad/agents/testbot/history.md` file is created on disk with the correct content, and `'TestBot'` appears in the agent list without page reload.
- [ ] Given an existing agent `'TestBot'`, when the user edits its role to `'Reviewer'`, then the change is written to `.squad/agents/testbot/history.md` within 500ms and the Agents page reflects the new role.
- [ ] Given an existing agent `'TestBot'`, when the user disables it, then the agent is marked `disabled: true` in its history file, it no longer appears in assignee dropdowns, and it can be re-enabled from the Agents page.
- [ ] **File-as-source-of-truth contract:** Given a `.squad/agents/newagent/history.md` file is manually created on disk while Squadboard is running, when the user navigates to the Agents page, then `'newagent'` appears in the list without requiring a server restart.

### Durability AC

> No workflow engine in Demo 3. File I/O is the durability surface.

- [ ] **Failure mode: disk write fails mid-hire.** Given the filesystem is read-only when the user submits the hire-agent form, then the API returns a 500 with a user-readable message, no partial agent directory is created, and the Agents list is unchanged.

### Engine invariants exercised

None — file-system/UI-only demo.

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (discovery) | Integration (fs fixture + Playwright) | Kujan |
| Functional AC 2 (hire) | Integration (fs assertion) | Kujan |
| Functional AC 3 (edit) | Integration (fs assertion) | Kujan |
| Functional AC 4 (disable) | Integration (fs + UI assertion) | Kujan |
| Functional AC 5 (hot-discovery) | Integration (inotify/poll fixture) | Kujan |
| Durability AC 1 (disk write failure) | Integration (mock fs error) | Kujan |

---

## Demo 4 — One-shot agent

**Goal:** Pick an agent, click Run, watch it work in an isolated workspace.

### Functional AC

- [ ] Given an agent `'hockney'` is enabled and a card exists, when the user clicks Run and selects `'hockney'`, then an `issue_runs` row is created with `kind='agent_run'` and `status='running'`, and the card's status column shows a "Running" indicator within 2 seconds.
- [ ] Given an agent run is in progress, when the run completes successfully, then the `issue_runs` row has `status='completed'`, `completed_at` is non-null, the agent's output is stored in `output_json`, and the card moves to the "Done" column.
- [ ] Given a workspace strategy of `'worktree'`, when a run starts, then a git worktree is created at the expected path and no other running agent shares that path.
- [ ] Given a completed run, when the user opens the run detail drawer, then the full output (truncated to 100KB if necessary) and the wall-clock duration are displayed.

### Durability AC

- [ ] **[I-3: Lease/heartbeat] Failure mode: engine process is killed while an agent run is in progress.** Given an `issue_runs` row with `status='running'` and `lease_expires_at` set 90s in the future, when the engine process dies and is restarted after 95s (past lease expiry), then `reapByLease` marks the run `status='failed'` with `failure_reason='lease_expired'`, the workspace is cleaned up (worktree removed), and the issue card is no longer shown as "Running".
- [ ] **[I-3: Lease/heartbeat] Failure mode: agent worker stops heartbeating without dying.** Given an agent worker holds a run row and stops writing heartbeats for 90s, when the sweeper fires, then the run is reaped as expired, the next retry attempt (if `max_attempts > 1`) creates a new `issue_runs` row, and no orphaned workspace remains.
- [ ] **[I-1: agent_run is only LLM step] Contract:** Given a run is dispatched, when the stepper advances it, then the `issue_runs` row has `kind='agent_run'` — never `kind='peer_review'` or `kind='split'` for a one-shot run. The step executor invokes `SquadClient.createSession()` exactly once per run.
- [ ] **[I-4: Output schema validation] Failure mode: agent emits no structured output.** Given an agent run completes but returns no JSON-parseable output, when `sendAndWait` returns, then schema validation fires, the run is marked `status='failed'` with `failure_reason='output_schema_violation'`, and `recordRunCompletion` is NOT called with a `success` status.
- [ ] **Workspace isolation:** Given two agents run simultaneously, when both runs are in-flight, then each has its own workspace directory and no file write from run A appears in run B's workspace (verified by sentinel file absence check).

### Engine invariants exercised

- **I-1** — `agent_run` is the only LLM step
- **I-3** — Lease (90s TTL) + heartbeat (30s) is authoritative liveness
- **I-4** — Output schema validation at session end

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (run starts) | E2E (Playwright + DB assertion) | Kujan |
| Functional AC 2 (run completes) | Integration (synthetic agent) | Kujan |
| Functional AC 3 (workspace isolation) | Integration (fs assertion) | Kujan |
| Functional AC 4 (run detail drawer) | E2E (Playwright) | Kujan |
| Durability AC 1 (engine kill + reap) | Durability (process kill harness) | Kujan |
| Durability AC 2 (heartbeat stop) | Durability (fake clock + synthetic agent) | Kujan |
| Durability AC 3 (I-1 kind assertion) | Integration (DB assertion) | Kujan |
| Durability AC 4 (I-4 no output) | Integration (synthetic agent, null output) | Kujan |
| Durability AC 5 (workspace isolation) | Integration (parallel run harness) | Kujan |

---

## Demo 5 — Routing tier 1

**Goal:** Auto-assign cards via deterministic `.squad/routing.md` rules.

### Functional AC

- [ ] Given a `.squad/routing.md` with a rule `IF labels CONTAINS 'backend' THEN assign hockney`, when a card with label `'backend'` is created, then the card's `assignee` field is set to `'hockney'` within 1 second and without user interaction.
- [ ] Given a `.squad/routing.md` with two rules where rule 1 matches and rule 2 also matches, when a card is created, then only rule 1's assignment is applied (first-match-wins), and the routing decision is logged to the `routing_log` table (or equivalent).
- [ ] Given a card that matches no routing rule, when the card is created, then it remains unassigned, no error is thrown, and the card appears in the Backlog column.
- [ ] Given a `.squad/routing.md` that is syntactically invalid, when Squadboard starts, then it logs a parse error at boot and all cards remain unassigned (no crash, no silent mis-routing).

### Durability AC

> Routing tier 1 is deterministic rule evaluation with no LLM or long-running workflow step. Durability scope is limited to rule-evaluation atomicity.

- [ ] **Failure mode: server crashes between card creation and routing evaluation.** Given a card is inserted in `issues` but the routing worker has not yet evaluated it, when the server restarts, then the pending-routing queue is replayed and the card receives the correct assignment within 5 seconds of restart.

### Engine invariants exercised

None directly — tier-1 routing is pre-LLM, deterministic rule evaluation. No `agent_run` steps are created.

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (rule match + assign) | Integration (routing fixture) | Kujan |
| Functional AC 2 (first-match-wins) | Unit (routing engine) | Kujan |
| Functional AC 3 (no match = unassigned) | Integration | Kujan |
| Functional AC 4 (invalid routing.md) | Integration (boot test) | Kujan |
| Durability AC 1 (crash before routing) | Durability (kill + restart harness) | Kujan |

---

## Demo 6 — First workflow

**Goal:** YAML workflows with the bundled `simple` template (route → run → approve).

### Functional AC

- [ ] Given the bundled `simple` workflow template is applied to a project and a card is created, when the workflow engine starts, then the card advances through all three steps (route → agent_run → approve) in order, each step creates an `issue_runs` row with the correct `kind`, and the final step sets `workflow_runs.status='completed'`.
- [ ] Given a workflow YAML with a step declaring `max_attempts: 3` and `backoff_ms: 500`, when the agent_run step fails on attempts 1 and 2, then a new `issue_runs` row is created for each retry with `attempt_number` incremented, the retry fires after `backoff_ms` delay (±100ms), and the third attempt is used.
- [ ] Given a completed workflow run, when the user opens the workflow timeline view, then all step rows are visible with their start/end timestamps and statuses in chronological order.

### Durability AC

- [ ] **[I-2: Single-spawner] Failure mode: two stepper instances race the same `workflow_runs` row.** Given two stepper workers both poll for ready steps at the same instant, when `FOR UPDATE SKIP LOCKED` is applied, then only one worker acquires the row, the other skips it, and the step is advanced exactly once — verified by the `issue_runs` row count being exactly 1 for that step.
- [ ] **[I-3: Lease/heartbeat] Failure mode: engine crash mid-workflow.** Given a workflow is on step 2 of 3 and the engine is killed, when the engine restarts after lease expiry, then `reapByLease` picks up the stale step, retries it (if `max_attempts > 1`), and the workflow eventually reaches `status='completed'` without re-running step 1.
- [ ] **[I-1: agent_run is only LLM step] Contract:** Given the `simple` workflow template, when inspecting all `issue_runs` rows created for a run, then every row that invokes `SquadClient.createSession()` has `kind='agent_run'`, and no other `kind` value invokes the LLM.
- [ ] **[I-4: Output schema validation] Failure mode: agent output fails schema check.** Given the route step's agent emits output that does not conform to the declared output schema, when `sendAndWait` returns, then the step is marked `failed` with `failure_reason='output_schema_violation'` before `recordRunCompletion` is invoked, and the workflow does not advance to the next step.

### Engine invariants exercised

- **I-1** — `agent_run` is the only LLM step
- **I-2** — Single-spawner via `FOR UPDATE SKIP LOCKED`
- **I-3** — Lease (90s TTL) + heartbeat (30s)
- **I-4** — Output schema validation at session end

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (full workflow advance) | Integration (synthetic agents) | Kujan |
| Functional AC 2 (retry policy) | Integration (fake-fail synthetic agent) | Kujan |
| Functional AC 3 (timeline view) | E2E (Playwright) | Kujan |
| Durability AC 1 (I-2 race condition) | Durability (two-stepper harness) | Kujan |
| Durability AC 2 (I-3 crash + resume) | Durability (kill + restart harness) | Kujan |
| Durability AC 3 (I-1 kind assertion) | Integration (DB assertion) | Kujan |
| Durability AC 4 (I-4 schema violation) | Integration (synthetic agent, bad output) | Kujan |

---

## Demo 7 — Resilience + cost

**Goal:** Survive engine crashes; show live per-run cost.

### Functional AC

- [ ] Given a run is in progress displaying cost, when the cost tracker emits a new `CostEvent`, then the per-run cost display in the card drawer updates within 2 seconds via WebSocket push (no page reload required).
- [ ] Given a completed run, when the user opens the run detail, then total cost (in USD, 4 decimal places) is displayed and matches the sum of all `cost_events` rows for that `issue_run_id`.
- [ ] Given a run has a configured budget cap (`budget_usd`), when the run's cumulative cost exceeds the cap, then the run is paused (status transitions to `'budget_paused'`), the user sees a "Budget exceeded" banner on the card, and no further LLM calls are made for that run.

### Durability AC

- [ ] **[I-3: Lease/heartbeat] Failure mode: engine process is SIGKILL'd while 3 runs are simultaneously in progress.** Given 3 `issue_runs` rows with `status='running'` and valid leases, when the engine is killed with SIGKILL and restarted after all 3 leases expire (95s), then `reapByLease` transitions all 3 to `status='failed'` or `status='retry_pending'` (per their `on_exhausted` config), none remain stuck in `status='running'`, and all 3 workspaces are cleaned up.
- [ ] **[I-2: Single-spawner] Failure mode: dispatcher attempts to spawn a run.** Given the dispatcher receives a "wake" event for an issue, when the dispatcher's code path is traced, then it does NOT insert into `issue_runs` directly — the stepper is the sole inserter. This is verified by asserting that `issue_runs` inserts only occur from the stepper code path (integration test with DB insert instrumentation).
- [ ] **[I-3: Lease/heartbeat] Sweeper coverage:** Given `reapByLease`, `reapByPidOwnPod`, `applyTimeouts`, and `checkBudgets` sweepers are all registered, when each sweeper fires in isolation against a synthetic stale row, then each transitions the target row to the expected terminal/retry state within one sweep cycle.

### Engine invariants exercised

- **I-2** — Single-spawner (dispatcher must NOT touch `issue_runs`)
- **I-3** — Lease (90s TTL) + heartbeat (30s)

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (live cost update) | E2E (Playwright + WS assertion) | Kujan |
| Functional AC 2 (cost total) | Integration (DB assertion) | Kujan |
| Functional AC 3 (budget cap pause) | Integration (synthetic agent + cost fixture) | Kujan |
| Durability AC 1 (SIGKILL 3 runs) | Durability (process kill harness) | Kujan |
| Durability AC 2 (I-2 dispatcher isolation) | Integration (DB insert instrumentation) | Kujan |
| Durability AC 3 (sweeper coverage) | Integration (sweeper unit + synthetic rows) | Kujan |

---

## Demo 8 — Routing tiers 2+3

**Goal:** matchRoute fallback + LLM specifier + human triage.

### Functional AC

- [ ] Given a card that matches no tier-1 rule, when `matchRoute` is evaluated and returns agent `'kobayashi'`, then the card is assigned to `'kobayashi'` and a `routing_log` row is created with `tier=2` and the matched pattern.
- [ ] Given a card that matches no tier-1 or tier-2 rule, when the tier-3 specifier agent is invoked, then an `issue_runs` row is created with `kind='specifier_run'` (desugared from tier-3 routing), `SquadClient.createSession()` is called exactly once, and the agent's assignment decision is written back to the card's `assignee` field.
- [ ] Given a card that no routing tier can assign, when all tiers are exhausted, then the card transitions to a "Needs Triage" state visible in the board UI, and the user can manually assign it from the triage queue.

### Durability AC

- [ ] **[I-1: agent_run is only LLM step] Contract for tier-3 routing.** Given the tier-3 specifier fires, when inspecting the `issue_runs` row, then `kind` is `'specifier_run'` (a distinct `agent_run` variant), and `SquadClient.createSession()` is called from the agent executor — not from the dispatcher or router code paths.
- [ ] **[I-3: Lease/heartbeat] Failure mode: tier-3 specifier agent crashes mid-routing.** Given a tier-3 specifier agent holds a lease and its process dies, when the lease expires and `reapByLease` fires, then the routing step is retried (if `max_attempts > 1`), the card does NOT remain stuck in "Routing" state indefinitely, and the retry creates a fresh `issue_runs` row with `attempt_number` incremented.
- [ ] **[I-4: Output schema validation] Failure mode: tier-3 specifier emits unparseable assignment.** Given the specifier agent returns output that cannot be parsed as a valid agent assignment, when schema validation fires after `sendAndWait`, then the step fails with `failure_reason='output_schema_violation'` and the card is queued for human triage rather than silently mis-assigned.

### Engine invariants exercised

- **I-1** — Tier-3 routing desugars to `agent_run` (kind=`'specifier_run'`)
- **I-3** — Lease/heartbeat on specifier run
- **I-4** — Output schema validation on specifier output

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (tier-2 matchRoute) | Integration (routing fixture) | Kujan |
| Functional AC 2 (tier-3 specifier) | Integration (synthetic specifier agent) | Kujan |
| Functional AC 3 (human triage fallback) | E2E (Playwright) | Kujan |
| Durability AC 1 (I-1 kind for tier-3) | Integration (DB assertion) | Kujan |
| Durability AC 2 (I-3 specifier crash) | Durability (kill harness) | Kujan |
| Durability AC 3 (I-4 bad specifier output) | Integration (synthetic agent, bad output) | Kujan |

---

## Demo 9 — Peer review

**Goal:** N-of-M quorum, 4-verb approvals, threaded audit trail.

### Functional AC

- [ ] Given a `peer_review` step configured with `quorum: { n: 2, of: 3 }` and 2 reviewers approving out of 3 assigned, when the second approval lands, then the `peer_review` step transitions to `status='approved'` and the workflow advances to the next step — without waiting for the third reviewer.
- [ ] Given a peer review step with 1 reviewer configured and `request_changes_policy: 'first'`, when that reviewer submits "Request changes", then the step transitions to `status='changes_requested'`, the workflow does NOT advance, and the submitting agent re-enters a revision cycle.
- [ ] Given a peer review step, when the user opens the audit trail, then all 4 verb actions (approve, reject, request_changes, comment) are recorded in the `review_events` table with reviewer identity, timestamp, and body text, in insertion order.
- [ ] **Reviewer lockout:** Given reviewer `'kujan'` is the author of the work under review, when the peer review step is configured with `exclude_author: true`, then `'kujan'` does not appear in the assignable reviewers list and cannot submit a review verb.

### Durability AC

- [ ] **[I-1: peer_review desugars to agent_run] Contract.** Given a `peer_review` step fires, when inspecting the `issue_runs` row for the review agent, then `kind='peer_review'` (a distinct `agent_run` desugar variant), and `SquadClient.createSession()` is called from the agent executor code path — not the review orchestrator.
- [ ] **[I-3: Lease/heartbeat] Failure mode: review agent crashes mid-review.** Given a review agent holds a lease on a `peer_review` issue_run and its process dies, when `reapByLease` fires after 90s, then the review step is retried if `attempt_number < max_attempts`, the partial review vote is not double-counted, and the quorum calculation remains correct.
- [ ] **Quorum atomicity:** Given N-of-M votes are submitted within the same 50ms window (concurrent reviewer submissions), when the DB applies both, then the quorum check is evaluated exactly once (via a `SELECT ... FOR UPDATE` on the review step row), the step transitions to `status='approved'` exactly once, and no duplicate "advance workflow" signal is emitted.

### Engine invariants exercised

- **I-1** — `peer_review` desugars to an `issue_runs` row with distinct kind
- **I-3** — Lease/heartbeat on review agent runs

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (N-of-M quorum) | Integration (synthetic reviewers) | Kujan |
| Functional AC 2 (request_changes_policy) | Integration | Kujan |
| Functional AC 3 (audit trail) | Integration (DB assertion) | Kujan |
| Functional AC 4 (reviewer lockout) | Integration + E2E | Kujan |
| Durability AC 1 (I-1 kind desugar) | Integration (DB assertion) | Kujan |
| Durability AC 2 (I-3 review agent crash) | Durability (kill harness) | Kujan |
| Durability AC 3 (quorum atomicity) | Durability (concurrent submission harness) | Kujan |

---

## Demo 10 — Fan-out + handoff

**Goal:** Subtask splitting, isolated worktrees, subtree pause/resume.

### Functional AC

- [ ] Given a `fan_out` step with 3 child tasks defined, when the step fires, then exactly 3 child `workflow_runs` rows exist in the DB, each with its own `issue` row, `first step_run` row, `issue_link` row, `handoff_context` row, and `variables` propagated from the parent — all created atomically (verified by transaction log showing a single commit).
- [ ] Given 3 child runs are in flight, when the user clicks "Pause subtree" on the parent card, then all 3 child `workflow_runs` rows transition to `status='paused'` within 2 seconds and no new LLM calls are initiated for those children.
- [ ] Given a paused subtree, when the user clicks "Resume subtree", then all 3 child runs resume from their last completed step (not from the beginning), and the parent workflow remains in `status='waiting_for_children'` until all children complete.
- [ ] Given 3 child runs where 2 succeed and 1 fails (exhausting retries), when the parent evaluates the `on_child_failure` policy, then the parent either proceeds (if policy=`'continue'`) or fails itself (if policy=`'fail_fast'`), and the final parent status reflects the policy outcome.

### Durability AC

- [ ] **[I-5: fan_out six-step transaction] Failure mode: engine crashes between step 3 and step 4 of the fan_out materialization transaction.** Given a `fan_out` step begins materializing 3 children and the engine is killed after `issue + workflow_run + first step_run` are written but before `issue_link + handoff_context + variables` are written, when the engine restarts, then the incomplete transaction is rolled back (Postgres guarantees atomicity), a fresh fan_out materialization is retried, and exactly 3 fully-formed children are created — no partial orphan rows.
- [ ] **[I-5: pinnedAgentRevisions inheritance] Contract.** Given a parent `workflow_run` has `pinnedAgentRevisions = { hockney: 'abc123' }`, when a `fan_out` step materializes 3 children, then all 3 child `workflow_runs` rows have the same `pinnedAgentRevisions` value — verified by DB assertion immediately after transaction commit.
- [ ] **[I-2: Single-spawner] Fan-out spawning discipline.** Given a `fan_out` step fires, when the materialization is inspected, then all 3 child `workflow_runs` rows are inserted by the stepper code path (not the dispatcher), verified by `pg_stat_activity` or application-level insert tracing.
- [ ] **Workspace isolation under fan-out:** Given 3 fan-out children with workspace strategy `'worktree'`, when all 3 are running simultaneously, then each has its own distinct git worktree path, and no two children share a worktree (verified by `git worktree list` output and sentinel file absence).

### Engine invariants exercised

- **I-1** — Each child's agent_run step is the only LLM step
- **I-2** — Single-spawner for child materialization
- **I-3** — Lease/heartbeat on each child run
- **I-5** — fan_out materializes full children in one six-step transaction; children inherit `pinnedAgentRevisions`

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (atomic materialization) | Integration (DB transaction assertion) | Kujan |
| Functional AC 2 (pause subtree) | Integration + E2E | Kujan |
| Functional AC 3 (resume from checkpoint) | Integration (synthetic agents) | Kujan |
| Functional AC 4 (child failure policy) | Integration (synthetic fail agent) | Kujan |
| Durability AC 1 (I-5 crash mid-tx) | Durability (kill-mid-transaction harness) | Kujan |
| Durability AC 2 (I-5 pinnedAgentRevisions) | Integration (DB assertion) | Kujan |
| Durability AC 3 (I-2 spawner discipline) | Integration (insert trace) | Kujan |
| Durability AC 4 (workspace isolation) | Integration (fs + git assertion) | Kujan |

---

## Demo 11 — Workflow editor

**Goal:** Monaco YAML + React Flow viz + templates gallery + versioning.

### Functional AC

- [ ] Given the workflow editor is open with a valid YAML workflow, when the user edits a step name in Monaco, then the React Flow graph updates the node label within 500ms (live sync, no save required).
- [ ] Given a syntactically invalid YAML workflow in Monaco, when the user pauses typing for 500ms, then a JSON Schema validation error is displayed inline in Monaco (red squiggle + error message) without requiring a save.
- [ ] Given the templates gallery with 3 bundled templates (e.g., `simple`, `fan-out-review`, `auto-approve`), when the user selects a template, then the editor is pre-populated with the template YAML, and the React Flow graph renders the correct step topology.
- [ ] Given a workflow with 2 saved versions, when the user selects version 1 from the version picker, then the editor and graph render version 1's YAML, and saving creates version 3 (not overwrites version 2).

### Durability AC

> Demo 11 is a UI-only editor. Durability scope is limited to save-on-conflict behavior.

- [ ] **Failure mode: concurrent edit conflict on workflow save.** Given two users both open the same workflow YAML in separate tabs, when both submit saves within 50ms of each other, then the second save receives a 409 Conflict response with the current version's content, the first save succeeds, and no version is silently overwritten.

### Engine invariants exercised

None — workflow editor is a UI-only authoring tool. Engine does not run workflows during editing.

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (live YAML→graph sync) | E2E (Playwright) | Kujan |
| Functional AC 2 (schema validation inline) | E2E (Playwright) | Kujan |
| Functional AC 3 (templates gallery) | E2E (Playwright) | Kujan |
| Functional AC 4 (versioning) | Integration (API assertion) | Kujan |
| Durability AC 1 (concurrent save conflict) | Integration (two-client race harness) | Kujan |

---

## Demo 12 — Multi-user + Live ops

**Goal:** GitHub OAuth, WebSocket fan-out, Live ops view, inbox.

### Functional AC

- [ ] Given GitHub OAuth is configured, when a user completes the OAuth flow, then a session cookie is set, the user's GitHub login is stored in the `users` table, and they are redirected to the board without re-authenticating for 24 hours.
- [ ] Given 2 browser tabs are connected via WebSocket to the same project, when run A's status changes, then both tabs receive the update event within 500ms of the DB write (verified by WebSocket message timestamp vs DB `updated_at`).
- [ ] Given the Live ops view, when 5 agent runs are active simultaneously, then the header summary strip shows the correct running/queued/failed counts, and the active-runs grid displays all 5 with live heartbeat indicators — all updating in real time without page reload.
- [ ] Given a WebSocket client disconnects and reconnects with `since-id=<last_seen_event_id>`, when reconnected, then the client receives all events that occurred during the disconnection window (no gaps), and no event is delivered twice (no duplicates).
- [ ] Given the inbox, when an agent run completes with `status='completed'`, then an inbox notification is created for the project owner and visible in the inbox UI within 2 seconds.

### Durability AC

- [ ] **[I-2: Single-spawner under concurrent access] Failure mode: two OAuth users simultaneously trigger the same workflow step.** Given two authenticated users both click "Run" on the same card within 100ms, when both requests hit the stepper, then `FOR UPDATE SKIP LOCKED` ensures only one `issue_runs` row is created for that step, and the second request receives a 409 or is silently dropped — the card is in `status='running'` exactly once.
- [ ] **WebSocket reconnect cursor durability:** Given the WebSocket server is restarted, when a client reconnects with its last `since-id`, then the event fan-out resumes from that cursor position — no events are lost and the client does not receive events from before its cursor.

### Engine invariants exercised

- **I-2** — Single-spawner under concurrent multi-user access

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (GitHub OAuth) | E2E (Playwright OAuth mock) | Kujan |
| Functional AC 2 (WS fan-out, 2 tabs) | E2E (two-tab Playwright) | Kujan |
| Functional AC 3 (Live ops view) | E2E (Playwright + synthetic runs) | Kujan |
| Functional AC 4 (since-id reconnect) | Integration (WS client harness) | Kujan |
| Functional AC 5 (inbox notification) | Integration + E2E | Kujan |
| Durability AC 1 (I-2 concurrent run click) | Durability (two-client race harness) | Kujan |
| Durability AC 2 (WS cursor durability) | Durability (server restart harness) | Kujan |

---

## Demo 13 — Dashboards

**Goal:** Agent leaderboard, cost burn, workflow funnel, burndown — all from existing tables.

### Functional AC

- [ ] Given a project with 10,000 issues (seeded), when the agent leaderboard chart is loaded, then it renders in under 2 seconds with correct top-5 agents by completed runs (verified by DB count query comparison).
- [ ] Given a project with 500 completed runs with cost events, when the cost burn chart is loaded, then it shows cumulative USD cost over time, bucketed by day, with the correct total (sum of all `cost_events.amount_usd` for the project).
- [ ] Given a project with runs at each workflow stage, when the workflow funnel chart is loaded, then each stage shows the correct count of runs that entered and exited it (no double-counting of retried steps).
- [ ] Given a project with a sprint milestone, when the burndown chart is loaded, then it shows remaining open issues per day with a trend line, and the data matches a hand-calculated count from `issues` table for 3 sampled dates.
- [ ] Given all 4 dashboard charts, when the page loads on a 10k-issue project, then the total page render time (all charts painted) is under 2 seconds on a machine with `embedded-postgres` running locally (measured via Playwright performance API).

### Durability AC

> Dashboards are read-only queries against existing tables. No engine workflow runs during demo 13. No durability ACs required.

### Engine invariants exercised

None — read-only analytics from existing tables. No engine workflow execution.

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (leaderboard < 2s) | E2E (Playwright perf + DB seed) | Kujan |
| Functional AC 2 (cost burn correctness) | Integration (DB assertion) | Kujan |
| Functional AC 3 (funnel no double-count) | Integration (DB assertion) | Kujan |
| Functional AC 4 (burndown accuracy) | Integration (spot-check vs DB) | Kujan |
| Functional AC 5 (full render < 2s) | E2E (Playwright performance API) | Kujan |

---

## Demo 14 — MCP + slash command

**Goal:** `engine_*` tools, idempotent creates, `/squadboard` CLI.

### Functional AC

- [ ] Given Squadboard is running with the MCP server bound to localhost TCP, when an agent calls `engine_create_issue` via MCP with `idempotency_key='k1'`, then an `issues` row is created with `idempotency_key='k1'` and the tool returns `{ created: true, id: <uuid> }`.
- [ ] Given the same `engine_create_issue` call is replayed 10 times with `idempotency_key='k1'`, when all 10 calls complete, then exactly 1 row exists in `issues` with `idempotency_key='k1'`, and all 10 calls return `{ created: false, id: <same-uuid> }` for replay calls (or `true` only for the first).
- [ ] Given the `/squadboard` CLI command, when the user runs `/squadboard status`, then the command prints the number of active runs, pending issues, and the engine uptime — sourced from the live Squadboard API (not a static stub).
- [ ] Given an `engine_run_workflow` MCP call referencing a non-existent workflow template, when the call is processed, then the tool returns a structured error `{ error: 'workflow_not_found', name: '<template>' }` and no `workflow_runs` row is created.

### Durability AC

- [ ] **[I-2: Single-spawner via MCP] Failure mode: two agents simultaneously call `engine_create_issue` with the same idempotency key.** Given two concurrent MCP calls land within 10ms of each other with `idempotency_key='race-k1'`, when both are processed, then the Postgres `partial unique index on (idempotency_key) WHERE idempotency_key IS NOT NULL` ensures exactly 1 row is created, and the losing call receives a non-error response with `{ created: false, id: <same-uuid> }` — no 500 error, no duplicate row.
- [ ] **[I-1: agent_run is only LLM step] MCP tool contract.** Given an agent calls `engine_run_step` which triggers an `agent_run`-kind step, when the MCP tool completes, then the `issue_runs` row has `kind='agent_run'` and `SquadClient.createSession()` was called exactly once — verified by CostTracker event count (1 session start event).

### Engine invariants exercised

- **I-1** — MCP-triggered steps must use `agent_run` kind for LLM work
- **I-2** — Idempotent creates are single-spawner safe (partial unique index)

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (create via MCP) | Integration (MCP client harness) | Kujan |
| Functional AC 2 (10x replay idempotency) | Integration (replay harness) | Kujan |
| Functional AC 3 (/squadboard status) | Integration (CLI + API) | Kujan |
| Functional AC 4 (not-found error shape) | Integration (MCP client harness) | Kujan |
| Durability AC 1 (I-2 concurrent idempotent create) | Durability (concurrent MCP race harness) | Kujan |
| Durability AC 2 (I-1 MCP kind assertion) | Integration (DB + CostTracker assertion) | Kujan |

---

## Demo 15 — GitHub sync

**Goal:** Push PRs, post check runs, ingest Issues via webhook.

### Functional AC

- [ ] Given a Squadboard issue with a linked `workflow_run` that has completed, when the user clicks "Push to GitHub", then a branch is created on the remote, a PR is opened with the issue title and body, and the `issues` row is updated with `github_pr_number` within 5 seconds.
- [ ] Given a GitHub Actions workflow run linked to a Squadboard workflow, when the `engine_*` step completes, then a GitHub check run is posted (status `completed`, conclusion `success` or `failure`) to the correct SHA within 10 seconds of `recordRunCompletion`.
- [ ] Given a GitHub webhook is configured pointing to Squadboard's `/webhooks/github` endpoint, when a new GitHub Issue is opened in the linked repository, then a corresponding Squadboard `issues` row is created within 5 seconds of webhook delivery, with `source='github'` and `github_issue_number` set.
- [ ] Given GitHub API rate limits are hit (HTTP 429 + `Retry-After` header), when the GitHub adapter receives the response, then it enqueues the pending push/check-run call and retries after `Retry-After` seconds — no data loss, no crash.

### Durability AC

- [ ] **Webhook cursor durability:** Given the Squadboard engine has ingested 100 webhook events (cursor at event 100), when the engine is restarted, then on reconnect the webhook listener resumes from cursor position 100, no previously ingested events are re-processed (no duplicate issues), and no events 101+ are dropped.
- [ ] **Failure mode: PR push fails mid-branch-creation (GitHub API error after branch push, before PR open).** Given the branch is created but the PR API call returns 500, when the adapter retries, then the branch is not duplicated (idempotent branch push) and the PR is opened on retry — the `issues` row does not end up with two GitHub branches.

### Engine invariants exercised

None directly — GitHub sync is an adapter/integration layer. The engine invariants governing workflow execution (I-1 through I-5) are tested in earlier demos; Demo 15 tests the GitHub seam.

> Note: If any sync step triggers a new workflow (e.g., auto-workflow on issue ingest), then I-1, I-2, I-3 apply and must be covered by those workflow's existing tests.

### Test type mapping

| AC | Test type | Owner |
|----|-----------|-------|
| Functional AC 1 (push to GitHub PR) | Integration (GitHub API mock) | Kujan |
| Functional AC 2 (check run posted) | Integration (GitHub API mock) | Kujan |
| Functional AC 3 (webhook → issue ingest) | Integration (webhook POST fixture) | Kujan |
| Functional AC 4 (rate limit backoff) | Integration (GitHub 429 mock) | Kujan |
| Durability AC 1 (webhook cursor survives restart) | Durability (kill + restart harness) | Kujan |
| Durability AC 2 (idempotent PR push) | Integration (retry simulation) | Kujan |

---

## Summary: Invariant coverage across 15 demos

| Invariant | Demos that exercise it |
|-----------|----------------------|
| **I-1** `agent_run` only LLM step | 4, 6, 8, 9, 10, 14 |
| **I-2** Single-spawner (`FOR UPDATE SKIP LOCKED`) | 4, 6, 7, 10, 12, 14 |
| **I-3** Lease (90s) + heartbeat (30s) | 4, 6, 7, 8, 9, 10, 14 |
| **I-4** Output schema validation at session end | 4, 6, 8 |
| **I-5** fan_out/split six-step transaction | 10 |

**Most-tested invariants: I-2 and I-3** (6–7 demos each). They require real clock control or process-kill harnesses — these are the hardest to exercise reliably in CI.

**Demos with durability ACs:** 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15 — **11 demos**
**Demos with functional ACs only:** 1, 2, 3, 13 — **4 demos** (UI/init/read-only)
