# Squad Apps, Bundles, and Templates

> **Status:** Reference guide for Squadboard's packaging & discovery system  
> **Last updated:** 2026-05-19  
> **Audience:** Users deciding how to distribute squad configurations; builders extending Squadboard

---

## Quick Reference

| Concept | Purpose | Scope | Versioned? | Marketplace-ready? |
|---------|---------|-------|-----------|-------------------|
| **Squad App** | Portable, complete project definition | Full project + team + workflows + skills | ✅ (SemVer) | ✅ (F6+) |
| **Project Template** | Snapshot of an existing project | Entire project state | ❌ | ❌ |
| **Team Template** | Reusable agent roster | Just the team roster | ❌ | ❌ |
| **Workflow Template** | Reusable ceremony/workflow | Single workflow YAML | ❌ | ❌ |

---

## Squad Apps — What Developers Ship

A **Squad App** is a self-contained, versioned bundle that packages everything needed to bootstrap a Squadboard project:

- **Project skeleton** (name, icon, description, board columns, WIP limits)
- **Team** (agent charters with roles)
- **Ceremonies** (trigger → workflow mappings)
- **Workflows** (YAML execution graphs)
- **Skills** (SKILL.md prompt additions, reusable across agents)
- **Tools** (MCP-backed function definitions)
- **MCP server recipes** (server configs for external tools)
- **Routing rules** (label/column → agent assignments)
- **Seed issues** (starter backlog)
- **README** (installation notes and overview, rendered in UI)

### Where Squad Apps Live

**Source code:**
- **Canonical directory layout:** `docs/squadapp-spec.md` (complete spec including schema, validation, and install behavior)
- **Manifest format:** `.squadapp/squadapp.json` (or inline in directory root, or git-backed)

**In this repository:**
- **Built-in Squad App bundles:** `bundles/` directory
  - Each subdirectory is one app (e.g., `bundles/kanban-triage/`, `bundles/agentic-docs/`)
  - Required file: `squad-bundle.json` (the manifest)
  - Optional files: agent charters, workflows, skills, README.md
- **SDK definition:** `packages/squadboard-sdk/` exports `SquadboardBundle` type
- **Discovery logic:** `packages/server/src/services/builtin-bundles.ts`
  - Lazy-scans `bundles/` on first API call
  - Validates and caches results in-process for the server lifetime
  - Emits warnings (but never crashes) on invalid bundles

### How Squadboard Discovers and Runs Squad Apps

