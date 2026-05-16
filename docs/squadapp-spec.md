# Squad Apps — Packaging Format Specification

> **Status:** Canonical spec · Wave 22 · Stream F3  
> **Author:** McManus (Lead Architect)  
> **Date:** 2026-05-16  
> **Anchors:** F4 (curated apps), F5 (unified import/export), F6 (marketplace), F7 (community contribution)

---

## Table of Contents

1. [What is a Squad App?](#1-what-is-a-squad-app)
2. [Format](#2-format)
3. [JSON Schema](#3-json-schema)
4. [Validation Rules](#4-validation-rules)
5. [Install Behavior](#5-install-behavior)
6. [Install Entry Points](#6-install-entry-points)
7. [Manifest Fields Reference](#7-manifest-fields-reference)
8. [Relationship to Upstream Squad Plugin Format](#8-relationship-to-upstream-squad-plugin-format)
9. [Worked Examples](#9-worked-examples)
10. [Versioning and Upgrade Path](#10-versioning-and-upgrade-path)
11. [Open Questions](#11-open-questions)

---

## 1. What is a Squad App?

A **Squad App** is a portable, self-describing, installable bundle that contains everything needed to stand up a fully functional Squadboard project in one step. It packages:

- A **project skeleton** (name, icon, description)
- A **kanban board** (columns, default column, WIP limits)
- A **team** (agent charters per role)
- **Ceremonies** (trigger → workflow pairs)
- **Workflows** (standalone workflow YAML)
- **Skills** (reusable prompt add-ons in SKILL.md format)
- **Tools** (MCP-backed function definitions)
- **MCP server recipes** (server configs)
- **Routing rules** (label/column → agent routing)
- **Seed issues** (starter backlog items)
- A **README** (rendered in the install dialog and the project overview)

### Squad App vs Template

| Dimension | Template | Squad App |
|---|---|---|
| **Scope** | A single artifact class (project structure, workflow, ceremony, or team) | The entire project configuration in one bundle |
| **Seed content** | No | Yes — seed issues and README |
| **Installable from URL** | No | Yes — directory, tarball, or git URL |
| **Marketplace-publishable** | No | Yes — F6 marketplace unit |
| **Versioned** | No | Yes — SemVer + `schemaVersion` |
| **Upgradeable** | No | Yes — in-place upgrade with conflict rules |

Templates (the existing `squad-bundle.json` format) are the **internal representation** that Squadboard uses after a Squad App is installed. A Squad App *produces* a bundle when applied; the bundle is Squadboard's runtime view.

### Squad App vs Plugin

| Dimension | Plugin (upstream Squad) | Squad App |
|---|---|---|
| **Granularity** | One artifact (a single skill, tool, or set of instructions) | Full project configuration |
| **File format** | `SKILL.md` / single-file | `.squadapp/` directory or `.squadapp.tar.gz` |
| **Registry unit** | Per-plugin entry in a marketplace repo | Per-app entry in the marketplace index |
| **Applies to** | An existing agent's skill list | A new or existing project |
| **Compatibility** | Upstream Squad CLI + Squadboard | Squadboard only (F5 importer) |

A Squad App's `skills/` section uses the **same SKILL.md format** as upstream Squad plugins. This means individual skills can be lifted from a Squad App and installed as standalone plugins, and vice versa.

---

## 2. Format

### 2.1 Distribution Forms

A Squad App may be distributed in any of three equivalent forms:

| Form | Description | When to use |
|---|---|---|
| `.squadapp/` directory | Uncompressed directory on disk | Local development, git repos |
| `.squadapp.tar.gz` | Gzip-compressed tar archive | Distribution, drag-and-drop upload |
| Git URL | Any `https://github.com/…` URL to a repo whose root is a `.squadapp/` directory or whose root contains a `squadapp.json` | Marketplace, community sharing |

The installer normalises all three to a temporary directory before processing.

### 2.2 Directory Layout

```
.squadapp/
├── squadapp.json                  # (required) manifest
├── README.md                      # (optional) app description, rendered in UI
├── project.json                   # (optional) project skeleton overrides
├── team/
│   ├── team-summary.json          # (optional) team-level metadata
│   └── <AgentName>.json           # (one per agent, optional charter inline or bodyPath)
├── ceremonies/
│   └── <ceremony-id>.yaml         # (one per ceremony, YAML workflow)
├── workflows/
│   └── <workflow-id>.yaml         # (one per standalone workflow)
├── skills/
│   └── <skill-key>/
│       └── SKILL.md               # upstream Squad SKILL.md format
├── tools/
│   └── <tool-key>.json            # tool definition
├── mcp/
│   └── <server-name>.json         # MCP server config
├── routing/
│   └── rules.json                 # routing rules array
└── issues/
    └── seed.json                  # seed issue list
```

**Invariants:**
- `squadapp.json` MUST be present at the root of the `.squadapp/` directory.
- All other files and directories are optional. An app with only a `squadapp.json` and one artifact is valid.
- The installer ignores unknown top-level keys in `squadapp.json` (forward-compat).
- The installer ignores unknown directories at the `.squadapp/` root (forward-compat).

> 📌 **Resolved 2026-05-16 (Gap 4 — Kobayashi W23): `agents/` and `mcp-servers/` as alternative discovery paths.**  
> The spec originally only showed `team/` and `mcp/` in the canonical directory layout, but Kobayashi's W23 reference implementation used `agents/<name>/charter.md` (to match the live project directory convention) and `mcp-servers/<name>.json`. **Both directory names are valid at install time:**
> - **Agent charters:** installer searches `agents/<name>/charter.md` first, then falls back to `team/<name>.json` / `team/<name>.md`. Either directory is accepted.
> - **MCP server configs:** installer searches `mcp-servers/<name>.json` first, then falls back to `mcp/<name>.json`.
>
> The canonical layout shown above (`team/`, `mcp/`) remains correct for new apps. Use `agents/` and `mcp-servers/` when the bundle is co-located with a live Squadboard project checkout (where those directory names already exist).

### 2.3 `squadapp.json` — Manifest Shape

```jsonc
{
  "schemaVersion": 1,               // integer — format version (breaking changes only)
  "appId": "my-squad-app",          // machine-readable, kebab-case, globally unique
  "version": "1.0.0",               // SemVer — content version, author-controlled
  "name": "My Squad App",           // human-readable display name (canonical)
  "displayName": "My Squad App",    // optional — UI-facing name; falls back to `name` if absent
  "kind": "project-template",       // optional — app classification (see valid values below)
  "description": "…",              // one-liner shown in install dialog
  "author": "Ahmed Sabbour",        // free text
  "license": "MIT",                 // SPDX identifier or "proprietary"
  "homepage": "https://…",         // optional — docs or repo URL
  "tags": ["engineering", "agile"], // optional — freeform taxonomy for search

  "requires": {
    "squadboard": ">=0.1.0"         // semver range; installer validates
  },

  // Inline artifact sections (alternative to per-file layout)
  "project": { /* BundleProject shape */ },
  "kanban":  { /* BundleKanban shape */ },
  "team":    [ /* BundleTeamMember[] */ ],
  "ceremonies": [ /* BundleCeremony[] */ ],
  "workflows":  [ /* BundleWorkflow[] */ ],
  "skills":     [ /* BundleSkill[] */ ],
  "tools":      [ /* BundleTool[] */ ],
  "mcpServers": [ /* BundleMcpServer[] */ ],
  "routing":    [ /* BundleRoutingRule[] */ ],
  "seedIssues": [ /* SeedIssue[] */ ],

  // Optional file manifest index (informational — installer discovers from filesystem)
  "artifacts": {
    "agents":     [ /* relative paths to agent charter files */ ],
    "ceremonies": [ /* relative paths to ceremony YAML files */ ],
    "skills":     [ /* relative paths to SKILL.md files */ ],
    "tools":      [ /* relative paths to tool JSON files */ ],
    "mcpServers": [ /* relative paths to MCP config files */ ],
    "seedIssues": [ /* relative paths to seed issue JSON files */ ]
  }
}
```

> 📌 **Resolved 2026-05-16 (Gap 1 — Kobayashi W23): `kind` enum.**  
> Kobayashi used `"kind": "project-template"` without the spec enumerating valid values. The canonical `kind` values are:
> | Value | Meaning |
> |---|---|
> | `project-template` | Full project config: project, kanban, team, ceremonies, skills. **(default)** |
> | `skills-pack` | Skills-only partial bundle — no `project` section. Installs into an existing project. |
> | `team-preset` | Team + routing config — no `project` section. Augments an existing project's team. |
> | `ceremony-pack` | Ceremonies + workflows only — no `project` section. |
>
> If absent, the installer defaults to `project-template`. The `kind` field is informational: it controls install dialog presentation and marketplace browse filters. The installer does not gate artifact sections on `kind` — any section may be present regardless of `kind`.

> 📌 **Resolved 2026-05-16 (Gap 2 — Kobayashi W23): `displayName` field.**  
> Kobayashi used `"displayName": "AKS Feature Kanban"` alongside `"name"` without it being formally specced. **`displayName` is now an optional top-level field.** When present, the UI renders `displayName` in the install dialog, app card, and marketplace listing in preference to `name`. `name` remains the canonical identifier used in CLI output and the installed-app registry. Both fields share the same constraints (1–128 chars, free text). If `displayName` is absent, the UI falls back to `name` — authors may omit it when the two would be identical.

> 📌 **Resolved 2026-05-16 (Gap 3 — Kobayashi W23): `artifacts` section.**  
> Kobayashi added an `artifacts` object listing the relative paths of included files per section. **Decision: `artifacts` is OPTIONAL.** The installer does **not** require it — file discovery happens by scanning the filesystem (the filesystem is the authoritative source of truth). If `artifacts` is present, it serves as a declaration index used by:
> 1. Tooling (IDE plugins, linters, CI validators) to enumerate files without a full directory scan.
> 2. Tarball integrity checks: F5 will use `artifacts` entries as the expected file list when verifying SHA-256 checksums (OQ-7).
> 3. Install preview cards: the server can count artifacts from `artifacts` without extracting the full tarball.
>
> The installer **does not error** if a file listed in `artifacts` is missing — it emits a warning and continues. The installer **does not error** if a file exists on disk but is not listed in `artifacts` — it installs it normally. `artifacts` is advisory, not gating.

### 2.4 Inline vs File-Based Artifacts

Every section may be specified **inline** in `squadapp.json` **or** in per-file form under the corresponding subdirectory. The two are merged at install time; per-file definitions take precedence over inline definitions for the same artifact key/id.

| Section | Inline key | File location | Per-file format |
|---|---|---|---|
| Project | `project` | `project.json` | JSON |
| Kanban | `kanban` | *(inline only)* | — |
| Team members | `team[]` | `team/<AgentName>.json` | JSON (may have `charterPath` → `.md` file) |
| Team members (alt) | `team[]` | `agents/<AgentName>/charter.md` | Markdown (charter body directly) |
| Ceremonies | `ceremonies[]` | `ceremonies/<id>.yaml` | YAML |
| Workflows | `workflows[]` | `workflows/<id>.yaml` | YAML |
| Skills | `skills[]` | `skills/<key>/SKILL.md` | Markdown (upstream format) |
| Tools | `tools[]` | `tools/<key>.json` | JSON |
| MCP servers | `mcpServers[]` | `mcp/<name>.json` | JSON |
| MCP servers (alt) | `mcpServers[]` | `mcp-servers/<name>.json` | JSON |
| Routing rules | `routing[]` | `routing/rules.json` | JSON array |
| Seed issues | `seedIssues[]` | `issues/seed.json` | JSON array |

**Large charter bodies (> 4 KB):** Use `charterPath: "team/<AgentName>.md"` in the agent's JSON. The installer resolves the path relative to the `.squadapp/` root.

### 2.5 Per-Artifact File Shapes

#### `team/<AgentName>.json`
```json
{
  "name": "Lead",
  "role": "Lead Architect",
  "persistent": true,
  "charter": "# Lead\n\n## Role\n…",
  "charterPath": "team/Lead.md"
}
```
`charter` and `charterPath` are mutually exclusive; `charterPath` wins if both present.

#### `ceremonies/<id>.yaml`
Standard Squadboard ceremony YAML. The file's base-name (without `.yaml`) is the ceremony `id`.
```yaml
id: sprint-planning
name: Sprint Planning
scope: project
trigger:
  kind: on_schedule
  config:
    cron: "0 9 * * 1"
steps:
  - type: agent_run
    agent: Lead
    prompt: "Run sprint planning…"
    timeout: 30m
```

#### `skills/<key>/SKILL.md`
Upstream Squad SKILL.md format (see [§8](#8-relationship-to-upstream-squad-plugin-format)):
```markdown
---
name: "repro-steps"
description: "Teaches agents how to write reproducible bug reports"
domain: "quality"
confidence: "high"
source: "manual"
---

## Context
…
## Patterns
…
```
The directory name is the skill `key`.

#### `tools/<key>.json`
```json
{
  "key": "run-tests",
  "name": "Run Tests",
  "description": "Runs the project test suite and returns a summary.",
  "category": "engineering",
  "inputSchema": {
    "type": "object",
    "properties": {
      "filter": { "type": "string", "description": "Test name glob pattern" }
    }
  }
}
```

#### `mcp/<name>.json`
```json
{
  "name": "github",
  "displayName": "GitHub MCP",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
}
```

#### `issues/seed.json`
```json
[
  {
    "title": "Set up CI pipeline",
    "body": "Configure GitHub Actions for build, test, and lint.",
    "labels": ["infrastructure", "good-first-issue"],
    "column": "inbox"
  }
]
```
Seed issues are created once during initial install. They are NOT re-created on re-install (idempotent by title + column).

---

## 3. JSON Schema

The canonical schema lives at:
```
packages/server/src/services/squad-apps/schema.json
```

It is referenced at install time for server-side validation and in CI for community contributions (F7).

### 3.1 Full Schema (JSON Schema draft-07)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://squadboard.dev/schemas/squadapp/v1/squadapp.json",
  "title": "SquadApp Manifest",
  "description": "squadapp.json — the root manifest for a Squadboard Squad App package.",
  "type": "object",
  "required": ["schemaVersion", "appId", "version", "name", "description"],
  "additionalProperties": true,

  "properties": {

    "schemaVersion": {
      "type": "integer",
      "const": 1,
      "description": "Format version. Bumped only on breaking manifest changes."
    },

    "appId": {
      "type": "string",
      "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
      "minLength": 3,
      "maxLength": 64,
      "description": "Machine-readable, globally unique, kebab-case identifier."
    },

    "version": {
      "type": "string",
      "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$",
      "description": "SemVer content version, author-controlled."
    },

    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "description": "Canonical display name shown in CLI output and installed-app registry."
    },

    "displayName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "description": "Optional UI-facing display name. Falls back to 'name' if absent."
    },

    "kind": {
      "type": "string",
      "enum": ["project-template", "skills-pack", "team-preset", "ceremony-pack"],
      "default": "project-template",
      "description": "App classification. Controls install dialog presentation and marketplace browse filters."
    },

    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 512,
      "description": "Short description shown in the install dialog and marketplace listing."
    },

    "author": {
      "type": "string",
      "maxLength": 128
    },

    "license": {
      "type": "string",
      "maxLength": 64,
      "description": "SPDX license identifier (e.g. MIT, Apache-2.0) or 'proprietary'."
    },

    "homepage": {
      "type": "string",
      "format": "uri"
    },

    "tags": {
      "type": "array",
      "items": { "type": "string", "maxLength": 32 },
      "maxItems": 20,
      "uniqueItems": true
    },

    "requires": {
      "type": "object",
      "properties": {
        "squadboard": {
          "type": "string",
          "description": "semver range that the installed Squadboard version must satisfy."
        }
      },
      "additionalProperties": false
    },

    "project": {
      "type": "object",
      "properties": {
        "name":        { "type": "string" },
        "description": { "type": "string" },
        "icon":        { "type": "string" },
        "settings":    { "type": "object" }
      },
      "required": ["name"],
      "additionalProperties": false
    },

    "kanban": {
      "type": "object",
      "required": ["columns", "defaultColumn"],
      "properties": {
        "columns": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["slug", "label", "order"],
            "properties": {
              "slug":      { "type": "string", "pattern": "^[a-z0-9-]+$" },
              "label":     { "type": "string" },
              "order":     { "type": "integer", "minimum": 0 },
              "wip_limit": { "type": "integer", "minimum": 1 }
            },
            "additionalProperties": false
          }
        },
        "defaultColumn": { "type": "string" }
      },
      "additionalProperties": false
    },

    "team": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "role"],
        "properties": {
          "name":        { "type": "string" },
          "role":        { "type": "string" },
          "persistent":  { "type": "boolean", "default": true },
          "charter":     { "type": "string" },
          "charterPath": { "type": "string" }
        },
        "additionalProperties": false
      }
    },

    "ceremonies": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "scope", "trigger"],
        "properties": {
          "id":           { "type": "string", "pattern": "^[a-z0-9-]+$" },
          "name":         { "type": "string" },
          "scope":        { "type": "string", "enum": ["project", "board", "task"] },
          "trigger": {
            "type": "object",
            "required": ["kind"],
            "properties": {
              "kind": {
                "type": "string",
                "enum": ["on_issue_entry", "on_schedule", "on_event", "manual", "github"]
              },
              "config": { "type": "object" },
              "event":   { "type": "string" },
              "action":  { "type": "string" },
              "filters": { "type": "object" }
            }
          },
          "workflowYaml": { "type": "string" },
          "workflowPath": { "type": "string" }
        },
        "additionalProperties": false
      }
    },

    "workflows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id":           { "type": "string", "pattern": "^[a-z0-9-]+$" },
          "name":         { "type": "string" },
          "description":  { "type": "string" },
          "workflowYaml": { "type": "string" },
          "workflowPath": { "type": "string" }
        },
        "additionalProperties": false
      }
    },

    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "name"],
        "properties": {
          "key":            { "type": "string", "pattern": "^[a-z0-9-]+$" },
          "name":           { "type": "string" },
          "description":    { "type": "string" },
          "category":       { "type": "string" },
          "promptAddendum": { "type": "string" },
          "curatedKey":     { "type": "string" }
        },
        "additionalProperties": false
      }
    },

    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["key", "name", "description"],
        "properties": {
          "key":         { "type": "string", "pattern": "^[a-z0-9-]+$" },
          "name":        { "type": "string" },
          "description": { "type": "string" },
          "category":    { "type": "string" },
          "inputSchema": { "type": "object" }
        },
        "additionalProperties": false
      }
    },

    "mcpServers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name":        { "type": "string" },
          "displayName": { "type": "string" },
          "command":     { "type": "string" },
          "args":        { "type": "array", "items": { "type": "string" } },
          "env":         { "type": "object" }
        },
        "additionalProperties": false
      }
    },

    "routing": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "label":  { "type": "string" },
          "column": { "type": "string" },
          "agent":  { "type": "string" }
        },
        "additionalProperties": false
      }
    },

    "seedIssues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["title"],
        "properties": {
          "title":  { "type": "string" },
          "body":   { "type": "string" },
          "labels": { "type": "array", "items": { "type": "string" } },
          "column": { "type": "string" }
        },
        "additionalProperties": false
      }
    },

    "artifacts": {
      "type": "object",
      "description": "Optional file manifest index. Advisory — installer discovers from filesystem regardless.",
      "properties": {
        "agents":     { "type": "array", "items": { "type": "string" } },
        "team":       { "type": "array", "items": { "type": "string" } },
        "ceremonies": { "type": "array", "items": { "type": "string" } },
        "workflows":  { "type": "array", "items": { "type": "string" } },
        "skills":     { "type": "array", "items": { "type": "string" } },
        "tools":      { "type": "array", "items": { "type": "string" } },
        "mcpServers": { "type": "array", "items": { "type": "string" } },
        "seedIssues": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    }
  }
}
```

### 3.2 Ajv Validation Requirements

> 📌 **Resolved 2026-05-16 (Gap 5 — Kobayashi W23): Ajv `addFormats` dependency.**  
> The schema uses JSON Schema `format` keywords (`"uri"`, `"date-time"`). Ajv **does not** validate `format` keywords by default — they are silently ignored, meaning invalid URIs and date strings pass validation. The validator **must** call `addFormats(ajv)` from the [`ajv-formats`](https://github.com/ajv-validator/ajv-formats) package immediately after constructing the Ajv instance:

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);                          // ← REQUIRED for format: "uri", "date-time", etc.
const validate = ajv.compile(schema);
```

