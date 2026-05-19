# Authoring Ceremonies

Ceremonies can be authored in three ways: visual editor, YAML import, or built-in seeding. This document explains each approach and how provenance is tracked.

## Visual Editor (Formulate)

The primary authoring surface is the **Formulate** visual editor in the Squadboard UI.

### Workflow

1. Click **+ New Ceremony** on the Ceremonies tab.
2. Enter metadata:
   - Name (required) — e.g., "Design Review"
   - Display Name (optional) — e.g., "Design Approval Gate"
   - Description (optional) — e.g., "Auto-triggers on PRs modifying design.md"
3. Configure the trigger:
   - Choose trigger type: `manual`, `cron`, `github-event`, or `agent-signal`
   - Set trigger parameters (schedule, event type, filters, etc.)
4. Add steps:
   - Click **+ Step** to open the step library
   - Select a step kind (e.g., `agent_run`, `peer_review`, `github_pr`)
   - Configure step inputs (agent, prompt, reviewers, timeout, etc.)
   - Connect edges (visual: drag from one step's output to another's input)
5. Save the ceremony.

The ceremony is immediately inserted into the `workflows` table with `origin = 'user-created'` and `status = 'active'`.

### Visual Editor Features (Phase 16+)

- **Auto-connect on step add (W27):** When you add a new step, the editor suggests a connection from the previous step's output.
- **Drag-to-reconnect:** Click and drag an edge to reroute connections.
- **Step library:** Searchable catalogue of built-in step kinds with documentation and example configurations.
- **Code tab:** Switch to a code editor view of the ceremony YAML (visual ↔ code round-trip).

## YAML Editor / API Import

YAML editing workflow:

1. **Export:** Use `GET /ceremonies/:id/yaml` to export a ceremony to canonical YAML.
2. **Edit locally:** Edit the `.workflow.yaml` file in your editor, commit to `.squad/ceremonies/`.
3. **Re-import:** Use `POST /ceremonies/import-yaml` with the updated YAML.

### Advantages of YAML Authoring

- Version control: commit ceremony definitions to the repo.
- Diff review: see changes to ceremony logic in pull requests.
- Templating: define ceremony "templates" to share across projects.
- Batch operations: import multiple ceremonies via script.

## Built-in Seeding

When a new project is created, three ceremonies are auto-seeded:

| Name | Trigger | Purpose |
|------|---------|---------|
| **design-review** | `github-event` on `pull_request` with paths matching `design.md` | Enforce design review before merging design changes |
| **retrospective** | `manual` | Manual trigger for team retrospectives |
| **retro-enforcement** | `cron` every Monday 9 AM | Check that a retrospective was held weekly |

These ceremonies are pre-configured with:
- Standard trigger parameters (cron expression, path filters, etc.)
- Steps referencing built-in agents or skills
- Metadata linking to the project's style guide

**Deployment:** Built-in ceremonies are inserted with `templateId` set to a reference (see origin derivation below), marking them as `origin = 'built-in'`.

## Origin Badges

Every ceremony has an **origin** that tracks its provenance. The origin is derived from specific DB columns using the logic in `ceremony-origin.ts` (CER-1).

### Derivation Rules

The `deriveOrigin()` function checks signals in this order (most-specific first):

1. **`templateId` is set** → `origin = 'built-in'`
   - Reserved for CER-2 (built-in seeding).
   - Indicates the ceremony came from a bundled template.

2. **`sourceYamlPath` is set** → `origin = 'yaml-import'`
    - Indicates the ceremony was loaded from `.squad/ceremonies/ceremony-name.workflow.yaml`.
    - Used by YAML/API import surfaces.

3. **`parentNarrativeId` is set** → `origin = 'conjure-llm'`
   - Indicates the ceremony was auto-generated from narrative prose (e.g., a team decision doc).
   - Active signal today for Phase 11 prose→ceremony translation.

4. **None of the above** → `origin = 'user-created'`
    - Fallback: the ceremony was authored manually (visual editor, API, or Code tab).

Close-out ceremonies also expose lifecycle metadata in route responses:
current run, worktree path, branch, started/ended timestamps, close-out report
path, and cleanup status when those values are available.

### Origin Labels in the UI

Origins are displayed as badges:

| Origin | Label | Color |
|--------|-------|-------|
| `built-in` | Built-in | Blue |
| `yaml-import` | YAML | Green |
| `conjure-llm` | Conjure | Purple |
| `user-created` | User | Gray |

### Example

```typescript
// From ceremony-origin.ts
export function deriveOrigin(ceremony: CeremonyOriginInput): CeremonyOrigin {
  if (ceremony.templateId) return 'built-in';
  if (ceremony.sourceYamlPath) return 'yaml-import';
  if (ceremony.parentNarrativeId) return 'conjure-llm';
  return 'user-created';
}
```

## Markdown-to-Ceremony Import

**Status: Not planned**

Research (Kobayashi, W28) concluded that importing ceremony definitions directly from `.squad/ceremonies.md` (the human-readable team ceremony spec) is not practical because:

- `.squad/ceremonies.md` is prose-first and intentionally loose (facilitator names, agenda bullets, contextual notes).
- No structured ceremony format exists in `.squad/ceremonies.md` that maps 1:1 to workflow YAML.
- The prose-to-ceremony path happens via **narrative translation** (Phase 11: LLM reads a decision doc and generates YAML), not by parsing a specific ceremony format.

**Alternative:** For the three human-readable ceremonies in `.squad/ceremonies.md`, use the **built-in seeding** path (CER-2) to pre-configure executable runtime ceremonies on project creation.

## Best Practices

- **Keep names descriptive:** "Design Review" is better than "review-1".
- **Document the intent:** Use the description field to explain why the ceremony exists.
- **Use consistent trigger config:** If two ceremonies use the same GitHub event, use consistent filters (same label names, path patterns).
- **Version with your repo:** Export ceremonies as YAML and commit to `.squad/ceremonies/` for version control and onboarding.
- **Review ceremony changes:** Treat ceremony edits (trigger config, step logic) like code — they affect team workflow.