1. **At server startup** — Not scanned. Discovery is lazy.
2. **On `GET /api/templates/builtin-projects`** — Builtin bundles service scans `bundles/`:
   - Reads each subdirectory
   - Parses `squad-bundle.json` from each
   - Validates against schema (see `squadapp-spec.md` § 4)
   - Caches entries in memory; memoizes on subsequent calls
   - Logs warnings but continues (invalid bundles don't crash the server)
3. **On `POST /api/templates/builtin-projects/{bundleId}/apply`** — Template controller:
   - Fetches the bundle from cache
   - Validates user-provided `name` and `squadPath`
   - Creates filesystem `.squad/` directory structure at the requested path
   - Writes project/team/ceremonies/workflows/skills to the new project's `.squad/` directories
   - Creates DB project record and links it to the `.squad/` path
4. **User-facing** — Templates page shows available apps and allows drag-drop import or direct application.

### Canonical Modules

| Module | Responsibility |
|--------|-----------------|
| `packages/server/src/services/builtin-bundles.ts` | Lazy scanner & validator; in-memory cache |
| `packages/server/src/routes/templates.ts` | HTTP endpoints for discovery and application |
| `packages/server/src/services/setup-lifecycle.ts` | Filesystem scaffold (creates `.squad/` directories) |
| `packages/squadboard-sdk/bundle.ts` | `SquadboardBundle` and `BundleProject` types |
| `docs/squadapp-spec.md` | Authoritative schema and validation rules |

---

## Project Templates — Snapshots for Reuse

A **Project Template** is a saved snapshot of an existing project. Unlike Squad Apps (which are authored as portable bundles), project templates are **user-created** and represent "the way we built this project."

### Where Project Templates Live

**Runtime storage:**
- **In-memory cache:** Loaded on demand by React Query hook `useTemplates('project')`
- **Persistent storage:** DB table `templates` with `kind = 'project'`
  - Columns: `id`, `kind`, `name`, `description`, `payload` (JSON), `projectId` (nullable), `createdAt`
  - If `projectId` is non-null: template was saved from a specific project (appears in "My templates" filter)
  - If `projectId` is null: built-in/global template

**Creation flow:**
- User clicks "Save as template" on an existing project
- `POST /api/projects/{projectId}/save-as-template` → payload is JSON snapshot of project state
- Template is stored in DB and optionally synced to filesystem

**Application flow:**
- User selects a project template and clicks "Create project from this template"
- `POST /api/projects/instantiate-template/{templateId}` with `name` and `squadPath`
- New project created at filesystem path; DB project linked to `.squad/` path

### Key Difference from Squad Apps

| Aspect | Squad App | Project Template |
|--------|-----------|------------------|
| **Created by** | Developer/squad author (shipped in repo) | End user (via Save button) |
| **Version control** | Git + semantic versioning | DB record; optional FS export |
| **Authored format** | `.squadapp/` directory with `squadapp.json` | Binary project state (JSON) |
| **Portability** | Distribution-ready; shareable as tarball/git URL | Export as JSON; import from JSON |
| **Upgradeable** | Schema versioning + conflict rules (planned F6+) | No upgrade path; treated as immutable snapshot |

---

## Team Templates, Workflow Templates — Finer Granularity

Squadboard also supports templates for **teams** and **workflows**:

- **Team Template:** Saves agent roster from one project and applies to another
  - `POST /api/projects/{id}/team/save-as-template`
  - `POST /api/projects/{id}/team/instantiate-template/{templateId}`
- **Workflow Template:** Saves a ceremony/workflow and reuses in another project
  - `POST /api/projects/{id}/ceremonies/{ceremonyId}/save-as-template`
  - `POST /api/projects/{id}/ceremonies/instantiate-template/{templateId}`

These are **user-created only** (no built-in library exists yet). They follow the same DB pattern as project templates: stored in `templates` table with `kind = 'team'` or `kind = 'workflow'`.

---

## Starter Projects — Legacy System (for reference)

Before Squad Apps existed, Squadboard shipped **starter projects** (Squad-IRL based):

- **Location:** `packages/server/src/data/starters/` (bundled at build time; generated by `scripts/generate-starters.mjs`)
- **Per-starter:** `meta.json`, `readme.md`, `plan.json`, `source.ts`
- **Discovery:** `services/starter-projects.ts` (read-once cache, immutable at runtime)
- **Status:** Superseded by Squad Apps for new work; maintained for backward compat

Starter projects will be migrated to the Squad App format or deprecated per Wave 25 roadmap.

---

## When to Use Each

### Use Squad Apps When…

1. **You're distributing a complete Squadboard project configuration** to a team or the community
2. **You want version control** — use SemVer and `schemaVersion` to track schema breaking changes
3. **You're publishing to a marketplace** — Squad Apps are the marketplace unit (F6+)
4. **Your project is meant to be reused** with variations (name, MCP servers, skills)

**Example:** "My company built a legal document review workflow. We want to ship it as a packaged starting point for other teams."

### Use Project Templates When…

1. **You've completed one project** and want to clone its exact state to another project
2. **You don't need version control** — templates are point-in-time snapshots
3. **The template is only used within your team** — no marketplace sharing

**Example:** "We just set up the Q3 marketing sprint project. Save its board layout, agents, and ceremonies so the Q4 team can replicate it."

### Use Team Templates When…

1. **You want to reuse a roster of agents** across multiple projects
2. **You don't want to reconfigure individual agent charters** each time

**Example:** "Our engineering team has a standard set of 5 agents (reviewer, merge-gate, deploy, monitor, oncall). Save them once; apply to every new service project."

### Use Workflow Templates When…

1. **You have a standard ceremony** (e.g., "daily standup," "RFC review") that every project needs
2. **You want to avoid re-authoring the same YAML** each time

**Example:** "Define one RFC ceremony with all the right gates. Save it. New projects can instantly add it without re-writing the workflow."

---

## Implementation Map — Key Files

| Layer | File | Purpose |
|-------|------|---------|
| **Discovery** | `packages/server/src/services/builtin-bundles.ts` | Lazy scanner for `bundles/` directory |
| **API** | `packages/server/src/routes/templates.ts` | HTTP GET/POST endpoints for templates |
| **Types** | `packages/squadboard-sdk/bundle.ts` | `SquadboardBundle`, `BundleProject`, etc. types |
| **Schema** | `docs/squadapp-spec.md` § 3 | JSON schema for `squadapp.json` |
| **Validation** | `docs/squadapp-spec.md` § 4 | Validation rules (required fields, constraints) |
| **Filesystem** | `packages/server/src/services/setup-lifecycle.ts` | Creates `.squad/` directories on project creation |
| **Frontend** | `packages/client/src/pages/Templates.tsx` | UI for browsing and applying templates |
| **Frontend API hooks** | `packages/client/src/api/templates.ts` | React Query hooks for all template operations |
| **Live bundles** | `bundles/` | Directory of bundled Squad App definitions |

---

## Common Questions

### Q: Can I share a Squad App as a git URL?

**A:** Yes (planned for F5). The installer will accept `https://github.com/user/squad-app-repo` and clone the repo if its root contains a `.squadapp/` directory or a `squadapp.json` file.

### Q: Can I upgrade a project created from a Squad App?

**A:** Not yet (roadmap F6+). Once a project is created from a Squad App, the two are independent. Future roadmap: sync-based upgrades with conflict resolution.

### Q: Can I export a project and turn it into a Squad App?

**A:** Partially. Use `POST /api/projects/{id}/export` to get the JSON. Manually author a `squadapp.json` manifest and directory structure to make it installable. Full automation planned for F5+.

### Q: What's the difference between `/bundles/` and `/packages/server/src/data/starters/`?

**A:** 
- **`bundles/`** — Squad App format (new, specified, marketplace-ready)
- **`starters/`** — Legacy Squad-IRL format (old, superseded, maintained for backward compat only)

New projects should use `bundles/`.

### Q: If I save a project as a template, does it create a Squad App?

**A:** No. Project templates are snapshots in the DB. They're not portable outside Squadboard. To make a Squad App, you'd export the project and manually author a `squadapp.json` and file structure. (Automation planned F5+.)

---

## Next Steps

- **F4 (Wave 24+):** Curate and ship first-class built-in Squad Apps
- **F5 (Wave 25+):** Git URL-backed installation; automated export → Squad App workflow
- **F6 (Wave 26+):** Squad App marketplace; upgrade path with conflict resolution
- **Community:** Contribute Squad Apps by submitting to the registry

---

## See Also

- [`docs/squadapp-spec.md`](../squadapp-spec.md) — Authoritative format spec
- [`docs/concepts/ceremonies.md`](./ceremonies.md) — Ceremony and workflow authoring
- [`docs/setup/mcp-install.md`](../setup/mcp-install.md) — MCP server setup