`ajv-formats` **must** be listed as a production dependency (not `devDependency`) in any package that validates Squad App manifests at runtime. Fields affected:
- `homepage`: `format: "uri"` — validates the URL is a well-formed URI.
- Any future `format: "date-time"` fields added to the registry or installed-app record.

Without `addFormats`, these format constraints are no-ops and malformed values silently pass schema validation.

---

## 4. Validation Rules

### 4.1 Required vs Optional Artifacts

| Field / Section | Required? | Notes |
|---|---|---|
| `schemaVersion` | **Required** | Must equal `1` |
| `appId` | **Required** | Kebab-case, 3–64 chars |
| `version` | **Required** | Valid SemVer |
| `name` | **Required** | 1–128 chars |
| `description` | **Required** | 1–512 chars |
| `displayName` | Optional | If present, rendered in UI in preference to `name`. Same 1–128 char constraint. *(W23 gap resolved)* |
| `kind` | Optional | Defaults to `project-template`. Valid: `project-template`, `skills-pack`, `team-preset`, `ceremony-pack`. *(W23 gap resolved)* |
| `author` | Optional | |
| `license` | Optional | Defaults to `"proprietary"` if absent |
| `homepage` | Optional | Must be a valid URI if present |
| `tags` | Optional | |
| `requires` | Optional | If present, `requires.squadboard` must be a valid semver range |
| `project` | Optional | Provides the project name/icon. Falls back to `manifest.name` |
| `kanban` | Optional | Must have ≥1 column; `defaultColumn` must reference an existing slug |
| `team` | Optional | Each member needs `name` + `role` |
| `ceremonies` | Optional | Each needs `id`, `name`, `scope`, `trigger`, and one of `workflowYaml`/`workflowPath` |
| `workflows` | Optional | Each needs `id` + `name` + one of `workflowYaml`/`workflowPath` |
| `skills` | Optional | Each needs `key` + `name` |
| `tools` | Optional | Each needs `key` + `name` + `description` |
| `mcpServers` | Optional | Each needs `name` |
| `routing` | Optional | |
| `seedIssues` | Optional | |
| `artifacts` | Optional | File manifest index. Lists relative paths per section. Installer discovers files from filesystem regardless; if present, `artifacts` is advisory — used by tooling, validators, and F5 tarball integrity checks. *(W23 gap resolved)* |
| `README.md` | Optional | Strongly recommended for marketplace listings |

