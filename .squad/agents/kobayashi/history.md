# Kobayashi — History

## Core Context

- **Project:** Squadboard — local-first kanban + workflow board for [Squad](https://github.com/bradygaster/squad) agents
- **Package:** `@sabbour/squadboard` · Local install: `npx @sabbour/squadboard init` · MIT · Self-hosted
- **Role:** Squad SDK Integrator
- **Joined:** 2026-05-14T08:17:03Z
- **Hired by:** Ahmed Sabbour
- **PRD:** `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md`

## SDK surface I own

From `@squad/sdk`:
- `SquadClient` / `SquadSession` — per-run session lifecycle
- `EventBus` — streaming session messages, tool calls, completion events
- `CharterCompiler` — reads `.squad/agents/<name>/charter.md` + identity files; produces frozen system-prompt
- `HookPipeline` — manually wired into `SquadSessionHooks.onPreToolUse` / `onPostToolUse` (NOT auto-attached)
- `CostTracker` — `wireToEventBus(bus)` then forward into `cost_records`
- OTel runtime — passes through unchanged

## Routing pipeline I implement

Three tiers (first match wins):
1. **Deterministic rules** (`.squad/routing.md`) — label matchers, title regex, priority. Fast, free.
2. **`matchRoute()`** — Squad's existing matcher, used router-only (returns name; we don't let it spawn).
3. **Specifier agent** — an `agent_run` (`kind=specifier`) reads issue + roster + each agent's `description`; returns `{assignee_agent_id, confidence}`. If `confidence < 0.6`, fall through to `triage_assign` (human picker).

## Roadmap I deliver against

- **Demo 3** — Squad onboarding (read `.squad/`, surface agents, hooks, cost)
- **Demo 4** — One-shot agent (first end-to-end SDK call from runWorker)
- **Demo 5** — Routing tier 1 (deterministic rules)
- **Demo 8** — Routing tiers 2 + 3 (`matchRoute()` + specifier agent)
- **Demo 14** — MCP + slash command (`engine_emit_final_output` + idempotent create)

## Recent team activity

**2026-05-15 Round 2 shipped:** Hockney (attachments backend), McManus (multi-modal frontend), Verbal (Consult chat fix), Fenster (typography sweep), Kobayashi (Ceremony Conjure UX), Keyser (layout rebalance). See `.squad/decisions.md` for Fluent2 canon, image bytea architecture, create-page pattern, react-markdown rendering.

---

## Wave 5 Update (2026-05-15T10:18:00Z)

**Run:** kobayashi-3  
**Model:** claude-sonnet-4.6  
**Task:** Per-project add/remove kanban columns

**Outcome:**
- Eliminated hard-coded `column_status` enum
- Made `column_meta` single source of truth for columns
- Users can now add/remove columns per project
- Five defaults seeded on first access
- Batch A (schema): commit `1a4c5d46`
- Batch B (endpoints): commit `d87c8f45`
- Batch C (docs): commit `6067d8a2`
- Decision: `.squad/decisions/inbox/kobayashi-columns-add-remove.md`
- New endpoint contracts documented for Keyser implementation
- Also merged carryover: kobayashi-fs-migration.md (3 callsites in agent-sync.ts migrated to SDK)

---

## Wave 6 Update (2026-05-15T10:36:00Z)

**Run:** kobayashi-4
**Model:** claude-sonnet-4.6
**Task:** Local universe registry — Hire Team picker missing Seinfeld (and The Office, The Simpsons)

**Outcome:**
- Created `packages/server/src/services/local-universes.ts`: `LocalUniverseId` union, `LocalUniverseTemplate`/`LocalUniverseCharacter` interfaces, `LOCAL_UNIVERSES` record with 15 Office + 10 Seinfeld + 14 Simpsons characters (39 total), plus `getLocalUniverseIds()`, `getLocalUniverse()`, `isLocalUniverseId()` helpers.
- Modified `casting-engine.ts`: `ExtendedUniverseId` type, `listUniverses()` now returns 5 universes (2 SDK + 3 local), `castTeam()` dispatches to local two-phase casting path for local ids.
- Modified `hire-formulator.ts`: team prompt now lists all 5 universe ids with tone guidance.
- Modified `packages/client/src/api/agents.ts`: `CastingUniverseId` widened to include the 3 new ids.
- Both `tsc --noEmit` checks clean.
- Code commit: `785db624`
- Decision: `.squad/decisions/inbox/kobayashi-local-universe-registry.md` (commit `7354cab7`)

