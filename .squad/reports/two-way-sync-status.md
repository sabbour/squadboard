# Squad ↔ Squadboard Two-Way Sync Status — Dogfood Loop

**Author:** McManus
**Timestamp:** 2026-05-19T14:47:51.758-07:00
**Overall status:** Partial

## Executive read

The dogfood loop is real but not closed. The board, filesystem, MCP capture, Scribe close-out, workflow events, and PostgreSQL-backed Squad state all have working implementation slices and focused tests. The gaps are architectural: several surfaces are one-way or one-time import paths, live coordinator capture is not yet proven in production sessions, and the current shared worktree still has in-flight fixes that need close-out before the coordinator treats them as stable.

Focused validation passed in this worktree: 7 server test files, 97 tests. The suite covered agent-sync retirement safety, project `.squad/` structure, directive capture parity, PostgreSQL storage provider behavior, and the PGlite `issue_runs` claim/catalog repair.

## Do not duplicate these in-flight lanes

- **Kobayashi:** cast/hired agents must stay active. The fix pattern is present in `agent-sync.ts`, and the focused regression now passes here, but the lane is still in-flight until merged/closed.
- **Kujan:** regression coverage for the retired-agent bug and project-create root-pollution invariant. Kujan's earlier red note is superseded by the current focused green run, but the ownership remains Kujan for sign-off.
- **Hockney:** PGlite `issue_runs` sweep/catalog repair, PostgreSQL provider launch/config, and `npm start` service fan-out are already Hockney-owned.

## Surface status

### 1. Filesystem `.squad/` state ↔ Squadboard project/team/agent APIs and DB

**Status:** Partial

**Evidence**
- `projects.path` stores the linked `.squad/` directory.
- `project-squad.ts` links projects to `.squad/` and reads `team.md`, `decisions.md`, and decision inbox filenames.
- `agent-sync.ts` scans `.squad/agents/`, uses SDK + filesystem union discovery, upserts DB agents, and only retires reliably absent rows.
- `sdk-state.ts` and `postgresql-storage-provider.ts` provide a `squad_storage` DB-backed Squad SDK `StorageProvider`.
- Focused provider tests passed, including first-run import from filesystem `.squad/`.

**Blockers / risks**
- DB mode imports existing filesystem files when the scoped table is empty, but this is not a continuous two-way mirror.
- Files written directly under `.squad/` after DB mode starts are not automatically reconciled unless the caller is on the filesystem path or a specific sync service handles that surface.
- Stale decision inbox notes still describe older PGlite/FS defaults; the current code/tests make PostgreSQL/PGlite-backed DB storage the default unless `fs` or a non-canonical value is selected.

**Next action**
- Publish one source-of-truth rule per mode: `postgresql` mode owns state in `squad_storage` after import; `fs` mode owns real `.squad/` files. Add a provider parity test that writes through one path and verifies the expected non-sync behavior is explicit.

### 2. Team casting / hire flow and “agents show retired”

**Status:** Partial

**Evidence**
- `routes/agents.ts` writes hire-team confirmed agents to `.squad/agents/<name>/charter.md`, `.squad/agents/<name>/history.md`, and active DB rows.
- `agent-sync.ts` now treats SDK + filesystem discovery as complementary, reactivates retired rows when a charter is present, and avoids retirement on transient read/parse failures.
- `agent-sync-retired-regression.test.ts` and `agent-sync-safety.test.ts` passed in the focused suite.
- `.squad/team.md` still lists Kobayashi and Kujan as active; decision inbox entries show this lane is already owned.

**Blockers / risks**
- The fix is not yet cleanly closed in the shared worktree.
- Missing browser/e2e coverage for “confirm hire team → reopen Agents page → agents remain Active and runnable.”

**Next action**
- Let Kobayashi/Kujan finish the lane. Add one end-to-end UI test around hire-team confirm + fresh agent list before marking stable.

### 3. Project creation / setup lifecycle and `.squad` root-pollution bug

**Status:** Partial