A Squad App with only `schemaVersion`, `appId`, `version`, `name`, and `description` is **valid** (minimal app). It installs an empty project with the given name.

### 4.2 Collision Rules

When an artifact from the Squad App has the same identifier as an existing artifact in the target Squadboard instance:

| Artifact | Identity key | Default behavior | `--overwrite` behavior |
|---|---|---|---|
| Project | `name` | Skip (warn) | Update description + icon |
| Kanban columns | `slug` | Skip column (warn) | Upsert (merge WIP limit) |
| Team members | `name` | Skip (warn) | Re-apply charter |
| Ceremonies | `id` (slugified `name`) | Skip (warn) | Replace workflow YAML |
| Workflows | `id` | Skip (warn) | Replace workflow YAML |
| Skills | `key` | Skip (warn) | Replace prompt body |
| Tools | `key` | Skip (warn) | Replace definition |
| MCP servers | `name` | Skip (warn) | Replace config |
| Routing rules | `label`+`column` pair | Skip (warn) | Replace agent assignment |
| Seed issues | `title`+`column` pair | Skip silently | Never re-create |

**Collision warnings** are surfaced in the install dialog (UI), CLI output, and MCP `install_app` response — but they do not fail the install unless the `--fail-on-conflict` flag is set.

### 4.3 Version Semantics

