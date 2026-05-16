# McManus — History

## Core Context

- **Project:** A web design project (v4 iteration) for the Squad product site
- **Role:** Lead Architect
- **Joined:** 2026-05-14T08:12:50.169Z

## Learnings

- **2026-05-14 Project Pivot:** Web design project expanded to **Squadboard** — local-first kanban + workflow board for Squad agents. Team augmented from 4 to 10 members. New teammates: Hockney (Backend), Kobayashi (SDK), Kujan (QA), Redfoot (DevRel), plus Ralph (Coordinator) and Scribe (Logger). Verbal re-roled to Real-time/WebSocket Dev. Squadboard PRD adopted as source of truth; ready for Demo 1 work.

- **2026-05-14 PRD Written:** Created `docs/prd.md` (~12KB) as the canonical executive-layer PRD. Key distillation calls:
  - **Cut:** All schema details, full demo exit criteria, user journey walkthroughs, SDK wiring specifics, step catalogue internals. These stay in the deep design.
  - **Kept:** The five invariants verbatim (they're contracts); one-line roadmap (links to deep design for detail); non-goals as a flat table (devs skim tables, skip prose); architecture as a single paragraph + pointer.
  - **Judgment call:** Framed "scope" as capabilities (what users get), not components (what engineers build). The PRD is a product brief, not a tech spec — that's the deep design's job.
  - **Pattern:** When distilling a research doc into a PRD, the rule is: the PRD answers "what and why"; the research doc answers "how." If a section requires reading code or schema to understand, it belongs in the research doc, not the PRD.
  - **Next:** Redfoot should copy-pass for voice. Deep design file needs to move into the repo proper.

- **2026-05-14 Deliverables Decomposition:** Decomposed PRD into `docs/deliverables.md` — 15 demos, dependency graph, owner assignments. Demo 1 (Hello Squadboard) has no dependencies; Demos 14-15 depend on most prior work. Key architectural insight: demos split cleanly into Foundation → Engine Core → Board UI → Workflow → Advanced layers. Owner assignments follow domain routing: Hockney owns engine-heavy demos, Kobayashi owns SDK seams, Keyser owns UI-primary demos, Verbal owns real-time.

- **2026-05-15 Phase 8 Vertical Slice — Column Metadata Overlay:** Shipped per-project column rename/describe/recolor as a focused first slice of the larger Phase 8 epic. Key pattern: **overlay table, not enum replacement.** A new `column_meta` table stores label/description/color overrides per (project_id, column_id) pair. The existing `column_status` enum is untouched; Phase 8 proper (multi-board, `board_columns` table replacing the enum, presets, pickup_behaviour, scope-resolved default workflow) can rebuild on top of this without losing user-authored column descriptions. The `column_meta` rows carry over 1:1 into `board_columns` when that migration lands. Used `withTimezone: true` on both timestamp columns to be born Hockney-compliant. Delivered: idempotent bootstrap DDL, GET/PATCH/POST-reset API routes, `useColumnMeta`/`useUpdateColumn`/`useResetColumns` hooks, KanbanColumn 4px accent border + Fluent2 Tooltip on description hover, ColumnSettingsPanel drawer with 8-swatch color picker. Gear icon added to board header to open the drawer.

- **2026-05-15 Multi-modal Issue Bodies:** Shipped `MarkdownBodyEditor` (tabbed Write/Preview, monospace textarea, fenced-code + image toolbar, drag-drop + clipboard paste) and `IssueBodyMarkdown` (react-markdown + remark-gfm + rehype-highlight renderer). Wired into `CreateIssueModal` (image upload disabled via Option A until issue saved) and `CardDetail` (body now renders markdown + attachment thumbnails). Created `useIssueAttachments` / `useUploadIssueAttachment` / `useDeleteIssueAttachment` hooks against Hockney's `/api/projects/:p/issues/:i/attachments` contract.

  **Pattern — paste/drop file handling in React:** Listen for `paste` on the textarea (check `e.clipboardData.items` for `kind === 'file'`) and `drop` on the same element (check `e.dataTransfer.files`). Both call the same async upload sequence. Keep a `valueRef` updated in a `useEffect` so async callbacks always see the live markdown string, not the stale closure value. Use a unique placeholder string (`![uploading ${file.name}…]()`) so concurrent uploads don't collide on replace.

  **Pattern — optimistic markdown placeholder → URL swap:** Insert placeholder at cursor position immediately (synchronous, keeps the user's focus). On `mutateAsync` resolve, call `onChange(valueRef.current.replace(placeholder, ![alt](url)))`. On reject, replace with an HTML comment and surface a timed error banner. The `valueRef` trick is critical — without it, if the user typed more text during the upload, `value` in the closure would be stale and `replace` would operate on the wrong string.

  **Staging discipline lesson (from `d7cc2ada` column_meta commit):** When amending commits in a monorepo where other agents have uncommitted files in progress, `git add .` or `git add packages/` will sweep in their scratch files. Always use explicit `git add -- <path>` per file, always run `git status` to verify the staging area before `git commit`, and never stage untracked scratch files (`.server-dev.log`, `.issue_id.txt`, `.run_id*.txt`, `.squad/server.log`).



New decisions merged to `.squad/decisions.md`:
- Demo 9 open question #2: `request_changes_policy` default is `'first'` (Hockney)
- Demo 12 open question #6: Optimistic concurrency for concurrent issue edits (Verbal)
- Demo 15 open question #8: GitHub issue mirroring OFF by default, opt-in per project (Hockney)

See `.squad/decisions.md` for full details.

Multi-agent fanout session completed 2026-05-15T12:35:00Z:
- 5 agents shipped (2 keyser rounds, mcmanus, hockney, verbal)
- 5 commits landed (42c120a0, d74c9622, d7cc2ada, 4d9fb813, base a97e2bce)
- 2 agents in flight (fenster, kobayashi)

Session log: `.squad/log/2026-05-15T12:35:00Z-squad-fanout.md`


## Recent team activity

**2026-05-15 Round 2 shipped:** Hockney (attachments backend), McManus (multi-modal frontend), Verbal (Consult chat fix), Fenster (typography sweep), Kobayashi (Ceremony Conjure UX), Keyser (layout rebalance). See `.squad/decisions.md` for Fluent2 canon, image bytea architecture, create-page pattern, react-markdown rendering.

---

## 2026-05-15 — Phase 3 Heartbeat Sweep Registry (p3-heartbeat + p3-sweeps)

**Task:** Replace the monolithic `dispatcher.start()` 5 s tick with a per-sweep interval registry.

**Delivered:**
- `engine/heartbeat.ts` — `Heartbeat` class with `register`, `start`, `stop`, `tick`, `getStatus`, `setSweepEnabled`. Singleton `heartbeat` exported.
- `engine/sweeps/stuck-issue-runs.ts` — 30 s — wraps all 5 sweeper operations + review timeouts.
- `engine/sweeps/idle-live-sessions.ts` — 60 s — marks `active` live sessions idle after 10 min of inactivity.
- `engine/sweeps/stale-presence.ts` — 30 s — evicts in-memory presence records older than 60 s.
- `engine/sweeps/ready-workflow-steps.ts` — 5 s — wraps `tickWorkflowAdvancement` + `claimAndRun`.
- `engine/sweeps/github-sync-overdue.ts` — 60 s — one-off pull for overdue GitHub-connected projects.
- `engine/sweeps/ceremonies-due.ts` — 5 s — thin wrapper around `sweepDueSchedules()` (honours Verbal's 504f4a57 backoff).
- `routes/heartbeat.ts` — `GET /api/heartbeat`, `POST /api/heartbeat/sweeps/:id/run`, `PATCH /api/heartbeat/sweeps/:id`.
- `realtime/event-bus.ts` — added `HeartbeatEventType` + `emitHeartbeatEvent()` method. Scope key `__heartbeat__`.
- `realtime/presence.ts` — added `sweepStalePresence(maxAgeMs)` export.
- `engine/dispatcher.ts` — deprecated comment added; file kept intact for rollback.
- `index.ts` — dispatcher.start() replaced; all 6 sweeps registered; heartbeat route mounted; graceful shutdown updated.
- `.squad/decisions/inbox/mcmanus-heartbeat.md` — design decisions documented (interface shape, intervals, deprecation, EventBus integration).

**TSC:** Clean on new code. 2 pre-existing errors in `conjure-classifier.ts` (not my code, not my responsibility to fix).

**Guardrails respected:** Did not touch `ceremony-scheduler.ts`, `routes/templates.ts`, `sdk/squad-stream.ts`, `sdk/consult-stream.ts`.

---

## 2026-05-15 — P0 Heartbeat Bus Isolation Fix

**Symptom:** `[ceremony] dispatcher lookup failed for heartbeat.sweep.completed: error: invalid input syntax for type uuid: "__heartbeat__"` spammed every 5 s. Every `ready-workflow-steps` tick emitted 2 errors.

**Root cause:** `emitHeartbeatEvent()` emitted on the shared `'event'` channel with `projectId: '__heartbeat__'` (a synthetic sentinel). `ceremony-dispatcher.ts` fanned all `'event'` emissions to `findMatchingCeremonies()`, which passed `'__heartbeat__'` as a Postgres UUID column value → `22P02` crash.

**Fix — two layers:**
1. **Primary (event-bus.ts):** `emitHeartbeatEvent()` now emits on the `'heartbeat'` channel (not `'event'`). The `'event'` channel contract is now enforced: every payload carries a valid project UUID. Added `onHeartbeat()` helper for typed subscriptions.
2. **Belt-and-suspenders (ceremony-dispatcher.ts):** Early return in `handleEvent` for `event.type.startsWith('heartbeat.')`. UUID regex guard in `findMatchingCeremonies` returns `[]` silently for non-UUID projectIds.

**Smoke test results:** UUID errors: 0, dispatcher lookup failures: 0, sweeps running (acted=2). TypeScript clean (two pre-existing unrelated errors in `conjure-classifier.ts` unchanged).

**Lesson:** The `'event'` channel must be treated as a typed contract: `projectId` is always a UUID. Server-wide synthetic scope keys (`__heartbeat__`, `consult:<id>`, `__global__`) belong on their own named channels. Any new server-wide emitter MUST use a separate channel or face the same crash.

## Team update (2026-05-15T16:09:55Z — Wave 3)

Heartbeat refactor (r2, commit ea091186): 6-sweep registry with 30s/5s intervals for lease cleanup and workflow advancement. Dispatcher deprecated-in-place for rollback safety (removed from index.ts). Hotfix (r3, commit 0fc2a64c): isolated heartbeat events to separate `'heartbeat'` EventEmitter channel + UUID guard in ceremony dispatcher. UUID errors 2→0 per tick. Rule for future contributors: `'event'` channel contract is UUID-only; server-wide events use separate named channels (e.g. `'heartbeat'`) or subscribeGlobal() pattern with pre-checks.

---

## 2026-05-15 — Polymorphic Capture ("Conjure") Design Proposal

**Task:** Design proposal for turning the global "+ Capture" button into a universal intent router supporting 10 artifact types.

**Delivered:** `.squad/decisions/inbox/mcmanus-polymorphic-capture.md` — 7-section design covering naming (recommended: "Conjure" + Wand icon), intent dimensions (10 kinds), classifier architecture (server-side, Haiku, <1.5s P95), hybrid routing UX (light in-place, heavy navigate), API contract (`POST /api/conjure/classify`), 3-step migration plan, and 5 open questions for the user.

**Open questions surfaced:** 5.

---

## Wave 5 Update (2026-05-15T10:18:00Z)

**Run:** mcmanus-4  
**Model:** claude-opus-4.6  
**Task:** Polymorphic Capture ("Conjure") design proposal + 5 open questions

**Outcome:**
- Designed universal intent-routing capture surface
- Formulated 5 open questions; user approved all answers via Copilot
- Naming decision: "Conjure" (with "Wand20Regular" icon)
- Design ratified; implementation deferred to Wave 6 (pending Hockney-6 Flow API + Kobayashi-3 columns land)
- Decision: `.squad/decisions/inbox/mcmanus-polymorphic-capture.md`
- Answer validation: `.squad/decisions/inbox/copilot-conjure-question-answers.md`

**Next:** Await Wave 6 spawn for implementation orchestration.

---

- r5 (2026-05-15T10:26:30.000-07:00) — added Office/Parks&Rec/Mad Men/Succession/SiliconValley universes + 11 non-tech roles with role-emoji mappings + non-tech routing table. Decision in inbox.

- **2026-05-15 Non-tech Role Set Narrowed (Wave 7):** Removed HR, Legal, Operations, Finance from supported non-tech roles per Ahmed's scope decision. Squad's non-tech role coverage now: PM, Designer, Founder, Sales, Marketing, Customer Success, Research (7 roles, down from 11). Updated surfaces: squad.agent.md (4 emoji rows + Donna example), routing.md (4 work-type rows + 2 cross-functional rules). casting-reference.md untouched (no role-fit hints present). Commit: 14b61f37. **Companion Wave 7 work:** Kobayashi trimmed each local universe to 10 characters (Office 15→10, Simpsons 14→10, Parks&Rec 14→10, Seinfeld stayed at 10). Total: 53→40 characters. Both role narrowing and universe trim are paired Ahmed directives for scope reduction on the non-tech surface area. Orchestration log: `.squad/orchestration-log/2026-05-15T17-50-29Z-mcmanus.md`.


- **2026-05-15 Wave 8 — Casting trim + non-tech charter templates:** Trimmed 3 universes (Mad Men, Succession, Silicon Valley) from `.squad/templates/casting-reference.md` (20→17), updated squad.agent.md count line (was already inconsistent at 15, now aligned to 17). Drafted 7 per-role charter templates in `.squad/templates/non-tech-charters/` (PM, Designer, Founder, Sales, Marketing, Customer Success, Research) plus a README index. Each template is distinct in tagline, "What I Own", "How I Work", "Boundaries", and "Voice" — not mad-libs swaps. Templates use literal `{Name}` placeholder for casting to fill on use. Commits: `10f659bf` (trim), `db12a997` (charters). Per-file `git add --` discipline held; no other agents' scratch files swept in. Decision in inbox: `mcmanus-non-tech-charters-and-trim.md`.

- **2026-05-15 Wave 11A — L1 (Electron architecture decision) — SILENT-SUCCESS:** Delivered comprehensive architecture rationale: Option B (server as supervised child process). Main process is thin supervisor (≈200 LOC) handling spawn, health-poll, restart, window mgmt, auto-update, IPC bridge, graceful shutdown. Preserves crash isolation (server panic ≠ app death), headless parity (no Electron imports in server), and dev-prod consistency (packages/server unaware it runs under Electron). Documented 5 downstream items (L2-L8) with open questions for implementers. Merged from inbox to decisions.md this session.

---

## Wave 13 Learnings — Q3 extension framework PR on plate

**Added by:** Scribe (Wave 13 close-out)  
**Date:** 2026-05-15T19:39:32-07:00

### Q3 upstream PR dependency

Redfoot delivered the generic "extension fragments" mechanism in Q4. Now it needs to be upstreamed to `bradygaster/squad-duck` as part of Q3 work:
- Add extension-discovery to Squad coordinator preamble
- Scan `~/.squad/extensions/coordinator/*.md` at session start
- Treat each as additional behavior fragments appended to the preamble
- Project-local overrides user-global
- Fragments survive Squad upgrades

This is a cross-repo effort. PR should be authored and submitted by you (or coordinated with upstream maintainer if they take the draft). Q4's postinstall approach is a stopgap; Q3 PR is the canonical long-term design.


---

## 2026-05-15T22:42 — Wave 15: Universal Project Bundle

**Task:** 3rd-escalation delivery of Ahmed's "deploy entire project configs as a single artifact" ask.

**Deliverables shipped:**

1. **SDK schema** — `packages/squadboard-sdk/src/bundle/schema.ts`
   - `SquadboardBundle` type covering all sections: manifest, project, kanban, team, ceremonies, workflows, skills, tools, mcpServers, routing, agents.
   - All types exported from SDK root (`@sabbour/squadboard-sdk`) and sub-path (`@sabbour/squadboard-sdk/bundle`).
   - `ApplyResult` type defined here, shared by both loader and CLI.
   - Also added `./bundle` to SDK package.json exports map.

2. **Loader** — `packages/server/src/services/bundle-loader.ts`
   - `applyBundle(bundle, opts): Promise<ExtendedApplyResult>` — applies all sections idempotently.
   - `loadBundle(pathOrUrl)` — loads from filesystem path or HTTP(S) URL.
   - Skip-with-warning default; `overwriteExisting` flag for full replace.
   - Ceremonies/workflows use the correct two-table pattern (`workflows` + `workflowVersions`).
   - Designed for Hockney W16 downstream: call `applyBundle(bundle, { projectId })` for template restore.

3. **CLI** — `packages/server/src/cli/bundle.ts`
   - `squadboard bundle apply <path-or-url> [--dry-run] [--overwrite] [--project-id <uuid>] [--json]`
   - Supports both filesystem paths and HTTPS URLs.
   - Human-readable and machine-readable (--json) output modes.

4. **Reference bundle** — `bundles/default-software-project/`
   - `squad-bundle.json` — 5-column kanban, 4 agents (Lead/Backend/Frontend/Tester), 3 ceremonies (Simple Review, Bug Fix, RFC), 2 skills (git-workflow, tdd-loop), 5 routing rules.
   - `README.md` — smoke test procedure + bundle format reference + customisation guide.

**Architecture decisions:**
- Format: hybrid (JSON root + optional split files for >4KB bodies).
- Schema home: SDK package (shared between server and future client-side code).
- Loader home: server services (DB access needed).
- Idempotency: skip-with-warning by default, opt-in overwrite.

**TypeScript status:** Clean (zero new errors).

**Closes:** `w15-universal-project-bundle`, `f5-unified-import-export`

**Decision doc:** `.squad/decisions/inbox/mcmanus-universal-project-bundle.md`

## Team Update — undefined

Run: wave-15

- **hockney**: Stream I (backup/restore + W14 migration)
- **keyser**: UI batch (#2, #6, #7 fixes)
