# Squad Decisions

## Active Decisions


# Fenster Typography Canon
**Date:** 2026-05-15
**Author:** Fenster (UX Designer)
**Status:** Ratified — apply app-wide

---

## Reference shape

`packages/client/src/components/layout/PageHeader.tsx` is the gold standard.
It uses `<Title2>` / `<Subtitle1>` for the page title (via `size` prop),
`<Caption1>` for the eyebrow and description, and `tokens.*` for all spacing.
Every other component should follow this lead.

`FluentProvider` (with `webLightTheme`) is confirmed wrapping the entire app in
`packages/client/src/main.tsx` — all `tokens.*` values resolve correctly.

---

## Typography map

| Where | Component | Notes |
|-------|-----------|-------|
| Page title (top of a route) | `<Subtitle1 as="h1">` (or `<Title2 as="h1">` for top-level landing pages) | Built into `PageHeader` |
| Section heading within a page | `<Caption1>` styled with `textTransform: 'uppercase'` + `fontWeight: tokens.fontWeightSemibold` | Matches GitHub/Linear label-section style |
| Card / panel title (15-16 px) | `<Subtitle2>` | e.g. drawer header |
| Body copy / item primary label | `<Body1Strong>` for bold labels, `<Body1>` for running text | |
| Secondary metadata / captions | `<Caption1>` | 12 px, Segoe UI |
| Muted small labels (11 px) | `<Caption1>` with `color: tokens.colorNeutralForeground3` | |
| Numeric / monospace data | `<Body1Strong>` with `fontFamily: tokens.fontFamilyMonospace` | Cost figures, paths |

Available Fluent2 v9 typography components (all from `@fluentui/react-components`):
`Display`, `LargeTitle`, `Title1`, `Title2`, `Title3`, `Subtitle1`, `Subtitle2`,
`Body1`, `Body1Strong`, `Body1Stronger`, `Body2`,
`Caption1`, `Caption1Strong`, `Caption1Stronger`, `Caption2`, `Caption2Strong`

---

## Spacing map

| Where | Token |
|-------|-------|
| Page content padding (full page) | `tokens.spacingVerticalXXL` (24 px vertical) + `tokens.spacingHorizontalXXL` (24 px horizontal) |
| Stack gap between sections | `tokens.spacingVerticalXXL` (24 px) |
| Stack gap between rows in a list | `tokens.spacingVerticalS` (8 px) |
| Row padding inside a card / panel | `tokens.spacingVerticalM` (12 px) x `tokens.spacingHorizontalL` (16 px) |
| Icon-to-text gap | `tokens.spacingHorizontalXS` (4 px) |
| Small inline gap (badges, chips) | `tokens.spacingHorizontalS` (8 px) |

Fluent2 spacing scale reference:
- `XXS` = 2 px, `XS` = 4 px, `SNudge` = 6 px, `S` = 8 px, `MNudge` = 10 px,
  `M` = 12 px, `L` = 16 px, `XL` = 20 px, `XXL` = 24 px, `XXXL` = 32 px
  (same for Horizontal and Vertical variants)

---

## Color map (text only)

| Semantic role | Token |
|---------------|-------|
| Primary text | `tokens.colorNeutralForeground1` |
| Secondary text | `tokens.colorNeutralForeground2` |
| Muted / disabled text | `tokens.colorNeutralForeground3` |
| Placeholder | `tokens.colorNeutralForeground4` |

`var(--surface)`, `var(--border)`, `var(--bg)`, `var(--accent)`, `var(--danger)`,
`var(--success)` remain valid for **layout / structural** colors (backgrounds,
borders). Only text colors are migrated to tokens.

---

## Font-weight tokens

| Value | Token |
|-------|-------|
| 400 (regular) | `tokens.fontWeightRegular` |
| 500 (medium) | `tokens.fontWeightMedium` |
| 600 (semibold) | `tokens.fontWeightSemibold` |
| 700 (bold) | `tokens.fontWeightBold` |

Prefer the `<*Strong>` typography variant over an explicit `fontWeight` override
wherever the entire text run should be semibold.

---

## Global CSS (packages/client/src/styles/globals.css)

Rules that conflict with Fluent2 typography were removed in this sweep.
What remains is intentional:

- `box-sizing: border-box` — kept (essential layout reset)
- `margin: 0; padding: 0` — kept on `*` (prevents browser default spacing)
- `html, body, #root { height: 100% }` — kept (app shell requires full height)
- `body { font-family: ...; font-size: 14px; line-height: 1.5; }` — **removed** (FluentProvider sets this)
- `-webkit-font-smoothing: antialiased` — kept (visual quality)
- `a { color: var(--accent); }` — kept (links are not Fluent2 managed)
- `button { cursor: pointer; font-family: inherit; font-size: inherit; }` — kept for native `<button>` fallback

---

## Exclusions

- `pages/CeremonyEditor.tsx` — pre-existing TS errors owned by another worker
- `pages/Consult.tsx` — pre-existing TS errors owned by another worker


# hockney — anchor filter applied to resolveAnchorIssue

**Date:** 2026-05-15T08:21:46-07:00
**Author:** Hockney (Backend / Workflow Engine Dev)
**Status:** Shipped

---

## What was changed

`resolveAnchorIssue()` in `packages/server/src/services/ceremony-scheduler.ts` now
excludes fan-out child issues from being selected as ceremony anchors.

### Filter applied

```sql
WHERE issues.project_id = $projectId
  AND NOT EXISTS (
    SELECT 1 FROM issue_links
    WHERE issue_links.child_issue_id = issues.id
      AND issue_links.link_type = 'fan_out'
  )
ORDER BY issues.created_at DESC
LIMIT 1
```

In Drizzle ORM terms:

```ts
.where(
  and(
    eq(schema.issues.projectId, projectId),
    not(
      exists(
        db.select({ id: schema.issueLinks.id })
          .from(schema.issueLinks)
          .where(
            and(
              eq(schema.issueLinks.childIssueId, schema.issues.id),
              eq(schema.issueLinks.linkType, 'fan_out'),
            ),
          ),
      ),
    ),
  ),
)
```

---

## Why this filter

The `issue_links` table (added in Demo 10) already records every parent→child
relationship from fan-out materialisation. `childIssueId` identifies fan-out
children; `linkType = 'fan_out'` distinguishes them from handoff links. No schema
migration needed — the discriminator already exists.

---

## No schema migration required

The `issue_links.child_issue_id` + `link_type = 'fan_out'` pair is the correct
discriminator. It was introduced in Demo 10 alongside the fan-out engine. No new
column, no new index needed for correctness (though a GIN/BTREE index on
`(child_issue_id, link_type)` would help at scale — P2 follow-up).

---

## Follow-ups

| Priority | Item |
|---|---|
| P2 | Add `CREATE INDEX ON issue_links (child_issue_id, link_type)` to make the NOT EXISTS subquery O(log n) at scale |
| P1 | Remaining items from Verbal's root-cause doc — see `verbal-spam-loop-rootcause.md` |


# Decision: Standard "create" page pattern for Squadboard

**Date:** 2026-05-15  
**Author:** Kobayashi (Squad SDK Integrator)  
**Status:** Adopted  
**Reference:** `feat(ceremonies): Conjure entrypoint + first-time-friendly create UX`

---

## Decision

Every "create" page in Squadboard should follow the pattern established in `CeremonyEditor.tsx`'s create-mode rendering. This pattern makes every new-artifact flow approachable for first-time users while keeping the power-user edit surface unchanged.

### The pattern (5 elements)