- `schemaVersion` (integer): controls the **format**. The installer rejects `schemaVersion > currentSupported` with a hard error and a pointer to upgrade Squadboard.
- `version` (SemVer): controls the **content**. Used for upgrade detection (see §10).

### 4.4 `requires` Validation

If `requires.squadboard` is present, the installer resolves the currently running Squadboard version (from `package.json`) and applies `semver.satisfies`. If the check fails:
- **Hard block** if the installed version is below the minimum (`<1.0.0`).
- **Warning only** if the range uses `<=` or `<` (app may be too new for this Squadboard).

### 4.5 Structural Validity Checks (beyond JSON Schema)

1. `kanban.defaultColumn` must be a `slug` that exists in `kanban.columns`.
2. Ceremony `workflowPath` values must resolve to a file inside the `.squadapp/` directory (no path traversal).
3. Agent `charterPath` must resolve inside `.squadapp/` directory.
4. Skill directory name must match the `key` field in `SKILL.md` front-matter (if front-matter is present).
5. `appId` must be unique within the target Squadboard instance's installed-app registry (collision → upgrade flow, not duplicate install).
6. Seed issue `column` values must reference a `slug` from `kanban.columns` (if kanban is present).

---

## 5. Install Behavior

### 5.1 Artifact Creation Order

