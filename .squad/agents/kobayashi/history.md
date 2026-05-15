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

## Why we bypass `SquadCoordinator`

PRD Appendix A — the Coordinator's regex routing is fine for one-shot use; its parallel fan-out and ad-hoc handoffs are exactly what Squadboard exists to escape. We call `SquadClient.createSession()` directly from the deterministic engine.

## Roadmap I deliver against

- **Demo 3** — Squad onboarding (read `.squad/`, surface agents, hooks, cost)
- **Demo 4** — One-shot agent (first end-to-end SDK call from runWorker)
- **Demo 5** — Routing tier 1 (deterministic rules)
- **Demo 8** — Routing tiers 2 + 3 (`matchRoute()` + specifier agent)
- **Demo 14** — MCP + slash command (`engine_emit_final_output` + idempotent create)

## Learnings

### 2026-05-14 — @bradygaster/squad-sdk wired as primary LLM backend

Replaced `@copilot-extensions/preview-sdk` (wrong package) with `@bradygaster/squad-sdk@0.9.4` (the real SDK). Correct import path is `@bradygaster/squad-sdk/client` — the `./client` package export re-exports `SquadClient` from `adapter/client.js`. The `./adapter` export maps to types only (no `SquadClient`); `./` (main) does not export `SquadClient` at all.

Key API learnings:
- `SquadClient` options: `{ githubToken, cwd, useLoggedInUser: false }`
- `createSession` config: `systemMessage: { mode: 'replace', content: charter }`, `workingDirectory`, `model`
- `sendAndWait(session, { prompt: task })` — field is `prompt`, NOT `message`
- Return type is `Promise<unknown>` — underlying copilot-sdk shape: `{ type: "assistant.message", data: { content: string } }`. Extract via `result.data.content` → `result.content` → `result.text`.
- Always `disconnect()` in `finally` — SquadClient wraps `@github/copilot-sdk` CopilotClient which spawns a CLI process; leaking it is a resource risk.
- The SDK downloads `@github/copilot` binaries (~73MB + ~75MB arch-specific) on `pnpm add` — expected, not a problem.
- Commit `0c35af92`. Build: 17 pre-existing errors unchanged, zero new errors from SDK integration.

### 2026-05-14 — Copilot SDK wired as primary LLM backend

Implemented McManus's `mcmanus-sdk-integration.md` plan exactly. `@copilot-extensions/preview-sdk@5.0.1` installed as a runtime dependency. `tryCopilotSdk()` added as Priority 1 backend in `squad-client.ts` — reads `GITHUB_TOKEN` or `SQUADBOARD_GITHUB_TOKEN`, calls `prompt()` with charter as system message (role='system' in messages array, NOT a top-level `system:` key — the SDK doesn't have that field). `SessionOptions.model?` added (backward-compatible). Bridge passes `input.agent.model ?? undefined` through. Backend priority: Copilot SDK → llm CLI → ollama → offline briefing. Build: 17 pre-existing TS2742 errors unchanged (these are declaration emit issues in route files); my new SDK code introduces zero errors. Key learning: `prompt()` API takes messages array with `role: 'system'` — not a `system:` top-level option. Also learned: removing `drizzle.config.ts` from tsconfig `include` unmasked ~128 underlying route type errors (Express v5 compat issues) because the drizzle rootDir violation was causing TypeScript to operate in a degraded mode. Kept original tsconfig to maintain baseline error count.


### 2026-05-14 — squadboard-chore extension
Created `.github/extensions/squadboard-chore/extension.mjs` to productize the chore workflow alongside add-feature and report-bug. Chores are housekeeping tasks (deps, refactors, config, CI, tooling, perf, type fixes) that are NOT bugs, NOT features, and need NO docs update (Redfoot excluded). Single-specialist routing via COMPONENT_OWNER map (20 component keys). Tool params: required `title`+`description`, optional `component` enum, `effort` enum (trivial/small/medium/large), `implementation_notes`. Writes spec to `docs/chores/{choreId}.md` and inbox note to `.squad/decisions/inbox/{choreId}.md`. Returns direct assignment prompt to the owning specialist — no Ralph fan-out, no Kujan regression test required.

