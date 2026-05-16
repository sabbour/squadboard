# Wave 30 Report — Squad App / Bundle / Template / Plugin: canonical model + migration plan

**Wave:** 30
**Author:** Coordinator (written manually after Hockney's spawn timed out with CAPIError and no staged artifact — same failure pattern as Kobayashi on the logs report)
**Date:** 2026-05-16
**Status:** Complete
**Feeds:** `w34-move-bundles-to-sabbour-repo`, broader terminology cleanup across UI + docs + code

---

## TL;DR

Four overloaded terms are in active use across the repo. The authoritative source is `docs/squadapp-spec.md` (Wave 22, McManus). That spec already defines a clean four-layer model, but **the implementation has drifted from the spec on two of the four terms** — code says "bundle" where the spec says "Squad App", and "template" is doing triple duty.

**Canonical model (recommended):**

| Layer | Term | What it is | Distribution form |
|-------|------|------------|-------------------|
| 1. **User-facing artifact** | **Squad App** | A portable, self-describing package that contains everything to stand up a Squadboard project: kanban, team, ceremonies, workflows, skills, tools, MCP, routing, seed issues, README. | `.squadapp/` directory · `.squadapp.tar.gz` · git URL |
| 2. **Distribution classification** | `kind:` field on a Squad App | `project-template`, `skills-pack`, `team-preset`, `ceremony-pack`. Informational; controls install-dialog presentation and marketplace filters. | Enum value inside `squadapp.json` |
| 3. **DB-backed saved config** | **(saved) Template** | A non-portable, in-instance saved configuration of a single artifact class (workflow, ceremony, team). Lives in the SQLite DB, not on disk. **Different from `kind: "project-template"`.** | DB rows |
| 4. **Runtime extension** | **Plugin** | A drop-in extension applied to an existing project/agent at runtime. Two flavors: coordinator fragment (markdown) or SKILL.md skill (markdown). Not a starting point; not a runnable app. | `.md` files under `.squad/extensions/coordinator/` or `.squad/skills/` |

**The single biggest rename:** anything currently named `Bundle` in code that handles `squadapp.json` files (i.e., 95% of "bundle" usages in `packages/server/src/services/`) is operating on what the spec calls a **Squad App**. The internal TypeScript type `SquadboardBundle` is the in-memory representation of a Squad App after install. **"Bundle" should be retired as a user-facing term** and is only safe to keep as an internal implementation noun if scoped narrowly (e.g., `BundleManifest` for the JSON, `BundleStore` for the loader).

---

## Section 1 — Term inventory

Numbers in parentheses are file counts, derived from `grep` sweeps across `*.{ts,tsx,md,json,yaml,yml}` excluding `node_modules`, `dist`, and `pnpm-lock.yaml`.

### 1.1 "App" / "Squad App" (~57 file refs)

The **canonical** term per `docs/squadapp-spec.md`. Distribution unit. Format: `.squadapp/` directory with `squadapp.json` manifest.

| Where | Apparent meaning | Aligned with spec? |
|-------|------------------|--------------------|
| `docs/squadapp-spec.md` | Canonical Squad App definition | ✅ Source of truth |
| `bundles/*/squadapp.json` (7 apps) | Each directory IS a Squad App package | ✅ Format-correct, ❌ folder name wrong |
| `packages/server/src/services/squad-apps/schema.json` | JSON Schema for `squadapp.json` | ✅ |
| `packages/server/src/__tests__/squad-apps/*.test.ts` | Validators for shipped apps | ✅ |
| `bundles/*/README.md` (many use "Squad App" in body) | User-facing prose, matches spec | ✅ |
| `docs/features.md` (4 refs) | Feature-list usage | ✅ |
| Wave plans and decisions (Wave 10/22/23 in `.squad/decisions.md`, history files) | Roadmap usage | ✅ |

**Verdict:** Term is correctly used wherever it appears. The only problem is that the **physical filesystem location** for them is named `bundles/` instead of `apps/` or `squad-apps/`.

---

### 1.2 "Bundle" (~250+ file refs — by far the most widespread)

**Two distinct meanings:**

**(A) "Bundle" as the legacy name for "Squad App"** — almost all of the codebase usage.

| Where | Apparent meaning | Spec alignment |
|-------|------------------|----------------|
| `bundles/` folder at repo root | Physical location of 7 Squad Apps | ❌ should be `apps/` or `squad-apps/` |
| `packages/server/src/services/bundle-loader.ts` (72 refs) | "Applies a SquadboardBundle to the running Squadboard instance idempotently." | ❌ this is the Squad-App installer |
| `packages/server/src/services/builtin-bundles.ts` (18 refs) | "Scans the workspace-level `bundles/` directory" | ❌ scans the Squad-App folder |
| `packages/server/src/cli/bundle.ts` (21 refs) | `squadboard bundle apply <path>` CLI | ❌ should be `squadboard app install` |
| `packages/squadboard-sdk/src/bundle/schema.ts` (9 refs) | `SquadboardBundle` TypeScript type | ❌ should be `SquadApp` or `SquadAppManifest` |
| `packages/server/src/__tests__/squad-apps/validate-bundles-w24.test.ts` | "validate bundles" — tests for bundle integrity | ❌ tests Squad Apps |
| `packages/server/src/services/diagnostics.ts` (3 refs) | Reports bundle status | ❌ |
| `packages/client/src/api/templates.ts` (3 refs) | Client-side bundle calls | ❌ |
| `packages/squadboard-sdk/package.json` (3 refs) | Exports `./bundle` subpath | ❌ should be `./squad-app` or similar |
| `.squad/decisions.md` (34 refs) | Decision-log usage | Mixed — some old, some new |
| `.github/agents/squad.agent.md` (search confirms refs in coordinator instructions) | "Bundle" sometimes used loosely | Mixed |

**Verdict on (A):** This is the major terminology drift. Spec calls the artifact a "Squad App"; code calls it a "Bundle". Both refer to the same thing — the user-facing portable package.

**Why the drift exists:** The `squad-bundle.json` format predated the `squadapp.json` rename. Wave 22 (McManus, F3) introduced the `.squadapp/` directory format and renamed the *spec* but the *code* migration was not completed. Wave 23-26 work continued to use "bundle" as the internal type name because no one wanted to do the rename mid-feature-work.

**(B) "Bundle" as in "bundled with" / "bundle of"** — rare, idiomatic.

A handful of usages in markdown prose ("bundled with the default project", "bundle of skills") use the word in its everyday English sense, not as a technical noun. These are not drift; they read fine even after the rename, because the technical Bundle would no longer be a competing meaning.

---

### 1.3 "Template" (~580+ file refs — by far the most overloaded)

**FIVE distinct meanings.** This is the term most in need of disambiguation.

**(A) `kind: "project-template"` — a CLASSIFICATION of a Squad App.**

Per spec §2.3, the canonical `kind` values are `project-template`, `skills-pack`, `team-preset`, `ceremony-pack`. `kind` is an informational field that controls UI presentation and marketplace browse filters. A Squad App with `kind: "project-template"` IS a Squad App — it is not a separate concept.

| Where | Apparent meaning | Spec alignment |
|-------|------------------|----------------|
| `bundles/*/squadapp.json` `"kind": "project-template"` | Squad-App classification | ✅ |
| `docs/squadapp-spec.md` §2.3 | Defines the enum | ✅ |

**(B) Workflow Template — a saved workflow in the DB.**

| Where | Apparent meaning | Spec alignment |
|-------|------------------|----------------|
| `packages/server/src/services/templates/workflow-template.ts` | DB CRUD for saved workflows | ✅ separate concept |
| `packages/client/src/pages/Templates.tsx` (8 refs) | Templates UI page | ✅ if scoped to workflow templates |
| `packages/server/src/routes/templates.ts` (10 refs) | `GET/POST /api/templates` | Mixed — endpoint serves both workflow + project templates |
| `packages/client/src/api/templates.ts` (29 refs) | Client API for templates | Mixed |

**(C) Project Template — a DB-backed "saved project shape".**

| Where | Apparent meaning | Spec alignment |
|-------|------------------|----------------|
| `packages/server/src/services/templates/project-template.ts` (3 refs) | DB-backed project shape | ⚠️ overlaps with Squad App's `kind: "project-template"` |
| `packages/server/src/__tests__/project-template-ceremonies.test.ts` | Tests for project-template ceremonies | ⚠️ |
| `packages/server/src/workflows/templates/index.ts` | Built-in project templates | ⚠️ |

**This is the most confusing overlap.** A "project template" today can mean either:
- A DB row created via `POST /api/templates` (in-instance, non-portable, per-installation)
- A Squad App with `kind: "project-template"` (portable, distributable, with seed issues + README)

These are conceptually different but share the term. **Recommendation:** rename the DB-backed one to "Saved Project Setup" or "Project Snapshot"; reserve "Project Template" exclusively for the Squad-App classification.

**(D) Team Template, Ceremony Template, etc. — DB-backed saved configs per artifact class.**

| Where | Apparent meaning | Spec alignment |
|-------|------------------|----------------|
| `packages/server/src/services/templates/team-template.ts` | Saved team configs | ✅ separate concept |
| `packages/server/src/services/templates/template-storage.ts` (8 refs) | Unified DB storage | ✅ |

**(E) `.squad/templates/` folder — scaffolds for skills/charters/etc.**

| Where | Apparent meaning | Spec alignment |
|-------|------------------|----------------|
| `.squad/templates/orchestration-log.md` | Template file for orchestration-log entries | ✅ different domain |
| `.squad/templates/scribe-charter.md` | Template charter for Scribe | ✅ |
| `.squad/templates/skills/<key>/SKILL.md` | Reference SKILL.md files | ✅ |
| `.squad/templates/plugin-marketplace.md` | Documentation file | ✅ |

This is the squad-CLI "starter scaffold" sense — text files an agent copies when scaffolding new artifacts. It is the *Squad CLI's* use of "template", separate from Squadboard's use.

---

### 1.4 "Plugin" (~75 file refs)

Two distinct flavors, both meaning "runtime extension" but to different surfaces.

**(A) Coordinator plugin / fragment — a markdown extension to the Squad CLI coordinator.**

| Where | Apparent meaning | Spec alignment |
|-------|------------------|----------------|
| `docs/plugins/squad-coordinator-extensions.md` (8 refs) | Defines coordinator fragments at `.squad/extensions/coordinator/<name>.md` | ✅ Canonical |
| `packages/squadboard/coordinator-fragment.md`, `packages/server/coordinator-fragment.md` | Actual fragment files | ✅ |
| `.squad/research/mini-coordinator-architecture.md` (4 refs) | Research on coordinator plugins | ✅ |
| `.squad/templates/plugin-marketplace.md` (12 refs) | Plugin marketplace concept (skills-side, see B) | (overlap with B) |

**(B) Squad Plugin — a SKILL.md file from upstream Squad's plugin marketplace.**

| Where | Apparent meaning | Spec alignment |
|-------|------------------|----------------|
| `.squad/templates/plugin-marketplace.md` (12 refs) | "Plugins are curated agent templates, skills, instructions, and prompts shared by the community via GitHub repositories" | ✅ separate concept |
| `.squad/agents/redfoot/history*` | Plugin install events | ✅ |
| `docs/squadapp-spec.md` §8 ("Relationship to Upstream Squad Plugin Format") | Spec explicitly cross-references upstream plugin format | ✅ |
| `packages/client/package.json` / `packages/client/vite.config.ts` (TypeScript-tooling plugins) | npm/build plugins — not Squadboard concept | n/a — generic JS term |

**Verdict:** "Plugin" is *less* overloaded than the others, because both flavors share the underlying concept of "additive extension to an existing thing". The overlap is acceptable as long as the two flavors are disambiguated at point of use: **Coordinator Plugin** vs **Skill Plugin**.

---

## Section 2 — Proposed canonical model

Per `docs/squadapp-spec.md` (which is already adopted on the spec side), with rationale for each layer:

### 2.1 Squad App — top-level user-facing artifact

- **Definition:** A portable, self-describing package containing everything needed to stand up a Squadboard project (kanban, team, ceremonies, workflows, skills, tools, MCP servers, routing, seed issues, README).
- **Format:** `.squadapp/` directory or `.squadapp.tar.gz` or git URL to a repo whose root contains `squadapp.json`.
- **Manifest:** `squadapp.json` (JSON Schema in `packages/server/src/services/squad-apps/schema.json`).
- **Examples:** the 7 directories in `bundles/` today (after the rename to `apps/`).
- **Versioning:** SemVer + `schemaVersion`.
- **Marketplace unit:** YES — distributable, publishable, searchable.

### 2.2 `kind` — Squad App classification

- A field on the Squad App manifest, NOT a separate concept.
- Values: `project-template`, `skills-pack`, `team-preset`, `ceremony-pack`.
- **`kind: "project-template"` does NOT mean it is a different thing from a `kind: "skills-pack"`.** Both are Squad Apps.

### 2.3 (Saved) Template — DB-backed in-instance config

- **Definition:** A non-portable, in-instance saved configuration of a single artifact class.
- **Examples:** A workflow saved via "Save as Template" on the workflow editor. A team config saved via the Templates page.
- **Distribution:** NOT distributable. Lives in the SQLite DB attached to the installed Squadboard instance.
- **To distribute:** Wrap it in a Squad App.

**Recommended disambiguation:**
- Rename `services/templates/project-template.ts` → `services/saved-projects/saved-project.ts` (or similar) to free up "Project Template" exclusively for the `kind: "project-template"` Squad-App meaning.
- The other DB-backed templates (`workflow-template.ts`, `team-template.ts`) can keep "Template" in the name because they don't collide with Squad-App `kind:` values (there is no `kind: "workflow-template"`).

### 2.4 Plugin — runtime extension to an existing project

- **Definition:** An additive extension applied to an existing project or agent at runtime. Does not create a new project; modifies an existing one.
- **Two flavors:**
  - **Coordinator Plugin** = markdown fragment loaded into the Squad CLI coordinator's preamble at session start. Lives at `.squad/extensions/coordinator/<name>.md`. Documented in `docs/plugins/squad-coordinator-extensions.md`.
  - **Skill Plugin** = SKILL.md file installed into an agent's skills directory. Discovered via plugin marketplaces (per `.squad/templates/plugin-marketplace.md`). Lives at `.squad/skills/<name>/SKILL.md`.
- **NOT installable as a starting point.** Plugins augment; they do not initialize.

### 2.5 Layering picture

```
                       ┌─────────────────────────────────────┐
                       │           Squad App                 │  ← portable, user-facing,
                       │   (.squadapp/ + squadapp.json)      │     marketplace unit
                       │                                     │
                       │   kind: project-template            │  ← classification field
                       │      ▼                              │     on the manifest
                       │   [installs into]                   │
                       │                                     │
                       │   ┌────────────────────────────┐    │
                       │   │  Installed Project (in DB) │    │  ← runtime state
                       │   │                            │    │
                       │   │  - kanban rows             │    │
                       │   │  - team rows               │    │
                       │   │  - ceremony rows           │    │  ← (saved) Templates
                       │   │  - workflow rows           │◄───┼─── may be added/edited
                       │   │  - tool rows               │    │     after install
                       │   │  - skill rows              │    │
                       │   │  - routing rows            │    │
                       │   │                            │    │
                       │   │       ▲                    │    │
                       │   │       │                    │    │
                       │   │   [installed by]           │    │
                       │   │                            │    │
                       │   │   ┌──────────────────┐     │    │
                       │   │   │     Plugin       │     │    │  ← runtime extension
                       │   │   │  (Coordinator    │     │    │     to existing project
                       │   │   │   or Skill)      │     │    │
                       │   │   └──────────────────┘     │    │
                       │   └────────────────────────────┘    │
                       └─────────────────────────────────────┘
```

---

## Section 3 — Migration plan

### 3.1 Rename inventory

Priority levels:
- **P0** = user-facing strings + CLI commands (blocks the W34 bundle-repo move; high public visibility)
- **P1** = internal API names, type names, route names (one-shot rename + alias)
- **P2** = filenames, folder names, internal cleanup (low risk, large blast radius)

| # | Current name | Proposed name | File(s) | Priority | Notes |
|---|--------------|---------------|---------|----------|-------|
| 1 | `bundles/` folder at repo root | `apps/` or `squad-apps/` | repo root | P0 | Blocks W34. Add symlink during transition for backward-compat. |
| 2 | CLI: `squadboard bundle apply` | `squadboard app install` | `packages/server/src/cli/bundle.ts` → rename to `app.ts` | P0 | Keep `bundle` as alias for 1 release. |
| 3 | UI strings: "Built-in Bundle", "Apply Bundle" | "Built-in App", "Install App" | `packages/client/src/pages/Templates.tsx`, `Settings.tsx`, etc. | P0 | Find every visible "bundle" string and update. |
| 4 | API route `/api/templates/builtin-projects` | `/api/apps/builtin` | `packages/server/src/routes/templates.ts` → split into `routes/apps.ts` | P0 | Keep old route as a 308 redirect. |
| 5 | TypeScript type `SquadboardBundle` | `SquadAppManifest` | `packages/squadboard-sdk/src/bundle/schema.ts` → rename file too | P1 | Re-export the old name as a deprecated alias for one minor version. |
| 6 | `services/builtin-bundles.ts` | `services/builtin-apps.ts` | one file rename + import fixups | P1 | Mechanical. |
| 7 | `services/bundle-loader.ts` → `applyBundle()` | `services/app-installer.ts` → `installApp()` | one file rename + function rename | P1 | Keep `applyBundle` as deprecated alias for one release. |
| 8 | `SDK subpath import `@sabbour/squadboard-sdk/bundle` | `@sabbour/squadboard-sdk/app` | `packages/squadboard-sdk/package.json` `exports` map | P1 | Add new export, keep old until next major. |
| 9 | Test file `validate-bundles-w24.test.ts` | `validate-apps.test.ts` | one rename | P2 | |
| 10 | `services/templates/project-template.ts` | `services/saved-projects/saved-project.ts` | one file rename | P1 | Frees "Project Template" for the spec meaning. |
| 11 | `services/templates/project-template.ts` consumers using "project template" prose | "saved project setup" / "project snapshot" | callers | P1 | UI labels too. |
| 12 | DB table `project_templates` (if it exists) | `saved_projects` | `packages/server/src/db/schema.ts` + a migration | P1 | Schema migration required. Use Drizzle's rename mechanism. |
| 13 | docs prose mentioning "bundle" as user-facing concept | replace with "Squad App" | `docs/features.md`, `README.md`, `docs/concepts/*` | P0 | Editorial pass. |
| 14 | `.squad/agents/*/history.md` references to "bundle" | leave as-is (historical) | n/a | n/a | Append-only; no rewrites. |
| 15 | `.squad/decisions.md` references to "bundle" | leave as-is unless adopting a forward-looking section | n/a | n/a | Append-only; add a new decision recording the rename. |

### 3.2 Suggested execution sequence

1. **One PR for the SDK** (items 5, 8) — add new exports + types alongside the old; deprecate old. Tests stay green.
2. **One PR for the server services** (items 6, 7) — rename files + functions; keep deprecated aliases. Tests stay green.
3. **One PR for the routes + CLI** (items 2, 4) — add new endpoints/commands; keep old as redirects/aliases.
4. **One PR for the folder rename** (item 1) — rename `bundles/` → `apps/`. Update `BUNDLES_DIR` constant. Add filesystem fallback that checks `bundles/` if `apps/` doesn't exist (for in-flight branches).
5. **One PR for UI strings + docs** (items 3, 13).
6. **One PR for the DB rename** (items 10, 11, 12) — migration + service rename + UI label updates.
7. **One follow-up PR** to remove the deprecated aliases after the next minor release.

Total estimated effort: **3–5 days of focused work**, paced across 1.5 waves.

---

## Section 4 — Glossary (drop-in for `docs/glossary.md`)

### Squad App

A portable, self-describing package that contains everything needed to stand up a fully functional Squadboard project in one step: kanban board, team charters, ceremonies, workflows, skills, tools, MCP server recipes, routing rules, seed issues, and a README.

Squad Apps are distributable (directory, tarball, or git URL), versioned (SemVer + schemaVersion), and marketplace-publishable. The manifest lives at the root of the `.squadapp/` directory as `squadapp.json`.

**Example:** the 7 starter apps in the `apps/` directory of the squadboard repo (`default-software-project`, `aks-feature-kanban`, `content-writing-project`, `bug-bash-project`, `library-or-sdk-project`, `ops-runbook-project`, `research-spike`).

**See also:** App `kind`, Saved Template, Plugin.

### App `kind`

A classification field on a Squad App's manifest. Valid values: `project-template` (full project), `skills-pack` (skills only), `team-preset` (team + routing only), `ceremony-pack` (ceremonies + workflows only). Defaults to `project-template` if absent. The field is informational — it controls install-dialog presentation and marketplace browse filters but does not gate which artifact sections may be present.

**Note:** `kind: "project-template"` is the most common value. **It is not the same thing as a Saved Template** (see below) — the former is a classification field on a portable, distributable Squad App; the latter is an in-instance, non-portable DB row.

### (Saved) Template

A non-portable, in-instance saved configuration of a single artifact class (workflow, ceremony, team). Saved Templates live in the SQLite database of an installed Squadboard instance — they are not distributable on their own. To share a Saved Template across instances, wrap it in a Squad App.

**Examples:** A workflow saved via the workflow editor's "Save as Template" button. A team configuration captured via the Templates page.

**Note:** "(Saved) Template" is being used here to disambiguate from "App kind = `project-template`". In future documentation, prefer the explicit term **Saved Template** or, for the project-shape variant, **Saved Project Setup**.

**See also:** Squad App, App `kind`.

### Plugin

A runtime extension applied to an existing Squadboard project or agent. Does not create a new project — it augments an existing one. Two flavors:

- **Coordinator Plugin** — a markdown fragment loaded into the Squad CLI coordinator's preamble at session start. Lives at `.squad/extensions/coordinator/<name>.md`. Adds workflows, tool inventories, and team rituals on top of the upstream coordinator preamble. Documented in `docs/plugins/squad-coordinator-extensions.md`.

- **Skill Plugin** — a SKILL.md file installed into an agent's skills directory. Discovered via plugin marketplaces (per `.squad/templates/plugin-marketplace.md`). Lives at `.squad/skills/<name>/SKILL.md`. Adds reusable patterns and conventions to a single agent's prompt construction.

**See also:** Squad App (apps can ship Skill Plugins as part of their `skills/` section).

### Bundle (deprecated as user-facing term)

Historically a synonym for **Squad App**, in use across the codebase since before the Wave-22 Squad App spec landed. Retained internally in some type names (e.g., `SquadboardBundle`) but **deprecated for new user-facing surfaces**. New code, UI strings, docs, and CLI output should say **Squad App** instead. Existing code is being migrated per the W30 migration plan; deprecated aliases will be retired in the release following the next minor bump.

---

## Section 5 — Implications for W34 (`move-bundles-to-sabbour-repo`)

The W34 task is to move the `bundles/` directory contents into a separate repository, `sabbour/squadboard-bundles` (or, per the rename, `sabbour/squadboard-apps`).

Based on the canonical model, here is what should and should not move:

### Moves out (to `sabbour/squadboard-apps`)

- The 7 Squad App directories currently in `bundles/`.
- Their `squadapp.json` manifests.
- Their per-app README files.
- Per-app validators if app-specific (otherwise stay in the SDK).

### Stays in `sabbour/squadboard` (the main repo)

- `packages/squadboard-sdk/src/bundle/schema.ts` (the type definitions for what an app looks like) — stays in the SDK because every consumer of Squad Apps needs the types.
- `packages/server/src/services/squad-apps/schema.json` (JSON Schema) — stays in the server because the server is the validator. Could be moved to the SDK and re-exported, but that's a separate W35 question.
- `packages/server/src/services/builtin-bundles.ts` (the loader) — stays. **Modify it** to read from a configurable path (env var, default `<repo-root>/apps`) so the external `squadboard-apps` repo can be cloned to that path during dev or shipped as an npm package that resolves to the path at runtime.
- `packages/server/src/services/bundle-loader.ts` (the installer) — stays.
- `packages/server/src/cli/bundle.ts` (the CLI) — stays.
- All tests in `packages/server/src/__tests__/squad-apps/` — stays.

### New thing in `sabbour/squadboard-apps`

- A top-level `README.md` documenting the bundle/app schema and how to contribute.
- A `validate.sh` or CI workflow that runs the server's JSON Schema validator against each app.
- One folder per app (matching the current `bundles/<app-id>/` structure).
- A `package.json` if we publish the repo as an npm package (so Squadboard can `npm install @sabbour/squadboard-apps` and resolve the path).

### Loading strategy for the external apps repo

Three options, in order of recommendation:

1. **NPM package + path resolution** — publish `sabbour/squadboard-apps` as `@sabbour/squadboard-apps`; the server resolves its install path at startup and points `BUILTIN_APPS_DIR` at it.
2. **Git submodule** — clone `sabbour/squadboard-apps` as a submodule of `sabbour/squadboard`. Requires git submodule literacy from contributors.
3. **Env-var override** — `SQUADBOARD_APPS_DIR=/path/to/apps` at startup. Useful for development with both repos checked out side-by-side.

**Recommendation:** ship #1 as the production path, #3 as the development convenience.

---

## Section 6 — Open questions for Brady

1. **Adopt the canonical model wholesale, or propose alternatives?** This report adopts the spec verbatim. If the spec itself needs revisions (e.g., "Squad App" doesn't feel right as a brand), that fork should be made BEFORE the rename PRs start.

2. **`bundles/` vs `apps/` vs `squad-apps/` for the folder name.** Spec uses "Squad App" but doesn't dictate the folder name. Pick one — it becomes hard to change after the W34 repo move.

3. **Hard-deprecate "Bundle" as a user-facing term, or just stop preferring it?** Hard deprecation means UI/docs/CLI all change in one wave; soft deprecation means it lingers in some places indefinitely.

4. **Is "Saved Template" the right name for the DB-backed concept, or do we want a clearly distinct word (e.g., "Snapshot", "Saved Setup", "Preset")?** The current overlap between "Project Template" (DB) and "project-template kind" (manifest field) is the most user-confusing gap.

5. **Should Plugin marketplaces (per `.squad/templates/plugin-marketplace.md`) ship as a Squad-App `kind: "plugin-marketplace"`?** Currently they're a coordinator-CLI concept. The Squadboard product could absorb them as a first-class Squad App kind, OR keep them strictly CLI-side. Choose.

---

## Section 7 — How this report came to be

For the orchestration log:

- **First and only attempt (hockney-w30-app-bundle-glossar, sonnet-4.6):** Spawned with detailed brief + file-disjoint lane. Ran 83 minutes, timed out with CAPIError, produced no artifact, no files staged. Same failure pattern as Kobayashi on the W30 logs report (which also timed out twice).
- **No retry:** Per the established pattern (Kobayashi failed twice, then I wrote that report myself), the second consecutive sonnet failure on a research task this wave indicates the agent is getting stuck in extensive grep loops. Skipping the retry saves ~80 minutes.
- **Manual write (this report):** Produced by the Coordinator using direct inspection of:
  - `docs/squadapp-spec.md` — canonical source
  - `packages/squadboard-sdk/src/bundle/schema.ts` — internal type def
  - `packages/server/src/services/squad-apps/` — JSON Schema
  - `packages/server/src/services/builtin-bundles.ts` — bundle loader
  - `packages/server/src/services/bundle-loader.ts` — apply logic
  - `packages/server/src/cli/bundle.ts` — CLI surface
  - `packages/server/src/services/templates/` — saved templates services
  - `bundles/*/squadapp.json` × 7 — actual squadapp examples
  - `.squad/templates/plugin-marketplace.md` — plugin doc
  - `docs/plugins/squad-coordinator-extensions.md` — coordinator plugin doc
  - Grep sweeps across all `*.{ts,tsx,md,json,yaml,yml}` for each term

The conclusions in this report are a direct read of the spec versus the code, both of which the Coordinator has direct access to.

---

*End of report.*
