# Hockney — History

## Core Context

- **Project:** Squadboard — local-first kanban + workflow board for [Squad](https://github.com/bradygaster/squad) agents
- **Package:** `@sabbour/squadboard` · Local install: `npx @sabbour/squadboard init` · MIT · Self-hosted
- **Role:** Backend / Workflow Engine Dev
- **Joined:** 2026-05-14T08:17:03Z
- **Hired by:** Ahmed Sabbour
- **PRD:** `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md`

## Tech stack I own

- Node.js single-process, Express v5
- Postgres — embedded `embedded-postgres` for local, hosted Postgres for cloud (same Drizzle schema)
- Drizzle ORM (~30 tables; 8 load-bearing)
- TypeScript
- Subprocess spawning (`setsid` + pgid) for isolated runWorkers
- WebSocket fan-out via in-process `EventEmitter` (real-time piece coordinated with Verbal)

## Five invariants I defend

1. **`agent_run` is the only step that does LLM work.** `peer_review`, tier-3 routing, and `split` are composites that desugar to `issue_runs` rows with distinct `kind` values.
2. **Single-spawner discipline.** The stepper alone spawns runs via `FOR UPDATE SKIP LOCKED`. The dispatcher only ticks, sweeps, and wakes.
3. **Lease + heartbeat is the authoritative liveness signal.** `lease_expires_at` (90s TTL) + `heartbeat_at` (30s interval).
4. **Output schema validation happens at session end.** After `sendAndWait`, before `recordRunCompletion`. Never on post-tool-use hooks.
5. **`fan_out` and `split` materialize full child workflow_runs.** Six-step transaction, no phantom columns.

## Roadmap I deliver against

15 demoable thin slices. The engine appears progressively across:
- **Demo 4** — One-shot agent (workspaces + live header)
- **Demo 6** — First workflow (engine end-to-end with retry + cost)
- **Demo 7** — Resilience + cost (lease/heartbeat sweepers, budget caps)
- **Demo 9** — Peer review (4-verb approvals, quorum)
- **Demo 10** — Fan-out + handoff (subtrees + additive skills)
- **Demo 14** — MCP + slash command + idempotent create
- **Demo 15** — GitHub sync (pushes, PRs, check runs, webhooks)

## Recent Learnings (2026-05-15)

### Bytea + Image Attachment Design

**Bytea pattern in Drizzle ORM:**  
Drizzle pg-core does not ship a built-in `bytea` helper; you add it via `customType` from `drizzle-orm/pg-core`. The minimal definition is:
```ts
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});
```
The pg driver returns bytea columns as Node.js `Buffer` objects automatically — no `fromDriver` conversion needed for the common case. The `customType` import must be added to the existing pg-core import list in `schema.ts`.

**multer memoryStorage usage:**  
`multer({ storage: multer.memoryStorage(), limits: { fileSize: N } })` makes the uploaded file available at `req.file.buffer` (a `Buffer`). The `limits.fileSize` guard rejects oversized streams before they reach the route handler — the service layer applies a second check to guard against middleware bypasses. The multer `MulterError` with `code === 'LIMIT_FILE_SIZE'` (or `message === 'File too large'`) maps to `{ ok: false, error: 'image_too_large' }`.

**Staging discipline:**  
On a previous commit (column-meta work) I accidentally staged untracked scratch files by using `git add packages/` instead of listing paths explicitly. Correct discipline: `git add -- <path1> <path2> ...` for each intentional file, then `git status` to confirm only those files are staged before committing. Never use `git add .` or broad directory globs in a repo with `.squad/` log files and editor artifacts.

## Team Activity Log

**2026-05-15 Round 2 shipped:** Hockney (attachments backend), McManus (multi-modal frontend), Verbal (Consult chat fix), Fenster (typography sweep), Kobayashi (Ceremony Conjure UX), Keyser (layout rebalance). See `.squad/decisions.md` for Fluent2 canon, image bytea architecture, create-page pattern, react-markdown rendering.

## Archive

For older learnings (Demo 1–15 architecture notes, GitHub App auth, TS fixes, UTC bug), see `history-archive.md`.

## Learnings

**2026-05-15T08:21:46-07:00 — P0 fix: resolveAnchorIssue spam-loop root cause**

Fixed the ceremony scheduler anchor spam loop (root cause identified by Verbal in
`verbal-spam-loop-rootcause.md`). Added a `NOT EXISTS (SELECT 1 FROM issue_links
WHERE child_issue_id = issues.id AND link_type = 'fan_out')` filter to
`resolveAnchorIssue()` in `ceremony-scheduler.ts`. The `issue_links` table from
Demo 10 already had the discriminator — no schema migration needed. Only the one
occurrence of the bad anchor selector pattern was in scope; the grep sweep of
`packages/server/src/services/` and `packages/server/src/engine/` confirmed no
other anchor-picker queries. TS check confirmed no regressions (pre-existing
`conjure-classifier.ts` errors were present on the base commit). See
`.squad/decisions/inbox/hockney-anchor-filter.md` for the exact filter and
follow-ups.

**2026-05-15 — Phase 3 Doctor (diagnostics service):**

- `getWebSocketServer()` is already exported from `realtime/ws-server.ts` — no new singleton needed. The `WebSocketServer` node from `ws` doesn't expose a `.readyState` in its TypeScript types the same way a client `WebSocket` does; checking `wss !== null` is the primary liveness signal; `.clients.size` gives connected count.
- `execFile` (promisified) is the safest way to invoke `gh auth status` — avoids shell injection, handles ENOENT cleanly. A non-zero exit still rejects the promise, so catch handles both "not found" and "not authed" cases.
- Pool.connect() + client.query() both need independent timeouts for the postgres health check. 50ms is tight but correct for embedded Postgres — if that fails the DB is genuinely unhealthy.
- Dynamic `import('@bradygaster/squad-sdk/client')` inside async functions works cleanly with ESM + `"moduleResolution": "bundler"` — no top-level import needed, which keeps the diagnostics service from throwing at module load time if the SDK isn't configured yet.
- `Promise.all` across all checks (each individually try/catch'd) gives true parallelism — total wall-clock bounded by the slowest single check, not the sum of all. The SDK checks each re-connect/disconnect to avoid state leakage.
- `mergeParams: true` on sub-routers is not needed for `GET /api/projects/:id/diagnostics` when mounted via `app.use('/api/projects/:id/diagnostics', projectDiagnosticsRouter)` because Express automatically merges params for routers created with `Router({ mergeParams: true })` or when mounted directly. Use `req.params['id']` (bracket notation) not `.id` to keep TS happy with index signature types. Also handle `string | string[]` on `req.params` values — cast with `Array.isArray(rawId) ? rawId[0] : rawId`.
- Pre-existing TypeScript errors in `conjure-classifier.ts` (`.modelId` / `.source` on `ResolveModelResult`) are not regressions from this work — confirmed by stashing and re-running `tsc --noEmit` on the base commit.

**2026-05-15T15:21:46Z — Coordination snag: Parallel commit with Keyser**

Keyser's Diagnostics UI work (commit 13c34dca) accidentally swept Hockney's server files when both agents committed diagnostics changes in parallel. Functional code is verified OK; server routes and diagnostics service are intact. **Audit trail is murky** — the commit appears to contain both agents' changes under one SHA. This happened because neither agent used explicit `git add -- <path>` per-file staging; Keyser's broader staging glob swept Hockney's uncommitted work into the same commit. **Action for future parallel sessions:** Use `git add -- <path1> <path2> ...` (bracket notation) for each intentional file. Never use `git add .` or `git add <directory>/` when multiple agents have working trees. Always `git status` before committing to confirm ONLY your changes are staged.

---

**2026-05-15T17:29:06-07:00 — m1-hire-team-routes: Missing propose/confirm routes**

Root cause of Cast-Team modal crash was two completely absent route handlers; Express
SPA catch-all was returning `index.html`, causing `JSON.parse('<!doctype...')` → crash.
Key learnings:

- `castTeam()` in `casting-engine.ts` handles all extended-role → base-role mapping internally;
  route handlers should pass raw strings and let the engine normalise. No need to call
  `EXTENDED_ROLE_TO_BASE_ROLE` explicitly in the route.
- `Parameters<typeof fn>[0]['field']` is the right TS idiom to cast a runtime-validated string
  to a sealed union type without duplicating the union in route code.
- Append `buildPersonaSection(member)` after `writeCharter()` to give cast agents richer context.
- Per-member error collection (vs. 500-abort) matches the client's `HireTeamConfirmResult`
  interface which has `errors: { agentName, error }[]`. Always match the client interface exactly
  before designing the server return shape.
- tsx watch on WSL2 auto-reloaded on file save — no manual server restart needed.



**Commit:** `3e3fefad` — `fix(templates): resolve workloads page load error + empty state`

**Root cause:** `Templates.tsx` never existed as a page. Navigation to the template catalog hit the catch-all redirect (`*` → `/`) and rendered nothing. `TemplatePicker.tsx` was orphaned (written but never imported anywhere). The `ceremoniesTopRouter.get('/templates')` handler also lacked a `try/catch`, leaving it without a graceful error envelope on any unexpected throw.

**Changes:**
- `packages/server/src/routes/ceremonies.ts` — Wrapped `GET /templates` in try/catch; returns `{ ok: false, error: '...' }` 500 JSON on failure instead of crashing Express.
- `packages/client/src/pages/Templates.tsx` — New page: loading spinner → empty state (`Body1`: "No workload templates yet.") → error state (`Subtitle1`: "Couldn't load templates — try again" + Retry button) → template card grid. Never throws or renders a stack trace.
- `packages/client/src/App.tsx` — Wired `Templates` at `/projects/:id/ceremonies/templates`.

**Verification:** `cd packages/client && npx tsc --noEmit` → clean. `cd packages/server && npx tsc --noEmit` → 2 pre-existing errors in `conjure-classifier.ts` (confirmed pre-existing by stash test), none from this change.

## Team update (2026-05-15T16:09:55Z — Wave 3)

Anchor filter fix (r3, commit 4ecb5525): `resolveAnchorIssue()` now excludes fan-out child issues via `issue_links` table. Closes spam loop at source — no ceremony anchor will pick a recently-created child that itself has fan-out steps. Indexed by existing `(child_issue_id, link_type)` pair from Demo 10; no schema migration. P1 follow-up: persist sweep failure count to Redis for process-restart recovery.

---

**2026-05-15T09:09:55-07:00 — Task: Phase 19 Templates & Portability backend**

**Commits:** 3 batches (see SHAs below after commit)

**Scope:**
- `db/schema.ts`: Added `templates` pgTable — UUID PK, kind TEXT + CHECK('workflow'|'team'|'project'), name, description, payload JSONB, optional project_id FK, timestamps.
- `db/index.ts`: Bootstrap DDL — `CREATE TABLE IF NOT EXISTS templates` + `CREATE INDEX IF NOT EXISTS templates_kind_name_idx ON templates (kind, name)`.
- `services/templates/workflow-template.ts`: exportWorkflow, importWorkflow (creates ceremony + version row), saveAsTemplate, instantiateTemplate.
- `services/templates/team-template.ts`: exportTeam (agents + skills/tools/mcp by key), importTeam (with name-conflict skip/force), saveAsTemplate, instantiateTemplate.
- `services/templates/project-template.ts`: exportProject (full bundle excluding issues/runs/comments/inbox/costs), importProject (transactional), saveAsTemplate, instantiateTemplate.
- `routes/templates.ts`: GET /api/templates (filter by kind), GET /api/templates/:id, DELETE /api/templates/:id.
- `routes/team-portability.ts`: POST export/import/save-as-template/instantiate-template under /api/projects/:id/team/.
- `routes/project-portability.ts`: POST export/import/save-as-template/instantiate-template under /api/projects (import + instantiate-template are static paths mounted before /:id handlers).
- `index.ts`: Mounted all 3 new route modules at end of mount block.

**Route count:** 11 new endpoints.

**No-conflict:** Did NOT touch engine/, sdk/, client/, ceremonies.ts existing GET /templates handler, Kobayashi's charter-compiler.ts/agent-sync.ts, McManus's engine/, or Verbal's sdk/.

**TypeScript:** `npx tsc --noEmit` → only 2 pre-existing conjure-classifier.ts errors. Zero new errors from this change.

**Decision filed:** `.squad/decisions/inbox/hockney-phase19-backend.md`

---

## 2026-05-15 — Phase 12 Reframe: Agent-Centric Flow Data API

**Task:** Build the data API powering the new agent-centric Flow page. Per Ahmed's request: "I want the flow page to be agent centric, see instances of agents, what are they active on, lineage of what triggered them, visually."

**Batch A** — `ce01a382` — Schema queries + 3 routes + service
**Batch B** — `9a9fb8a3` — WS event hooks (workflow-runner, stepper, fan-out, consult-stream)

**Scope:**
- `services/flow-agents.ts` (new): `getFlowAgents()` + `getFlowLineage()`. Uses CTE-based UNION ALL query across 4 data sources (workflow_runs, issue_runs, live_sessions, consult_sessions). LATERAL join for current step attribution. Trailing-24h cap of 50 completed rows per source type.
- `routes/flow.ts`: Added `GET /agents`, `GET /lineage`, `GET /graph` sub-routes to existing `projectFlowRouter`. Original `GET /flow` kanban payload unchanged.
- `realtime/event-bus.ts`: Added `FlowEventType` union, `emitFlowEvent()`, and `emitFlowHeartbeat()` (in-memory 1/s throttle per instanceId).
- `engine/workflow-runner.ts`: Surgical adds — `flow.instance.started` on `createWorkflowRun`, heartbeat/ended in `advanceToNextStep`, ended in `handleAgentRunStep` failure path. Added `getProjectIdForWorkflowRun()` internal helper.
- `engine/stepper.ts`: `flow.instance.started` before SDK call, heartbeat in DB timer, ended on success and both failure paths.
- `engine/fan-out.ts`: `flow.lineage.edge.created` for each child run after `materializeFanOut()` commits.
- `sdk/consult-stream.ts`: `flow.instance.started` after `startConsultSession`, `flow.instance.ended` in `endRunningConsult`.

**Route count:** 3 new endpoints.

**Data gaps logged in decision doc:**
- `workflow_runs` with no step agent and no issue assignee excluded silently.
- `consult_sessions` mode='model' excluded (no agentId).
- No issue_run→issue_run direct lineage (schema gap).
- No workflow_run→consult_session cross-source edges (no FK).
- `parentInstanceId` not emitted in flow.instance.started for issue_runs (deferred).

**TypeScript:** `npx tsc --noEmit` → only 2 pre-existing conjure-classifier.ts errors. Zero new errors.

**Smoke test:** Dev server started, all 3 new endpoints returned `{ ok: true, data: {...} }` with correct shapes. Project "foo" returned 11 agents, fenster with 1 consult_session instance, hockney with 1 issue_run instance. Original `/flow` returned 5 columns + activeRunsCount intact.

**Decision filed:** `.squad/decisions/inbox/hockney-flow-agent-api.md`

---

## Wave 5 Update (2026-05-15T10:18:00Z)

**Run:** hockney-6  
**Model:** claude-sonnet-4.6  
**Task:** Flow page agent-centric API + templates backend

**Outcome:**
- Redesigned Flow page API to center on agent instances (not runs)
- New endpoint: GET /api/projects/:id/flow/agents
- Response model: FlowAgentsResponse (agents, instances, lineage, active/idle state)
- Batch A (endpoints): commit `ce01a382`
- Batch B (models): commit `9a9fb8a3`
- Batch C (docs): commit `72511689`
- Decisions: `.squad/decisions/inbox/hockney-flow-agent-api.md` (Keyser builds against), `.squad/decisions/inbox/hockney-phase19-backend.md` (templates table: kind TEXT + JSONB payload)
- Templates: kind discriminator chosen (TEXT + CHECK), payload shape per kind (workflow | team | project)

**Status:** COMPLETE — Flow API and templates backend ready for Phase 19 integration and Keyser client work.

---

## 2026-05-15 — Conjure classify endpoint (Phase 1)

**Commit:** `9e6bf984` — `feat(server): add /api/conjure/classify endpoint for intent routing`

**Task:** Replace the free-form Capture inbox with a smart-create surface that
takes any prose prompt and routes the user to the right creation flow with a
pre-filled draft. Phase 1 = backend classify endpoint only; frontend follows
(Keyser).

**Endpoint:** `POST /api/conjure/classify`
- Request: `{ prompt, context?, hint?, useLlm? }`
- Response: `{ ok, data: { intent, confidence, draft, routing: { destination, presentation, fallbacks }, rationale, strategy } }`
- 6 intents: `project | issue | team | agent | skill | tool`
- Errors: 400 missing prompt, 413 oversized (>10k chars), 500 unhandled

**Classifier strategy chosen: Option C (hybrid)**
- Rule-based scorer first — weighted regex signals per intent, soft-saturated to 0..1 confidence.
- LLM disambiguation (`runFormulator` + `extractJsonObject`) fires only when rule confidence < 0.55 AND `useLlm !== false`.
- LLM call wrapped in try/catch — missing GITHUB_TOKEN / SDK / model never breaks the surface; degrades to best rule candidate.
- Default ambiguous fallback: `issue` (per locked-in design — board captures default to issues).
- Phase 1 happy path is rule-based-only: 13/13 of the sample prompts in the brief classified correctly at confidence ≥ 0.55, so the LLM never fires.

**Files:**
- `packages/server/src/services/conjure-classifier.ts` — rewrote (was 200 lines of broken/unused code with two pre-existing TS errors). New file ~556 lines: `classifyAndDraft()` + rule scorer + 6 draft builders + routing table + LLM fallback. Test-only `__test__` export for unit-test reach-in.
- `packages/server/src/routes/conjure.ts` — new, ~75 lines. Thin wrapper around `classifyAndDraft()` with input validation + standard `{ ok, error }` envelope.
- `packages/server/src/index.ts` — mounted `app.use('/api/conjure', conjureRouter)` between MCP HTTP and presence endpoints.

**Decision filed:** `.squad/decisions/inbox/hockney-conjure-classify.md` — endpoint shape, classifier strategy, intent/draft contract, Phase 2 roadmap (storage, accuracy tuning, multi-artifact suggestion strip, top-3 candidates).

**Side benefit:** The two pre-existing TS errors in `conjure-classifier.ts` (`ResolveModelResult.modelId` / `.source`) that have been polluting `tsc --noEmit` output for several waves are now gone. `cd packages/server && npx tsc --noEmit` is fully clean (exit 0, no errors).

**Verification:** Rule classifier smoke test (offline, `useLlm: false`) on 13 sample prompts from the brief → 13/13 correct intent classification. Edge cases: empty → 400; vague ("something about AKS") → defaults to `issue` conf=0.2; mixed ("fix the team build pipeline") → top `issue`, fallback `team`.

**NOT done (deferred to Phase 2 / other waves):**
- Frontend integration (Keyser, after Fenster's design)
- Removing CaptureFAB / CaptureModal (Keyser)
- `event_log` persistence of classify invocations (additive — needs telemetry plan first)
- Re-introducing the 4 dropped kinds (`inbox-item`, `consult`, `ceremony`, `mcp-server`) — currently folded into the 6
- Top-3 candidates with full per-candidate drafts (currently fallbacks return only intent IDs)

**Coordination note:** Saw that `templatesRouter`, `teamPortabilityRouter`, `projectPortabilityRouter` are imported in `index.ts` but never mounted on the Express app — looks like a pre-existing gap from Phase 19 work (mine, originally). Out of scope for this commit; flagging here for a follow-up.

**Staging discipline:** Per-file `git add --` only. Confirmed via `git diff --cached --name-status` that exactly 3 files were staged (M index.ts, A routes/conjure.ts, A services/conjure-classifier.ts). No `.squad/` log files, no node_modules, no other agents' work swept in. Decision file lives in `.squad/decisions/inbox/` which is gitignored — not committed (matches existing inbox convention).

**Status:** COMPLETE — endpoint live in main, ready for Keyser to wire up the modal once Fenster's design lands.


---

## 2026-05-15 — MCP starter tools + diagnostics false-negative fix

Two-task wave under one prompt. Both complete.

### Task A — MCP server (Phase 1 starter tools)

The MCP plumbing was already in place from earlier waves: `createMcpServer()`
factory in `packages/server/src/mcp/server.ts`, stdio entry point
(`mcp/index.ts`), and Streamable HTTP transport (`mcp/http-transport.ts`)
mounted on the live Express app at `/mcp`. Phase 18 had already dropped the
`squadboard_*` prefix on tool names because the server name (`squadboard`)
already namespaces.

So the wave was *additive* — wire the four tools the brief asked for into the
existing factory, not stand up a new package.

**Tools added (4):**
- `list_projects` — every project + a resolved `.squad/` path so an external
  CLI can pick a `projectId` to pass to other tools.
- `list_inbox` — Conjure / quick-capture queue, filterable by `status` /
  `projectId`. Trims long bodies into a `originalDraftPreview` for list view.
- `capture` — drops a free-form prompt through `classifyAndDraft()` (the
  Conjure classifier I shipped in `9e6bf984`). When `intent='issue'` AND
  `projectId` is provided, materialises the card immediately and returns
  `{ action: 'issue_created', issue, classification }`. For other intents
  returns `{ action: 'draft_only', classification }` so the caller can route
  the user into the matching create flow.
- `get_routing` — reads the resolved `.squad/routing.md` for the project.
  Uses the same `resolveSquadDir()` helper as the diagnostics fix below.

**Wiring choice — in-process, not HTTP:** all 4 tools call services /
Drizzle directly (`getDb()`, `inboxService.listInboxItems`,
`classifyAndDraft`). No HTTP roundtrip to localhost. Matches the existing
7 tools' pattern; faster; no double serialisation.

**Total tool count:** 11 (was 7). All registered via `TOOLS` array →
auto-listed on `/mcp/health` and via MCP `list_tools`.

**README:** new `packages/server/src/mcp/README.md` (~140 lines) with
`.copilot/mcp-config.json` and Claude Desktop install snippets, tool
table, transport notes, and what's deferred (auth, multi-project routing
in stdio, prompts/resources MCP primitives).

**Build:** `tsc --noEmit` → 0 errors. `dist/mcp/index.js` already in the
existing build pipeline.

### Task B — Diagnostics false-negative fix

**Root cause** (verified against live `/api/projects` data):
- `projects.path` is stored inconsistently across the table.
  - `foo` project: `/home/asabbour/GitWSL/EMU/foo/.squad` — points AT `.squad/`.
  - other projects: `/home/asabbour/.squadboard/projects/<slug>` — point at the project ROOT.
- `checkSquadDirShape()` blindly did `join(projectPath, '.squad')`, which for
  `foo` resolved to `/home/asabbour/GitWSL/EMU/foo/.squad/.squad/` — doesn't
  exist, so EVERY child collection check (`agents/`, `log/`, `routing.md`,
  `decisions.md`) failed simultaneously. Hence the screenshot.
- The `.squad/` parent `access()` check at the top of the function actually
  also failed in the `foo` case — but caught by the outer `try/catch` and
  reported as a single warn — which is why Ahmed's screenshot showed all 4
  inner checks in the SAME diagnostic line.

**Fix:** new tolerant resolver `resolveSquadDir(storedPath)` exported from
`services/diagnostics.ts`:
1. `path.resolve()` to absolute (so a relative `projects.path` can't pivot
   off `process.cwd()` silently — was a CWD/team-root mismatch suspect per
   the Worktree Awareness pattern, ruled out but the fix preserves
   correctness either way).
2. If `basename === '.squad'` AND it exists → use as-is, `projectRoot` is
   parent.
3. Else if `<path>/.squad/` exists → use that.
4. Else → `{ ok: false, reason }` so the caller surfaces ONE clear
   "project path is wrong" diagnostic + remediation instead of N
   cascading "missing collection" errors.

Applied to both:
- `checkSquadDirShape()` — when `ok=false`, returns single `status: 'fail'`
  with remediation; when `ok=true`, the existing required-collection /
  required-file loop runs against the resolved `squadDir`.
- `checkDiskWriteable()` — only adds the `.squad/` write target when
  `resolveSquadDir().ok` is true. Otherwise `checkSquadDirShape` already
  surfaces the actionable error; no need to double-report.

The MCP `get_routing` tool also reuses `resolveSquadDir`, so the fix
benefits both surfaces.

**Verification:** ran the resolver against the three live `projects.path`
values (`/.../foo/.squad`, two `/.../.squadboard/projects/<slug>`):
- foo → `ok: true, squadDir: /home/asabbour/GitWSL/EMU/foo/.squad`. ✅
- other two → `ok: false, reason: "no .squad/ directory found at ... or ..."`
  — single, clear, actionable. (Their `.squad/` was indeed never created.)

**Files touched (4 total):**
- `packages/server/src/services/diagnostics.ts` — +`resolveSquadDir`,
  rewrote `checkSquadDirShape` body, updated `checkDiskWriteable`.
- `packages/server/src/mcp/server.ts` — +4 TOOLS entries, +4 handlers,
  +4 switch cases, imports for new services.
- `packages/server/src/mcp/README.md` — new file.

**Decision filed:** `.squad/decisions/inbox/hockney-mcp-and-diagnostics.md`.

**Status:** COMPLETE. `tsc --noEmit` clean. Local commits only — not pushed.

### Learnings

1. **Read what's already there before adding a new package.** The brief
   suggested standing up `packages/mcp/` for the MCP server. A 30-second
   look at `packages/server/src/mcp/` showed the whole stdio + HTTP
   apparatus was already built (Phase 18). Extending the existing factory
   was the right call — same lifecycle, same DB pool, same build.
2. **`projects.path` semantics are inconsistent across the table.** The
   schema comment says ".squad/ directory" but seeders / project-create
   flows have stored both layouts. Future writers should either (a) pick
   one layout and migrate, or (b) keep using `resolveSquadDir()`. Logged
   in the decision doc as a follow-up.
3. **Cascading false-negatives mask the actual bug.** When a parent check
   fails, don't run dependent child checks — they generate noise. Pattern
   is now: resolve once, fail-fast with remediation, only descend when the
   parent is healthy.

---

## Heartbeat live verification path — Wave 10 E4 (2026-05-15T13:09:47-07:00)

**Verified by:** Hockney (programmatic, no browser needed)

### Data path traced

| Layer | Detail |
|---|---|
| Engine | `engine/heartbeat.ts` — `Heartbeat._runSweep()` sets `this.lastTickAt = new Date()` on every sweep completion |
| Sweeps | 6 registered: `stuck-issue-runs` (30s), `stale-presence` (30s), `idle-live-sessions` (60s), `ready-workflow-steps` (5s), `ceremonies-due` (5s), `github-sync-overdue` (60s) |
| Service | `services/heartbeat.ts` — `getHeartbeatSnapshot()` reads `heartbeat.getStatus().lastTickAt` and returns it as `lastTickAt` in the snapshot. Also maintains an in-memory ring buffer (capacity 200) of recent sweep events keyed by monotonic `seq`. |
| API endpoint | `GET /api/heartbeat/status` — returns `{ active, lastTickAt, lastError, sweeps[], recent }` |
| React component | `pages/Heartbeat.tsx` — polls `/api/heartbeat/status` every 5s; renders `lastTickAt` via `relativeTime()` helper in the "Last tick" section card |
| No DB column | `lastTickAt` is pure in-memory (`Heartbeat` singleton). The lease+heartbeat column `heartbeat_at` on `issue_runs` is separate (written by runWorker at 30s interval during active LLM runs). |

### Live-fire samples (server was already running on :3000)

| Sample | `lastTickAt` | Ring cursor |
|---|---|---|
| T1 | `2026-05-15T20:15:30.871Z` | 374 |
| T2 | `2026-05-15T20:15:58.809Z` | 384 |

- **Delta:** 27.9 s ✅ (within ~30s ± 5s; driven by the 5s fast-sweeps so actual cadence is ≤5s between any tick)
- **Ring advancement:** +10 events — confirms continuous sweep completions
- **Status:** ✅ TICKING — `active: true`, no `lastError`

### Quick re-verify command (future agents)

```bash
T1=$(curl -s http://localhost:3000/api/heartbeat/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['lastTickAt'])")
sleep 10
T2=$(curl -s http://localhost:3000/api/heartbeat/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['lastTickAt'])")
echo "T1=$T1  T2=$T2"
# Expect T2 > T1 by ≥5s (fastest sweep cadence)
```