### 2026-05-14
Demo 1 SDK surface: squad-discovery.ts scans filesystem for .squad/ dirs (home + common dev dirs, depth 3). Validates by checking team.md exists. project-squad.ts links projects to squad dirs. Discovery API: GET /api/squad/discover, validate, register.

### 2026-05-14
Demo 3 SDK: CharterCompiler parses charter.md (name, role, model, expertise, reviewer authority). agent-sync.ts syncs .squad/agents/ to DB, hash-based change detection. Hire flow creates charter.md + history.md on disk atomically.

### 2026-05-14
Demo 4 SDK bridge: executeAgentRun is the single entry point (Invariant 1). SquadClient.createSession() called directly, bypassing SquadCoordinator. Graceful fallback to stub when SDK not installed. OutputStreamer appends chunks to DB. CostTracker records per-run costs.

### 2026-05-14
Demo 5: routing-compiler.ts parses .squad/routing.md tables into RoutingRule[] (label/keyword/catchall match types, priority by file order). RoutingBadge shows ⚡ Auto on auto-routed cards. Routing test panel in Agents page.

### 2026-05-14
Demo 6 HookPipeline: register hooks by HookPoint (pre-run/output-validation/post-run/on-error), run in sequence, stop on first failure. Output validation hook registered at startup (Invariant 4). bundled simple.yaml template: route→agent_run→approve with output_schema.

### 2026-05-14 — SDK real invocation (squad-client.ts rewrite)

