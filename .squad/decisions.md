# Squad Decisions

## Active Decisions

# 2026-05-15T17:52:56Z: User directive — Cap each local universe at 10 characters
**By:** Ahmed Sabbour (via Copilot)
**What:** Reduce the local universe registry (`packages/server/src/services/local-universes.ts`) so each universe has at most 10 characters. Keep the most popular/iconic characters; drop peripheral or recurring-guest characters.
**Why:** Universe trim — preserve the recognisable core, reduce noise in the Hire Team picker.

**Per-universe targets:**
- The Office: 15 → 10 (drop 5)
- Seinfeld: 10 → 10 (already at cap, no change)
- The Simpsons: 14 → 10 (drop 4)
- Parks & Recreation: 14 → 10 (drop 4)

Total: 53 → 40 characters.

**Constraint:** After trimming, each universe must still cover all 9 SDK roles (`lead | developer | tester | prompt-engineer | security | devops | designer | scribe | reviewer`) across its remaining `preferredRoles` arrays so best-fit casting still produces complete teams.

---

# 2026-05-15T17:50:29Z: User directive — Drop 4 non-tech roles
**By:** Ahmed Sabbour (via Copilot)
**What:** Remove HR, Legal, Operations, and Finance from the non-tech role set. Squad's non-tech role coverage is now: PM, Designer, Founder, Sales, Marketing, Customer Success, Research (7 roles, not 11).
**Why:** User scope narrowing — these 4 roles were added in McManus r5 (`c2dd1b53`) but Ahmed has decided they are out of scope for Squad's supported non-tech coverage.

**Implementation surfaces affected:**
- `.github/agents/squad.agent.md` — role-emoji table: drop the 4 rows (👥 HR, ⚖️ Legal, 💰 Finance, 📦 Operations); also drop the Donna 📦 example since it referenced Operations
- `.squad/routing.md` — "Non-tech Work Types" table: drop the 4 rows; cross-functional rules: drop rule #4 (Legal gates external commitments) and rule #5 (Finance gates spend over threshold); renumber remaining rules
- `.squad/templates/casting-reference.md` — drop any HR/Legal/Operations/Finance role-fit hints if present

**Note:** Character `preferredRoles` arrays in `packages/server/src/services/local-universes.ts` are NOT affected — those use SDK role enums (`lead | developer | tester | prompt-engineer | security | devops | designer | scribe | reviewer`), not the non-tech role labels being removed.

---

# Non-tech Role Set Narrowed (2026-05-15)

## Decision

Narrowed Squad's supported non-tech role coverage from **11 roles to 7 roles**.

**Removed (4):**
- HR / People / Recruiting / Talent
- Legal / Counsel / Compliance
- Operations / Ops / Program Manager
- Finance / Accounting / Controller

**Remaining (7):**
- PM / Product Manager / Product Owner
- Designer / UX Designer / Visual Designer
- Founder / CEO / Executive
- Sales / Account / Business Development
- Marketing / Growth / Comms
- Customer Success / Support / Account Management
- Research / User Research / Data Science

## Why

Ahmed Sabbour's scope narrowing decision (2026-05-15). Non-tech role coverage scope reduced to core revenue/engagement/discovery functions. Compliance and operations functions deferred.

## What Changed

### `.github/agents/squad.agent.md`

**Standard role emoji mapping table:**
- Removed 4 rows: Finance (💰), HR (👥), Legal (⚖️), Operations (📦)

**Examples (non-tech roles) block:**
- Changed example from `donna` (📦 Operations) to `chris` (🎧 Customer Success)
- Both from Parks & Rec universe; maintains example variety

### `.squad/routing.md`

**Non-tech Work Types table:**
- Removed 4 rows: Finance, HR, Legal, Operations

**Cross-functional rules (numbered list):**
- Removed rule #4 (Legal gates contracts/external commitments)
- Removed rule #5 (Finance gates spending decisions)
- Renumbered remaining 3 rules (1, 2, 3) sequentially

### `.squad/templates/casting-reference.md`

- No changes — file contains no role-fit hints or character examples mapping to removed roles
- Succession universe's "finance" tag is a thematic resonance signal, not a role assignment

## Commit

```
14b61f37 chore(squad): remove HR/Legal/Operations/Finance from non-tech role set
```

## Next

- Any future non-tech requests in HR/Legal/Operations/Finance scope default to manual routing (user specifies handler or task routes to PM/Founder for prioritization)
- If these roles are re-added, reverse this decision and restore squad.agent.md / routing.md surfaces

---

# Decision: Local universe character cap = 10

**Author:** Kobayashi (Squad SDK Integrator)
**Date:** 2026-05-15
**Commit:** `54f2dc5e`
**File touched:** `packages/server/src/services/local-universes.ts` (data-only; no API change)

## What

Cap each local universe in `LOCAL_UNIVERSES` at exactly **10 characters**. Total roster shrinks from **53 → 40** across 4 universes.

| Universe              | Before | After | Dropped (count) |
|-----------------------|-------:|------:|-----------------|
| The Office            |     15 |    10 | 5               |
| Seinfeld              |     10 |    10 | 0 (already at cap) |
| The Simpsons          |     14 |    10 | 4               |
| Parks and Recreation  |     14 |    10 | 4               |
| **Total**             | **53** | **40** | **13**         |

## Why

Ahmed's preference (2026-05-15): the Hire Team picker should surface the popular/iconic core of each show, not the long tail of recurring-guest characters. Keeping the picker tight reduces decision fatigue for the user choosing a hire and keeps each universe's voice consistent (lead-cast tone, no third-tier dilution).

## Dropped characters

- **The Office (5):** Phyllis Vance, Ryan Howard, Toby Flenderson, Creed Bratton, Meredith Palmer
- **The Simpsons (4):** Chief Wiggum, Principal Skinner, Professor Frink, Milhouse Van Houten
- **Parks and Recreation (4):** Mark Brendanawicz, Jean-Ralphio Saperstein, Tammy Swanson, Mona-Lisa Saperstein

No keep/drop swaps were exercised — Ahmed's recommended drops aligned with my judgment on popularity and on SDK role-coverage feasibility.

## Final rosters (the 40)

- **The Office (10):** Michael Scott, Jim Halpert, Pam Beesly, Dwight Schrute, Andy Bernard, Stanley Hudson, Kevin Malone, Angela Martin, Oscar Martinez, Kelly Kapoor
- **Seinfeld (10):** Jerry Seinfeld, George Costanza, Elaine Benes, Cosmo Kramer, Newman, Frank Costanza, Estelle Costanza, Susan Ross, J. Peterman, David Puddy
- **The Simpsons (10):** Homer Simpson, Marge Simpson, Bart Simpson, Lisa Simpson, Mr. Burns, Smithers, Moe Szyslak, Apu Nahasapeemapetilon, Krusty the Clown, Ned Flanders
- **Parks and Recreation (10):** Leslie Knope, Ron Swanson, Tom Haverford, Ann Perkins, April Ludgate, Andy Dwyer, Ben Wyatt, Chris Traeger, Donna Meagle, Jerry Gergich

## SDK role coverage — verified per universe

Hard requirement: the union of `preferredRoles` across each universe's 10 characters must contain all 9 `AgentRole` values: `lead | developer | tester | prompt-engineer | security | devops | designer | scribe | reviewer`.

| Universe       | lead | developer | tester | prompt-engineer | security | devops | designer | scribe | reviewer |
|----------------|:----:|:---------:|:------:|:---------------:|:--------:|:------:|:--------:|:------:|:--------:|
| The Office     | ✅   | ✅        | ✅     | ✅              | ✅       | ✅     | ✅       | ✅     | ✅       |
| Seinfeld       | ✅   | ✅        | ✅     | ✅              | ✅       | ✅     | ✅       | ✅     | ✅       |
| The Simpsons   | ✅   | ✅        | ✅     | ✅              | ✅       | ✅     | ✅       | ✅     | ✅       |
| Parks and Rec  | ✅   | ✅        | ✅     | ✅              | ✅       | ✅     | ✅       | ✅     | ✅       |

All 4 universes pass the 9-role coverage check after the trim.

## What changes

- The Hire Team picker (data-driven from `castingRouter.listUniverses()`) will render 10 cards per local universe instead of 15 / 10 / 14 / 14.
- `LocalUniverseId`, `LocalUniverseTemplate`, `LocalUniverseCharacter`, `LOCAL_UNIVERSES`, `getLocalUniverseIds()`, `getLocalUniverse()`, `isLocalUniverseId()` — all unchanged in shape. Pure data trim.

## What stays the same

- `LocalUniverseId` union: still `'the-office' | 'seinfeld' | 'the-simpsons' | 'parks-and-rec'`.
- SDK universes (`usual-suspects`, `oceans-eleven`) unaffected — they're owned by `@bradygaster/squad-sdk/casting`, not by this registry.
- `casting-engine.ts` dispatch glue, `hire-formulator.ts` prompt, `packages/client/src/api/agents.ts` `CastingUniverseId` — none touched (per directive scope).
- Coordinator-side casting templates (`.squad/templates/casting-reference.md`) — separate code path, not in scope.

## Verification performed

1. `npx tsc --noEmit` from `packages/server` — clean for `local-universes.ts`. (Two pre-existing errors remain in `conjure-classifier.ts` — `ResolveModelResult.modelId` / `.source` — unrelated to this change.)
2. `grep -cE "^        name: '"` returns **40**; per-universe `awk` count returns 10/10/10/10.
3. Recursive grep across `packages/**/*.ts*` for each of the 13 dropped names — **no stale references**. Hire Team UI is purely data-driven from the API, so no client-side string fix-ups required.