The installer applies artifacts in a strict dependency order to avoid foreign-key violations:

```
1.  Project         (created first; all other artifacts belong to it)
2.  Kanban columns  (needed by ceremonies with on_issue_entry triggers)
3.  Skills          (agents reference skills by key)
4.  Tools           (agents reference tools by key)
5.  MCP servers     (agents reference MCP servers)
6.  Team members    (created after skills/tools so assignments resolve)
7.  Routing rules   (reference agents by name — agents must exist first)
8.  Ceremonies      (reference agents and columns)
9.  Workflows       (standalone, no dependencies on agents or columns)
10. Seed issues     (placed into kanban columns — columns must exist)
```

### 5.2 Idempotency (Re-install Behavior)

Re-installing an app that was previously installed:

- **By default (no flags):** All existing artifacts are kept. Only genuinely new artifacts (present in the app but absent from the project) are created. Existing artifacts are skipped with a warning logged but not surfaced unless verbose mode is active.
- **`--overwrite`:** Existing artifacts are updated to match the app's version (see collision table in §4.2).
- **`--dry-run`:** No writes. Returns a diff: `{ toCreate: [], toUpdate: [], toSkip: [], conflicts: [] }`.

Seed issues are **never** re-created on re-install, even with `--overwrite`.

### 5.3 Rollback on Partial Failure

All artifact writes within a single install run are wrapped in a **database transaction**. If any step fails after writes have started, the transaction is rolled back and the project is left in its pre-install state.

Exception: **seed issues** are written outside the main transaction (after commit) to avoid blocking the install on GitHub API rate limits. If seed issue creation fails, the install is still considered successful and the failure is reported as a non-fatal warning.

### 5.4 Conflict Resolution Summary

1. **Identity collision, no `--overwrite`:** Skip artifact, emit warning.
2. **Identity collision, `--overwrite`:** Update artifact in place (see §4.2).
3. **`--fail-on-conflict`:** Abort install at first collision (after dry-run phase); no writes occur.
4. **Version downgrade (`--overwrite` + installed version > app version):** Require explicit `--allow-downgrade` flag; otherwise reject with an error.

---

## 6. Install Entry Points

### 6.1 UI — Drag-and-Drop

**Trigger:** User drags a `.squadapp.tar.gz` file (or pastes a git URL) onto the "New Project" dialog or the dedicated "Install App" drop-zone.

**Flow:**
1. Client uploads the file to `POST /api/squad-apps/preview` → server validates manifest + returns a preview card (name, description, artifact counts, conflicts).
2. User reviews the preview card (can toggle `--overwrite`).
3. User clicks **Install** → `POST /api/squad-apps/install` → server runs the full install pipeline.
4. On success: redirect to the new project's board.
5. On failure: modal with rollback confirmation and error details.

**Supported input types:** `.squadapp.tar.gz`, `.squadapp.zip`, git URL (parsed and fetched server-side).

### 6.2 CLI — `npx squadboard app install`

```
npx squadboard app install <path|git-url> [options]

Arguments:
  <path|git-url>   Local directory, .squadapp.tar.gz file, or git URL

Options:
  --overwrite        Update existing artifacts on conflict [default: false]
  --dry-run          Validate and show diff; no writes [default: false]
  --fail-on-conflict Abort on first collision [default: false]
  --allow-downgrade  Allow installing an older version over a newer [default: false]
  --project-id <id>  Install into an existing project (skip project creation)
  --verbose          Show all skipped artifacts
  --json             Output machine-readable JSON result
```

**Exit codes:**
- `0` — Success (or dry-run success)
- `1` — Validation failure
- `2` — Install failure (partial; always rolls back)
- `3` — Conflict (only with `--fail-on-conflict`)

**Example:**
```bash
npx squadboard app install ./my-app.squadapp.tar.gz --dry-run
npx squadboard app install https://github.com/acme/squad-app-saas --overwrite
```

### 6.3 MCP — `install_app` Tool

The `install_app` MCP tool allows AI agents (e.g., Copilot via Conjure) to install Squad Apps programmatically.

**Tool definition:**
```json
{
  "name": "install_app",
  "description": "Install a Squad App from a local path, tarball, or git URL. Returns the created project ID and a list of installed artifacts.",
  "inputSchema": {
    "type": "object",
    "required": ["source"],
    "properties": {
      "source": {
        "type": "string",
        "description": "Local file path, .squadapp.tar.gz path, or https:// git URL"
      },
      "overwrite": {
        "type": "boolean",
        "default": false,
        "description": "If true, update existing artifacts that conflict with the app"
      },
      "dryRun": {
        "type": "boolean",
        "default": false,
        "description": "If true, validate and return diff without writing"
      },
      "projectId": {
        "type": "string",
        "description": "Install into an existing project (skips project creation)"
      }
    }
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "projectId": "proj_abc123",
  "appId": "my-squad-app",
  "appVersion": "1.2.0",
  "created": { "team": 4, "ceremonies": 3, "skills": 2, "tools": 1, "seedIssues": 5 },
  "skipped": { "skills": 1 },
  "warnings": ["Skill 'repro-steps' already exists — skipped"],
  "dryRun": false
}
```

---

## 7. Manifest Fields Reference