Replaced the `@sabbour/squad-sdk` stub entirely. `squad-client.ts` now:
1. Reads the charter from disk using `charterPath`.
2. Tries `llm` CLI (Simon Willison's tool, `pip install llm`) via `child_process.execFile` — supports many LLM backends via plugins, cost $0 for local.
3. Falls back to `ollama run llama3` if `llm` is absent.
4. Falls back to a structured **offline briefing** (full charter + task markdown) when no backend is reachable — zero-token, cost $0.000, honest label.
No `@sabbour/squad-sdk` import remains. `[stub output — real SDK integration in production]` string is gone from both `squad-client.ts` and `bridge.ts`. The `executeAgentRunStub` export in `bridge.ts` now produces a useful forced-stub briefing (for tests) without any placeholder text. Committed as `a2b826e`.

### 2026-05-14 — Demo 5 routing compiler deepdive
Demo 5 routing compiler: parseRoutingFile reads .squad/routing.md 3-table format (label/keyword/catchall rows). matchRule(issue) walks priority order, returns first match or null for escalation. RoutingBadge.tsx renders ⚡ Auto pill on auto-routed issue cards (shows matched rule label on hover). Agents page routing test panel: input issue title + labels, output resolved assignee. Non-fatal on parse errors (logs + continues).

### 2026-05-14 — squad-client.ts simplified to ACP-only (no fallbacks)

Rewrote `squad-client.ts` per Ahmed's directive. Removed:
- `tryLlmBackend()` (llm CLI + ollama subprocess logic)
- `buildOfflineBriefing()` (offline stub output)
- `import { execFile } from 'node:child_process'`
- `import { promisify } from 'node:util'`
- All multi-tier fallback logic

What remains: a single `createAgentSession()` that calls `SquadClient.createSession()` + `sendAndWait()` directly. No fallbacks — if the SDK call fails, the error surfaces immediately.

Key learnings:
- `@github/copilot-sdk` `sendAndWait()` returns `AssistantMessageEvent | undefined`
- Confirmed shape from `/tmp/squad-sdk-inspect/node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`: `{ type: "assistant.message", data: { messageId: string, content: string } }`
- `extractOutput()` checks `result.data.content` as primary path (matching actual SDK shape), then falls back to top-level `content`, `text`, `message` fields
- Token fallback: if no GITHUB_TOKEN, `useLoggedInUser: true` (relies on VS Code / `gh auth`)
- Commit `12372450`. All 16 pre-existing TS errors unchanged; zero new errors from this change.

### 2026-05-15 — Ceremony create page UX + Conjure entrypoint

**Conjure wiring strategy chosen: Option A** — the Phase 16 `generate-from-prose` endpoint (`ded0a28b`) already exists and returns `{ yamlContent, triggerKind, triggerConfig, rationale, warnings }`. The YAML is parseable client-side via `parseSteps()` (from `services/ceremony-graph.ts`) to extract name, description, steps, and header extras. No new server service needed. Wired through `useGenerateFromProse(projectId)` (already in `api/ceremonies.ts`) directly into `CeremonyEditor.tsx`.

**Page clarity pattern applied (first-time-friendly create UX):**
- `PageHeader` replaces bespoke header for new ceremonies (consistent with all other in-project pages).
- Dismissible intro card (`<Card>` + `<Body1>`) explains what a ceremony is. Persisted via `localStorage` key `squadboard.ceremonyEditor.introDismissed`.
- `FormulatePanel` mounted at the top of create mode (isNew only). On success: parses YAML → populates name/trigger/steps, switches to Visual tab.
- Trigger picker replaced with `<RadioGroup>` showing both the option name and a one-line human description (e.g., "Schedule — Run on a recurring schedule (cron expression).").
- Step kind `<Dropdown>` expanded: common kinds show descriptions; advanced kinds collapsed under `── Advanced ──` divider.
- Sensible defaults on create: `kind='workflow'`, `triggerKind='manual'`, single empty `agent_run` step.
- Empty state for steps: Fluent `<Card>` with guidance text pointing to both "Add step" and "Formulate with AI".
- Field helper `<Caption1>` text added (description field, kind field, cron expression).

**New-user vs power-user split:** keyed on `ceremonyId` route param being absent (`isNew = !ceremonyId || ceremonyId === 'new'`). Conjure panel, PageHeader, intro card, and name field above the body are all gated on `isNew`. The edit-mode header (name input + badges + run/validate buttons) is unchanged.

### 2026-05-15 — Phase 5 sdk-state.ts wrapper (p5-state-wrapper)

Created `packages/server/src/services/sdk-state.ts` — the foundational SquadState shim for Phase 5.

**API surface chosen:**
- `getState(projectId): Promise<SquadState>` — lazily cached, primary entry point.
- `invalidateState(projectId): void` — cache eviction (call after re-linking a project path).
- Seven typed collection accessors: `getAgents`, `getRouting`, `getDecisions`, `getSkills`, `getTeam`, `getTemplates`, `getConfig`. Each returns the SDK collection instance directly.
- `ProjectNotFoundError` — typed error thrown when the project row is absent from the DB.

**Storage strategy:** `FSStorageProvider(rootDir)` with confinement, combined with `SquadState.fromStorage()` (synchronous factory, no existence re-validation). `projects.path` in the DB is the `.squad/` dir; `rootDir = path.dirname(squadPath)`.

**Cache:** `Map<string, SquadState>` scoped to the server process. Collections themselves always read through to the filesystem — no stale data risk on reads. Cache eviction is explicit via `invalidateState()`.

**TypeScript check:** Zero new errors introduced. Two pre-existing errors in `conjure-classifier.ts` (`modelId`/`source` mismatch from prior session) are untouched.

Decision filed: `.squad/decisions/inbox/kobayashi-sdk-state-wrapper.md`.

## Recent team activity

**2026-05-15 Round 2 shipped:** Hockney (attachments backend), McManus (multi-modal frontend), Verbal (Consult chat fix), Fenster (typography sweep), Kobayashi (Ceremony Conjure UX), Keyser (layout rebalance). See `.squad/decisions.md` for Fluent2 canon, image bytea architecture, create-page pattern, react-markdown rendering.

## Team update (2026-05-15T16:09:55Z — Wave 3)

SDK state wrapper (r1, commit 8fdbbaa9): `services/sdk-state.ts` with SquadState factory and 7 typed collection accessors (agents, routing, decisions, skills, team, templates, config). Synchronous fromStorage(storage, rootDir) factory (no re-validation; path already validated on DB write). Module-level cache per projectId with invalidateState() eviction. FSStorageProvider must receive rootDir for security confinement. Foundational shim for downstream Phase 5 work; all Phase 5 state reads depend on this wrapper. SDK quirk: collection constructors not exported; only instantiate via SquadState.

### 2026-05-15T09:48:00-07:00 — Per-project Kanban column add/remove (dynamic-columns)

**Batch A — `1a4c5d46`** (schema + bootstrap):  
- Removed `columnStatusEnum` pgEnum from `schema.ts`; `issues.status` is now `TEXT`.  
- Added `semantic TEXT NOT NULL DEFAULT 'custom'` and `is_default BOOLEAN NOT NULL DEFAULT false` to `columnMeta` table in schema.ts.  
- Bootstrap DDL in `db/index.ts`: idempotent enum→text migration (`DO $$ IF EXISTS $$`), `ADD COLUMN IF NOT EXISTS` for both new fields, semantic backfill for the 5 seed columns, `is_default=true` backfill on `backlog` for projects with no default set.

**Batch B — `d87c8f45`** (CRUD routes + validation + client hooks):  
- `routes/column-meta.ts` rewritten: added `POST /columns`, `DELETE /columns/:columnId` (with `?reassignTo=` atomic issue migration), `PATCH /columns/reorder` (full order rewrite in transaction), extended `PATCH /columns/:columnId` with `semantic`/`isDefault` (isDefault=true atomically clears others).  
- `services/issues.ts`: `ColumnStatus` widened to `string`, `assertColumnExists(projectId, columnId)` exported, `getDefaultColumnId(projectId)` private helper, `createIssue` defaults to `is_default=true` column, `moveIssue` validates column before write.  
- `services/templates/project-template.ts`: `ColumnMetaBundle` extended with `semantic`/`isDefault`; export+import updated.  
- `client/src/api/columns.ts`: `ColumnMeta` interface extended; `useCreateColumn`, `useDeleteColumn`, `useReorderColumns` added.

TypeScript: server 2 pre-existing conjure-classifier errors only; client clean.  
Smoke test: `POST /api/projects/<id>/columns` returned `{ ok: true, data: { columnId: "triage", semantic: "backlog", isDefault: false, ... } }`.  
Decision filed: `.squad/decisions/inbox/kobayashi-columns-add-remove.md`.


Migrated charter-compiler + agent-sync from raw `fs/promises` reads to SDK collections.

**charter-compiler.ts:** Refactored internally without changing any public signatures.
- Extracted `parseCharterContent(content: string): CharterMetadata` — synchronous, pure in-memory parser. Called by `parseCharter(charterPath)` (unchanged signature, now delegates).
- Extracted `computeContentHash(content: string | Buffer): string` — synchronous md5. Called by `computeCharterHash(charterPath)` (unchanged signature, now delegates).
- Both new exports are available for callers who already have content in memory (e.g. after an SDK read).

**agent-sync.ts:** Two callsite clusters replaced with SDK-first + fs-fallback:
1. `fs.readdir(agentsDir)` → `(await getAgents(projectId)).list()` with warn + readdir fallback
2. `fs.access(charterPath)` + `parseCharter(charterPath)` + `computeCharterHash(charterPath)` → `(await getAgents(projectId)).get(name).charter()` with warn + fs.readFile fallback. Both branches now call `parseCharterContent(content)` + `computeContentHash(content)` — no double-file reads.

**No write-side migration:** `writeCharter` in charter-compiler.ts uses `fs.writeFile`. The SDK's `AgentsCollection` only has `create(name, charter)` (for NEW agents) and no `AgentHandle.updateCharter()` method. Raw-fs write retained intentionally; documented in decision doc.

**TS check:** Zero new errors. Two pre-existing `conjure-classifier.ts` errors untouched.

Decision filed: `.squad/decisions/inbox/kobayashi-fs-migration.md`
Commit: (see git log after p5-migrate-fs commit)