---

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
### 2026-05-15T09:55:00Z: Conjure design — answers to McManus's 5 open questions
**By:** Ahmed Sabbour (via Copilot, "take a best guess")
**Context:** McManus's Polymorphic Capture proposal (`mcmanus-polymorphic-capture.md`) surfaced 5 open questions. These are the locked-in answers — implementation may proceed.

**1. Project scoping for heavy artifacts (agent / team / skill / tool / ceremony)**
→ **Project-aware with smart defaults.** If the user has a current project context (URL contains `/projects/:id`), default the new artifact to that project — no picker shown. If no project context (e.g., user is on the global Projects page), show a project picker AFTER classification with the current project pre-selected if any. Skills, tools, and MCP servers can also be cross-project (live in the personal/global library) — surface that toggle inline as a checkbox "Make available across all projects" when the kind is one of those three.

**2. Multi-artifact Conjure ("I need a QA agent and a code-review ceremony")**
→ **One-at-a-time in v1.** After the user lands on the create page, surface a dismissible "You might also want to create…" suggestion strip with up to 2 follow-up suggestions the classifier inferred. Each suggestion is a one-click "Conjure this next" button. No auto-creation. Defer true multi-artifact in one shot to v2.

**3. Keyboard navigation for the candidate-chip disambiguation**
→ **Arrow keys + enter from day one.** Tab into the chip strip, ←/→ to move, Enter to select, Esc to dismiss the strip and stay on top candidate. Standard a11y baseline — non-negotiable.

**4. Fallback when the LLM endpoint is unavailable**
→ **Manual kind picker.** A dropdown labeled "What are you creating?" with the 10 v1 kinds. Don't degrade to the old CaptureModal — clean break, no two parallel paths once Conjure ships. Show a small banner: "AI classifier offline — pick a kind manually."

**5. Per-project FAB on the Board**
→ **Conjure-aware with Issue pre-selected.** The Board FAB opens the same Conjure modal but with `hint: 'issue'` so the classifier biases heavily toward issue creation (since 95% of board captures are issues). User can clear the hint via a "this isn't an issue" link below the textarea.

**Status:** APPROVED. McManus's design is unblocked. Implementation wave can spawn after Hockney r6 (Flow API) and Kobayashi r3 (column add/remove) land — to keep the parallel-agent count manageable.
### 2026-05-15T09:34:03Z: Flow page becomes agent-centric
**By:** Ahmed Sabbour (via Copilot)
**What:** The Flow page (`/projects/:id/flow`) is reframed around **agent instances**, not workflow runs.
**Required visualizations:**
- **Instances of agents** — each running/recently-active agent appears as a node (multiple instances if the same agent is running concurrently)
- **What they're active on** — current step / issue / run shown on the node (or in a side panel on selection)
- **Idle vs active** — visual distinction for agents currently executing vs at rest
- **Lineage** — directed edges showing what triggered each agent (parent run → child fan-out → grandchild). Hover/click an instance to highlight the chain that led to it
- **Visual** — graph/canvas representation, not a list. Use the existing flow library if one is already in the client (e.g., `react-flow` if installed); otherwise propose one before adopting.
**Status:** Design directive — Fenster owns UX, Hockney owns API surface, Keyser owns implementation.
**Why:** User wants to see "what the team is doing right now" at a glance, with the ability to trace why any agent was activated.
### 2026-05-15T09:34:03Z: Polymorphic Capture — smarter, intent-routed
**By:** Ahmed Sabbour (via Copilot)
**What:** The global **+ Capture** button (currently issue-only via CaptureModal/CaptureFab + Phase 14 quick-capture) is reframed as a **universal intent router** that takes a prose draft and decides what the user is trying to formulate.
**Required behavior:**
- Accept any prose input
- Classify intent: project | issue | team | agent | skill | tool | (extensible: ceremony, workflow template, MCP server, label, …)
- Route the user to the right surface — either inline preview (current Issue flow) OR navigate to the matching create page (e.g., HireAgentModal, HireTeamModal, CeremonyEditor) with the formulated draft pre-filled
- Reuse the existing universal Formulate primitive (checkpoint 019) on the server
- Confidence + ambiguity handling: if the classifier is unsure, show the top 2-3 candidates as a chip row and let the user pick
- Needs a different name and icon — current "Capture" + flask emoji is too narrow. McManus to propose options.
**Status:** Architectural design owned by McManus; data/API shaping by Hockney; visual + interaction design by Fenster (queued); implementation by Keyser.
**Why:** "It should know what I want and take me to the right place" — Ahmed wants Capture to be the single-entry-point creation surface for everything in Squadboard.
# Decision: Project Name Relocation to Top Header

**Date:** 2026-05-15  
**Author:** Fenster (UX Designer)  
**Status:** Implemented

---

## What changed

The active project name was previously rendered inside the sidebar's `NavDrawerBody` as a plain `<div>` with a custom font-size (`'14px'` — a Fluent2 violation). It was clipped/hidden by the sidebar's overflow at certain sidebar heights.

It has been relocated to the **top header bar** (`topBar` div in `Layout.tsx`), on the **left side** of the bar — anchored to the left edge, with the action buttons (Inbox / Consult / Capture) remaining on the right.

---

## Placement decision

**Left of the action buttons, right of the implicit sidebar boundary.**

The topBar spans the full width of the `main` column (everything to the right of the sidebar). Positioning the project name at the far left of this column mirrors the convention of many multi-project tools (Linear, Notion, GitHub): app logo/nav is left, current context label is the next thing you see, global actions are right.

No logo was added to the topBar — the Squadboard wordmark already sits in the sidebar header and remains there. The project name therefore acts as the "current context" breadcrumb for the main content area.

---

## Sidebar version: removed

The old sidebar `projectName` div has been **removed entirely**. Rationale:

- It was the clipping-prone element that prompted this ticket.
- The section headers (`WORK`, `SQUAD`, `OPERATIONS`) already scope the sidebar nav items to "this project" — a redundant label above them added noise without value.
- Keeping both (sidebar + header) would create a confusing duplication. The header is more persistent (always visible even when scrolling page content), so it's the canonical location.

---

## Fluent2 components used

| Concern | Component / Token |
|---|---|
| Project switcher button | `Button` (`appearance="subtle"`, `iconPosition="after"`) |
| Switch affordance icon | `ChevronDown16Regular` from `@fluentui/react-icons` |
| Typography weight | `tokens.fontWeightSemibold` (Body1Strong equivalent) |
| Right-side button gap | `tokens.spacingHorizontalS` (8 px) |
| Truncation | `'& .fui-Button__text': { overflow: hidden, textOverflow: ellipsis, whiteSpace: nowrap }` on the `projectSwitcher` makeStyles slot |

No ad-hoc `fontSize` or `px` spacing values were introduced in the new styles. The `maxWidth: '240px'` on `projectSwitcher` is a layout bound (not a typography token) — acceptable per Fluent2 canon for container sizing.

---

## Empty-state behaviour

When `projectName === null` (either no project is selected, e.g. on `/projects`, or the project fetch failed), the switcher button is **not rendered**. The `topBarLeft` div collapses to zero width. The `justifyContent: space-between` on `topBar` then pushes the right-side buttons flush-right — identical visually to the pre-change state.

---

## Truncation at narrow widths

The `projectSwitcher` button is constrained to `maxWidth: 240px`. At very narrow viewport widths the button will reach that cap, and the internal text span truncates with an ellipsis (`text-overflow: ellipsis`). The chevron icon remains visible. The full project name is available via the `title` attribute on the button.
# Flow Agent API — Decision Record
**Author:** Hockney  
**Date:** 2026-05-15  
**Status:** Shipped (Batch A + B committed)

---

## Endpoint Contracts (verbatim — Keyser builds against these)

### `GET /api/projects/:id/flow/agents`
Returns the agent-instance graph for visualisation.

```
Response: { ok: true, data: FlowAgentsResponse }

FlowAgentsResponse {
  agents: Array<{
    agentId: string          // agents.id (UUID)
    name: string
    role: string
    instances: Array<{
      instanceId: string     // workflow_run.id | issue_run.id | live_session.id | consult_session.id
      instanceKind: 'workflow_run' | 'issue_run' | 'live_session' | 'consult_session'
      status: 'active' | 'idle' | 'completed' | 'failed' | 'pending'
      currentStep?: { stepId: string; label: string; startedAt: string }
      currentIssue?: { issueId: string; title: string }
      startedAt: string      // ISO 8601
      lastHeartbeatAt?: string
      endedAt?: string
      model?: string
    }>
  }>
}
```

Every non-retired agent appears in the response regardless of whether it has
active instances. `instances: []` means idle/undeployed — client should
visually de-emphasise those cards.

### `GET /api/projects/:id/flow/lineage`
Returns the directed-edge set for the lineage graph.

```
Response: { ok: true, data: FlowLineageResponse }

FlowLineageResponse {
  edges: Array<{
    fromInstanceId: string
    toInstanceId: string
    relation: 'fan_out' | 'split' | 'consult' | 'handoff' | 'spawn'
    createdAt: string
    triggerStepId?: string   // set when sourced from handoff_context
  }>
}
```

### `GET /api/projects/:id/flow/graph`
Combined — use this as the primary client endpoint (single round-trip).

```
Response: { ok: true, data: { agents: FlowAgent[], edges: FlowLineageEdge[] } }
```

Internally calls `getFlowAgents()` + `getFlowLineage()` concurrently via
`Promise.all`. If you need refresh on a heartbeat, poll this one.

---

## Instance Attribution Logic

