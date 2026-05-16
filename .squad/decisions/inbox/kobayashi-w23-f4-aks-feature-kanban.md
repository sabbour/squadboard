# Kobayashi W23 — F4 AKS Feature Kanban: First Curated Squad App

**Author:** Kobayashi (SDK + data-shapes specialist)
**Wave:** 23
**Stream:** F4 (curated apps)
**Date:** 2026-05-16
**Deliverable:** `bundles/aks-feature-kanban/`

---

## Verbatim Spec Quotes (≥3 required — W22 post-mortem standard)

> **Quote 1** (§2.2 Directory Layout, line 111):
> "`squadapp.json` MUST be present at the root of the `.squadapp/` directory."

Used to anchor the bundle root: `bundles/aks-feature-kanban/squadapp.json` is the required entry point. All other files are discoverable from this root.

> **Quote 2** (§2.4 Inline vs File-Based Artifacts, table row for Kanban):
> "| Kanban | `kanban` | *(inline only)* | — |"

This resolved a potential ambiguity: the task spec mentioned a `project.json` that "includes the kanban board," but per McManus's spec the kanban section is **inline-only** in `squadapp.json`. I placed the kanban definition in `squadapp.json` and used `project.json` only for the project skeleton (name, description, icon, defaultLabels).

> **Quote 3** (§5.3 Rollback on Partial Failure):
> "Exception: **seed issues** are written outside the main transaction (after commit) to avoid blocking the install on GitHub API rate limits. If seed issue creation fails, the install is still considered successful and the failure is reported as a non-fatal warning."

Confirms that seed issues in `issues/seed.json` (and the alias at `seed-issues/issues.json`) do not need to be in the main rollback transaction. This is preserved in the bundle design — seed issues are defined separately.

> **Quote 4** (§4.2 Collision Rules, seed issues row):
> "| Seed issues | `title`+`column` pair | Skip silently | Never re-create |"

Used to verify that the 5 seed issues are idempotent-safe: each has a unique `title + column` pair across the entire set.

---

## Files Written

### Bundle root (`bundles/aks-feature-kanban/`)

| File | Purpose |
|---|---|
| `squadapp.json` | Manifest — schemaVersion 1, all inline section defs + charterPath/workflowPath refs |
| `project.json` | Project skeleton (name, icon, defaultLabels) |
| `README.md` | Install instructions, what's included, file layout, customisation guide |

### Agents (`agents/`)

| File | Agent | Role |
|---|---|---|
| `agents/aks-pm/charter.md` | aks-pm | AKS Product Manager — triage, signals, scope, disclosures |
| `agents/aks-platform-engineer/charter.md` | aks-platform-engineer | ARM + Kubernetes API + az CLI + Helm |
| `agents/aks-quality-engineer/charter.md` | aks-quality-engineer | Playwright + Azure CLI tests + cluster bringup |
| `agents/aks-docs-engineer/charter.md` | aks-docs-engineer | learn.microsoft.com docs + disclosure review |

### Ceremonies (`ceremonies/`)

| File | Trigger | Purpose |
|---|---|---|
| `ceremonies/weekly-aks-triage.yaml` | `on_schedule` Mon 09:00 UTC | Labels bugs, routes P0/P1, confirms repros |
| `ceremonies/feature-cut-review.yaml` | `manual` | Pre-ship scope + test + docs review + human gate |
| `ceremonies/customer-signals-digest.yaml` | `on_schedule` Fri 08:00 UTC | Aggregates 6 sources into ranked signal digest |

### Skills (`skills/`)

| File | Skill key |
|---|---|
| `skills/aks-customer-signal-collection/SKILL.md` | `aks-customer-signal-collection` |
| `skills/aks-disclosure-quality/SKILL.md` | `aks-disclosure-quality` |

### Tools (`tools/`)

| File | Tool key |
|---|---|
| `tools/aks-cluster-info.json` | `aks-cluster-info` |

### MCP Servers

| File | Location | Notes |
|---|---|---|
| `mcp/azure-mcp.json` | Spec-canonical (`mcp/<name>.json`) | Used by installer |
| `mcp-servers/azure-mcp.json` | Task-specified (`mcp-servers/`) | Extended recipe with install prerequisites |

### Seed Issues

| File | Location | Notes |
|---|---|---|
| `issues/seed.json` | Spec-canonical (`issues/seed.json`) | Used by installer |
| `seed-issues/issues.json` | Task-specified (`seed-issues/`) | Alias; installer ignores unknown dirs per spec §2.2 |

### Schema + Test

| File | Purpose |
|---|---|
| `packages/server/src/services/squad-apps/schema.json` | Canonical draft-07 schema (verbatim from spec §3.1) |
| `packages/server/src/__tests__/squad-apps/validate-aks-kanban.test.ts` | Vitest test suite — 23 assertions |

---

## Validation Results

