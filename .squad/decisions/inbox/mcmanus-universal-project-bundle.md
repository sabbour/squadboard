# Decision: Universal Project Bundle (W15)

**Date:** 2026-05-15T22:42:29-07:00  
**Author:** McManus (Lead Architect)  
**Status:** Accepted — shipped in Wave 15  
**Closes todos:** `w15-universal-project-bundle`, `f5-unified-import-export`  

---

## Summary

Shipped a complete portable project-configuration bundle system: a TypeScript schema (SDK), an idempotent loader (server service), a CLI command, and a reference bundle proving the loop closes end-to-end.

---

## Decisions

### 1. File Format — Hybrid JSON + Optional Split Files

**Decision:** Root manifest is a single `squad-bundle.json` file. Large markdown bodies (charters, ceremony YAML) > 4 KB are split into `bundle/{section}/{id}.md` and referenced via a relative `bodyPath` field in the manifest. Bodies ≤ 4 KB are inlined in JSON.

**Rationale:** Single-file bundles are easy to share (URL, paste, drag-drop). Split files keep the manifest readable and avoid hitting JSON size limits for large charter sets. The loader transparently reads either form.

**Reference bundle:** `bundles/default-software-project/squad-bundle.json` (all-inline, < 4 KB per body — no split needed for this starter).

### 2. Schema Location — SDK Package

**Decision:** `SquadboardBundle` type lives at `packages/squadboard-sdk/src/bundle/schema.ts`, exported from the SDK root index and via the `@sabbour/squadboard-sdk/bundle` sub-path export.

**Rationale:** The schema is consumed by both the server (loader) and eventually client-side code (import/export UI). The SDK is the right seam for types shared across packages. The loader lives at `packages/server/src/services/bundle-loader.ts` — server-only, imports types from the SDK.

### 3. Idempotency Strategy — Skip-with-Warning by Default

**Decision:** When a named resource (agent, ceremony, skill, routing rule, etc.) already exists in the target project, the loader skips it and records a warning. Pass `overwriteExisting: true` to replace.

**Rationale:** Safe defaults for production use. Re-applying the same bundle multiple times (CI, template restore, demo reset) should not corrupt data. Explicit `--overwrite` flag gives power users full control.

### 4. Ceremonies/Workflows — Two-Table Insert

**Decision:** Ceremonies and workflows insert into `workflows` (metadata) AND `workflowVersions` (YAML content). Overwrite creates a new version row (monotonic version counter) and deactivates old ones.

**Rationale:** Matches existing route logic. Keeps the version history intact. The loader reuses the same schema contract as the UI.

### 5. Project Resolution

**Decision:** If `projectId` is not supplied to `applyBundle`, the loader looks up the project by name from `bundle.project.name` (or `bundle.manifest.name` as fallback). If no match, it creates a new project. If multiple matches, it uses the first.

**Rationale:** Bundles are frequently applied to fresh instances (no pre-existing project). Name-based lookup handles idempotent re-apply. Supplying `projectId` explicitly is the safe path for production restore flows.

---

## Open Questions

1. **Bundle signing / verification** — Should community bundles be signed (GPG, Sigstore)? Currently the loader trusts the JSON at face value. A signing layer would be needed before a public marketplace. Recommendation: defer to W18+ (marketplace UI wave).

2. **Versioning UI** — Should the Squadboard UI show which bundle version a project was bootstrapped from? Useful for "update available" notifications. Requires storing `bundleId` + `version` on the project row. Not done yet.

3. **Marketplace registry** — Beyond plain URL fetch, a curated registry (like npm for bundles) would enable discovery, ratings, version pinning. Out of scope for now; URL fetch is the MVP escape hatch.

4. **Bundle export action** — The inverse of apply: serialize a project's current config as a `squad-bundle.json`. Not implemented. Hockney's backup/restore work may overlap here.

---

## Next Steps

| Wave | Item | Owner |
|------|------|-------|
| **W16** | **Built-in project templates restore**: call `applyBundle(bundle, { projectId })` from the project templates page. Hockney needs to: (1) package the default bundle as a bundled asset, (2) wire it to the "Apply template" UI action, (3) handle the case where the project already has data (offer `overwriteExisting` toggle). `applyBundle` is ready for this. | Hockney |
| W17 | Bundle export action — serialize project config to `squad-bundle.json` | TBD |
| W18 | Marketplace UI — browse and apply community bundles by URL, with preview and one-click apply | Keyser |

---

## Key File Paths

| File | Purpose |
|------|---------|
| `packages/squadboard-sdk/src/bundle/schema.ts` | `SquadboardBundle` TypeScript type + all sub-types |
| `packages/squadboard-sdk/src/index.ts` | Re-exports all bundle types from SDK root |
| `packages/server/src/services/bundle-loader.ts` | `applyBundle()`, `loadBundle()`, per-section apply functions |
| `packages/server/src/cli/bundle.ts` | `squadboard bundle apply <path-or-url>` CLI command |
| `bundles/default-software-project/squad-bundle.json` | Reference bundle (5 columns, 4 agents, 3 ceremonies, 2 skills, 5 routing rules) |
| `bundles/default-software-project/README.md` | Smoke test procedure + bundle format reference |

---

## Hockney W16 Handoff Note

To wire `applyBundle` as the "project template" restore mechanism:

```typescript
import { loadBundle, applyBundle } from '../services/bundle-loader.js';

// Load the bundled default template (ship squad-bundle.json as a static asset under src/data/)
const { bundle, bundleDir } = await loadBundle('./data/bundles/default-software-project/squad-bundle.json');

// Apply into an existing (possibly empty) project
const result = await applyBundle(bundle, {
  projectId: existingProjectId,   // ← pass the target project id
  overwriteExisting: false,       // or true if the user confirmed "reset to template"
  bundleDir,
});
```

The returned `result.meta.projectId` is the project that was written to. `result.errors` is empty on clean apply.