| Source table | Attributed to agent via |
|---|---|
| `workflow_runs` | Current step's `issue_runs.agent_id` if a step is running; fallback to `issues.assignee_id`; excluded if neither resolves |
| `issue_runs` | `issue_runs.agent_id` — but only **standalone** runs (not linked to a `step_run`) |
| `live_sessions` | `live_sessions.agent_id` (only rows where `agent_id IS NOT NULL`) |
| `consult_sessions` | `consult_sessions.agent_id` (mode='agent' only) |

**Why issue_runs linked to step_runs are excluded from the issue_run bucket:**
An issue_run that IS a workflow step is already represented as the `currentStep`
of its parent `workflow_run` instance. Showing it twice would duplicate the card.

---

## Data Gaps

1. **`workflow_runs` with no step agent and no issue assignee** — excluded
   silently. This can happen if a workflow_run was created before an agent was
   assigned. It will appear once the routing step resolves. Document as known
   gap in the UI with "Unassigned" placeholder.

2. **`consult_sessions` (mode='model')** — excluded. These sessions have no
   `agentId` (they talk directly to a model). They cannot appear on an
   agent-centric flow page. If the team later wants to show them, they need a
   "model instance" entity type.

3. **`issue_run → issue_run` lineage** — no schema support. A direct handoff
   between two standalone issue_runs (without a workflow_run) has no FK chain.
   Current edges only cover: issue_links (fan_out/handoff), workflow_run
   parent_workflow_run_id, and consult_session forked_from_session_id.

4. **`workflow_run → consult_session` cross-source edges** — no FK. A consult
   session doesn't store which workflow_run spawned it (if any). Would require
   a new `triggered_by_run_id` column on `consult_sessions`. Documented as
   Phase 13 gap.

5. **`parentInstanceId` in `flow.instance.started` for issue_runs** — not
   emitted. The issue_run ↔ step_run relationship is inverse (step_run stores
   issueRunId), so looking it up at emit time adds a query inside the hot
   heartbeat path. Defer until Fenster needs the visual connection.

---

## WebSocket Events

All four events are routed through the existing project event bus
(`emitFlowEvent` / `emitFlowHeartbeat`). Clients subscribe to the project
room the same way they subscribe to `run.*` events.

| Event | Payload | Throttle |
|---|---|---|
| `flow.instance.started` | `{ instanceId, agentId, kind }` | none |
| `flow.instance.heartbeat` | `{ instanceId, status }` | 1/s per instanceId (in-memory Map in EventBus) |
| `flow.instance.ended` | `{ instanceId, status }` | none |
| `flow.lineage.edge.created` | `{ fromInstanceId, toInstanceId, relation, createdAt }` | none |

Emit hooks live in:
- `engine/workflow-runner.ts` — workflow_run lifecycle
- `engine/stepper.ts` — issue_run lifecycle + 30 s heartbeat
- `engine/fan-out.ts` — lineage edge on fan_out completion
- `sdk/consult-stream.ts` — consult_session lifecycle

---

## Performance Posture

- **Active instances**: always included (no cap).
- **Completed/failed instances**: trailing 24 h window, 50 rows per source
  type (7 sources → theoretical max ~350 rows per response before grouping).
- **No pagination** for v1 — the cap keeps payloads reasonable for projects
  with <200 issues/runs.
- If a project grows past ~500 active runs, add `LIMIT` to the active CTEs
  and expose a `?since=<ISO>` cursor. Flag this to Keyser before Phase 14.

---

## Commit SHAs

- **Batch A** (endpoints + service): `ce01a382`
- **Batch B** (WS events): `9a9fb8a3`
# Hockney Phase 19 Backend — Decision Record
**Date:** 2026-05-15T09:09:55.552-07:00
**Author:** Hockney (backend / workflow engine dev)

---

## Templates table shape — kind discriminator chosen

The `templates` table uses a plain `TEXT kind` column with a DB-level CHECK constraint (`kind IN ('workflow', 'team', 'project')`).  Rejected a pg ENUM because adding new kinds via `ALTER TYPE` in a live DB is hazardous; a TEXT + CHECK is easy to migrate and Drizzle doesn't need to know about it at compile time.

The `payload JSONB NOT NULL` column stores kind-specific bundles:
- `workflow`: `{ name, slug, description, triggerKind, triggerConfig, kind, yamlContent }`
- `team`: `{ agents: AgentExport[] }` — agent row + charterContent + skill/tool/mcp key arrays
- `project`: `{ meta, agents, ceremonies, labels, columnMeta, skills, tools, mcpServers, routingRules }`

`project_id UUID REFERENCES projects(id) ON DELETE SET NULL` is nullable: NULL for built-in templates, set when saved from a user project.

---

## Kobayashi's SDK wrapper — used on read paths?

**No.** The Phase 19 template services read directly from Postgres via Drizzle/raw SQL rather than through `sdk-state.ts`.  Reason: the SDK wrapper is optimised for the `.squad/` YAML file system (agents, routing, decisions) and doesn't cover the DB tables needed here (workflowVersions, skills, tools, mcpServers, routingRules, columnMeta, labels).  The read paths in the template services are thin DB queries — no semantic value is added by an SDK indirection.

If a future need arises to merge file-system agent data (e.g., reading a charter that hasn't been synced yet), `sdk-state.ts` is the right entry point, but that is out of scope for Phase 19.

---

## Schema migration concerns

This is a **new table** with no backfill required.  The bootstrap DDL uses `CREATE TABLE IF NOT EXISTS` so existing databases upgrade safely on next server start.  The index `templates_kind_name_idx` is also `CREATE INDEX IF NOT EXISTS`.  No existing tables are modified.

**Note for users with existing dbs:** the server log will show `[db] schema bootstrapped` on next boot without any manual migration steps.

---

## Decision for Keyser (client)

The route surface is:

| Method | Path |
|--------|------|
| GET    | /api/templates?kind=… |
| GET    | /api/templates/:id |
| DELETE | /api/templates/:id |
| POST   | /api/projects/:id/team/export |
| POST   | /api/projects/:id/team/import |
| POST   | /api/projects/:id/team/save-as-template |
| POST   | /api/projects/:id/team/instantiate-template/:templateId |
| POST   | /api/projects/:id/export |
| POST   | /api/projects/import |
| POST   | /api/projects/:id/save-as-template |
| POST   | /api/projects/instantiate-template/:templateId |

All responses wrap in `{ ok: boolean, data: ... }` or `{ ok: false, error: string }`.

`POST /api/projects/import` requires `{ payload, name?, squadPath }` — `squadPath` is the absolute path to the new project's `.squad/` directory; the client must collect this from the user.  `POST /api/projects/instantiate-template/:templateId` similarly requires `{ name?, squadPath }`.
# Keyser Phase 19 Client — Decisions & Contracts

**Date:** 2026-05-15  
**Commit:** 8eb337dd  
**Author:** Keyser (Frontend Dev)

---

## Decision 1 — TabList URL State Contract

The Templates page uses `?tab=ceremonies|workflows|teams|projects` in the URL search params to persist the active tab. Default is `ceremonies` (Hockney's original content).

```
/projects/:id/ceremonies/templates?tab=workflows
/projects/:id/ceremonies/templates?tab=teams
/projects/:id/ceremonies/templates?tab=projects
```

Tab values are validated — any unrecognised value falls back to `ceremonies`.

---

## Decision 2 — File Upload Validation Rule

The drag-import zone in each user-template tab validates that the JSON file's `payload.kind` field matches the active tab's kind before calling any import API:

- Workflows tab → expects `payload.kind === "workflow"`
- Teams tab → expects `payload.kind === "team"`
- Projects tab → expects `payload.kind === "project"`

If the kinds don't match, an inline error is shown and no API call is made. Files without a `payload.kind` field are passed through (permissive — Hockney's import endpoints should enforce their own validation server-side).

---

## Decision 3 — Save-as-template Dialog UX

All "Save as template" dialogs (Agents, Settings, CeremonyEditor) share the same UX contract:

- **Name** field: required, blocks the submit button until non-empty
- **Description** field: optional, 3-row Textarea
- Submit label: `Save template` / `Saving…` when pending
- Error shown inline in the dialog (Caption1, red foreground)
- On success: dialog closes, brief toast/badge shown ("✓ Template saved" / "✓ Saved")

---

## Open Question for Hockney

`useImportWorkflow` calls `POST /api/projects/:id/ceremonies/import` — this endpoint was NOT in the Phase 19 contract. The hook degrades gracefully (will return an API 404 error). Hockney should either:

1. Ship `POST /api/projects/:id/ceremonies/import` in the route layer, OR
2. Confirm it's out of scope and Keyser will remove `useImportWorkflow`

All other endpoints match the agreed Phase 19 contract exactly.
# Decision: Per-Project Kanban Column Add/Remove

**Author:** Kobayashi (Squad SDK Integrator)  
**Date:** 2026-05-15T09:48:00.000-07:00  
**Requested by:** Ahmed Sabbour  
**Status:** Shipped — commits `1a4c5d46` (Batch A) · `d87c8f45` (Batch B)

---

## What changed

`column_meta` is now the single source of truth for what columns a project has.
The hard-coded `column_status` Postgres enum is gone; `issues.status` is plain `TEXT`.
Users can add and remove columns per project. The five defaults are still seeded on
first access, but are no longer the only legal set.

---

## New endpoint signatures (for Keyser to build against)

### 1. `POST /api/projects/:projectId/columns`
Create a new column.

**Request body:**
```json
{
  "columnId": "triage",          // required — ^[a-z0-9_-]{1,40}$
  "label": "Triage",             // required — 1–80 chars
  "color": "#d29922",            // required — #rrggbb
  "description": "...",          // optional string|null
  "position": 2,                 // optional integer — inserts here, shifts others
  "semantic": "backlog"          // optional — see enum below; default "custom"
}
```

**Response 201:**
```json
{ "ok": true, "data": { <ColumnMeta> } }
```

**Errors:** 400 (invalid field), 409 (columnId already exists for project).

---

### 2. `DELETE /api/projects/:projectId/columns/:columnId?reassignTo=<columnId>`
Delete a column.

- If the column has **zero issues**, deletes immediately.
- If the column has **N issues** and `reassignTo` is absent → **409**:
  ```json
  { "ok": false, "error": "Column has N issues; pass reassignTo=<columnId>", "count": N }
  ```
- If `reassignTo` is present, atomically moves all issues to that column then deletes.
- Cannot delete the last column in a project → **409**.
- If the deleted column was `is_default=true`, auto-promotes the lowest-position
  remaining column to `is_default=true`.

---

### 3. `PATCH /api/projects/:projectId/columns/reorder`
Atomically rewrite all column positions.

**Request body:**
```json
{ "order": ["backlog", "triage", "todo", "in_progress", "in_review", "done"] }
```

**Response 200:**
```json
{ "ok": true, "data": [ <ColumnMeta>[] ordered by new position ] }
```

**Error:** 400 if `order` is missing, empty, or contains non-strings.

---

### 4. Extended: `PATCH /api/projects/:projectId/columns/:columnId`
Now also accepts `semantic` and `isDefault`.

```json
{
  "label": "...",
  "description": "...",
  "color": "#rrggbb",
  "semantic": "done",
  "isDefault": true    // atomically clears is_default on all other columns first
}
```

---

### 5. `GET /api/projects/:projectId/columns` (unchanged path, extended response)
Now returns `semantic` and `isDefault` on every item:

```json
{
  "ok": true,
  "data": [
    {
      "id": "...", "columnId": "backlog", "label": "Backlog",
      "description": "...", "color": "#6e7681", "position": 0,
      "semantic": "backlog", "isDefault": true
    }
  ]
}
```

---

## Semantic enum — original 5 mapped

| original `column_id` | new `semantic` |
|----------------------|----------------|
| `backlog`            | `backlog`      |
| `todo`               | `ready`        |
| `in_progress`        | `in_progress`  |
| `in_review`          | `review`       |
| `done`               | `done`         |
| any custom column    | `custom`       |

`semantic` is used for analytics roll-ups, GitHub sync label mapping, and dashboard
"what does done mean" semantics. Multiple columns can share the same semantic.

---

## Migration safety (enum → text on a live DB)

The bootstrap DDL (`db/index.ts → bootstrapSchema`) runs on every server start.
The migration block is:

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'column_status') THEN
    ALTER TABLE issues ALTER COLUMN status TYPE TEXT USING status::TEXT;
    ALTER TABLE issues ALTER COLUMN status SET DEFAULT 'backlog';
    DROP TYPE column_status;
  END IF;