---

## Wave 6 Addendum (2026-05-15T10:38:30Z)

**Run:** kobayashi-4b (quick follow-up)
**Task:** Add Parks and Recreation to local universe registry

**Outcome:**
- Extended `LocalUniverseId` with `'parks-and-rec'`, added 14-character template to `LOCAL_UNIVERSES` (Leslie, Ron, Tom, Ann, April, Andy, Ben, Chris, Donna, Jerry/Garry, Mark, Jean-Ralphio, Tammy Two, Mona-Lisa). Full 9-role AgentRole coverage.
- Updated hire-formulator.ts prompt to list all 6 universes.
- Extended `CastingUniverseId` in client agents.ts with `'parks-and-rec'`.
- Both `tsc --noEmit` clean.
- Commit: `185f88d6`
- Decision: `.squad/decisions/inbox/kobayashi-parks-and-rec-universe.md`
- Picker now shows 6 universes (2 SDK + 4 local). Total local characters: 53.


**Status:** COMPLETE — API stable for client. Ready for Keyser Batch B.

---

## Learnings

- **2026-05-15 Wave 7 — Universe Trim (2026-05-15T17:52:56Z)** — Trimmed 4 local universes to 10 chars each (53 → 40 total) per Ahmed's scope preference. Dropped peripheral characters: Office (Phyllis, Ryan, Toby, Creed, Meredith), Simpsons (Wiggum, Skinner, Frink, Milhouse), Parks & Rec (Mark, Jean-Ralphio, Tammy, Mona-Lisa). Seinfeld already at cap. Verified all 9 SDK roles (`lead | developer | tester | prompt-engineer | security | devops | designer | scribe | reviewer`) still covered in each universe via `preferredRoles` union scan; no swap-overrides needed. `tsc --noEmit` clean for `local-universes.ts` (only pre-existing unrelated errors in `conjure-classifier.ts`). No callsites referenced dropped names by string. Commit: `54f2dc5e`. **Companion Wave 7 work:** McManus narrowed non-tech roles from 11 to 7 (removed HR, Legal, Operations, Finance). Both role narrowing and universe trim are paired Ahmed directives for scope reduction on the non-tech surface area. Orchestration log: `.squad/orchestration-log/2026-05-15T17-52-56Z-kobayashi.md`.