1. **`<PageHeader title="New <artifact>" description="…" />`**  
   Replace any bespoke header with the canonical `PageHeader` component. Title = "New <artifact>". Description = one sentence explaining what this artifact is for. Actions = back button + primary create button.

2. **Dismissible intro card**  
   A Fluent2 `<Card>` immediately below the PageHeader. `<Body1>` text explains what the artifact is and when to use it. A `<Dismiss16Regular>` button in the top-right corner persists the dismissal in `localStorage` with key `squadboard.<artifactType>.introDismissed`.

3. **Formulate / Conjure entrypoint at the top**  
   `<FormulatePanel>` mounted above the form body. The `onFormulate` callback calls the relevant `generate-from-prose` or `formulate` endpoint, populates all form fields, and switches to a review tab (Visual, Preview, etc.) so the user immediately sees the AI draft.

4. **Labeled pickers with one-line descriptions**  
   For any enum/kind/type picker, prefer `<RadioGroup>` with `label={`${technicalName} — ${humanDescription}`}` over a plain `<Dropdown>`. For step/action kinds, use a grouped `<Dropdown>` with descriptions inline; collapse less-common options under an "Advanced" divider.

5. **Sensible defaults on create**  
   Pre-populate the most common values so the user can click "Create" immediately without changing anything. Document the defaults in a comment above the `useState` initializations.

### What stays unchanged in edit mode

The edit-mode surface (existing artifact, `ceremonyId` is set) should NOT include the PageHeader, intro card, or Formulate panel. These are first-time affordances. The existing compact header with badges, validate, run, and save buttons is the right edit-mode experience.

---

## Applicability to future create pages

This pattern should be applied to the following create pages (where not already done):

| Page | Status |
|------|--------|
| `CeremonyEditor.tsx` (new ceremony) | ✅ Done (2026-05-15) |
| New skill | Apply pattern |
| New tool | Apply pattern |
| New MCP server | Apply pattern |
| New agent (HireAgent dialog) | Partial — has FormulatePanel; add intro card + PageHeader |
| New team (HireTeam dialog) | Partial — has FormulatePanel; add intro card + PageHeader |

---

## Rationale

- Users landing on a blank create form with no framing have no idea what the artifact is, which fields are required, or what a sensible starting point looks like.
- The Conjure / Formulate entrypoint reduces time-to-first-success from "navigate docs + fill form" to "type a sentence + review draft".
- The intro card gives just enough context without being a wall of text — it's also dismissible so power users don't see it every time.
- Using `RadioGroup` with descriptions instead of raw-enum `Dropdown` means users can make an informed choice without looking up documentation.
- Sensible defaults mean users can always click "Create" immediately and refine later.


# Decision: sdk-state-wrapper API Surface

**Author:** Kobayashi (Squad SDK Integrator)  
**Date:** 2026-05-15T08:21:46.164-07:00  
**Phase:** p5-state-wrapper  
**Status:** Settled

---

## SquadState API Surface Chosen

`SquadState.fromStorage(storage, rootDir)` is used (synchronous factory) rather than the async `SquadState.create()` because:

- `projects.path` in the DB is already the validated `.squad/` directory — it was written there by `linkProjectToSquad()`, which calls `validateSquadDir()` before persisting.
- Re-validating on every cache miss is redundant I/O.
- `fromStorage()` constructs all eight collection instances (`agents`, `routing`, `decisions`, `skills`, `team`, `templates`, `config`, `log`) immediately without hitting the filesystem.

`projects.path` is the `.squad/` dir itself; `SquadState` expects its parent, so `rootDir = path.dirname(squadPath)`.

`FSStorageProvider` is constructed with `rootDir` as the confinement root, preventing any path-traversal escapes out of the project directory.

Collections exposed:
| Accessor | Collection class | Primary methods |
|---|---|---|
| `getAgents()` | `AgentsCollection` | `.list()`, `.get(name)`, `.create()`, `.delete()` |
| `getRouting()` | `RoutingCollection` | `.get()`, `.update()` |
| `getDecisions()` | `DecisionsCollection` | `.list()`, `.add()` |
| `getSkills()` | `SkillsCollection` | `.list()`, `.get(id)`, `.exists()` |
| `getTeam()` | `TeamCollection` | `.get()`, `.update()` |
| `getTemplates()` | `TemplatesCollection` | `.list()`, `.get(id)`, `.exists()` |
| `getConfig()` | `ConfigCollection` | `.get()`, `.update()`, `.exists()` |