```
Test Files  1 passed (1)
     Tests  23 passed (23)
  Start at  01:44:18
  Duration  252ms

Tests cover:
  1. JSON Schema validation (Ajv draft-07, strict: false for format keywords)
  2. schemaVersion === 1
  3. SemVer version format
  4. Required top-level fields (appId, name, description)
  5. 6 kanban columns with correct slugs
  6. defaultColumn references a valid slug
  7. All 4 charterPath files exist
  8. All 3 workflowPath ceremony files exist
  9. Both SKILL.md files exist
 10. aks-cluster-info.json exists with required fields
 11. Both MCP server files exist (canonical + extended recipe)
 12. issues/seed.json exists with 5 issues
 13. Seed issue columns reference valid kanban slugs
 14. 2 bugs, 2 features, 1 chore distribution
 15. README.md and project.json exist
```

---

## Spec Ambiguities Resolved

### A1 — `agents/` vs `team/` directory for charter files

**Ambiguity:** McManus's spec (§2.2) defines `team/<AgentName>.json` for per-agent files with an optional `charterPath` reference. The task brief specified `agents/{name}/charter.md`. The spec also says "The installer ignores unknown top-level keys in `squadapp.json` and unknown directories at the `.squadapp/` root" (§2.2 Invariants).

**Resolution:** Charter markdown files live at `agents/<name>/charter.md` (as the task requires), referenced via `charterPath` in `squadapp.json`'s inline team definitions. This is valid per spec because `charterPath` is "relative to the `.squadapp/` root" (§2.5) and can point anywhere inside the bundle. The spec's `team/<AgentName>.json` per-file format is an alternative discovery mechanism for agents not defined inline; since all 4 agents are defined inline in `squadapp.json` with `charterPath`, no `team/*.json` files are needed.

### A2 — `mcp-servers/` vs `mcp/` and `seed-issues/` vs `issues/`

**Ambiguity:** Task specifies `mcp-servers/azure-mcp.json` and `seed-issues/issues.json`. Spec specifies `mcp/<name>.json` and `issues/seed.json` as the canonical per-file locations the installer discovers.

**Resolution:** Created both:
- Spec-canonical paths (`mcp/azure-mcp.json`, `issues/seed.json`) — used by the installer.
- Task-specified paths (`mcp-servers/azure-mcp.json`, `seed-issues/issues.json`) — ignored by installer per the forward-compat invariant but provide the extended recipe format requested.
The `mcpServers` and `seedIssues` sections are also defined inline in `squadapp.json` (which takes priority over per-file discovery per §2.4), so the install path is unambiguous.

### A3 — `kind: "project-template"` field

**Ambiguity:** Task requires `kind: "project-template"` in the manifest. This field does not appear in McManus's JSON Schema (§3.1). The schema root has `"additionalProperties": true`.

**Resolution:** Added `kind: "project-template"` as an additional property. This is forward-compatible per spec §2.2: "The installer ignores unknown top-level keys in `squadapp.json` (forward-compat)." The field is preserved in the manifest as a hint for future marketplace filtering.

### A4 — `displayName` field

**Ambiguity:** Task requires `displayName`. Not in schema. Same resolution as A3 — additional property, installer ignores it.

### A5 — Kanban column names

**Ambiguity:** Example B in the spec (§9) shows columns: Inbox · Design · In Progress · Review · Done. The task requires: Backlog · Triage · In Progress · In Review · Validation · Done.

**Resolution:** Used the task-specified columns. The spec's Example B is illustrative, not prescriptive. The task spec is the authoritative description for what this curated app should contain. The 6-column layout (Backlog → Triage → In Progress → In Review → Validation → Done) better reflects real AKS feature team workflows.

---

## Spec Follow-Ups for McManus W24

| ID | Topic | Detail |
|---|---|---|
| SF-1 | `kind` field | The spec has no first-class `kind` field on the manifest. Curated apps (F4) and community apps (F6) may benefit from a `kind: "project-template" | "skill-pack" | "ceremony-pack"` enum to support marketplace filtering. Recommend adding as optional field in schemaVersion 1 minor update. |
| SF-2 | `displayName` | Spec uses `name` as the display name. Marketplace UIs may want a separate `displayName` (e.g., "AKS Feature Kanban") vs a shorter `name` for search/slug. Recommend clarifying or adding `displayName` as optional. |
| SF-3 | `artifacts` manifest listing | No `artifacts` section is defined in the schema. I added it as an additional property to document all included files. Useful for `--dry-run` output. Recommend formalising in a minor schema update. |
| SF-4 | Agent directory naming | Spec says `team/<AgentName>.json`; many apps may want `agents/` as the top-level directory. Recommend adding `agents/` as an alternative per-file discovery path with the same semantics as `team/`. |
| SF-5 | Ajv strict format validation | The schema uses `"format": "uri"` on `homepage`. Ajv v8 (used in this repo) throws on unknown formats without `strict: false`. Recommend either (a) removing the `format` keyword and using a regex pattern, or (b) documenting that `ajv-formats` is a peer dependency of the squad-apps validator. |
