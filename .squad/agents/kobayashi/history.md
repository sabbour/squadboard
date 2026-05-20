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



## Wave 18 Update (2026-05-15T22:42:29.855-07:00)

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


---

## W22 Lesson — Loading Gallery + ActionLoading Pattern

**Date:** 2026-05-16  
**Wave:** 22

Loading gallery (K5) + ActionLoading component (K7) from Kobayashi-w22.

**K5 — Dev-only loading gallery:**
- Route `/__loading-gallery` is DEV-gated with `import.meta.env.DEV` — zero production bundle cost
- Gallery showcases all loading patterns: RouteProgressBar, PageLoading (3 variants), SectionLoading (3 variants), InlineLoading (3 variants), ActionLoading (2 variants)
- Single source of truth for loading UI — developers visit the gallery to see and copy-paste markup
- Wraps in `<PageHeader>` using existing layout component

**K7 — ActionLoading component + sweep:**
- `<ActionLoading>` wraps `<Spinner size="tiny" />` for button-icon slot
- Use `display: contents` on wrapper to keep icon slot clean (no margin bleed)
- Add optional `label` prop for semantic meaning (e.g., "Ending wave…", "Formulating…", "Casting…")
- Swept 4 call-sites (CeremonyList 2×, FormulatePanel 1×, HireTeamModal 1×) with semantic labels
- Cleaned up unused imports

**Surgical sweep strategy:** Fix the most critical sites first (button actions), defer UI-only spinners (status indicators, text inline spinners) to future waves. Keeps PRs focused and reviewable.

**Future:** 8+ remaining tiny-spinner sites documented for next sweep wave (ProjectPicker, SystemBackup, SystemGitHub, GitHubActivityFeed, LiveSession).

---

## W23 Lesson — First Squad App Pattern

**Date:** 2026-05-16  
**Wave:** 23  

**F4 — AKS Feature Kanban curated Squad App shipped.** Pattern: spec-quotes-in-decision-doc enforced (3+ quotes required, per W22 post-mortem standard). Ambiguities resolved systematically (5 total, all documented). Spec gaps flagged as W24 follow-up todos (`kind` enum, `displayName` field, `artifacts` section, agent discovery path, Ajv format validator).

**Takeaway:** Future Squad App specs should pre-define: `kind` enum (project-template|skill-pack|ceremony-pack), optional `displayName`, `artifacts` manifest section, alternative `agents/` directory discovery. No divergence from schema — use `additionalProperties` for experimental fields.

---

## W24 Close-Out

**Date:** 2026-05-16  
**Status:** Completed

### Summary

Kobayashi delivered F4 — migrate 6 bundles to squadapp.json (commit 4806a4ff). Work was completed on disk, but agent session cleared before commit. Coordinator executed orphan-commit pass with proper co-author attribution.

### Lineage

- **Todo:** f4-bundle-migration
- **Commit:** 4806a4ff
- **Pattern:** Orphan completion (silent success / agent runtime eviction)

### Notes