`log` is accessible via `state.log` but not given a dedicated top-level accessor (it's internal plumbing; callers can reach it via `getState(id).then(s => s.log)` if needed).

---

## Cache Invalidation Strategy

A module-level `Map<string, SquadState>` caches one instance per `projectId`.

- **Hit:** returns the same in-memory instance — collections share the `FSStorageProvider`, which in turn hits the real filesystem on each collection `.get()` / `.list()` call. There is no stale-data risk for reads because the storage layer never caches file contents.
- **Invalidation trigger:** callers invoke `invalidateState(projectId)` to evict the entry. Appropriate when the project's linked `.squad/` path changes (e.g., after `linkProjectToSquad()` with a new path).
- **Process restart:** the Map is in-process memory only — it is rebuilt fresh on every server start.
- **Granularity:** per-projectId, not per-collection. Evicting a single project doesn't affect others.

---

## SDK Quirks Discovered

1. **`FSStorageProvider` constructor is optional-rootDir** — passing it confines all paths; omitting it allows the provider to touch anywhere. Always pass `rootDir` for security.
2. **`SquadState.fromStorage` is synchronous** — it doesn't validate the `.squad/` directory exists. Validation happens at a higher layer (the DB `projects.path` column is already validated on write).
3. **`log` collection exists on `SquadState`** but is not exported by the barrel in `state/index.d.ts` as a top-level named type import — it's accessible only via `state.log` at runtime.
4. **Collection constructors are not exported** — `AgentsCollection` etc. can be imported by name for typing purposes but should only be *instantiated* via `SquadState`, never `new AgentsCollection(...)` directly from service code.


# Decision: Heartbeat Bus Isolation

**Date:** 2026-05-15  
**Author:** McManus (Lead Architect)  
**Status:** Implemented

## Context

`engine/heartbeat.ts` emitted `heartbeat.sweep.completed` / `heartbeat.sweep.error`
through the shared project `EventBus` with `projectId: '__heartbeat__'` — a synthetic
server-wide sentinel. `services/ceremony-dispatcher.ts` listens to ALL events on that
bus and called `findMatchingCeremonies(event.projectId, ...)`, which passed
`'__heartbeat__'` directly to a Postgres UUID column → `22P02` error every 5 s.

## Decision: Option A — Separate `'heartbeat'` channel

`emitHeartbeatEvent()` now emits on the `'heartbeat'` EventEmitter channel instead
of the shared `'event'` channel. Use `eventBus.on('heartbeat', handler)` or the
new `eventBus.onHeartbeat(handler)` helper to subscribe.

**Why Option A over Option B:**
- Heartbeat events are server-wide infrastructure telemetry, not project events.
  Sharing the bus (even with `projectId: null`) would still require every subscriber
  to understand and guard against the null-project convention.
- The `'event'` channel contract is: every payload has a valid UUID `projectId`.
  Putting a non-UUID there violates that contract for all existing subscribers.
- No consumer was using the heartbeat bus events via WS or REST; the Heartbeat UI
  polls `GET /api/heartbeat` (reads internal state map) — no subscriber migration needed.

## Dispatcher Guard Pattern

In addition to the primary fix, `ceremony-dispatcher.ts` now has **two** defensive layers:

1. **Early type guard in `handleEvent`:** if `event.type.startsWith('heartbeat.')` → return immediately. This is belt-and-suspenders: heartbeat events no longer reach this handler via the `'event'` channel, but guards against future regressions.

2. **UUID guard in `findMatchingCeremonies`:** validates `projectId` against
   `/^[0-9a-f]{8}-...-[0-9a-f]{12}$/i` before issuing any DB query. Returns `[]`
   and logs a `debug`-level warning if the projectId is not UUID-shaped. This prevents
   ANY future synthetic sentinel (e.g. `consult:<id>`, `__global__`, etc.) from
   crashing the Postgres query.

**Rule for future contributors:** Any code that emits on the `'event'` channel MUST
supply a genuine project UUID in `projectId`. Server-wide / cross-project events
should use a separate named channel (e.g. `'heartbeat'`, `'global'`) or use
`subscribeGlobal()` on the consuming side with a UUID pre-check.


# McManus Decision Log — Heartbeat Sweep Registry (Phase 3)

**Date:** 2026-05-15  
**Author:** McManus (Lead Architect)  
**Commit:** feat(engine): heartbeat sweep registry replaces dispatcher tick (Phase 3)

---

## 1. Sweep Interface Shape

```typescript
interface Sweep {
  id: string;           // kebab-case identifier; used in routes + event payloads
  intervalMs: number;   // milliseconds between automatic runs
  enabled: boolean;     // runtime toggle — PATCH /api/heartbeat/sweeps/:id
  run(): Promise<SweepResult>;
}

interface SweepResult {
  acted: number;        // rows/records touched (reclaimed, marked, evicted, etc.)
  errors: number;       // sub-items that failed within this pass
  details?: string;     // optional human-readable summary for logs / UI
}
```

**Rationale:** Kept intentionally minimal. `acted` and `errors` give the UI enough signal to colour-code sweep health without forcing each sweep to emit a custom type. `details` is a free-form string rather than a typed map to avoid over-engineering at this stage.

---

## 2. Per-Sweep Intervals

| Sweep ID              | Interval | Replaces / Wraps                                              |
|-----------------------|----------|---------------------------------------------------------------|
| `stuck-issue-runs`    | 30 s     | sweepExpiredLeases + sweepOrphanedRuns + sweepExpiredStepLeases + sweepOrphanedWorkflowRuns + sweepReviewTimeouts |
| `idle-live-sessions`  | 60 s     | New — marks `active` live_sessions with no activity in 10 min as `idle` |
| `stale-presence`      | 30 s     | New — evicts in-memory presence records older than 60 s       |
| `ready-workflow-steps`|  5 s     | tickWorkflowAdvancement + claimAndRun (Stepper)               |
| `github-sync-overdue` | 60 s     | New — one-off pull for projects whose lastGithubSyncAt > 5 min ago |
| `ceremonies-due`      |  5 s     | sweepDueSchedules() from ceremony-scheduler.ts                |

**Interval rationale:**
- 5 s for the hot paths (workflow advancement, ceremonies) to match the old dispatcher cadence.
- 30 s for lease/presence cleanup — these are crash-recovery paths, not latency-sensitive.
- 60 s for idle-session and GitHub sync — both tolerate a minute of lag.

---

## 3. Dispatcher Deprecation Strategy

`dispatcher.ts` is **kept around but unused** for one release cycle. The import in `index.ts` was removed (the `dispatcher` singleton is still exported from the file but never called).  
- A `// DEPRECATED: replaced by engine/heartbeat.ts (Phase 3). Kept for one release cycle for rollback safety.` comment was added at the top of the file.  
- Rollback: revert `index.ts` to call `dispatcher.start()` / `dispatcher.stop()` instead of heartbeat — no other files need touching.  
- Planned deletion: next minor release after Phase 3 ships to production without incident.

---

## 4. EventBus Integration

Two new event types were added to `event-bus.ts`:

```typescript
type HeartbeatEventType =
  | 'heartbeat.sweep.completed'   // payload: { sweepId, result: SweepResult, durationMs }
  | 'heartbeat.sweep.error';      // payload: { sweepId, error: string, durationMs }
```

Both are emitted with `projectId = '__heartbeat__'` (a synthetic scope key) so they flow through the existing WS fan-out infrastructure without special-casing. Clients that want to observe sweep telemetry can subscribe with `{ projectId: '__heartbeat__' }`.

The approach mirrors how consult sessions use `consult:<sessionId>` as a synthetic project key — zero infrastructure changes needed.

---

## 5. Functional Completeness Note

The old dispatcher tick bundled 7 operations. The 6 new sweeps cover all 7:

| Old tick operation         | New sweep                |
|----------------------------|--------------------------|
| sweepExpiredLeases         | stuck-issue-runs (30 s)  |
| sweepOrphanedRuns          | stuck-issue-runs (30 s)  |
| sweepExpiredStepLeases     | stuck-issue-runs (30 s)  |
| sweepOrphanedWorkflowRuns  | stuck-issue-runs (30 s)  |
| sweepReviewTimeouts        | stuck-issue-runs (30 s)  |
| tickWorkflowAdvancement    | ready-workflow-steps (5 s)|
| claimAndRun (Stepper)      | ready-workflow-steps (5 s)|

No functionality was dropped.


# Decision Record — Verbal: Consult Stream Wiring (Phase 5)

**Date:** 2026-05-15T08:21:46.164-07:00  
**Author:** Verbal (Real-time / WebSocket Dev)  
**Task:** `p5-consult`

---

## Three event types settled on

| Event | Scope | Payload |
|---|---|---|
| `consult.request` | `SessionEventType` | `{ requestId, fromAgent, question, timestamp }` |
| `consult.response` | `SessionEventType` | `{ requestId, fromAgent, answer, timestamp }` |
| `consult.error` | `SessionEventType` | `{ message, timestamp, requestId? }` |

All three are added to `SessionEventType` in `event-bus.ts` so they route through `emitSessionEvent()` → the project WS room. No separate consult room is used for these; they flow inline with the rest of the transcript.

---

## How consult requests are detected in the SDK output stream

`RunningLiveSession.attachListeners()` in `squad-stream.ts` registers two new listeners on the SDK `SquadSessionLike` session object:

```ts
this.session.on('consult.request',  (e) => this.onConsultRequest(e));
this.session.on('consult.response', (e) => this.onConsultResponse(e));
```

These fire when the underlying SDK session emits those event names. The handlers use the existing `pickString()` helper to extract fields with fallback key sequences:

- `requestId` ← `requestId | id | req-<Date.now()>`
- `fromAgent` ← `fromAgent | agentName | agent | 'agent'`
- `question` ← `question | content | text | message`
- `answer` ← `answer | content | text | message`
- `timestamp` ← `timestamp | new Date().toISOString()`

If the SDK never emits these events (e.g. older SDK version) the listeners are simply no-ops — zero risk to the existing stream.

---

## SDK quirks discovered

- `@bradygaster/squad-sdk/dist/sharing/consult.d.ts` does **not exist** in the installed SDK version (`0.9.4`). The sharing/consult module is not yet published. This wiring is therefore forward-compatible: listeners register now, events will flow automatically once the SDK surface ships.
- The existing `ConsultEventType` in `event-bus.ts` (Phase 17 ask/consult mode) uses a different routing mechanism (`consult:<sessionId>` as the project key) for standalone consult sessions. The three new event types added here are distinct and scoped to the live session, not the standalone consult surface.

---

## WS routing

No new WS code was needed. `emitSessionEvent(type, projectId, payload)` already routes to the project room (`project:<projectId>`). All clients subscribed to the live session page already receive these events.

---

## Client rendering

`AgentActivityFeed.tsx` now renders:
- `consult.request` → `ConsultRow` left-aligned, dashed neutral border, 💬? icon, "asked" label
- `consult.response` → `ConsultRow` right-aligned, dashed neutral border, 💬↩ icon, "answered" label
- `consult.error` → `Pill` danger tone, 💬⚠ icon

No new chat surface; consult exchanges appear inline in the existing transcript scroll region.


### 2026-05-14T08:17:03Z: Project pivot — "foo" → Squadboard
**By:** Ahmed Sabbour (via Coordinator)
**What:** This repo is now the build for **Squadboard** — a local-first kanban + workflow board for Squad agents. Package `@sabbour/squadboard`, MIT, self-hosted.
**Why:** PRD landed at `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md` (~90KB, 15-demo roadmap). Original "foo" placeholder is retired.
**Stack:** Node + Express v5 · Postgres (embedded local / hosted cloud) + Drizzle · React 19 + Vite · WebSocket · Squad SDK · GitHub API.

### 2026-05-14T08:17:03Z: Team augmented for Squadboard
**By:** Ahmed Sabbour (via Coordinator)
**What:** Added 4 specialists to the existing 4-person team (Usual Suspects universe maintained):
- **Hockney** — Backend / Workflow Engine Dev
- **Kobayashi** — Squad SDK Integrator
- **Kujan** — Tester / QA (reject authority on durability + recovery contracts)
- **Redfoot** — DevRel / Docs (reject authority on user-facing copy)

Re-roled **Verbal** from "Interaction Dev" → "Real-time / WebSocket Dev" (project-scoped WS, event_log fan-out, since-id reconnect cursor, Live ops view feed).

Existing roles unchanged: McManus (Lead Architect), Keyser (Frontend Dev), Fenster (UX Designer).
**Why:** "foo"'s original 4 were a web-design team; Squadboard needs full-stack muscle.

### 2026-05-14T08:17:03Z: Five non-negotiable engine invariants (PRD §6.0)
**By:** Ahmed Sabbour (via PRD intake)
**What:**
1. `agent_run` is the only step that does LLM work. `peer_review`, tier-3 routing, and `split` desugar to `issue_runs` rows with distinct `kind` values.
2. **Single-spawner discipline.** The stepper alone spawns runs via `FOR UPDATE SKIP LOCKED`. The dispatcher only ticks/sweeps/wakes — never touches `issue_runs` except via sweepers.
3. Lease (90s TTL) + heartbeat (30s) is the authoritative liveness signal. `kill(pid, 0)` is an in-pod sanity check only.
4. Output schema validation happens at session end — after `sendAndWait` returns, before `recordRunCompletion`. Never on the post-tool-use hook.
5. `fan_out` and `split` materialize full child `workflow_runs` rows in one six-step transaction (issue + workflow_run + first step_run + issue_link + handoff_context + variables propagation). Children inherit `pinnedAgentRevisions` from parent.

**Enforcement:** Kujan has reject authority on PRs that violate these. Hockney owns implementation. McManus owns adjudication of any proposed change.

### 2026-05-14T08:17:03Z: Bypass `SquadCoordinator` (PRD Appendix A)
**By:** Ahmed Sabbour (via PRD intake)
**What:** The Squadboard engine reads `task.assignee` directly and calls `SquadClient.createSession()` for that one agent. Coordinator's regex routing and parallel fan-out are NOT used by the engine.
**Why:** Coordinator's parallel fan-out and ad-hoc handoffs are exactly what Squadboard exists to escape. We need deterministic, single-spawner orchestration with durable state.
**Owner:** Kobayashi.

### 2026-05-14T08:17:03Z: Postgres, not SQLite
**By:** Ahmed Sabbour (via PRD §6.13)
**What:** Storage is Postgres everywhere — embedded `embedded-postgres` (~50MB binary) for local install, hosted Postgres for cloud. Same Drizzle schema, same SQL surface (`FOR UPDATE SKIP LOCKED`, partial unique indexes, JSONB, recursive CTEs, tsvector).
**Why:** Same SQL across local + cloud is worth more than a smaller binary. SQLite was considered and rejected.
**Owner:** Hockney.

### 2026-05-14: PRD canonicalization
**By:** McManus (Lead Architect)
**What:** `docs/prd.md` (~12KB) is the canonical PRD for Squadboard. The research doc (`squad-web-design-v4.md`, 90KB) is the deep design appendix — implementation spec only. The five engine invariants are pasted verbatim into PRD §5. Roadmap = one-line-per-demo only. Verbal listed under re-roled title (Real-time / WebSocket Dev, not Interaction Dev).
**Next:** Redfoot to copy-pass for voice/clarity on `docs/prd.md`. Deep design file to be moved into repo proper (separate routing).

### 2026-05-14: Hacking phase workflow
**By:** Ahmed Sabbour (via Copilot)
**What:** We are in **hacking phase**. (1) Local git only. (2) Use worktrees per issue (`squad/{issue-number}-{slug}` branch). (3) No PRs. (4) Merge frequently into `main` locally. (5) Reviewer rejections (Kujan/Redfoot) happen inline on branch before merge, not via PR. Standard PR workflow resumes when user says "exit hacking phase".
**Why:** User directive — explicit team operating mode for current development phase.

### 2026-05-14: PRD copy pass approved
**By:** Redfoot
**What:** Copy pass on `docs/prd.md` complete and ✅ approved. 12,331 → 12,195 bytes (5 surgical edits). Tightened vision with active problem statement; simplified scope table grammar; improved architecture signal-to-noise; polished tech-stack links; removed instructional trailer. The 5 engine invariants verified paste-locked against `decisions.md`. 14-section structure intact. No follow-up issues flagged. Treat as final for hacking phase.
**Owner:** Redfoot (reject authority on user-facing copy).

### 2026-05-14: Top-level README authored
**By:** Redfoot
**What:** `README.md` at project root, 5,024 bytes. Hero banner uses `assets/squadboard-horizontal.svg` (full width, centered); smaller logo uses `assets/squadboard.svg` (bottom, inline with team names). 10 sections in show-before-tell order (quick-start precedes architecture). All content sourced from `docs/prd.md` — zero invention. Hacking-phase compliant: no Contributing/PR section, no CI badges, no npm badge. Honest status section notes "hacking phase, pre-1.0, breaking changes expected". Brand assets (both SVGs + square PNG) committed alongside.
**Source:** `decisions/inbox/redfoot-readme.md` (merged, inbox deleted).

### 2026-05-14: docs/deliverables.md is canonical work breakdown
**By:** McManus
**What:** `docs/deliverables.md` is the authoritative decomposition of the 15-demo roadmap. All agents reference it for owner assignments, dependencies, and exit criteria. Work items in this doc are the team's backlog for the hacking phase. The 5 engine invariants are tagged per demo so Kujan knows which durability tests each demo needs.
**Rationale:** Domain routing — Hockney owns engine/backend-primary demos (1, 4–10, 15). Kobayashi owns SDK-seam-primary demos (3, 14). Keyser owns UI-primary demos (2, 11, 13). Verbal owns real-time-primary demos (12). Every demo has secondary owners for cross-cutting work.

### 2026-05-14: docs/demos/ holds per-demo user-facing documentation
**By:** Redfoot
**What:** `docs/demos/` is the directory for per-demo user-facing documentation (15 stubs created, pattern: `demo-NN-{slug}.md`). Each stub includes status badge, layer, session time, outcome, prerequisites, "Run it" section, observables, and known gaps. Template discipline — every stub follows the same format. All claims sourced from PRD or marked TBD.
**Rationale:** McManus's `docs/deliverables.md` is the internal work breakdown; `docs/demos/` is what a developer running the demo sees. Hacking-phase compliant: no fake commands, no invented content. As each demo ships, the corresponding stub is updated in the same commit.

### 2026-05-14: docs/acceptance-criteria.md is the quality gate
**By:** Kujan
**What:** `docs/acceptance-criteria.md` defines functional + durability ACs per demo. A demo is NOT shippable until all its ACs have passing tests. Kujan has reject authority on any durability/recovery criterion. All 5 engine invariants are tagged in the demos that exercise them.
**Rationale:** Durability and recovery contracts are non-negotiable. If a PR lands without AC coverage, Kujan rejects, and a different agent (not the original author) writes the fix.

### 2026-05-14: Demo 1 backend scaffold choices
**By:** Hockney
**What:** pnpm workspaces monorepo. Express v5 + TypeScript ESM. embedded-postgres data dir: ~/.squadboard/data. Drizzle ORM for schema management. CLI package with `squadboard init` command. Port 3000.
**Details:**
- `packages/server` — Express v5, TypeScript ESM, embedded-postgres on port 54321, Drizzle ORM + pg driver
- `packages/cli` — `squadboard init` command, TCP-probes port 3000 before opening browser
- Bootstrap schema runs `CREATE TABLE IF NOT EXISTS` on server startup (Demo 1 pragmatic); proper `pnpm db:generate && pnpm db:push` supersedes this
- Wired Kobayashi's `/api/squad/register` to real DB insert (upsert by path column) — removed sidecar-only stub
- `embedded-postgres` data dir `~/.squadboard/data`, internal port 54321 (avoids clash with system Postgres on 5432)
- Client dist path: `packages/server/dist` → `../..` → `packages/client/dist` (Keyser's build output)

### 2026-05-14: .squad/ discovery strategy
**By:** Kobayashi
**What:** Discovery scans home dir (depth 3) + common dev dirs (~/src, ~/code, ~/projects, ~/dev, ~/workspace). Validation: must have team.md. Auto-registration creates projects row. Manual path entry also supported via GET /api/squad/validate.

### 2026-05-14: Demo 1 frontend stack
**By:** Keyser
**What:** Vite 6 + React 19 + TypeScript ESM. Tailwind CSS v4. TanStack Query v5. React Router v7. Dark mode first (GitHub palette). No component library — custom components only. Fenster does visual passes. API client proxies to localhost:3000.

### 2026-05-14: Demo 2 — Issues/Comments/Labels schema
**By:** Hockney
**What:** issues.status uses pgEnum (backlog/todo/in_progress/in_review/done). position integer for column ordering. Soft delete via archived flag. Bulk action via POST /bulk. Move endpoint recalculates positions.
**Details:**
- Issues table: status enum (backlog/todo/in_progress/in_review/done), position ordering, soft-delete via archived flag
- Comments table: markdown body, threaded per issue
- Labels table: per-project, colored badges, many-to-many issue_labels join table
- 14 endpoints: POST/GET issues, POST issue, PUT/DELETE issue, POST move, POST bulk, POST/GET comments, POST comment, DELETE comment, GET/POST labels, POST add-label, DELETE label-link
**Owner:** Hockney (backend)

### 2026-05-14: Demo 2 — Kanban board UI
**By:** Keyser
**What:** @hello-pangea/dnd for drag-drop (maintained react-beautiful-dnd fork). Optimistic updates on drag. CardDetail as right slide-over (not page nav). Multi-select via checkbox. BulkActionBar at bottom when selection active. Five fixed columns matching DB enum.
**Details:**
- Five-column board (backlog/todo/in_progress/in_review/done) with drag-and-drop persistence
- IssueCard component: labels, assignee avatar, comment count, multi-select checkbox
- CardDetail: right-side slide-over with full card view, comments, label picker
- BulkActionBar: move/archive batch operations when items selected
- FilterBar: title search + label filter chips
- CreateIssueModal, CommentList (react-markdown + remark-gfm), AddComment
**Owner:** Keyser (frontend)

### 2026-05-14: Agent sync strategy (Demo 3)
**By:** Kobayashi
**What:** File-on-disk is source of truth. DB is a sync mirror (upsert on hash change). Hire creates files first, then DB row. Disable = status='disabled' in DB, file untouched. Charter changes detected via md5 hash. chokidar watches for live reload.
**Rationale:** Ensures agent state persists cleanly across server restarts and team collaboration — no divergence between filesystem and database.

### 2026-05-14: Agents UI pattern (Demo 3)
**By:** Keyser
**What:** Agents page uses grid layout (not list). Two sections: Active + Disabled. AgentDetailPanel is 520px slide-over (wider than board's 480px for charter editing). Charter editing is raw textarea (no Monaco in Demo 3 — Monaco lands in Demo 11). HireAgentModal validates kebab-case name.
**Rationale:** Grid scales better for scanning agents; dual sections clarify state at a glance. Wider panel accommodates charter editing; raw textarea keeps Demo 3 lean.

### 2026-05-14: Engine core architecture (Demo 4)
**By:** Hockney
**What:** Dispatcher tick=5s (sweep→wake→advance). Stepper uses raw SQL FOR UPDATE SKIP LOCKED (Drizzle doesn't support it). Lease TTL=90s, heartbeat=30s. Three workspace strategies: scratch (tmpdir), dir (~/.squadboard/workspaces), worktree (stubbed for Demo 4). SSE stream uses 1s DB poll for Demo 4 (real pipe streaming in Demo 12). Sweeper runs on every tick. Invariants 1, 2, 3 now enforced.
**Details:**
- Schema: issueRuns, workflowRuns, stepRuns + status/strategy enums
- Dispatcher: 5s tick loop (sweep → wake → advance)
- Stepper: claim-and-run with raw SQL FOR UPDATE SKIP LOCKED
- Sweeper: reclaim expired leases + orphaned runs on crash/restart
- Workspace: scratch (tmpdir), dir (~/.squadboard/workspaces), worktree (stubbed)
- Routes: POST/GET issue runs, GET run status, POST cancel, GET SSE stream

### 2026-05-14: SDK bridge architecture (Demo 4)
**By:** Kobayashi
**What:** executeAgentRun() is the ONLY function the engine calls for LLM work (Invariant 1 enforced). SquadCoordinator bypass confirmed: engine calls SquadClient.createSession() directly. SDK gracefully degrades to stub when @sabbour/squad-sdk not installed. OutputStreamer streams chunks to DB. CostTracker records per run.
**Details:**
- executeAgentRun(): single entry point, reads charter, calls SquadClient directly
- SquadClient: @sabbour/squad-sdk wrapper with graceful stub fallback
- OutputStreamer: incremental SQL COALESCE append to issue_runs.output
- CostTracker: per-run token + cost recording

### 2026-05-14: Run status UI pattern (Demo 4)
**By:** Keyser
**What:** RunOutputPanel uses EventSource (SSE) for real-time output. Terminal-style display (#0d1117 bg, monospace, green text). RunHistory tab added to CardDetail. RunButton in IssueCard footer. CostDisplay shows $X.XXX · N tokens. Running state uses animated pulse badge.
**Details:**
- RunButton: agent selector dropdown + start/cancel/done states
- RunOutputPanel: SSE EventSource, terminal-style, auto-scroll
- RunStatusBadge: 5 states with animated pulse on Running
- RunHistory: collapsible run list in CardDetail Runs tab
- CostDisplay: $X.XXX · N tokens format
- Updated: IssueCard footer, CardDetail tabs, KanbanColumn/Board prop threading

### 2026-05-14: Demo 5 — Routing Tier 1 architecture
**By:** Hockney
**What:** Routing desugars to issue_runs kind='agent_run' (Invariant 1). Rules loaded from routing.md into routing_rules cache table. Match order: label > keyword > catchall. Hot-reload is restart-only (v1 non-goal). resolveRoute returns null for Tier 2/3 escalation (Demo 8).

### 2026-05-14: Demo 5 — routing.md parse strategy
**By:** Kobayashi
**What:** Parser reads actual .squad/routing.md table format. MatchType inferred from pattern: label: prefix → label, * → catchall, else keyword. Priority = file order. matchRule() used by Hockney's router.ts. RoutingBadge shows auto-assignment provenance on IssueCard.

### 2026-05-14: Demo 14 — MCP server binding (Open Question #7 resolution)
**By:** Kobayashi (SDK Integrator)
**What:** The MCP server is implemented as a **stdio server** (not TCP), spawned as a separate process via `squadboard mcp`. This supersedes the "same process, localhost TCP" proposal from the deliverables brief — stdio is simpler, requires no port management, and is the standard transport for MCP hosts (Claude Desktop, Cursor, etc.).

- Entry point: `packages/server/dist/mcp/index.js`
- Transport: stdio (JSON-RPC 2.0 over stdin/stdout, stderr for logs)
- Started via: `squadboard mcp` CLI command
- MCP tools exposed: `squadboard_list_issues`, `squadboard_create_issue`, `squadboard_run_agent`, `squadboard_get_run_status`, `squadboard_list_agents`, `squadboard_slash_command`
- SDK: `@modelcontextprotocol/sdk@^1.29.0` (installed in `packages/server`)
- Slash handler: `packages/server/src/mcp/slash-handler.ts` — parses `/squadboard <cmd>` strings, returns markdown
- Express stays on port 3000; no MCP TCP port needed.

**Rationale:** stdio avoids port conflicts, firewall issues, and is the de-facto MCP convention. Claude Desktop config snippet printed to stderr on `squadboard mcp` startup.

### Demo 9 open question #2 resolution: `request_changes_policy` default
**By:** Hockney
**What:** `request_changes_policy` on `approve` workflow steps defaults to `'first'` — the first reviewer who requests changes blocks the workflow and re-queues the prior agent_run step with feedback injected. This mirrors GitHub PR semantics.
**Allowed values:** `'first'` (default) | `'majority'` (strict majority must request changes to block) | `'all'` (every reviewer must request changes to block).
**Interaction with `quorum`:** `quorum: { n: 2, of: 3 }` requires ≥ N approvals before the policy is evaluated. A `'first'` request_changes short-circuits regardless of quorum — the veto lands the moment any single reviewer requests changes.
**Why 'first':** Safety over convenience. One reviewer seeing a problem is enough to stop the train. Teams wanting permissive gates can opt into `'majority'` or `'all'` explicitly.
**Enforced at:** `peer-reviewer.ts::shouldBlock()` + `workflow-runner.ts::handleApproveStep()`.
**Owner:** Hockney.


- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
- The five engine invariants above are non-negotiable without an explicit decision entry overriding them

### Demo 12 open question #6 resolution: Optimistic concurrency for concurrent issue edits
**By:** Verbal (Real-time / WebSocket Dev)
**What:** Concurrent edit conflicts on issues are resolved using an **optimistic concurrency token** — a `version INTEGER NOT NULL DEFAULT 1` column on the `issues` table.
**Protocol:**
- Every `GET /api/projects/:projectId/issues/:id` response includes `version`.
- `PATCH /api/projects/:projectId/issues/:id` — if the request body includes `version`, the update is conditional: `WHERE id = ? AND version = ?`. If zero rows are updated (mismatch), the server returns `409 { error: 'conflict', currentVersion: N }`. The client must re-fetch and re-apply its edit.
- On every successful PATCH the server increments `version` atomically: `SET version = version + 1`.
- If `version` is omitted from PATCH, the legacy path runs (no concurrency check) — backward compatible.
**Why optimistic (not pessimistic):**
- Lock-free reads; no deadlock risk.
- Conflicts are rare on a kanban board; rejecting and re-fetching is cheap.
- Works across multiple tabs without server-side session state.
**Implementation:** `routes/issues.ts` PATCH handler; `db/schema.ts` + `db/index.ts` migration.
**Owner:** Verbal.

### Demo 15 open question #8 resolution: GitHub issue mirroring is OFF by default, opt-in per project
**By:** Hockney (Backend / Workflow Engine Dev)
**What:** GitHub issue mirroring (push Squadboard issues to GitHub Issues) is **disabled by default** on every project. It becomes active only when explicitly enabled via `PUT /api/projects/:id/github` with a valid PAT + owner + repo.
**Mechanism:**
- `projects.github_sync_enabled BOOLEAN DEFAULT FALSE` — gate column; sync hooks short-circuit immediately if false.
- `projects.github_token TEXT` — GitHub Personal Access Token, stored in plaintext in Postgres.
- `projects.github_owner TEXT`, `projects.github_repo TEXT` — target repository.
- `PUT /api/projects/:id/github { token, owner, repo }` enables sync and starts a 60 s pull loop.
- `DELETE /api/projects/:id/github` disables sync and stops the pull loop.
**Security note:** Token stored in plaintext is acceptable for the local-first hacking phase (Postgres is embedded and not exposed). **Production deployments MUST use a secrets manager** (e.g., AWS Secrets Manager, Azure Key Vault, HashiCorp Vault) and store only a secret reference in the DB column. This is a known tech debt item; do not ship to multi-tenant cloud without addressing it.
**Why opt-in:** Teams using Squadboard for internal planning should not be required to expose their issues to GitHub. Mirroring is an advanced integration — opting in is the safe default.
**Owner:** Hockney.
**Files:** `packages/server/src/github/client.ts`, `sync.ts`, `sync-hook.ts`, `routes/github-sync.ts`, `db/schema.ts`, `db/index.ts`.

### 2026-05-15: Coordinator session-state snapshot
**By:** Ahmed Sabbour (via Copilot CLI / Squad coordinator)
**What:** Durable snapshot of mid-session state — what was just dispatched, what has shipped, what's open. Triple-recorded across `plan.md`, `todos` SQL table, and this file so the session can resume from any of the three.

**Why:** User directive — *"You need to track all this somewhere durable in case the session crashes."* Compaction has already happened twice this session; rotating snapshots prevents replanning loss.

**Snapshot:**

- **Recently shipped (this segment):**
  - `42c120a0` feat(issues): Formulate with AI on the New Issue dialog (Keyser)
  - `a97e2bce` fix(ui): build break + 204 cache + Routing crash + sidebar/Consult overhaul

- **In flight (5 background agents):**
  - ⚛️ Keyser → Consult page layout rebalance (`pages/Consult.tsx`)
  - 🎨 Fenster → Fluent2 typography + spacing consistency sweep (app-wide)
  - 🏛 McManus → Customizable kanban columns slice (column_meta table + drawer)
  - 🔧 Hockney → Timezone "7 hours ago" bug (withTimezone:true on user-facing timestamps)
  - 📡 Verbal → Uber Now view `/now` (cross-project aggregator + global WS scope + page)

- **Open bugs not yet dispatched:** issue spam loop (createIssue mutation runaway), `fry/` agent dir investigation, `p1-verify` smoke pass.

- **Active machinery:** `manage_schedule` schedule #1 (10-min recurring status pings).

**Resume rule:** if compaction or crash strikes, the next session can rebuild from `plan.md → "Session in flight — coordinator snapshot (2026-05-15 05:20 PDT)"` plus `SELECT * FROM todos WHERE id LIKE 's-%'`.

**Forward-compatibility:** all 5 in-flight agents are independent — no inter-agent file conflicts. They will each commit atomically with explicit `git add` paths. Merge order doesn't matter.

### 2026-05-14: New chore extension
**By:** Ahmed (via Copilot)
**What:** Added squadboard-chore extension for housekeeping tasks that aren't bugs or features, with no docs requirement.
**Why:** Productize the chore workflow alongside add-feature and report-bug.

### 2026-05-15: Fluent2 typography + spacing consistency canon
**By:** Fenster (UX Designer)
**Status:** Ratified — apply app-wide

Reference shape: `pages/PageHeader.tsx` uses `<Title2>` / `<Subtitle1>` for page title, `<Caption1>` for eyebrow/description, `tokens.*` for all spacing.

Typography map: page title → `<Subtitle1 as="h1">`, section heading → `<Caption1>` uppercase+semibold, card title → `<Subtitle2>`, body → `<Body1Strong>` (bold labels) or `<Body1>` (running text), secondary metadata → `<Caption1>`, muted labels → `<Caption1>` with `colorNeutralForeground3`.

Spacing: page padding → `spacingVerticalXXL` (24px) + `spacingHorizontalXXL`, section gap → `spacingVerticalXXL`, list row gap → `spacingVerticalS` (8px), card row padding → `spacingVerticalM` (12px) × `spacingHorizontalL` (16px), icon-to-text → `spacingHorizontalXS` (4px).

Color: primary text → `colorNeutralForeground1`, secondary → `colorNeutralForeground2`, muted → `colorNeutralForeground3`, placeholder → `colorNeutralForeground4`. Layout colors remain `var(--surface)`, `var(--border)`, `var(--bg)`, `var(--accent)`, `var(--danger)`, `var(--success)`.

Font-weight: 400 → `fontWeightRegular`, 500 → `fontWeightMedium`, 600 → `fontWeightSemibold`, 700 → `fontWeightBold`. Prefer `<*Strong>` variant.

Global CSS: kept `box-sizing: border-box`, `margin/padding: 0` on `*`, `html/body/#root { height: 100% }`, `-webkit-font-smoothing`, `a { color: var(--accent) }`, `button fallbacks`. Removed conflicting rules (body font-family/size delegated to FluentProvider).

Exclusions: `CeremonyEditor.tsx`, `Consult.tsx` (pre-existing TS errors owned by other workers).

### 2026-05-15: Issue attachments — BYTEA + 5MB cap + multer
**By:** Hockney (Backend Dev)
**Status:** Shipped

Chose BYTEA in PostgreSQL (not filesystem) for transactional atomicity, no orphaned files, zero new infrastructure, single backup/restore story. 5 MB cap (enforced at multer stream level + service layer guard). Allowed MIME types: `image/{png,jpeg,gif,webp,svg+xml}` (markdown-embeddable images, SVG included for diagrams). Error codes: `image_too_large`, `unsupported_type`.

URL shape: `/api/projects/:projectId/issues/:issueId/attachments/:attachmentId` (relative in JSON responses, writable into markdown as `![alt](url)`). Attachment IDs are UUIDs; delete+re-upload → new ID, so `Cache-Control: public, max-age=31536000, immutable` is safe.

Cascade: `issue_attachments.issue_id` FK has `ON DELETE CASCADE` (hard-delete issue removes all attachments). Issues use soft-delete (`archived=1`) so attachments persist until explicit removal or issue hard-delete.

### 2026-05-15: Standard "create" page pattern — CeremonyEditor lead example
**By:** Kobayashi (Squad SDK Integrator)
**Status:** Adopted

Every create page should follow CeremonyEditor's create-mode pattern:
1. `<PageHeader title="New <artifact>" description="…" />` — canonical header.
2. Dismissible intro card (Fluent2, `<Body1>` explanation, `<Dismiss16Regular>` button, `localStorage: squadboard.<artifactType>.introDismissed`).
3. Formulate / Conjure entrypoint at top — `<FormulatePanel>` calls generate/formulate endpoint, populates fields, switches to review tab.
4. Labeled pickers with descriptions — `<RadioGroup>` with `label=${technicalName} — ${humanDescription}` instead of plain `<Dropdown>`.
5. Sensible defaults on create — pre-populate most common values so user can click "Create" immediately.

Edit mode: suppress PageHeader, intro card, Formulate panel. Keep compact header with badges, validate, run, save buttons.

Apply to: New skill, New tool, New MCP server, New agent (HireAgent), New team (HireTeam) — add intro card + PageHeader where missing.

### 2026-05-15: Multi-modal issue bodies — react-markdown + code/image toolbar
**By:** McManus (Lead Architect)
**Status:** Shipped

Markdown library: `react-markdown@10` + `remark-gfm@4` + `rehype-highlight` (new). Base renderer already in use, GFM tables/strikethrough/task lists free from remark-gfm (already installed), rehype-highlight is de-facto standard with first-party TS types. `highlight.js` installed as peer for CSS themes.

Create-flow image tradeoff: chose **Option A** — disable image uploads in create until issue is saved. `MarkdownBodyEditor` accepts `issueId?: string`; if undefined, Image toolbar button, paste handler, drop handler are disabled. Tooltip: *"Save the issue first to attach images."* Code-block button remains active for keyboard-first users. Option B (optimistic issue creation on first paste/drop) deferred — increases complexity (modal state transition, mid-session issueId bubble-back, orphaned issue recovery).

Image domain whitelist: `IssueBodyMarkdown` overrides `img` component in ReactMarkdown. Images with `src` starting with `/api/projects/` render normally. All other `src` replaced with `[external image redacted]` note (prevents malicious tracking pixels embedded in user-supplied markdown).

Toolbar: `Code24Regular` (fenced code block, wraps selection or inserts empty) + `Image24Regular` (opens `<input type="file" accept="image/*">`). Kept minimal; bold/italic deferred (engineers comfortable with raw markdown syntax).

Future: Option B create-flow uploads, EditIssueModal, attachment delete button in CardDetail thumbnails, lightbox on thumbnail click, bold/italic buttons.

### 2026-05-15: Kujan QA Investigation — spam loop + fry cleanup + formatDistanceToNow guards
**By:** Kujan (Tester / QA)
**Date:** 2026-05-15
**Status:** Investigation complete; findings + recommendations logged

**Scope:** Read-only investigation; diagnostic findings only, no code changes in Kujan's pass.

**A. Issue Spam Loop — Root Cause (Medium Confidence)**
- `ceremony-scheduler.ts::sweepDueSchedules()` appears idempotent (two-phase pattern with tentative `nextFireAt` advance, exception handling does not update to future timestamp if error occurs — but 5-min tentative prevents immediate re-fire on 5s tick).
- `consult-stream.ts` does NOT retry with title mutation.
- Symptom pattern (`... — verbal — verbal — fenster`) suggests looping/retry mechanism outside primary files. Most likely: **a caller of `acceptProposeIssue()` / `acceptProposeConversation()` that retries on error**, OR **background middleware that mutates titles on each attempt.**
- **Proposed fix:** Add error logging + rethrow in sweep catch block; add unique constraint on `(projectId, title)` with partial `WHERE archived = 0` filter; add dedup check before `createIssue()` in consult flow.
- **Owner:** Verbal (backend investigation) + McManus (ceremonies audit). **Follow-up:** Verbal to investigate retry paths and error handlers.

**B. Fry Agent Directory — Orphan / Vestigial**
- `.squad/agents/fry/` exists on disk with `history.md` (Frontend Dev learnings), but NOT in `team.md` or casting registry.
- Status: confirmed orphan, likely one-off frontend audit.
- **Recommendation:** Archive to `.squad/agents/_alumni/fry/` (Coordinator action). Do not add to team.md unless reactivated.

**C. formatDistanceToNow Crash Guard — Partial Fix Verified**
- `RoutingLogTable.tsx` (lines 21–30): Guard properly in place; durable fix.
- 7 other callsites unguarded and vulnerable (CommentList.tsx lines 80, 142, 184; CardDetail.tsx:211; DeliverableCard.tsx:83–84; AgentDetailPanel.tsx:224, 230).
- Root cause: If timestamps come back as `null`, `undefined`, or unparseable string, unguarded calls crash.
- **Owner:** Hockney (frontend fix batch). Recommendation: Apply `safeRelativeTime()` guard pattern universally or upstream-normalize dates in API serialization.

**D. WebSocket Reconnect & StrictMode — Verified OK**
- `ws-client.ts` singleton, idempotent cleanup (nullifies handlers, closes socket, sets to null), no render-time loops, retry scheduled outside render cycle.
- StrictMode cleanup: cleanup() method is idempotent; no racy reconnect loops.
- **Status:** No action needed.

### 2026-05-15: Diagnostics service shape (Demo 3 / System Ops)
**By:** Hockney (Backend / Workflow Engine Dev)
**Status:** Shipped in Phase 3

**What:**
- Created `services/diagnostics.ts` with 8 parallel checks: `sdk.client`, `sdk.models`, `github.auth`, `squad_dir.shape`, `postgres.health`, `websocket.health`, `mcp.servers`, `disk.writeable`.
- All checks run in parallel via `Promise.all`; each individually try/catch guarded (no single failure short-circuits rest).
- Created `routes/diagnostics.ts` with 5-second in-memory cache (global + project-scoped via `Map<projectId, result>`).
- Registered `GET /api/diagnostics` (server-wide) and `GET /api/projects/:id/diagnostics` (project-scoped).

**Rationale:**
- Parallel execution keeps wall-clock time under slowest check (~10s SDK timeout) vs. summing all timeouts.
- 5s cache prevents thundering-herd on doctor UI refresh button.
- `github.auth` is warn-only (not fail) — local-first usage without `gh` CLI is supported.
- `postgres.health` uses 50ms deadline on `pool.connect()` + `client.query()` — embedded Postgres should respond sub-millisecond; slower warrants fail.
- `mcp.servers` skips gracefully when `mcp_servers` table absent (matches progressive schema bootstrap).
- `disk.writeable` checks `~/.squadboard/data` + project's `.squad/` (if projectId in scope).
- Used existing `getWebSocketServer()` from `realtime/ws-server.ts` to avoid new singleton coupling.

### 2026-05-15: Top-level routes for Diagnostics and Heartbeat (Demo 3 UI)
**By:** Keyser (Frontend Dev)
**Status:** Shipped in Phase 3

**Routes chosen:**
- **Diagnostics:** `/diagnostics` (global) + `/projects/:id/diagnostics` (project-scoped, mirrors server endpoint).
- **Heartbeat:** `/heartbeat` (system-level, not project-scoped).

**Rationale for top-level:**
- Rejected nested under Settings — diagnostics is operational, not configurational. Top-level route lets ops staff reach it directly without selecting a project first.
- Rejected Dashboard panel slot — Heartbeat and Diagnostics verbose enough for own full pages; Dashboard already dense.
- `useDiagnostics` hook reads `projectId` from `useParams`, switches between `/api/diagnostics` and `/api/projects/:id/diagnostics` automatically.

**Nav placement:** New **SYSTEM** section header in sidebar (above project-scoped groups), matching existing `OPERATIONS` / `WORK` / `SQUAD` grouping convention in `Layout.tsx`.

### 2026-05-15: Spam loop — confirmed root cause + three defensive guards shipped
**By:** Verbal (Real-time / WebSocket Dev)
**Status:** Defensive fix shipped (commit 504f4a57); root cause confirmed P0 follow-up

**Root Cause (Confirmed):**
`resolveAnchorIssue` in `ceremony-scheduler.ts` (line 131) picks the **most recently created** issue:
```ts
.orderBy(sql`${schema.issues.createdAt} DESC`)
.limit(1);
```
Fan-out child issues (`Foo — verbal`, `Foo — fenster`) are themselves most recently created after fan-out. On next cron tick, scheduler anchors its new workflow run on `Foo — fenster` (latest child), which itself has a fan-out step in YAML. That second run creates grandchildren `Foo — fenster — verbal` / `Foo — fenster — fenster`, etc. Pattern `Foo — verbal — verbal — fenster` is a specific slice of ever-deepening tree.

**Secondary compounding vector (concurrent ticks):**
`UPDATE step_runs SET status = 'splitting'` inside `materializeFanOut` had no `AND status = 'pending'` guard. Two concurrent `advanceWorkflowRun` calls would both pass `if (stepRun.status === 'pending')` check, both enter transaction, both create child issues.

**Three Guards Shipped:**

1. **`services/issues.ts` — `createIssue` dedup guard:**
   Before INSERT, query for non-archived issue with same `(projectId, title)` created within 60 seconds. If found, return existing issue + log warning. Added optional `idempotencyKey?: string` parameter (reserved for future 24-h window; not wired yet).
   Note: `materializeFanOut` bypasses `createIssue` (raw SQL INSERTs), so guard only covers service layer + HTTP callers. Still valuable for consult-stream.

2. **`services/ceremony-scheduler.ts` — loud sweep failures + 1-h backoff:**
   Replaced silent `console.error` with structured message including consecutive failure count (module-level `Map<string, number>`).
   On ≥2 consecutive failures for same schedule, `nextFireAt` pushed to `now + 1h` (overrides tentative 5-min placeholder). Breaks re-entry storm.
   Failure count reset to zero on any successful fire or skip.

3. **`engine/fan-out.ts` — two guards:**
   - **Concurrency guard (Step 2, 6-step transaction):** Changed `UPDATE step_runs SET status = 'splitting' WHERE id = $1` to add `AND status = 'pending'`. If `rowCount === 0`, ROLLBACK + return `[]` — concurrent winner already claimed step.
   - **Title compound guard (child title construction):** Before computing `childTitle = \`${issue.title} — ${target.label}\``, check if `issue.title` already ends with ` — ${target.label}`. If true, log warning + use parent title as-is, preventing double-suffix.

**P0 Follow-ups Required:**
| Priority | Item |
|---|---|
| P0 | **Fix `resolveAnchorIssue`** to exclude fan-out child issues (filter out issues with `issue_links` row `link_type = 'fan_out'`). **This is the actual loop driver.** |
| P1 | Add proper `UNIQUE` index on `(project_id, title)` with partial `WHERE archived = 0` (requires Drizzle migration). |
| P1 | Persist sweep failure count to DB (or Redis key) so process restart doesn't reset backoff. |
| P2 | `materializeFanOut` should check `child_workflow_run_ids` is empty before creating children (additional idempotency layer post-concurrency guard). |
| P3 | `tickWorkflowAdvancement` has no `FOR UPDATE SKIP LOCKED` on workflow runs; multi-instance deployments can both advance same run. Concurrency guard in fan-out.ts mitigates for fan-out steps only. |