- **2026-05-15T22:14:50-07:00 Wave 14, q8 — Scribe as ceremony SDK** — Chose **(a) new package `packages/squadboard-sdk/`** over (b) in-package approach. Rationale: `packages/squadboard/` is a distribution package (coordinator-fragment, postinstall) not a code library. Future agents (Auditor, etc.) will want to compose primitives independently; a separate SDK package keeps the MCP protocol surface clean.

  **Primitives extracted** (all in `packages/squadboard-sdk/src/scribe/primitives.ts`, independently testable):
  1. `archiveDecisionsBySize(path, opts)` — archive-by-size gate
  2. `mergeInbox(inboxDir, decisionsPath)` — merge inbox/*.md → decisions.md, dedupe, delete
  3. `writeOrchestrationLogs(manifest, logsDir, datetime)` — one file per agent
  4. `writeSessionLog(manifest, logsDir, datetime)` — brief topical summary
  5. `crossAgentHistoryUpdates(manifest, agentsDir)` — team updates to history.md files
  6. `summarizeHistoryIfLarge(historyPath, thresholdBytes)` — soft compaction at 15KB
  7. `commitScribeFiles(paths, message, repoRoot)` — individual `git add -- <path>` per file, commit with -F

  **Archive-gate — course-corrected (same wave):** Initial implementation used a size-target walk (oldest→newest until ≤ 30KB). Ahmed course-corrected: SDK must mirror squad.agent.md task #1 EXACTLY — date-window only (>= 20KB → archive > 30d; >= 51KB → archive > 7d). No `targetBytes` parameter. The 74.7KB Wave 13 issue is a known follow-up against squad.agent.md, not a divergence to bake into the SDK. Rule established: squad.agent.md is updated FIRST, then the SDK syncs.

  **Ceremony registration** — `BUILT_IN_CEREMONIES` array in `ceremony-translator.ts`. First entry: `scribe-close-out`. Pattern: push to array + implement `invoke(ctx)` that dynamic-imports `@sabbour/squadboard-sdk`. Three trigger flags: `manual` (q9 button), `scheduled` (q7 daemon), `coordinator` (CLI spawn). Public API: `getBuiltInCeremony(id)`, `listBuiltInCeremonies()`, `invokeBuiltInCeremony(id, ctx)`.

  **Workspace note** — SDK is a peer pnpm workspace package (`@sabbour/squadboard-sdk`). Server's ceremony-translator.ts uses a lazy dynamic `import('@sabbour/squadboard-sdk')` so the SDK is only loaded when the ceremony fires. Server tsconfig stays unchanged (no `paths` needed once SDK is built and dist/index.d.ts exists). Build the SDK before building the server.

  **Scribe stays unchanged** — charter.md untouched, squad.agent.md spawn template untouched. Migration to call SDK from coordinator is deferred to a future wave once the daemon (q7, Verbal) proves the contract.

---

## Wave 14 — q8 course-correction: SDK mirrors agent spec

**Date:** 2026-05-15T22:14:50-07:00  
**Spawned by:** Copilot Coordinator  
**Task:** q8-scribe-as-ceremony  

Received course-correction from Ahmed: `squadboard.scribe.closeOut()` SDK must implement the EXACT 9-step algorithm from squad.agent.md's Scribe spawn template. NO divergence. Archive-gate rule is immutable per upstream spec:
- >= 20480 bytes → 30-day archive
- >= 51200 bytes → 7-day archive

This is the "Scribe stays one agent" principle: one source of truth for algorithm, multiple callers.

---

## Wave 18 Update (2026-05-15T22:42:29.855-07:00)

**Run:** kobayashi-w18  
**Model:** claude-sonnet-4.6  
**Tasks:** P1 — npm publish setup; P2 — Squad coordinator awareness (upstream PR + fallback patcher)

### P1 — Package publishing

**packages/server → `@sabbour/squadboard@0.1.0`:**
- Renamed from `@sabbour/squadboard-server`, removed `private: true`
- Added: `bin: { squadboard: "./dist/cli/index.js" }`, `files`, `publishConfig`, `repository`, `homepage`, `license`, `prepublishOnly`, `postinstall`
- Fixed: duplicate `@electric-sql/pglite` dependency removed
- Created: `src/cli/index.ts` — CLI dispatcher (mcp, start, --help, --version)
- Absorbed coordinator-fragment.md + postinstall-coordinator-fragment.mjs from packages/squadboard (packages/squadboard marked private as @sabbour/squadboard-coordinator-fragment)

**packages/squadboard-sdk → `@sabbour/squadboard-sdk@0.1.0`:**
- Added: `files`, `publishConfig`, `repository`, `homepage`, `license`, `prepublishOnly`

**Root package.json:** renamed to `@sabbour/squadboard-monorepo`, marked private (prevents pnpm workspace name conflict).

**Builds:** both clean. Dry-run pack outputs verified (no .ts source, no node_modules, correct file lists).

**Publish status:** BLOCKED — npm token in ~/.npmrc returns 401. Todos filed: `p1-publish-mcp-auth-needed` and `p1-publish-needs-human-trigger`. Commands ready: `pnpm publish --access public --no-git-checks` in each package dir.

### P2 — Squad coordinator awareness

**Path A (upstream PR) — FILED:**
- Forked `bradygaster/squad` as `sabbour/squad` (fork already existed)
- Branch: `feat/extension-fragments` → PR https://github.com/bradygaster/squad/pull/1124
- Added `### Extension Fragments` section to `squad.agent.md`: scan dirs, YAML front matter shape, loading rules, anti-patterns, Source of Truth table entry
- Added `docs/plugins/squad-coordinator-extensions.md`: full plugin-author guide
- Correct repo confirmed as `bradygaster/squad` (not `squad-duck`)

**Path B (fallback patcher) — SHIPPED:**
- `packages/server/scripts/install-squad-extension.js` — patches `.github/agents/squad.agent.md` with `<!-- SQUADBOARD_EXTENSION_START/END -->` sentinels
- Idempotent (upgrade-aware), `remove` command strips block
- q5-extension-fallback-patcher: DONE

**Extension fragment content:** Squadboard MCP tools + github_* tools (W18 Hockney) + ceremony API. Note: github_* documented but arriving same wave; patch bump to 0.1.1 once Hockney lands.

**Decision doc:** `.squad/decisions/inbox/kobayashi-w18-npm-publish-squad-aware.md`

