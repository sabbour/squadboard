# YAML Schema Reference

This document is the complete reference for the canonical `.workflow.yaml` format (apiVersion: squad.io/v1, kind: Ceremony). Every field is documented with its type, requirement, validation rules, and examples.

For rationale and lifecycle context, see [lifecycle.md](./lifecycle.md#storage-and-canonicalization-cer-3).

## Top-Level Fields

### apiVersion

**Type:** `string` (literal)  
**Required:** Yes  
**Value:** `squad.io/v1`  
**Validation:** Exact match; no other versions supported today  

```yaml
apiVersion: squad.io/v1
```

The API version ensures backward compatibility as Squadboard evolves. All ceremonies authored today use `v1`. Future breaking changes will increment to `v2.0`.

### kind

**Type:** `string` (literal)  
**Required:** Yes  
**Value:** `Ceremony`  
**Validation:** Exact match; case-sensitive

```yaml
kind: Ceremony
```

Distinguishes ceremonies from other Squadboard object types (e.g., `kind: Workflow`, `kind: ReviewPolicy`).

### metadata

**Type:** object  
**Required:** Yes  
**Validation:** `.strict()` — rejects unknown keys

#### metadata.name

**Type:** `string`  
**Required:** Yes  
**Validation:** Min length 1; must be unique per project; alphanumeric + hyphens + underscores  
**Example:** `design-review`, `weekly-retro-enforcement`

Identifier for the ceremony. Used in URLs, API references, and CLI commands. Should be a slug (lowercase, hyphenated).

#### metadata.displayName

**Type:** `string`  
**Required:** No (optional)  
**Validation:** Min length 1  
**Example:** `Design Review Gate`, `Weekly Retrospective`

Human-readable label displayed in the UI. Defaults to `metadata.name` if omitted.

#### metadata.description

**Type:** `string`  
**Required:** No (optional)  
**Validation:** No length limit  
**Example:** `Auto-triggers when a PR modifies docs/design.md to enforce design review before merge.`

Explains the ceremony's purpose, when it runs, and what it does. Displayed in ceremony list and detail views.

**Example metadata block:**

```yaml
metadata:
  name: design-review
  displayName: Design Review Gate
  description: Auto-triggers on PRs modifying design.md; requires designer approval
```

### spec

**Type:** object  
**Required:** Yes  
**Validation:** `.strict()` — rejects unknown keys; must contain both `trigger` and `steps`

#### spec.trigger

**Type:** object (discriminated union on `trigger.type`)  
**Required:** Yes  
**Validation:** Type must be one of: `github-event`, `manual`, `cron`, `agent-signal`; fields vary by type

##### github-event trigger

```yaml
spec:
  trigger:
    type: github-event
    event: pull_request              # required: pull_request, push, issues, issue_comment
    filters:                         # optional
      labels:
        - design/*
        - review-needed
      paths:
        - docs/design.md
        - packages/ui/**/*.tsx
```

**Fields:**
- `type` (required, literal): `github-event`
- `event` (required, string): One of `pull_request`, `push`, `issues`, `issue_comment`
- `filters` (optional, object):
  - `labels` (optional, array of strings): GitHub label name patterns (substring match or glob)
  - `paths` (optional, array of strings): File path patterns (glob notation, e.g., `**/*.md`)
  - Additional unknown keys allowed (reserved for future filter types)

**Validation:**
- `event` must be non-empty
- `filters.labels` and `filters.paths` are optional arrays of non-empty strings
- If `filters` is absent, ceremony fires on all events of that type (may be broad)

##### manual trigger

```yaml
spec:
  trigger:
    type: manual
```

**Fields:**
- `type` (required, literal): `manual`

No additional configuration. Ceremony runs when user clicks the Run button.

##### cron trigger

```yaml
spec:
  trigger:
    type: cron
    schedule: "0 9 * * 1"           # required: 5-field cron expression
    timezone: America/Los_Angeles    # optional; defaults to UTC
```

**Fields:**
- `type` (required, literal): `cron`
- `schedule` (required, string): 5-field cron expression (minute, hour, day-of-month, month, day-of-week)
- `timezone` (optional, string): IANA timezone name (e.g., `America/Los_Angeles`, `Europe/London`, `UTC`)

**Validation:**
- `schedule` must be a valid cron expression (parsed by cron-parser library)
- `timezone` must be a valid IANA timezone if provided

##### agent-signal trigger

```yaml
spec:
  trigger:
    type: agent-signal
```

**Fields:**
- `type` (required, literal): `agent-signal`

No additional configuration today. Ceremony fires when an agent emits a signal (support limited in Phase 16; CER-6 expands in W29).

#### spec.steps

**Type:** array of objects  
**Required:** Yes  
**Validation:** At least one step required; order preserved; each step must have `id` and `kind`

```yaml
spec:
  steps:
    - id: analyze
      kind: agent_run
      agent: designer
      prompt: "Review the design for consistency."
      timeout: 300
    
    - id: approval
      kind: peer_review
      reviewers: 1
      timeout: 3600
```

##### Step Fields (Common)

**Every step must have:**

- `id` (required, string): Unique identifier within the ceremony; alphanumeric + hyphens + underscores; used to reference step in routes/retries
- `kind` (required, string): Step type — specifies the handler (e.g., `agent_run`, `peer_review`, `route`, `github_pr`)

**Fields by step.kind (extensible):**

Step kinds are extensible. Unknown fields within a step are allowed (passthrough validation). Common kinds include:

| kind | Description | Example Fields |
|------|-------------|-----------------|
| `agent_run` | Run an LLM agent on the issue | `agent`, `prompt`, `timeout` |
| `peer_review` | Wait for N-of-M reviewer approvals | `reviewers`, `timeout` |
| `github_pr` | Push branch and open PR | `branchName`, `title`, `body` |
| `route` | Classification-based dispatch | `classifier`, `branches` |
| `wait_timer` | Sleep N seconds | `duration` |
| `approve` | Hard gate: wait for designated approver | `approver`, `timeout` |
| `fan_out` | Parallel agent runs | `count`, `agent`, `prompt` |

Refer to [Workflow Step Catalogue](../concepts/ceremonies.md#workflow-step-catalogue) for detailed step configuration.

**Validation:**
- Array must not be empty
- Each step's `id` must be unique within the ceremony
- Each step's `kind` must be non-empty
- Additional fields in each step are allowed (future step kinds, custom parameters)

## Complete Example

```yaml
apiVersion: squad.io/v1
kind: Ceremony
metadata:
  name: design-review
  displayName: Design Review Gate
  description: >-
    Auto-triggers when a PR modifies docs/design.md.
    Requires a designer to review for consistency, accessibility, and brand alignment.
    If approved, the PR can merge. If rejected, changes are requested.

spec:
  trigger:
    type: github-event
    event: pull_request
    filters:
      paths:
        - docs/design.md
      labels:
        - area:design

  steps:
    - id: initial-review
      kind: agent_run
      agent: designer
      prompt: |
        Review the design changes in this PR.
        Check for:
        - Visual consistency with the design system
        - Accessibility compliance (WCAG AA)
        - Brand alignment
        
        Provide detailed feedback.
      timeout: 600

    - id: approval-gate
      kind: peer_review
      reviewers: 1
      timeout: 3600

    - id: route-result
      kind: route
      classifier: approved
      branches:
        - condition: "true"
          steps:
            - id: approve-pr
              kind: github_pr
              action: approve
        - condition: "false"
          steps:
            - id: request-changes
              kind: github_pr
              action: request_changes
```

## Validation Rules Summary

| Field | Type | Required | Validation | Notes |
|-------|------|----------|-----------|-------|
| `apiVersion` | string | Yes | Must be `squad.io/v1` | No other versions supported |
| `kind` | string | Yes | Must be `Ceremony` | Case-sensitive |
| `metadata.name` | string | Yes | Min 1 char; unique per project | slug format recommended |
| `metadata.displayName` | string | No | Min 1 char if provided | Defaults to name |
| `metadata.description` | string | No | No limit | Markdown supported |
| `spec.trigger.type` | string | Yes | One of: github-event, manual, cron, agent-signal | Discriminates sub-schema |
| `spec.trigger.event` | string | Conditional | Required if type=github-event | One of: pull_request, push, issues, issue_comment |
| `spec.trigger.schedule` | string | Conditional | Required if type=cron; must be valid cron expression | 5-field format |
| `spec.trigger.timezone` | string | No | Valid IANA timezone if provided | Defaults to UTC |
| `spec.trigger.filters` | object | No | Unknown keys allowed | Extensible for future filter types |
| `spec.steps` | array | Yes | Min 1 item; each item has id (required), kind (required) | Order preserved; unknown fields in step allowed |

## Tips for Writing YAML

- **Use strong types:** Don't quote numbers (e.g., `timeout: 300`, not `timeout: "300"`).
- **Multiline strings:** Use `|` for block strings (prompts, descriptions) to preserve newlines.
- **Reuse field names:** If you have multiple steps of the same kind, keep field names consistent (e.g., all `agent_run` steps use `agent`, `prompt`, `timeout`).
- **Document intentions:** Use comments (`# ...`) to explain non-obvious trigger filters or step branching logic.
- **Validate locally:** Use `POST /ceremonies/validate` to check YAML before importing.

## Schema Metadata

**Canonical implementation:** `packages/server/src/ceremonies/yaml-schema.ts` (Zod runtime schema)  
**Type definitions:** `packages/server/src/ceremonies/types.ts` (TypeScript interfaces)  
**Validation endpoint:** `POST /ceremonies/validate` — returns `{ valid: boolean, errors?: string[] }`  
**Import endpoint:** `POST /ceremonies/import-yaml` — creates or updates ceremony from YAML  
**Export endpoint:** `GET /ceremonies/:id/yaml` — exports ceremony as YAML  

---

**See also:**
- [Triggers.md](./triggers.md) for detailed trigger type documentation
- [Lifecycle.md](./lifecycle.md) for versioning and storage guarantees
- [Authoring.md](./authoring.md) for how to edit YAML