| Field | Type | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `schemaVersion` | `integer` | **Yes** | — | Format version. Must equal `1`. | `1` |
| `appId` | `string` | **Yes** | — | Globally unique, kebab-case, 3–64 chars. | `"aks-feature-kanban"` |
| `version` | `string` | **Yes** | — | SemVer content version. | `"1.0.0"` |
| `name` | `string` | **Yes** | — | Canonical display name (1–128 chars). Used in CLI output and installed-app registry. | `"AKS Feature Kanban"` |
| `displayName` | `string` | No | *(value of `name`)* | Optional UI-facing display name. If present, shown in the install dialog, app card, and marketplace listing in preference to `name`. Same 1–128 char constraint. *(W23 gap resolved)* | `"AKS Feature Kanban"` |
| `kind` | `string` | No | `"project-template"` | App classification. Controls install dialog and marketplace filters. Valid values: `project-template`, `skills-pack`, `team-preset`, `ceremony-pack`. *(W23 gap resolved)* | `"project-template"` |
| `description` | `string` | **Yes** | — | One-liner for install dialog (1–512 chars). | `"Engineering team kanban for shipping AKS features."` |
| `author` | `string` | No | `""` | Author name or org. | `"Ahmed Sabbour"` |
| `license` | `string` | No | `"proprietary"` | SPDX identifier or `"proprietary"`. | `"MIT"` |
| `homepage` | `string` | No | — | URI. | `"https://github.com/acme/squad-app"` |
| `tags` | `string[]` | No | `[]` | Freeform tags for search/filter (max 20, max 32 chars each). | `["engineering", "agile", "aks"]` |
| `requires.squadboard` | `string` | No | — | semver range for Squadboard version. | `">=0.1.0"` |
| `project` | `object` | No | *(name from `name`)* | Project skeleton. | `{"name": "AKS Kanban", "icon": "☸️"}` |
| `project.name` | `string` | If `project` present | — | Project display name. | `"AKS Feature Kanban"` |
| `project.description` | `string` | No | — | Project description. | `"Track AKS feature work."` |
| `project.icon` | `string` | No | `"📋"` | Emoji or single character. | `"☸️"` |
| `kanban` | `object` | No | — | Board configuration. | — |
| `kanban.columns` | `object[]` | If `kanban` present | — | Column definitions (≥1). | — |
| `kanban.columns[].slug` | `string` | Yes | — | Kebab-case column identifier. | `"in-progress"` |
| `kanban.columns[].label` | `string` | Yes | — | Display label. | `"In Progress"` |
| `kanban.columns[].order` | `integer` | Yes | — | 0-based sort order. | `2` |
| `kanban.columns[].wip_limit` | `integer` | No | — | Max issues allowed in column. | `3` |
| `kanban.defaultColumn` | `string` | If `kanban` present | — | Slug of the column for new issues. | `"inbox"` |
| `team` | `object[]` | No | `[]` | Agent definitions. | — |
| `team[].name` | `string` | Yes | — | Cast name. | `"Lead"` |
| `team[].role` | `string` | Yes | — | Role title. | `"Lead Architect"` |
| `team[].persistent` | `boolean` | No | `true` | Persistent agents survive between sessions. | `true` |
| `team[].charter` | `string` | No* | — | Inline markdown charter body (*mutually exclusive with `charterPath`). | `"# Lead\n…"` |
| `team[].charterPath` | `string` | No* | — | Relative path to `.md` charter file. | `"team/Lead.md"` |
| `ceremonies` | `object[]` | No | `[]` | Ceremony definitions. | — |
| `ceremonies[].id` | `string` | Yes | — | Kebab-case identifier. | `"sprint-planning"` |
| `ceremonies[].name` | `string` | Yes | — | Display name. | `"Sprint Planning"` |
| `ceremonies[].scope` | `string` | Yes | — | `"project"`, `"board"`, or `"task"`. | `"project"` |
| `ceremonies[].trigger` | `object` | Yes | — | Trigger definition. | — |
| `ceremonies[].trigger.kind` | `string` | Yes | — | `on_issue_entry`, `on_schedule`, `on_event`, `manual`, `github`. | `"on_schedule"` |
| `ceremonies[].workflowYaml` | `string` | No* | — | Inline YAML (*required if no `workflowPath`). | `"name: …\nsteps: …"` |
| `ceremonies[].workflowPath` | `string` | No* | — | Relative path to `.yaml` file. | `"ceremonies/sprint-planning.yaml"` |
| `workflows` | `object[]` | No | `[]` | Standalone workflow definitions. | — |
| `skills` | `object[]` | No | `[]` | Skill definitions (inline). See §8 for file-based format. | — |
| `tools` | `object[]` | No | `[]` | Tool definitions. | — |
| `mcpServers` | `object[]` | No | `[]` | MCP server configs. | — |
| `routing` | `object[]` | No | `[]` | Routing rules. | — |
| `seedIssues` | `object[]` | No | `[]` | Seed backlog items (created once on install). | — |
| `seedIssues[].title` | `string` | Yes | — | Issue title. | `"Set up CI pipeline"` |
| `seedIssues[].body` | `string` | No | `""` | Issue body (markdown). | `"Configure GitHub Actions…"` |
| `seedIssues[].labels` | `string[]` | No | `[]` | Label names. | `["infrastructure"]` |
| `seedIssues[].column` | `string` | No | `kanban.defaultColumn` | Target column slug. | `"inbox"` |
| `artifacts` | `object` | No | — | File manifest index. Keys: `agents`, `team`, `ceremonies`, `workflows`, `skills`, `tools`, `mcpServers`, `seedIssues` — each a `string[]` of relative file paths. Optional and advisory; installer discovers from filesystem regardless. *(W23 gap resolved)* | `{"agents": ["agents/Lead/charter.md"]}` |

---

## 8. Relationship to Upstream Squad Plugin Format

### 8.1 Upstream Plugin Shape

Upstream Squad (the `.github/agents/` conventions used by GitHub Copilot CLI and related tooling) defines a plugin as a directory with a `SKILL.md` file:

```
.squad/skills/<plugin-name>/SKILL.md
```

The `SKILL.md` format (from `.squad/templates/skill.md`):
```markdown
---
name: "{skill-name}"
description: "{what this skill teaches agents}"
domain: "{e.g., testing, api-design, error-handling}"
confidence: "low|medium|high"
source: "{how this was learned: manual, observed, earned}"
tools:
  - name: "{tool-name}"
    description: "{what this tool does}"
    when: "{when to use this tool}"
---

## Context
## Patterns
## Examples
## Anti-Patterns
```

