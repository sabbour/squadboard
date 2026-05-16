# Default Software Project Bundle

A curated Squadboard starter for software teams. Provides a complete project configuration — kanban columns, team skeletons, ceremonies, skills, and routing rules — that can be applied to any Squadboard instance in a single command.

---

## What's in the Box

| Section | Contents |
|---------|----------|
| **Kanban** | 5 columns: Inbox → Triaged → In Progress → Review → Done |
| **Team** | 4 role skeletons: Lead, Backend, Frontend, Tester |
| **Ceremonies** | Simple Review, Bug Fix, RFC |
| **Skills** | `git-workflow`, `tdd-loop` |
| **Tools** | *(placeholder — add your own)* |
| **MCP Servers** | *(placeholder — add your own)* |
| **Routing** | 5 rules: bug→Tester, feature→Lead, frontend→Frontend, backend→Backend, catchall→Lead |

> **Init Mode note:** Agent names in this bundle are generic role skeletons (Lead, Backend, Frontend, Tester). When you apply the bundle via the Squadboard UI's "New Project" wizard, Init Mode will re-cast them with project-specific names and custom charters. The bundle just provides the role and charter skeleton.

---

## Applying the Bundle

### Via CLI

```bash
# From the repo root — apply against a fresh PGlite instance
npx tsx packages/server/src/cli/bundle.ts apply \
  bundles/default-software-project/squad-bundle.json

# Dry run — see what would be created without writing anything
npx tsx packages/server/src/cli/bundle.ts apply \
  bundles/default-software-project/squad-bundle.json \
  --dry-run

# Apply into an existing project
npx tsx packages/server/src/cli/bundle.ts apply \
  bundles/default-software-project/squad-bundle.json \
  --project-id <uuid>

# Apply from a URL (community bundle)
npx tsx packages/server/src/cli/bundle.ts apply \
  https://example.com/bundles/my-team/squad-bundle.json

# Overwrite existing resources (default: skip on conflict)
npx tsx packages/server/src/cli/bundle.ts apply \
  bundles/default-software-project/squad-bundle.json \
  --overwrite
```

### Via the `applyBundle` API (programmatic)

```typescript
import { loadBundle, applyBundle } from './packages/server/src/services/bundle-loader.js';

const { bundle, bundleDir } = await loadBundle('./bundles/default-software-project/squad-bundle.json');
const result = await applyBundle(bundle, { dryRun: false, overwriteExisting: false, bundleDir });

console.log('Applied:', result.applied);
console.log('Skipped:', result.skipped);
console.log('Warnings:', result.warnings);
console.log('Errors:', result.errors);
```

---

## End-to-End Smoke Test (Manual)

This procedure verifies that the bundle loader closes the loop end-to-end: bundle JSON → PGlite → running server → visible in the UI.

### Prerequisites

- Node.js 20+ and `pnpm` installed
- Repo checked out at repo root

### Steps

**Step 1 — Start the server against a fresh PGlite instance**

```bash
cd <repo-root>
pnpm --filter @sabbour/squadboard-server dev
```

Wait for `Squadboard server running on http://localhost:3000` (or whichever port your `.env` configures).

**Step 2 — Apply the bundle via CLI**

In a second terminal:

```bash
cd <repo-root>
npx tsx packages/server/src/cli/bundle.ts apply \
  bundles/default-software-project/squad-bundle.json
```

Expected output:

```
Applying bundle "Default Software Project" v1.0.0

✅ Applied:
  • project:<uuid> ("Default Software Project" created)
  • kanban: column "Inbox" (slug=inbox)
  • kanban: column "Triaged" (slug=triaged)
  • kanban: column "In Progress" (slug=in-progress)
  • kanban: column "Review" (slug=review)
  • kanban: column "Done" (slug=done)
  • team: agent "Lead" created (role=Lead Architect)
  • team: agent "Backend" created (role=Backend Engineer)
  • team: agent "Frontend" created (role=Frontend Engineer)
  • team: agent "Tester" created (role=QA Engineer)
  • ceremony: "Simple Review" created
  • ceremony: "Bug Fix" created
  • ceremony: "RFC" created
  • skill: "git-workflow" created
  • skill: "tdd-loop" created
  • routing: rule "bug" → Tester
  • routing: rule "feature" → Lead
  • routing: rule "frontend" → Frontend
  • routing: rule "backend" → Backend
  • routing: rule "catchall" → Lead

Done (project <uuid>): 20 applied, 0 skipped, 0 warnings, 0 errors.
```

**Step 3 — Verify in the UI**

Open `http://localhost:3000` in a browser and confirm:

| What to check | Where |
|---------------|-------|
| Board shows 5 columns (Inbox, Triaged, In Progress, Review, Done) | Board / Kanban view |
| New issues default to the **Inbox** column | Create an issue, check it lands in Inbox |
| Team page shows 4 agents: Lead, Backend, Frontend, Tester | Team tab |
| Ceremonies page shows: Simple Review, Bug Fix, RFC | Templates / Ceremonies tab |
| Skills page shows: git-workflow, tdd-loop | Skills tab |
| Routing rules show 5 rules (bug→Tester, feature→Lead, …) | Routing tab |

**Step 4 — Idempotency check**

Apply the bundle a second time **without** `--overwrite`:

```bash
npx tsx packages/server/src/cli/bundle.ts apply \
  bundles/default-software-project/squad-bundle.json
```

Expected: all rows in the **Skipped** list, zero errors, no duplicate rows in the UI.

**Step 5 — Dry-run check**

```bash
npx tsx packages/server/src/cli/bundle.ts apply \
  bundles/default-software-project/squad-bundle.json \
  --dry-run
```

Expected: output shows "(would create)" or "(would update)" for all items, nothing appears or changes in the running server.

---

## Bundle Format Reference

See [`packages/squadboard-sdk/src/bundle/schema.ts`](../../packages/squadboard-sdk/src/bundle/schema.ts) for the full `SquadboardBundle` TypeScript type.

### Top-level sections

```json
{
  "manifest": { "bundleId", "name", "version", "description", "schemaVersion": 1 },
  "project":   { "name", "description", "icon" },
  "kanban":    { "columns": [...], "defaultColumn": "inbox" },
  "team":      [...],
  "ceremonies": [...],
  "workflows": [...],
  "skills":    [...],
  "tools":     [...],
  "mcpServers": [...],
  "routing":   [...]
}
```

### Large markdown bodies

Charter or workflow bodies > 4 KB should be split into separate files:

```
bundles/my-bundle/
  squad-bundle.json         ← root manifest
  bundle/
    team/
      lead.md               ← charter body (referenced via charterPath)
    ceremonies/
      complex-flow.yaml     ← ceremony YAML (referenced via bodyPath)
```

Reference them in the manifest:

```json
{ "name": "Lead", "role": "Lead Architect", "charterPath": "bundle/team/lead.md" }
{ "id": "complex-flow", "bodyPath": "bundle/ceremonies/complex-flow.yaml" }
```

---

## Customising This Bundle

1. Copy `bundles/default-software-project/` to `bundles/my-project/`
2. Edit `squad-bundle.json` — change `manifest.bundleId`, `manifest.name`, and sections as needed
3. Apply with `npx tsx packages/server/src/cli/bundle.ts apply bundles/my-project/squad-bundle.json`

---

## Roadmap

| Wave | Item | Owner |
|------|------|-------|
| W16 | Built-in project templates restore (call `applyBundle` from Hockney's template system) | Hockney |
| W17 | Bundle export action (export current project config as a downloadable bundle) | TBD |
| W18 | Marketplace UI (browse and apply community bundles by URL) | Keyser |