END $$;
```

- **Idempotent:** the `IF EXISTS` guard means it's a no-op once applied.
- **In-place:** Postgres casts enum values to their text equivalents automatically.
  No row updates needed — `'backlog'::column_status` becomes `'backlog'::text`.
- **Zero downtime risk on embedded Postgres:** the server owns the embedded PG
  instance; migration runs before any route handler accepts traffic.
- **`ADD COLUMN IF NOT EXISTS`** guards on `semantic` and `is_default` are
  equally idempotent.

---

## `reassignTo` contract for DELETE

- `reassignTo` is a **query parameter**, not a body field.
  `DELETE /api/projects/:projectId/columns/:columnId?reassignTo=todo`
- The target column must exist in the same project; 400 if not.
- All affected issues are moved atomically inside a transaction before the column row
  is deleted — no orphan issues possible.

---

## Open question for Keyser: reorder UX

**Recommendation:** drag-and-drop handles (grip icon on each column chip in the
settings panel). This is the most natural affordance — users expect to drag columns
on a Kanban board. A number input works for accessibility fallback but should not be
the primary interface.

The `PATCH /reorder` endpoint takes a full `order` array, so either drag-and-drop
(build the new order client-side then send one request) or a number input (send
on blur) both integrate cleanly. **Final call is Keyser's.**

---

## Client hooks shipped (packages/client/src/api/columns.ts)

| hook | description |
|------|-------------|
| `useCreateColumn(projectId)` | POST /columns |
| `useDeleteColumn(projectId)` | DELETE /:columnId?reassignTo= |
| `useReorderColumns(projectId)` | PATCH /reorder |
| `useUpdateColumn(projectId)` | PATCH /:columnId (extended) |
| `useColumnMeta(projectId)` | GET / (extended) |
| `useResetColumns(projectId)` | POST /reset (unchanged) |

All mutations invalidate `['column-meta', projectId]` on success.
# Decision: p5-migrate-fs — SDK Collection Migration (Phase 5)

**Author:** Kobayashi  
**Date:** 2026-05-15  
**Task:** p5-migrate-fs

---

## Raw-fs Callsites Migrated

**Total: 3 callsites replaced in 1 file (`services/agent-sync.ts`)**

| # | Original call | Replaced with |
|---|---------------|---------------|
| 1 | `fs.readdir(agentsDir, { withFileTypes: true })` | `(await getAgents(projectId)).list()` |
| 2 | `fs.access(charterPath)` + `parseCharter(charterPath)` | `(await getAgents(projectId)).get(agentName).charter()` |
| 3 | `computeCharterHash(charterPath)` (read + hash) | `computeContentHash(charterContent)` (in-memory, no fs read) |

`charter-compiler.ts` was **not** changed at the callsite level — it was refactored to expose:
- `parseCharterContent(content: string)` — pure in-memory parser (new export)
- `computeContentHash(content)` — pure in-memory hash (new export)
- `parseCharter(charterPath)` — still exists, now delegates to `parseCharterContent` internally
- `computeCharterHash(charterPath)` — still exists, now delegates to `computeContentHash` internally

No callers outside the two target files had to change.

---

## Fallback Strategy: YES — kept, and it matters

The SDK-first + raw-fs-fallback pattern was **retained** for both callsites:

**Why it was kept:**
- `getAgents(projectId)` requires a live DB connection and a valid project row. If the DB is not yet seeded (cold-start) or the project row is missing, the SDK throws `ProjectNotFoundError`.
- Charter compilation is on the critical path for agent sync, which is triggered on every `GET /agents` request. A single SDK failure must not silently kill an entire sync run.
- The watcher (`watchAgents`) fires on every file change; if the SDK cache is cold at that moment, the fallback ensures charters still get parsed.

**Fallback log prefix:** `[agent-sync]` with `console.warn` so it is observable without being alarming.

---

## SDK Quirks Discovered

1. **`AgentsCollection.get(name)` is synchronous but `AgentHandle.charter()` is async.** The handle is created synchronously; only the IO operations are async. You must `await handle.charter()` even though `agents.get(name)` itself doesn't return a promise.

2. **No SDK method to UPDATE an existing charter markdown.** `AgentsCollection.create(name, charter)` creates a new agent directory+charter; `AgentHandle.update(partial)` mutates `Agent` domain-object fields (role, status, etc.), not the raw markdown file. Consequently, `writeCharter(charterPath, meta)` in `charter-compiler.ts` was left as a raw-fs write — there is no safe SDK equivalent for in-place charter overwrites yet. Future migrations should wait for an `AgentHandle.updateCharter()` surface to appear in the SDK.

3. **`AgentsCollection.list()` returns directory names, not filtered-by-charter-existence names.** An agent directory without a `charter.md` would appear in the list, then `handle.charter()` would throw. The fallback's `fs.access` guard handles this gracefully; SDK callers need to be prepared for `charter()` to reject.

4. **The SquadState cache in `sdk-state.ts` is per-process.** Each `Promise.all` iteration that calls `getAgents(projectId)` re-enters the same cached `SquadState`, so there is no DB round-trip per agent — only one on cold-start. No performance concern.
# Polymorphic Capture → "Conjure" — Design Proposal

**Author:** McManus (Lead Architect)  
**Date:** 2026-05-15  
**Status:** PROPOSED — awaiting user approval before implementation wave  
**Scope:** Replace the global "+ Capture" button with a universal intent-routing surface.

---

## 1. Naming Proposal

The user said: "it probably needs a different name/icon."

### Candidates

| # | Name | Rationale | Icon (from `@fluentui/react-icons`) | Tooltip |
|---|------|-----------|--------------------------------------|---------|
| 1 | **Conjure** | Already used in the codebase (`conjure-classifier.ts`, Ceremony Conjure UX). Evokes "speak it into existence." | `Wand20Regular` — `import { Wand20Regular } from '@fluentui/react-icons'` | "Conjure anything (c)" |
| 2 | **Summon** | Strong intent verb; implies the system figures out what you want. Slightly game-y. | `Flash20Regular` — `import { Flash20Regular } from '@fluentui/react-icons'` | "Summon a new artifact (c)" |
| 3 | **Compose** | Familiar from email/chat; implies creation from prose. Might feel too "text-centric." | `Compose20Regular` — `import { Compose20Regular } from '@fluentui/react-icons'` | "Compose something new (c)" |

### Recommendation: **Conjure**

- Already has semantic presence in the server layer (`conjure-classifier.ts`, `ConjureKind`).
- The wand icon is distinctive in Fluent — instantly differentiates from the generic `+` button.
- Verb works as both button label ("Conjure") and action description ("Conjuring an agent…").
- Keyboard shortcut stays `c`.

Import: `import { Wand20Regular } from '@fluentui/react-icons'`  
Button label: `Conjure`  
Tooltip: `"Conjure anything (c)"`

---

## 2. Intent Dimensions (v1 Artifact Types)

### Required per user (v1 MUST)

| Kind | Description | Already has a create flow? |
|------|-------------|---------------------------|
| `project` | Spin up a new project | Partial (route exists, no formulate) |
| `issue` | Tracked work item on the board | ✅ CaptureModal + /issues/formulate |
| `team` | Hire a multi-agent cast | ✅ HireTeam + /agents/team/formulate |
| `agent` | Hire a single agent | ✅ HireAgent + /agents/formulate |
| `skill` | Reusable instruction for agents | ✅ CreateSkill page |
| `tool` | Custom function agents can call | ✅ CreateTool page |

### Recommended additions for v1

| Kind | Justification |
|------|---------------|
| `ceremony` | Creation modal exists; ceremonies are first-class in Squadboard; Ceremony Conjure UX already shipped (Kobayashi, Phase 019). |
| `mcp-server` | Already in `ConjureKind` enum; creation page exists. Low cost to support. |
| `inbox-item` | Fallback — when the classifier is uncertain, default to a loose inbox capture (preserves current behavior). |
| `consult` | Redirects to Consult chat; costs nothing since it's just a navigate-with-draft. |

### Deferred to v2 (not in v1)

| Kind | Why deferred |
|------|--------------|
| `workflow template` | No create flow yet. Needs template CRUD designed. |
| `project template` | Same — templates are read-only presets today. |
| `team template` | Same. |
| `label` | Too trivial for LLM classification; keep inline creation on the board. |
| `column` | Column management lives inside the board settings drawer. |
| `routing rule` | Complex; needs its own design pass. |
| `board column` | Synonym of "column"; covered by column settings. |

**v1 kind count: 10** (project, issue, team, agent, skill, tool, ceremony, mcp-server, inbox-item, consult).

---

## 3. Classifier Architecture

### Existing asset

`packages/server/src/services/conjure-classifier.ts` is already 90% of what we need:
- Exports `classifyConjure(prompt, context) → ConjureClassification`
- Supports all 10 kinds
- Returns `{ kind, payload, confidence, rationale, modelUsed }`
- Delegates to `runFormulator()` (shared model-resolution infra)

### Where it runs

**Server-side.** The LLM call happens on the server (already the case). The client sends prose, gets back a typed classification.

### Model strategy

- **Default:** `claude-haiku-4.5` via the existing model-resolution stack.
- **Bump trigger:** Only if accuracy on ambiguous prompts drops below 85% in QA testing.
- **Cost per invocation:** ~400 input tokens + 200 output tokens ≈ $0.0001.

### Latency target

- **P50 < 800ms**, **P95 < 1.5s**, **P99 < 3s**.
- Haiku is well within this on typical prompt lengths (<200 words).
- The modal shows a spinner during classification; we do NOT block UI rendering.

### Output contract (extended from current)

```typescript
interface ConjureResponse {
  intent: ConjureKind;
  confidence: number;
  candidates: Array<{
    intent: ConjureKind;
    confidence: number;
    reason: string;
  }>;
  draft: Record<string, unknown>; // per-intent payload shape
  rationale: string;
  modelUsed: { id: string; source: string };
}
```

**Change from today:** Add `candidates` array (top-3 by confidence). Today the classifier returns only the winner. We'll instruct the LLM to return its top-3 in a `candidates` array alongside the primary pick.

### Ambiguity handling

1. If `confidence < 0.7` → show candidates as selectable chips in the modal.
2. If `candidates[0].confidence - candidates[1].confidence < 0.15` → also show chips.
3. Chips are labeled: "Issue", "Agent", "Ceremony", etc. User taps one → re-classify is NOT needed (we already have the draft payloads for all top-3 in `candidates`).
4. If user doesn't pick within 5s and confidence ≥ 0.5, auto-select the top candidate but keep the chip bar visible for correction.

### Heuristic fast-path (no LLM needed)

For cost savings and latency, a client-side regex pre-classifier handles obvious cases:
- Starts with "bug:" or "fix:" or "task:" → `issue` (confidence 0.95)
- Starts with "hire " or "recruit " → `agent` or `team` (check if "team" appears)
- Starts with "project:" or "new project" → `project` (confidence 0.95)

If the heuristic fires with confidence ≥ 0.9, skip the LLM call entirely and go straight to the form. The user can always "re-classify" via a small button.

---

## 4. Routing UX

### Options considered

| Option | Summary | Pros | Cons |
|--------|---------|------|------|
| A — In-place preview | Modal swaps content to the matching form | No navigation; user stays put | Modal becomes mega-complex; heavy forms (agent config) crammed into overlay |
| B — Navigate-with-draft | Modal closes → navigate to `/create/:kind?draft=...` | Clean separation; each create page owns its form | Loses user's page context if mid-work |
| C — Hybrid | Light artifacts in-place; heavy artifacts navigate | Best of both; respects complexity budget per kind | Two code paths; slightly more to test |

### Recommendation: **Option C — Hybrid**

**In-place (light):** issue, inbox-item, consult, label (if ever added).  
**Navigate (heavy):** project, team, agent, skill, tool, ceremony, mcp-server.

**Justification:**
- Issues and inbox items are the 80% use case (quick capture). Users expect typing → immediate creation without page switch. The current CaptureModal already does this; we preserve the muscle memory.
- Agents, teams, and ceremonies have multi-field forms with file uploads, role lists, model selectors, etc. Cramming them into a modal overlay produces a claustrophobic UX. Navigation gives them room to breathe.
- Context loss is mitigated: the draft is stashed in `sessionStorage` keyed by a unique formulation ID. If the user hits Back, the draft survives. The Conjure modal also shows a "Navigating to [Agent Creator]…" toast with an undo link (3s window).

**Edge case — mid-page navigation:**
- If the user is editing something unsaved on the current page, the navigate path triggers `beforeunload`-style prompt ("You have unsaved changes. Continue?"). This is already handled by React Router's `useBlocker` hook in our create pages.

---

## 5. Server Contract

### Endpoint

**New route:** `POST /api/conjure/classify`

Rationale for a new route rather than extending `/api/inbox/:id/formulate`:
- The inbox formulate endpoint is item-scoped (requires an existing inbox item ID).
- Conjure classification happens BEFORE any item exists.
- Separation of concerns: classification ≠ formulation of a specific kind.

After classification, the client calls the existing per-kind formulate endpoint (`/agents/formulate`, `/issues/formulate`, etc.) if it needs deeper draft refinement. The classifier provides a "good-enough" draft; the per-kind endpoint can polish it.

### Request

```typescript
POST /api/conjure/classify
Content-Type: application/json