### 8.2 Compatibility Contract

| Surface | Squadboard Squad App | Upstream Squad plugin |
|---|---|---|
| **Skills** | `skills/<key>/SKILL.md` — identical format | `SKILL.md` — same file |
| **Marketplace registry** | `marketplaces.json` (F6) | `.squad/plugins/marketplaces.json` — same shape |
| **Install verb** | `npx squadboard app install` | `squad plugin install` |
| **Scope** | Full project bundle | Single artifact |

**Key rule:** Skills from a Squad App are installed to `.squad/skills/<key>/SKILL.md` and are therefore **immediately consumable by upstream Squad tooling** without any conversion. Upstream Squad plugins (single SKILL.md files) can be imported via the F5 unified importer as a partial bundle (skills-only subset of the Squad App format).

### 8.3 What Squad App Does NOT Overlap With

- **Upstream marketplace internals** — F6 spec owns the marketplace index shape, browse API, and dedupe logic. This spec only establishes that the `appId` + `version` pair is the dedupe key.
- **Charter format** — Charters remain `.md` files in upstream format (`## Role`, `## Expertise`, `## Style` sections). The Squad App wraps them but does not redefine their internal structure.
- **Workflow YAML format** — Squadboard's ceremony workflow YAML is Squadboard-specific. Upstream Squad agents are Markdown-instruction-based and do not use YAML workflows. The two systems coexist; Squad Apps carry Squadboard workflows, not upstream Squad instructions.

---

## 9. Worked Examples

### Example A — Minimal Squad App (one skill + one ceremony)

**Use case:** Share a "bug reproduction" skill and a manual triage ceremony as a lightweight reusable bundle.

**Directory layout:**
```
.squadapp/
├── squadapp.json
└── skills/
    └── repro-steps/
        └── SKILL.md
```

**`squadapp.json`:**
```json
{
  "schemaVersion": 1,
  "appId": "bug-repro-starter",
  "version": "1.0.0",
  "name": "Bug Repro Starter",
  "description": "Adds a repro-step authoring skill and a manual triage ceremony to any project.",
  "author": "Squadboard Team",
  "license": "MIT",
  "tags": ["quality", "bug-bash"],
  "ceremonies": [
    {
      "id": "manual-triage",
      "name": "Manual Triage",
      "scope": "project",
      "trigger": { "kind": "manual" },
      "workflowYaml": "name: Manual Triage\nsteps:\n  - type: agent_run\n    label: Triage lead reviews open bugs\n    agent: Lead\n    prompt: \"Review all issues in Inbox. Classify severity (P0–P3), assign to a team member, and move to Triaged.\"\n    timeout: 30m\n"
    }
  ]
}
```

**`skills/repro-steps/SKILL.md`:**
```markdown
---
name: "repro-steps"
description: "Teaches agents to write precise, reproducible bug reports"
domain: "quality"
confidence: "high"
source: "manual"
---

## Context
Apply when an issue lacks clear reproduction steps or the environment is under-specified.

## Patterns
- Always list: OS, browser/runtime version, exact steps, observed vs expected behaviour.
- Attach a minimal reproduction case (code snippet or repo link) when possible.
- Label the issue `needs-repro` if steps cannot be confirmed.

## Anti-Patterns
- "It doesn't work" — never acceptable as a bug description.
- Describing symptoms without steps.
```

**Install result:** No project created (no `project` section). The skill and ceremony are installed into the **current active project** (or the project passed via `--project-id`). If there is no active project, the installer returns an error: `"No project section and no --project-id specified"`.

---

### Example B — Full Squad App (AKS Feature Kanban)

**Use case:** A complete AKS engineering team kanban: 4 agents, 3 ceremonies, 2 skills, 1 tool, 1 MCP server, seed issues, README.

**Directory layout:**
```
.squadapp/
├── squadapp.json
├── README.md
├── team/
│   ├── Lead.md
│   ├── Backend.json
│   ├── Frontend.json
│   └── Tester.json
├── ceremonies/
│   ├── sprint-planning.yaml
│   ├── pr-review.yaml
│   └── bug-fix.yaml
├── skills/
│   ├── aks-networking/
│   │   └── SKILL.md
│   └── repro-steps/
│       └── SKILL.md
├── tools/
│   └── run-e2e-tests.json
├── mcp/
│   └── github.json
└── issues/
    └── seed.json
```

**`squadapp.json`:**
```json
{
  "schemaVersion": 1,
  "appId": "aks-feature-kanban",
  "version": "1.0.0",
  "name": "AKS Feature Kanban",
  "description": "Engineering team kanban for shipping AKS features: architect + backend + frontend + tester, sprint planning, PR review, and bug-fix ceremonies.",
  "author": "Squadboard Team",
  "license": "MIT",
  "homepage": "https://github.com/sabbour/squadboard",
  "tags": ["engineering", "aks", "kubernetes", "azure"],
  "requires": { "squadboard": ">=0.1.0" },

  "project": {
    "name": "AKS Feature Kanban",
    "description": "Track AKS feature work from design to ship.",
    "icon": "☸️"
  },

  "kanban": {
    "columns": [
      { "slug": "inbox",       "label": "Inbox",       "order": 0 },
      { "slug": "design",      "label": "Design",      "order": 1 },
      { "slug": "in-progress", "label": "In Progress", "order": 2, "wip_limit": 3 },
      { "slug": "review",      "label": "Review",      "order": 3 },
      { "slug": "done",        "label": "Done",        "order": 4 }
    ],
    "defaultColumn": "inbox"
  },

  "team": [
    {
      "name": "Lead",
      "role": "Lead Architect",
      "persistent": true,
      "charterPath": "team/Lead.md"
    },
    {
      "name": "Backend",
      "role": "Backend Engineer",
      "persistent": true,
      "charterPath": "team/Backend.md"
    },
    {
      "name": "Frontend",
      "role": "Frontend Engineer",
      "persistent": true,
      "charterPath": "team/Frontend.md"
    },
    {
      "name": "Tester",
      "role": "QA Engineer",
      "persistent": true,
      "charterPath": "team/Tester.md"
    }
  ],

  "routing": [
    { "label": "backend",  "agent": "Backend" },
    { "label": "frontend", "agent": "Frontend" },
    { "label": "bug",      "agent": "Tester"  }
  ],

  "seedIssues": [
    {
      "title": "Set up CI/CD pipeline for AKS",
      "body": "Configure GitHub Actions: build, test, lint, and AKS deploy stages.",
      "labels": ["infrastructure", "good-first-issue"],
      "column": "inbox"
    },
    {
      "title": "Define networking policy for feature X",
      "body": "Document ingress rules, network policies, and service mesh configuration.",
      "labels": ["design", "aks"],
      "column": "inbox"
    },
    {
      "title": "Write E2E tests for feature X",
      "labels": ["testing"],
      "column": "inbox"
    }
  ]
}
```