**Evidence**
- `routes/squad.ts` creates projects by making `<parent>/<project>/.squad`.
- `setup-lifecycle.ts` writes `agents/`, `casting/`, `decisions/`, `log/`, `orchestration-log/`, `skills/`, `team.md`, `routing.md`, `decisions.md`, and `ceremonies.md` under `squadPath`.
- `squad-create-structure.test.ts` passed and asserts those children never appear as project-root siblings.
- `ProjectPicker.tsx` previews create paths ending in `/.squad/`; template apply uses the provided `.squad` path.

**Blockers / risks**
- The direct `POST /api/squad/create` invariant is covered; template apply/import and full UI flows still need equivalent assertions.
- Bundle apply creates DB project/team state before filesystem scaffold; a scaffold failure can leave partial DB state.

**Next action**
- Add template/apply and browser-path regression coverage. If scaffold fails after DB apply, either transactionally roll back DB sections or report a repairable partial state.

### 4. Decisions inbox, `decisions.md`, orchestration logs, session logs, histories, health reports

**Status:** Partial

**Evidence**
- `.squad/reports/wave-30-sdk-logs-orchlogs.md` documents Scribe generation for `.squad/orchestration-log/` and `.squad/log/`.
- `scribe-closeout.ts` invokes SDK close-out, writes metadata under `.squad/reports/`, and can issue a close-out directive capture.
- `project-squad.ts` reads `decisions.md` plus decision inbox filenames into project context.
- Recent health/log artifacts exist for storage and PGlite work.

**Blockers / risks**
- Logs, histories, health reports, and orchestration logs are filesystem artifacts first. They are not fully indexed as board objects or DB records.
- Decision inbox merge state is visible, but pending inbox volume is high and can drift from board status.

**Next action**
- Add an artifact index/status API for `.squad/{decisions,inbox,log,orchestration-log,health,reports,agents/*/history.md}` so the board can report freshness without pretending these artifacts are DB-owned.

### 5. `docs/features` + `docs/bugs` backlog ↔ Squadboard board/status surfaces

**Status:** Partial

**Evidence**
- Backlog status currently sees one feature: Common PostgreSQL Storage Provider.
- Backlog status currently sees one bug: PGlite ready-workflow-step sweep failure, fixed in the working tree.
- Local coordinator state still has additional in-flight items for retired agents, project root pollution, and startup services.

**Blockers / risks**
- There is no durable proof that every docs feature/bug has a board card, or that board completion updates the docs artifact.
- Status tooling can read docs and pending inbox, but capture/done symmetry is not guaranteed.

**Next action**
- Choose authority: either docs are source and board cards are generated with stable IDs, or board is source and docs are generated reports. Until then, status tools should mark this surface Partial.

### 6. MCP capture/status flow and capture/done symmetry

**Status:** Partial

**Evidence**
- `mcp/server.ts` implements `capture`, idempotency keys, issue creation for `hint: issue`, and `done:` close-out via fuzzy title matching.
- `directive-capture.ts` writes decision inbox markdown, creates a DB inbox row, and best-effort calls MCP capture with fail-open auditing.
- `routes/inbox.ts` exposes `POST /api/inbox/directive-captures`.
- `directive-capture.test.ts` passed, including close-out prompts and fail-open MCP behavior.
- `scribe-closeout.ts` can capture a close-out directive.

**Blockers / risks**
- Prior dogfood audit found no live coordinator evidence that MCP capture was actually called for real work. The new parity endpoint exists, but live usage still needs proof.
- There is no single user-facing capture status ledger that pairs intake capture, board card, close-out capture, and Scribe metadata.

**Next action**
- Make `captureDirective()` / `POST /api/inbox/directive-captures` the mandatory coordinator seam for work directives. Record returned board IDs in Scribe close-out metadata and display paired intake/close-out status.

### 7. Workflow engine runs, `issue_runs`, step runs, event logs, live UI/WebSocket state

**Status:** Partial

**Evidence**
- Schema has `issue_runs`, `workflow_runs`, `step_runs`, `live_session_events`, and `issue_run_events`.
- `routes/runs.ts` creates and lists runs, rejects disabled/retired agents, emits run events, and stores Git/PR state.
- `ws-server.ts` fans event bus updates to project/global subscribers at `/api/ws`.
- `useRealtimeBoard.ts` updates issue caches and invalidates run/workflow queries on WS events.
- Focused PGlite run-claim/catalog repair tests passed.