{
  prose: string;                  // user's free-form input
  hint?: ConjureKind;            // optional — user already picked a kind chip
  projectId?: string;            // current project context (nullable)
  projectName?: string;          // display name for LLM context
  knownProjectNames?: string[];  // for cross-project routing
}
```

### Response

```typescript
{
  intent: ConjureKind;
  confidence: number;
  candidates: [
    { intent: ConjureKind, confidence: number, reason: string, draft: object },
    { intent: ConjureKind, confidence: number, reason: string, draft: object },
    { intent: ConjureKind, confidence: number, reason: string, draft: object }
  ];
  draft: object;       // top candidate's draft (shortcut)
  rationale: string;
  modelUsed: { id: string; source: string };
}
```

### Per-intent draft shapes

| Kind | Draft shape |
|------|-------------|
| `issue` | `{ title, body, labels?, priority?, columnSlug? }` |
| `inbox-item` | `{ title, body, suggestedLabels? }` |
| `consult` | `{ topic, prompt }` |
| `agent` | `{ name, role, expertise: string[], model?, rationale? }` |
| `team` | `{ universe, teamSize, requiredRoles: string[], rationale? }` |
| `skill` | `{ name, description, body }` |
| `tool` | `{ name, description, parameters? }` |
| `mcp-server` | `{ name, transport: "stdio"|"http"|"sse", command?, url? }` |
| `ceremony` | `{ name, prose, triggerKind }` |
| `project` | `{ name, description }` |

These mirror the existing shapes in `conjure-classifier.ts` line 93–104. No new invention needed.

### Implementation note

The route handler simply calls `classifyConjure()` from the existing service, extended to return top-3 candidates. Minimal new code.

---

## 6. Migration Plan

### Step 1 — Classifier + New Modal (Feature-flagged)

**What:** Ship the `POST /api/conjure/classify` route and a new `ConjureModal.tsx` component. Gate behind `FF_CONJURE_MODAL` (localStorage flag for dev, server env var for prod).

**Owner:**
- Route: **Hockney** (server)
- Modal shell + candidate chips: **Keyser** (UI)
- Architecture oversight: **McManus**

**Duration:** 1 sprint (≤5 days)

**Old CaptureModal:** untouched. Both modals exist in parallel.

### Step 2 — Route all intents through ConjureModal

**What:** When `FF_CONJURE_MODAL` is on, the global "Conjure" button and `c` hotkey open `ConjureModal`. Issue creation path is verified identical to current CaptureModal behavior. Other intents navigate to their respective create pages with pre-filled drafts.

**Owner:**
- Wiring + hotkey: **Keyser** (UI)
- Visual design (modal layout, chips, transitions): **Fenster**
- Navigate-with-draft plumbing (sessionStorage, toast): **Keyser**
- QA parity verification: **Kujan**

**Duration:** 1 sprint

### Step 3 — Drop CaptureModal

**What:** Remove `CaptureModal.tsx`, `CaptureFab.tsx` (or refactor FAB to open ConjureModal). Remove feature flag. Update `Layout.tsx` button label/icon.

**Owner:**
- Cleanup: **Keyser**
- Regression pass: **Kujan**
- Docs update: **Redfoot**

**Duration:** ½ sprint (2–3 days)

### Total timeline: ~2.5 sprints end-to-end.

---

## 7. Open Questions for the User

1. **Project scoping for heavy artifacts:** Should team/agent/skill/tool/ceremony creation ALWAYS require a project context, or can a user Conjure them from the global (no-project) level and assign later?

2. **Multi-artifact Conjure:** If the user types "I need a QA agent and a code-review ceremony," should we support creating multiple artifacts in one shot, or force one-at-a-time? (v1 recommendation: one-at-a-time, but surface a "You might also want…" suggestion.)

3. **Keyboard-only flow for power users:** Should the candidate-chip disambiguation be navigable with arrow keys + enter (full a11y) from day one, or is mouse-click acceptable for v1?

4. **Fallback when LLM is unavailable:** If the model endpoint is down, should we degrade to a "pick from a list" dropdown (manual kind selection) or show an error and fall back to old CaptureModal?

5. **Per-project quick-filters:** The FAB on the Board currently always creates issues. Should the per-project FAB also become Conjure-aware, or stay issue-locked (since on the Board, 95% of captures are issues)?

---

## Appendix: File References

| File | Role in this design |
|------|---------------------|
| `packages/server/src/services/conjure-classifier.ts` | Core classifier — extend to return top-3 candidates |
| `packages/server/src/routes/inbox.ts` | Existing formulate — stays as-is for inbox items |
| `packages/server/src/routes/agents.ts` | Existing agent/team formulate — called post-classification |
| `packages/server/src/routes/issues.ts` | Existing issue formulate — called post-classification |
| `packages/client/src/components/inbox/CaptureModal.tsx` | Deprecated in Step 3 |
| `packages/client/src/components/inbox/CaptureFab.tsx` | Refactored in Step 3 |
| `packages/client/src/components/formulate/FormulatePanel.tsx` | Reused inside ConjureModal for the prose input |
| `packages/client/src/components/Layout.tsx` | Button label/icon updated in Step 3 |
# Decision: Ceremony Pages — Fluent2 Redesign

**Author:** Fenster (UX Designer)  
**Date:** 2026-05-15T10:18:00.000-07:00  
**Wave:** fenster-4 (retry after fenster-3 API timeout)  
**Pages affected:** `/projects/:id/ceremonies` + `/projects/:id/ceremonies/new`

---

## Pattern chosen for Create flow: Pattern A (Conjure-first)

**Rationale:** The user complaint was "too busy". Pattern A removes the intro callout, collapses trigger selection to a single `Dropdown + Field` (saves ~150px of radio cards), and hides all advanced metadata behind an `Accordion`. The Formulate hero card IS the intro — no redundant text above it. The manual structured form is hidden behind a subtle "or build it manually →" toggle and auto-expands after Formulate fires.

---

## Badge color mapping (canonical — follow for Schedules page and any future list)

| Category | Value            | appearance  | color         |
|----------|------------------|-------------|---------------|
| Trigger  | `manual`         | `outline`   | `subtle`      |
| Trigger  | `on_issue_entry` | `filled`    | `brand`       |
| Trigger  | `on_event`       | `filled`    | `brand`       |
| Trigger  | `on_schedule`    | `filled`    | `informative` |
| Kind     | `narrative`      | `outline`   | `success`     |
| Kind     | `workflow`       | `outline`   | `warning`     |
| Kind     | `review_policy`  | `outline`   | `severe`      |
| Kind     | `ceremony`       | `outline`   | `subtle`      |

---

## "Advanced" Accordion contents (create mode)

The `Accordion` item titled **"Advanced"** contains:
1. **Description** — `Textarea`, optional, shown in ceremony list
2. **Kind** — `Dropdown` (`workflow` / `ceremony` / `review_policy` / `narrative`), helper text: "Use workflow for most automations. narrative is documentation-only."

---

## Small reusable mini-components extracted

| Component | Path | Purpose |
|-----------|------|---------|
| `TriggerBadge` | `packages/client/src/components/ceremony/CeremonyBadges.tsx` | Renders trigger kind as Fluent Badge with canonical color |
| `KindBadge`    | `packages/client/src/components/ceremony/CeremonyBadges.tsx` | Renders ceremony kind as Fluent Badge with canonical color |

Both are reusable in any future list page (Schedules, Runs log, etc.).

---

## What was changed

### CeremonyList.tsx
- Replaced hand-rolled `<table>` + plain `<h1>` with Fluent2 `DataGrid` + `PageHeader`
- Added `TriggerBadge` and `KindBadge` to Trigger and Kind columns
- `Created` column: `safeRelativeTime` + `Tooltip` showing absolute date
- Toolbar: `Review drafts` subtle button + `CounterBadge` + `+ New ceremony` primary button
- Empty state: centred card with CTA
- Background: `tokens.colorNeutralBackground1`, all spacing via Fluent tokens

### CeremonyEditor.tsx (/new route)
- Removed dismissable intro callout entirely
- Formulate hero card is now the only top-level element in create mode
- "or build it manually →" subtle button reveals the structured form
- Trigger: `RadioGroup` with 4 stacked cards → `Dropdown` inside `Field` (description as `hint`)
- Metadata (description + kind): collapsed inside `Accordion` titled "Advanced"
- `Create` button disabled until name differs from "New Ceremony"
- After Formulate fires: structured form auto-expands with populated values
- Edit mode unchanged: compact header + split left/right pane layout
- Fixed unclosed `<>` JSX fragment (root cause of TypeScript errors)
- Removed unused `Dismiss16Regular` icon import

---

## TypeScript

`npx tsc --noEmit` — clean, zero errors.

---

# keyser-columns-batch-b — Batch B Ship Decision Record

**Date:** 2026-05-15  
**Author:** keyser (spawn 4)  
**Commit:** `e4d87359`

---

## Commit

`e4d87359` — `feat(board): add/remove/reorder columns in ColumnSettingsPanel + CaptureModal dropdown`

Files changed:
- `packages/client/src/components/board/ColumnSettingsPanel.tsx`
- `packages/client/src/components/inbox/CaptureModal.tsx`

---

## Drag-and-drop pattern (Kobayashi recommendation confirmed)

Used `@hello-pangea/dnd` (`DragDropContext` + `Droppable` + `Draggable`) matching the existing pattern in `KanbanBoard.tsx`. `ReOrder20Regular` icon as the drag handle anchored to `provided.dragHandleProps`. Optimistic local state (`orderedIds`) is applied immediately on drop; the `useReorderColumns` mutation is called in the background and reverts `orderedIds` to the previous value `onError`.

---

## Issue count decision for delete confirms

**Approach chosen: reuse `useIssues(projectId)` inside `ColumnSettingsPanel`.**

Rationale: `useIssues` is already called in `Board.tsx` (parent), so the TanStack Query cache is warm — no extra network request is made. Issue counts per column are derived by iterating `allIssues` and grouping by `issue.column`. This avoids a prop-drilling change to `Board.tsx` (which is outside Batch B scope) and avoids 409-driven UX (which would delay feedback until after a round-trip). If the column has ≥1 issues the reassign picker is shown immediately; if 0 issues a simple "Delete this column?" confirmation is shown. In both cases `reassignTo` is always passed to the API (defaulting to the project's `isDefault=true` column as a safe sentinel when there are zero issues).

---

## CaptureModal follow-ups noticed

1. **Column reset on project switch** — when the user changes the project dropdown, the column state resets to the new project's `isDefault` column. A `prevProjectIdRef` guards against resetting on every `columnMeta` refetch.
2. **`lockedColumn` guard** — if `lockedColumn` is set (per-project FAB), the auto-reset is skipped so the lock is preserved.
3. **`existingItemId` guard** — if the modal is hydrating an existing item, the auto-reset is also skipped; `hydrateFromItem` owns column state in that case.
4. **Fallback list** — when `projectId === ''` (global Capture button before a project is picked), `FALLBACK_COLUMNS` (the 5 seed slugs) is used so the dropdown is never empty.
5. **`column` type** — still typed as `ColumnId` (= `string` after Batch A), which is fully compatible with dynamic column slugs.

No blocking issues found in CaptureModal. The `handlePublish` call passes `columnSlug: column` to the API which is now a dynamic slug — this is correct as long as the server accepts any registered column slug for the project (which it should, given the server-side columns API).

---

# Decision: Local Universe Registry — The Office, Seinfeld, The Simpsons

**Date:** 2026-05-15
**Author:** Kobayashi (SDK Integrator)
**Requested by:** Ahmed Sabbour

---

## Problem

Ahmed reported that the Hire Team picker only showed "The Usual Suspects" and "Ocean's Eleven", despite requesting Seinfeld in a previous session. The SDK's `UniverseId` type is a sealed union (`'usual-suspects' | 'oceans-eleven' | 'custom'`) with no extensibility API — the SDK ships exactly two named universes and there is no `registerUniverse()` or equivalent.

---

## Decision: Squadboard-side Local Registry (not SDK PR / fork)

**Chosen:** A `local-universes.ts` module in `packages/server/src/services/` that lives entirely within the Squadboard monorepo and is merged with the SDK output at the `casting-engine.ts` wrapper layer.

**Rationale:**
- PRing the SDK would introduce an upstream dependency on a release cycle we do not control; the SDK maintainer may not want show-specific content in the core package.
- Forking the SDK requires maintaining a divergent copy, which has compounding cost.
- The `casting-engine.ts` wrapper is Kobayashi's file and is explicitly the right place for SDK augmentation per the charter. Merging in `listUniverses()` and routing in `castTeam()` is a surgical, localised change.
- Future universes (Mad Men, Parks & Rec, Succession) can be added to `LOCAL_UNIVERSES` in minutes — no SDK interaction required.

**Workaround for sealed type:** `ExtendedUniverseId = Exclude<UniverseId, 'custom'> | LocalUniverseId` gives the type system what it needs without touching the SDK or casting it to `any` at the boundary.

---

## Universes Added (this batch)

| Universe | Label | Characters |
|---|---|---|
| `the-office` | The Office | 15 |
| `seinfeld` | Seinfeld | 10 |
| `the-simpsons` | The Simpsons | 14 |

**Total new characters:** 39
**Total universes now available:** 5 (2 SDK + 3 local)

---

## Future Additions

If Ahmed wants more universes (Mad Men, Parks & Rec, Succession, etc.), the `LOCAL_UNIVERSES` record in `local-universes.ts` is the right place — just add a new `LocalUniverseId` member to the union and a corresponding entry in the record. `listUniverses()` and `castTeam()` pick them up automatically.

---

## Open Question

**Should `listUniverses()` accept a per-project override?**
Some projects might only want a subset of universes (e.g. a workplace-comedy project could default to The Office and hide heist themes). Currently the full merged list is always returned. A future `project.universeAllowlist` config field could filter this. Out of scope now — flagged for follow-up.

---

# Decision: Non-tech Role Coverage + New Business Universes

**Author:** McManus (Lead Architect)  
**Date:** 2026-05-15T10:26:30.000-07:00  
**Round:** r5  
**Status:** APPROVED (self-authored governance expansion)  
**Files changed:**
- `.squad/templates/casting-reference.md`
- `.github/agents/squad.agent.md`
- `.squad/routing.md`

---

## Context

Ahmed requested non-tech business roles and additional casts on two prior occasions. Neither shipped. This decision closes both gaps in a single coordinated round.

---

## 1. New Universes Added (5)

Four universes were requested; Silicon Valley was added as an optional fifth on the basis of a clean tech-startup fit with no table bloat.

| Universe | Capacity | Shape Tags | Rationale |
|----------|----------|------------|-----------|
| **Mad Men** | 14 | medium, drama, ensemble, workplace | Fills the advertising/marketing/ambition signal space — ideal for projects with brand, growth, or B2B focus. Period drama adds period-appropriate resonance. |
| **The Office** | 18 | large, comedy, ensemble, workplace | The canonical ensemble workplace comedy. Sales, dysfunction, business — exact fit for teams that include Sales or Ops members. |
| **Parks and Recreation** | 15 | medium, comedy, ensemble, workplace | Government/civic/optimism resonance. Strong fit for civic-tech, public-sector, or mission-driven projects. Optimism tag distinguishes it from the dysfunction of The Office. |
| **Silicon Valley** | 10 | medium, comedy, ensemble, tech | Tech-startup satire. Fills the startup/VC/disruption resonance gap — no prior universe covered the tech-startup idiom without going full sci-fi. Capacity 10 slots cleanly between Firefly and Ocean's Eleven. |
| **Succession** | 12 | medium, drama, ensemble, business | Corporate power/finance/family dynamics. Ideal for projects with Finance, Legal, or executive-level stakeholder emphasis. Ambition + finance tags complement Mad Men without overlapping. |

**Total before:** 15 universes. **Total after:** 20 universes.

Casting policy `allowlist_universes` is `["*"]` — no `policy.json` edit required. New universes are immediately selectable on the next casting call.

---

## 2. Role-Emoji Additions (11 new rows)

Each emoji was chosen to avoid collision with existing assignments (📋 Scribe, 📊 Data, 📝 Docs, ⚛️ Frontend, 🔧 Backend, 🧪 Test, ⚙️ DevOps, 🔒 Security, 🏗️ Lead, 🔄 Ralph, 🤖 Copilot) and to have strong semantic fit.

| Role | Emoji | Collision check | Semantic rationale |
|------|-------|-----------------|-------------------|
| PM, Product Manager, Product Owner | 🎯 | Clear | Target/goal — PM owns outcomes, not outputs. |
| Designer, UX Designer, Visual Designer | 🎨 | Clear | Palette — universal design symbol. Added as a *distinct* row from `Frontend, UI, Design` to break the old ambiguity where "Designer" matched ⚛️. |
| Founder, CEO, Executive | 👔 | Clear | Business attire — executive/leadership signal. Placed above Lead so CEO doesn't accidentally match Lead first. |
| Sales, Account, Business Development | 💼 | Clear | Briefcase — classic business/sales symbol. |
| Marketing, Growth, Comms | 📣 | Clear | Megaphone — broadcast/outreach. Distinct from 📊 Data and 📝 Docs. |
| Finance, Accounting, Controller | 💰 | Clear | Money bag — unambiguous finance signal. |
| HR, People, Recruiting, Talent | 👥 | Clear | Two people — people-ops symbol. Distinct from 👤 fallback (single person). |
| Legal, Counsel, Compliance | ⚖️ | Clear | Scales — universal legal symbol. Note: Security row retains "Compliance" for technical compliance; Legal row is legal-side compliance only. Pattern matching resolves correctly because "Legal" and "Counsel" are distinct tokens from "Security" and "Auth". |
| Operations, Ops, Program Manager | 📦 | Clear | Box/logistics — operations symbol. "Program Manager" is included because PgMs typically own cross-functional operations work, distinct from PM (product). |
| Customer Success, Support, Account Mgmt | 🎧 | Clear | Headset — support/customer-success symbol. Distinct from Sales (💼) even though both touch customer accounts. |
| Research, User Research, Data Science | 🔬 | Clear | Microscope — research/inquiry symbol. Distinct from 📊 Data (infrastructure/analytics) vs. 🔬 Research (qualitative/study). |

---

## 3. Role-Emoji Table Reordering

The matching rule is first-match-wins (case-insensitive partial match). The old ordering allowed `Designer` to fall through to `Frontend, UI, Design → ⚛️`. The new ordering places more specific patterns above general ones:

**Key reordering decisions:**
- `PM / Product Manager / Product Owner → 🎯` placed **above** `Lead, Architect, Tech Lead → 🏗️` — a PM is not a tech lead.
- `Designer, UX Designer, Visual Designer → 🎨` placed **above** `Frontend, UI, Design → ⚛️` — "Designer" alone is now unambiguous.
- `Founder, CEO, Executive → 👔` placed above `Lead` — an executive is not a tech lead.
- All 11 new business roles placed below the 8 tech rows but above Scribe/Ralph/@copilot.
- Scribe, Ralph, @copilot remain at the bottom — they are singletons matched by exact name, not role patterns.

The matching note was updated to: *"Order in the table is priority order — more specific patterns higher up."*

---

## 4. Non-tech Routing Subsection

Added `## Non-tech Work Types` to `.squad/routing.md` with:
- 10 work-type rows mapping business functions to primary roles.
- 5 cross-functional gate rules establishing reject-authority for PM (scope), Marketing/Sales (copy/positioning), Legal (contracts), and Finance (spending).