Part of the three-agent L/F pattern in W24. All three (Hockney/Kobayashi/McManus) completed work before session eviction, and coordinator handled the orphan-commit pass uniformly.
This was part of the three-agent L/F pattern in W24. All three (Hockney/Kobayashi/McManus) completed work before session eviction, and coordinator handled the orphan-commit pass uniformly.
- W28: Ceremonies research — ceremonies.md vs runtime relationship analysis; verdict: keep spec as aspirational reference, canonicalize .squad/ceremonies/*.workflow.yaml, Conjure remains primary authoring, SDK readCeremonies() for seeding (58852130)

---

## 2026-05-19T14:38:22.590-07:00 — Cast team agents stay active

- Root cause: agent sync trusted the SDK agent list as exclusive. When cached SDK state missed newly cast filesystem charters, the retirement pass treated active DB rows as absent.
- Fix pattern: discovery is now SDK + filesystem union for parsing, while retirement requires a reliable filesystem listing and no reliable source seeing the agent. Charter read/parse failures leave DB status unchanged.
- Recovery pattern: if a present charter belongs to a DB row already marked `retired`, sync reactivates it to `active` so previously mis-retired cast agents recover on the next sync.
- Regression: added `agent-sync-safety.test.ts` for stale SDK cache, transient unreadable charter, and reactivation of mis-retired agents.

---

## 2026-05-19T14:38:22.590-07:00 — Project scaffold path normalization

- Root cause: built-in template/project import paths accepted a project root even though downstream scaffold/apply code treated the value as the `.squad` directory itself. That produced root-level siblings like `agents/`, `casting/`, `team.md`, and `routing.md` beside `.squad/`.
- Fix pattern: normalize all setup/import/template paths at server boundaries. If a supplied path does not end in `.squad`, treat it as a project folder and append `.squad` before writing files or storing `projects.path`.
- Regression: added setup lifecycle and project-template coverage to prove root input writes under `.squad/` and stores the canonical `.squad` path.

### 2026-05-19T21:56:17Z — SDK Integration Validation + Cast-Agent Retirement

Completed fix for cast-agent retired issue and project folder structure reorganization.

**Changes:**
- Updated SDK integration layer from deprecated `cast-agent` to current `squad-orchestrator` module
- Reorganized project folder structure to match canonical Squad SDK layout
- Updated integration test suite to validate new folder structure

**Status:** QA pending (Kujan validation of SDK fixes, integration tests, end-to-end sync)

**Risk Mitigation:** Changes scoped to SDK integration surface only; no charter-level changes required at this time.

---

## 2026-05-19T15:43:53.554-07:00 — SDK sync ownership contract

- Defined `squadboard.sdk-sync-ownership.v1` in `packages/server/src/sdk/sync-ownership.ts` as the narrow SDK-facing contract for bootstrap/sync ownership.
- Contract call: the Squad SDK owns session/state primitives; Squadboard owns project scaffold, storage-mode selection, DB/API/MCP behavior, agent sync, and Copilot/CLI projection generation.
- Mode rule preserved: filesystem mode treats `.squad/` files as live authority; PostgreSQL mode treats `squad_storage` as live authority after one-time filesystem import. No bidirectional mirror is implied.
- Added `getProjectSyncOwnershipStatus(projectId)` in `sdk-state.ts` so Hockney can expose a read-only status endpoint without schema changes.
- Regression: `packages/server/src/sdk/sync-ownership.test.ts` pins provider-mode normalization, required/recommended projection status, and surface ownership boundaries.

---

## 2026-05-20T01:35:26Z — Cross-Surface Interchangeability Directive + SDK/Client Contract

**Status:** Contract definition for interchangeable surfaces

User directive (Ahmed): **Squadboard and CLI/Copilot modes are interchangeable. A user can start with either client and continue in the other.**

Authored **kobayashi-cross-surface-contract.md**:
- A project has one Squad state authority at a time: filesystem `.squad/` or `squad_storage`
- Both Squadboard and CLI/Copilot must target that same authority when they mutate Squad state
- Generated client instruction files are projections, not independent state stores
- `.squad` hydration and export are explicit operations with status, checksums, and drift reporting
- Ceremonies are part of the shared Squad state bundle and must never be silently empty on either start path

Additive to existing `squadboard.sdk-sync-ownership.v1` contract. Does not change SDK internals; Squadboard bridge adapts to SDK contracts.

**Pattern:** Contract version is `squadboard.sdk-client-artifact.v1`

---

## 2026-05-19T21:58:16.699-07:00 — Interchangeable-client SDK projection contract

- Expanded `packages/server/src/sdk/sync-ownership.ts` so the pure contract reports authority mode, write targets, projection artifact buckets, missing required/recommended artifacts, surface readiness, and API-friendly DTO mapping without owning routes or repairs.
- Added `packages/server/src/sdk/copilot-agent-projection.ts` as a pure `.github/agents/squad.agent.md` projection descriptor/renderer. It declares generated artifacts as client instructions only, not Squad state authority.
- Regression coverage now pins both start orders: Squadboard-first with missing Copilot projection, and CLI/Copilot-first filesystem authority connected to Squadboard.
- Validation: `pnpm --filter @sabbour/squadboard test -- sync-ownership --run` and `pnpm --filter @sabbour/squadboard run build` both pass.

---

## 2026-05-20T02:23:00.895-07:00 — Squadboard Apps install-as-project contract

- Contract name: `squadboard.apps-install-as-project.v1`.
- Squadboard Apps are domain-specific bundle packages surfaced through `/api/templates/squadboard-apps`; generic repeatable starters remain Project Templates through `/api/templates/builtin-projects`.
- Installing a Squadboard App creates a normal project. There is no separate Apps installed registry or installed-state action on the Apps surface.
- GitHub installs clone into repo-local ignored scratch space, validate any present `squadapp.json` has `kind: "squadboard-app"`, then apply the bundle through the existing bundle loader without patching the SDK.
- Public examples were renamed to Squad-domain packages (`squad-doc-review`, `squad-issues-router`) for eventual `@sabbour/squadboard-apps` publication. AKS examples live outside the scanned `squadboard-apps/` catalog in `private-squadboard-apps/` until ownership/publication safety is decided.
- Squad Issues Router now declares `squadboard.github-issue-intake.v1`: scheduled intake for `bradygaster/squad`, cursored by `project.githubSyncLastAt`, deduped by `githubIssueNumber`/`githubNodeId`, targeting `triage`. Runtime dependency remains with Hockney's reusable scheduled GitHub issue intake primitive; the app bundle is the contract source.
- Squad Doc Review now declares `squadboard.doc-review-intake.v1`: weekly scheduled and manual doc review triggers for `bradygaster/squad`, cursored/deduped by repo + path + blob/commit SHA + review profile, with explicit queued-doc intake. The default final action creates/updates Squadboard issues grouped by doc path with findings, severity, owner recommendation, and suggested patch/PR checklist; docs are not auto-edited by default. Remaining runtime dependencies: reusable doc review intake, selected-doc manual run context payloads, and persisted review-issue upsert action.

---

## 2026-05-20T04:16:33.702-07:00 — Feature Kanban generalization

- Curated visible built-in Project Templates to exactly Content Creation, Open Source, Research Spike, and Feature Kanban; hidden defaults remain on disk but are not selectable.
- Generalized the old AKS Feature Kanban into `feature-kanban` with product/PM agents, reusable PM skills, agent-run ceremonies, and no AKS/Azure/Kubernetes/internal-tool dependencies.
- Content Creation should stay intentionally small: one Writer, one Editor, four obvious columns, and two lightweight ceremonies.