**`team/Lead.md`** (example — full charter in the file):
```markdown
# Lead

## Role
Lead Architect — owns AKS architecture decisions, PR reviews, and technical direction.

## Expertise
- AKS node pools, VMSS, cluster autoscaler
- Azure networking (VNet, NSG, private endpoints)
- Helm, Kustomize, GitOps (Flux/Argo)
- Security: workload identity, RBAC, policy

## Style
Direct. Decides fast. Revisits when telemetry says otherwise.
```

**Install result:** Creates a project "AKS Feature Kanban" with a 5-column board, 4 agents, 3 ceremonies (loaded from `ceremonies/*.yaml`), 2 skills (from `skills/*/SKILL.md`), 1 tool, 1 MCP server (GitHub), routing rules, and 3 seed issues in Inbox. Init Mode automatically re-casts agent names on first project use.

---

## 10. Versioning and Upgrade Path

### 10.1 Installed App Registry

When a Squad App is successfully installed, Squadboard records it in a per-project installed-app registry:
```json
{
  "appId": "aks-feature-kanban",
  "version": "1.0.0",
  "installedAt": "2026-05-16T01:40:00Z",
  "source": "https://github.com/sabbour/aks-squad-app"
}
```

This registry is used to detect upgrades and prevent accidental downgrades.

### 10.2 Upgrade Flow

1. User runs `npx squadboard app install <source>` (or drag-and-drops a newer version).
2. Installer compares `app.version` vs `installed.version` using SemVer comparison.
3. If `app.version > installed.version`: **upgrade** — apply with `--overwrite` semantics by default. Prompt user in UI ("Upgrade from 1.0.0 to 1.1.0?").
4. If `app.version == installed.version`: **re-install** — standard idempotent behavior (skip existing, add new).
5. If `app.version < installed.version`: **downgrade** — rejected unless `--allow-downgrade` is passed.

### 10.3 Breaking Change Rules (SemVer)

| Change type | Version bump required |
|---|---|
| Adding new optional artifacts | Patch (`1.0.0` → `1.0.1`) |
| Changing agent charter content | Minor (`1.0.0` → `1.1.0`) |
| Renaming an artifact key/id | **Major** (`1.0.0` → `2.0.0`) |
| Removing an artifact | **Major** |
| Changing kanban column slugs | **Major** |
| Adding a new required field to `squadapp.json` | Requires `schemaVersion` bump |

### 10.4 `schemaVersion` Bumps

`schemaVersion` is an **integer** and changes only on breaking format changes (not content changes). The installer:
- Supports: all `schemaVersion` values ≤ `currentSupported` (currently `1`).
- Warns: if `schemaVersion` equals the current supported version but unknown fields are present.
- **Hard-rejects:** `schemaVersion > currentSupported` — user must upgrade Squadboard.

A migration shim may be registered for `schemaVersion` N→N+1 transitions in `packages/server/src/services/squad-apps/migrations/`.

### 10.5 Surfacing Breaking Changes to Users

In the upgrade preview card (UI and `--dry-run` output):
- **MAJOR bump detected:** Banner "⚠ This upgrade contains breaking changes. Existing artifact keys may be renamed or removed. Review the changelog before upgrading."
- **MINOR bump:** Info note "This upgrade adds or updates content. Existing customisations are preserved unless `--overwrite` is set."
- **PATCH bump:** Silent (just a version number update in the registry).

---

## 11. Open Questions

These are explicitly deferred to follow-up waves. **Do not block Stream F4 or F5 on these.**

| # | Question | Assumed default for now | Follow-up owner |
|---|---|---|---|
| OQ-1 | Should `appId` be globally unique across all Squadboard instances, or only within a project? | **Unique within a project** (instance-scoped). Global registry is F6's concern. | F6 marketplace spec |
| OQ-2 | Should seed issues support GitHub issue creation (real GH issues) vs Squadboard-internal issues only? | **Squadboard-internal only** for now; GitHub-sync is a separate stream. | F5 / GitHub sync |
| OQ-3 | Should `schemaVersion` follow the same repo as Squadboard, or be independently published? | **Same repo** (`packages/server/src/services/squad-apps/schema.json`). | F7 contributing guide |
| OQ-4 | Can a Squad App be installed into multiple projects simultaneously (multi-project install)? | **No — one project per install invocation.** Repeat installs are supported. | Future CLI enhancement |
| OQ-5 | Should `kanban` be required if `seedIssues` references specific columns? | **Soft warning** if seed issue column doesn't exist; place in `defaultColumn`. | Validation iteration |
| OQ-6 | How does Init Mode interact with agent `name` fields from a Squad App (re-cast vs keep)? | **Keep Squad App names by default; Init Mode re-casts on first conversation** (existing behavior). | Init Mode spec |
| OQ-7 | Should the `.squadapp.tar.gz` format include a checksum file (SHA-256) for integrity verification? | **Yes — add `squadapp.json.sha256` to the tarball.** Specify in F5. | F5 unified import/export |
| OQ-8 | How are environment variable secrets in `mcp/*.json` (e.g., `GITHUB_TOKEN`) handled at install time? | **Placeholders only** (`${ENV_VAR}`). User configures actual values post-install. No secret storage in bundles. | Security review |
| OQ-9 | Should partial-bundle installs (skills-only, ceremonies-only) be a first-class mode? | **Yes — any subset of sections is a valid Squad App.** Already covered by the optional-artifact rules in §4.1. | Already specced |
| OQ-10 | Does `--overwrite` on a ceremony replace the YAML if the user has customised it locally? | **Yes, with a diff preview in UI.** "Your local version vs app version" before confirming overwrite. | F5 / UI spec |