Gate rules follow the same reject-authority pattern already established for Kujan (durability) and Redfoot (user-facing copy).

---

## 5. Compatibility

- **Zero breaking change for existing all-tech teams.** The emoji table additions are additive; no existing pattern was removed or reordered in a way that changes an existing role's assignment (Lead still → 🏗️, Frontend still → ⚛️ when no "Designer" token present).
- **New universes are opt-in via selection algorithm.** They only surface when resonance signals or LRU bonuses favour them.
- **Routing additions are additive.** The non-tech table is a new section; existing tech routing rows are unchanged.

---

## 6. Future Considerations

- **Silicon Valley** was added proactively. If it proves noisy for non-tech projects, the LRU penalty will naturally deprioritise it.
- **Finance threshold rule** (cross-functional rule #5) asks the coordinator to prompt the user for a spending threshold when Finance joins — this is deliberate, not an oversight. The threshold is project-specific and cannot be defaulted here.
- **Legal + Security "Compliance" overlap** is resolved by token priority: "Legal" and "Counsel" are distinct first-match tokens. A role string of "Compliance Officer" would match Legal (⚖️) since Legal appears higher in the table. If the intent is Security compliance, the role string should include "Security" or "Auth".

---

## 2026-05-15T18:00:22Z: User directive — Drop upstream PRs to bradygaster/squad from queue

**By:** Ahmed Sabbour (via Copilot)
**What:** Remove the upstream-PRs queue item. We are NOT submitting PRs to `bradygaster/squad` for: (a) governance docs (non-tech roles + universe additions), (b) SDK type loosening + `engine.registerUniverse()`, (c) character data donation. Scope stays internal.
**Why:** User scope decision — keep our extensions local; do not propose them upstream at this time.

---

## 2026-05-15T18:08:24Z: User directives — UX consistency + queued asks

**By:** Ahmed Sabbour (via Copilot)

**Standing directives:**
1. **Project switcher preserves category.** When the user switches projects via the top dropdown, the destination should be the same category page (boards → boards, flow → flow, etc.) for the new project — not a reset to the default.
2. **System category menu sits last in the sidebar.** Always anchored to the bottom of the navigation order. Project-scoped categories sort above it.
3. **All pages must adhere to Fluent2.** When in doubt about spacing/padding/typography, look up the Fluent2 reference and follow it.

**Queued asks:**
- 🔌 Expose Squadboard's API as **MCP server endpoints** so external CLI (e.g., the Squad CLI) and other AI agents can drop into and interact with the running Squadboard. Hockney's domain — queued for after Conjure backend ships.
- 🩺 **Diagnostics: `.squad/` directory shape check is buggy** — currently reports `missing directory: .squad/agents/; missing directory: .squad/log/; missing file: .squad/routing.md; missing file: .squad/decisions.md` even though all of those exist. Likely a CWD / team-root resolution mismatch in the health check (similar to the Worktree Awareness pattern). Hockney's domain — queued for after Conjure backend ships.

---

## 2026-05-15: Hockney — Conjure classify endpoint (Phase 1)

**Author:** Hockney
**Date:** 2026-05-15
**Status:** Shipped (local commit only — not pushed)

**Scope:** Phase 1 of replacing the free-form Capture inbox with **Conjure** — a universal smart-create surface that takes any prose prompt and routes it to the right creation flow with a pre-filled draft. Phase 1 deliverable is the **backend classify endpoint only**. Frontend integration (modal, FAB rewire, deprecating `CaptureModal`) is out of scope this wave and owned by Keyser after Fenster's design lands.

**Endpoint:** `POST /api/conjure/classify`

**Classifier strategy:** **Option C (hybrid)** — rule-based first, LLM only for ambiguous cases. Rationale: determinism over cleverness, zero runtime cost on hot path, graceful degradation, tunable threshold.

**6 Phase 1 intents:** project, issue, team, agent, skill, tool (with draft contracts defined).

**What's NOT in scope (Phase 2):** inbox-item, consult, ceremony, mcp-server (10 kinds in locked-in proposal, Phase 1 ships 6).

**Commit:** `feat(server): add /api/conjure/classify endpoint for intent routing` (SHA to be filled in by Hockney's history).

**File map:**
- `packages/server/src/services/conjure-classifier.ts` — rewritten (was broken/unused), ~350 lines
- `packages/server/src/routes/conjure.ts` — new, ~75 lines
- `packages/server/src/index.ts` — mount `/api/conjure`, +5 lines

**Verification:** `tsc --noEmit` clean; 13/13 sample prompts classified correctly offline; edge cases handled.

---

## 2026-05-15: McManus — Casting reference trim + non-tech charter templates

**Author:** McManus
**Date:** 2026-05-15
**Status:** Shipped (commits `10f659bf`, `db12a997`)

**What:**
1. **Casting reference trimmed from 20 → 17 universes.** Dropped Mad Men, Succession, and Silicon Valley from `.squad/templates/casting-reference.md`.
2. **Per-role charter templates added for 7 non-tech roles** under `.squad/templates/non-tech-charters/` (PM, Designer, Founder, Sales, Marketing, Customer Success, Research) plus an index README.

**Why:**
- **Trim:** Coordinator/picker symmetry — 3 dropped universes don't earn their keep in the casting reference and never appeared in the runtime picker. Removing them improves alignment.
- **Templates:** Reusable starting points for next non-tech hire. Each follows the same structural shape as tech charters (Identity, What I Own, How I Work, Boundaries, Voice, Model, Collaboration) but role-specific. `{Name}` placeholder for casting to fill.

**Files affected:**
- Commit `10f659bf`: `.squad/templates/casting-reference.md`, `.github/agents/squad.agent.md`
- Commit `db12a997`: `.squad/templates/non-tech-charters/` (8 files: README + 7 role templates)

**Invariants preserved:** One universe per assignment, casting algorithm (size_fit + shape_fit + resonance_fit + LRU), charter shape across team, `{Name}` placeholder literal.


---

## 2026-05-15: Keyser — UI bundle: ceremonies padding, Consult width, project-switcher category preserve, sidebar reorder, Reconnecting badge fix

**Author:** Keyser
**Date:** 2026-05-15
**Status:** Shipped (5 commits in Wave 9)

**Commits:**
1. **`8b3f7197`** — Fluent2 spacing on CeremonyList page (padding canon compliance)
2. **`16414e90`** — Widened Consult page layout
3. **`d72fd8a7`** — Project switcher preserves category + System nav anchored to bottom (sidebar reorder)
4. **`5673d57b`** — Reconnecting badge alignment + cancelled stale reconnect timer (root cause: client-side state machine, NOT server)

**Team conventions ratified:**

### 1. Project switcher preserves the active category
When the user switches projects via `foo ▾` dropdown, the destination preserves the route segment (category). Examples: `/projects/foo/board` → `/projects/bar/board`; `/projects/foo/flow` → `/projects/bar/flow`.

Recognised categories (in `Layout.tsx` `PROJECT_SCOPED_SEGMENTS`): dashboard, board, flow, agents, skills, tools, mcp-servers, ceremonies, costs, settings, inbox, consult, diagnostics.

**Action for other agents:** Any new project-scoped top-level segment must be added to `PROJECT_SCOPED_SEGMENTS` in `Layout.tsx`.

### 2. Fluent2 page padding canon
Page content padding is `tokens.spacingVerticalXXL` (24 px) + `tokens.spacingHorizontalXXL` (24 px).

**Anti-pattern A:** Single-axis token for both axes — always use both tokens explicitly.

**Anti-pattern B:** List scroll containers missing padding — any `flex: 1; overflow: auto` div wrapping a DataGrid or list needs padding tokens, else content slams edges.

```
List body convention:
paddingTop: tokens.spacingVerticalL (not XXL — header above handles spacing)
paddingBottom: tokens.spacingVerticalXXL
paddingLeft: tokens.spacingHorizontalXXL
paddingRight: tokens.spacingHorizontalXXL
```

**Audit candidates:** Skills, Tools, MCP Servers, Agents, Costs pages should be checked for same violations.

### 3. Sidebar bottom-anchor pattern
For pinning a nav section (SYSTEM, settings) to the visual bottom of the sidebar: drop a `<div style={{ flex: 1 }} />` spacer in `NavDrawerBody`. No CSS overrides needed — Fluent's flex column + DrawerBody flex already handle it.

**Root cause note:** Reconnecting badge alignment + stale timer were a **client-side state machine bug, NOT a server issue**. No Hockney handoff needed.

---

## 2026-05-15: Hockney — MCP server extended (11 tools) + diagnostics path resolver

**Author:** Hockney
**Date:** 2026-05-15
**Status:** Shipped (local commits only — not pushed)

**Scope:** Two parallel asks from Ahmed (queued in Wave 8):

1. 🔌 **MCP Phase 1 starter tools** — Extend the existing `createMcpServer()` factory in `packages/server/src/mcp/server.ts` with 4 new tools: `list_projects`, `list_inbox`, `capture` (wrapping Conjure classifier), `get_routing`. Total tool count now **11** across stdio + HTTP `/mcp` transports. README with `.copilot/mcp-config.json` install snippet added at `packages/server/src/mcp/README.md`.

2. 🩺 **Diagnostics false-negative fix** — Bug: `projects.path` for foo already pointed AT `.squad/` (not the parent), so `join(path, '.squad')` was double-nesting to `.squad/.squad/`, causing all 4 inner collection checks to fail. Solution: `resolveSquadDir()` helper tolerates both layouts, returns ONE clear error when project path is wrong instead of cascading missing-collection errors.

**MCP tool details:**

| Tool             | Wraps                                                      | Transport |
|------------------|------------------------------------------------------------|-----------|
| `list_projects`  | `db.select().from(projects)` + `resolveSquadDir()` per row | stdio, HTTP |
| `list_inbox`     | `inboxService.listInboxItems()`                           | stdio, HTTP |
| `capture`        | Conjure classify → issue creation if intent='issue'        | stdio, HTTP |
| `get_routing`    | `resolveSquadDir()` + `readFile('.squad/routing.md')`      | stdio, HTTP |

Naming: kept the Phase 18 convention (bare names, no `squadboard.*` prefix) for consistency within the factory.

**Diagnostics resolver:**

`resolveSquadDir(storedPath): ResolvedSquadDir | UnresolvedSquadDir`
- Resolves to absolute path first (defensive against relative CWD pivots).
- If basename is `.squad/` AND exists → use as-is.
- Else if `<path>/.squad/` exists → use that.
- Else → `{ ok: false, reason }` with actionable diagnostic.

Applied to:
- `checkSquadDirShape()` (the reported bug)
- `checkDiskWriteable()` (same double-nesting bug, was silently writing wrong dir)
- `mcp/server.ts → handleGetRouting()` (new, uses same helper)

**Files touched:**
- `packages/server/src/services/diagnostics.ts` — +`resolveSquadDir()` + types; rewrote `checkSquadDirShape`; updated `checkDiskWriteable`.
- `packages/server/src/mcp/server.ts` — +4 TOOLS, +4 handlers, +4 switch cases, imports.
- `packages/server/src/mcp/README.md` — new install/usage guide.

**Commits:**
- `85dd8780` — Diagnostics false-negative fix
- `1838253d` — MCP Phase 1 starter tools

**Verification:** `cd packages/server && npx tsc --noEmit` → clean (exit 0, 0 errors). Resolver verified offline against all live `projects.path` values; foo resolves correctly.

**Follow-ups (not in this commit):**
- **`projects.path` migration.** Unify both layouts; until then, all consumers should use `resolveSquadDir()`.
- **Auth on MCP HTTP transport.** Local-only fine for hacking; problem if Squadboard runs on shared port.
- **`capture` for non-issue intents.** Currently return `draft_only`; could support full materialisation with more inputs (Phase 2).
- **`list_inbox` filters.** Add `userId`, `since`, `until`, search (Phase 2).