**Blockers / risks**
- The product does not expose tables named `workflow_step_runs` or `event_log`; the implemented equivalents are `step_runs`, `issue_run_events`, and `live_session_events`. Any external status/reporting contract should use canonical current names or add compatibility views.
- Need a single integration test that advances a workflow step, records issue-run events, and observes the live UI/WebSocket cache update.

**Next action**
- Document the canonical run/event model and add a “run to event to UI” smoke test.

### 8. GitHub issues/PR/workflows integration and local-only/no-remote limits

**Status:** Partial

**Evidence**
- `github-git-ops.ts` implements push branch, PR creation, PR merge, comments, workflow dispatch, and workflow polling through `git`/`gh`.
- `github-sync.ts` persists webhook events, applies card side effects, enriches active runs with GitHub context, and records sync logs.
- GitHub status UI exists in Settings.
- Current project policy is local hacking mode: no PRs, local merges, worktrees per issue.
- This checkout has no Git remote configured, so push/PR/workflow operations cannot be exercised here.

**Blockers / risks**
- Local dogfood cannot validate remote GitHub writes without a remote and authenticated `gh`.
- GitHub credentials are still local/hacking-phase posture, not production-grade secret management.

**Next action**
- Keep remote GitHub work disabled for dogfood until the user exits local-only mode or provides a remote. Add a dry-run status page that clearly distinguishes “implemented but unavailable locally.”

### 9. `npm start` / dev / docs surfaces that affect sync testing

**Status:** Partial

**Evidence**
- Root `package.json` now fans out backend, client, and docs on `start`.
- `dev:postgresql` and `dev:fs` exist for explicit provider-mode testing.
- Server package exposes `dev`, `dev:postgresql`, and `dev:fs`; client package exposes matching Vite modes; docs bind to port 3002.
- Kujan statically verified the script wiring; focused provider tests also assert launch-script expectations.

**Blockers / risks**
- Full long-lived `npm start` was not runtime-smoked in this shared worktree.
- Port/process ownership must be clean before testing live sync, WS, and docs together.

**Next action**
- In a cleared environment, run one smoke: backend health on 3000, frontend on 5173, docs on 3002, and `/api/ws` connection through the Vite proxy.

### 10. Storage providers: PGlite/local and PostgreSQL/cloud

**Status:** Partial

**Evidence**
- `PostgreSQLStorageProvider` stores Squad SDK state in `squad_storage(scope,path,content,...)`.
- Local runtime uses PGlite unless `DATABASE_URL` points to standalone PostgreSQL.
- `resolveStorageBackend()` selects DB-backed storage for unset/blank or `postgresql`; `fs`, `pglite`, and unknown values use filesystem fallback.
- Focused provider tests passed and cover path safety, stale env names, canonical `postgresql`, non-canonical `pglite`, persistence, and first-run import.

**Blockers / risks**
- Local PGlite is in-process; external Squad/Copilot cannot directly connect to it. Shared state needs hosted PostgreSQL with matching scope or the Squadboard MCP/API broker.
- The provider has a compatibility cache for deprecated sync methods; multiple provider instances can observe stale sync-cache data until reinitialized.
- The decision archive/inbox has conflicting old provider wording; docs must converge on the current code/test contract.

**Next action**
- Write a cloud/shared PostgreSQL integration test across two processes. Update or archive stale PGlite-era inbox notes so operators do not route work from superseded assumptions.

## Durable architecture call

The next architectural seam should be **Directive Capture Parity**: one call that writes `.squad/decisions/inbox`, records a DB inbox item, calls MCP capture/done, and returns stable status IDs. Everything else should report against that seam rather than inventing a parallel sync path.

For `.squad` state, stop calling it “two-way sync” until there is an explicit mirror service. Today it is **mode-based authority**: filesystem mode owns files; PostgreSQL mode owns `squad_storage` after first import; external tools share through hosted PostgreSQL or the Squadboard broker.
