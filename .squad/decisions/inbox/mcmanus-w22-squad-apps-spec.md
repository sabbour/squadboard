# McManus W22 — Squad Apps Packaging Spec (F3)

**Author:** McManus (Lead Architect)  
**Wave:** 22  
**Stream:** F3  
**Date:** 2026-05-16  
**Deliverable:** `docs/squadapp-spec.md`

---

## Key Design Decisions

### D1 — Squad App format is a superset of the existing `squad-bundle.json`

The existing bundle format (`squad-bundle.json` in `bundles/`) becomes the **runtime representation** that Squadboard uses internally. The Squad App format (`squadapp.json`) is the **distribution format** — it adds `appId`, `tags`, `homepage`, `requires`, `seedIssues`, and a `README.md` on top of the bundle shape. The `bundle-loader.ts` idempotency contract is reused verbatim for the install pipeline.

### D2 — `appId` is kebab-case, scoped to a Squadboard instance (not a global registry)

Global uniqueness is F6's responsibility. For now, `appId` + `version` is the dedupe key within a project's installed-app registry. This avoids blocking F4 on F6 infrastructure.

### D3 — Two-tier versioning: `schemaVersion` (integer) + `version` (SemVer)

Mirrors the existing bundle schema pattern. `schemaVersion` only bumps on breaking format changes (rare). `version` is author-controlled content versioning. This is the same pattern already in `BundleManifest` — no new concepts introduced.

### D4 — File-based artifacts win over inline, but both are valid

Per-file layout (e.g., `skills/<key>/SKILL.md`, `ceremonies/<id>.yaml`) supports large bodies and git-diff-ability. Inline JSON is valid for small apps. The installer merges both; per-file takes precedence. This mirrors the existing `bodyPath` pattern in `bundle/schema.ts`.

### D5 — Skills use upstream SKILL.md format verbatim

Zero conversion cost. Skills from a Squad App are immediately usable by upstream Squad tooling. Upstream plugins (single SKILL.md files) are valid partial Squad Apps (skills-only subset). This secures F6 marketplace compatibility without a translation layer.

### D6 — Artifact creation order is fixed and dependency-ordered

`project → kanban → skills → tools → mcp → team → routing → ceremonies → workflows → seed issues`. This order prevents foreign-key violations and mirrors the existing `bundle-loader.ts` apply order. Seed issues are written outside the main DB transaction to avoid blocking on GitHub API rate limits.

### D7 — Default collision behavior is skip-with-warning (not fail, not overwrite)

Matches `bundle-loader.ts` existing contract (`ON CONFLICT: skip with a warning unless opts.overwriteExisting = true`). `--overwrite` opt-in, `--fail-on-conflict` for strict CI, `--dry-run` for preview. This is already what users expect from the built-in project templates.

### D8 — Seed issues are idempotent by `title + column` and never re-created on re-install

Prevents duplicate backlog pollution on re-install or upgrade. Even with `--overwrite`, seed issues are skipped if they already exist.

### D9 — MCP secrets are placeholders only (`${ENV_VAR}` syntax)

No secrets in bundles. Post-install, users configure actual values. This is a hard security requirement. Documented as OQ-8 for future secret-management integration.

### D10 — Rollback via DB transaction (except seed issues)

All writes are in a single transaction; any failure rolls back the project to pre-install state. Seed issues are outside the transaction (non-fatal on failure) to avoid blocking on external APIs.

---

## Examples Chosen

- **Example A (minimal):** `bug-repro-starter` — one skill + one ceremony. No project section; installs into current active project. Tests the partial-bundle path.
- **Example B (full):** `aks-feature-kanban` — 4 agents (Lead/Backend/Frontend/Tester), 3 ceremonies, 2 skills, 1 tool, 1 MCP server (GitHub), routing rules, 3 seed issues, README. Covers the F4 "AKS feature kanban" curated app that Hockney/Keyser will implement.

---

## Open Questions Deferred

| ID | Topic |
|---|---|
| OQ-1 | Global vs instance-scoped `appId` uniqueness (F6) |
| OQ-2 | Seed issues vs real GitHub issues (F5/GitHub sync) |
| OQ-3 | Schema publication location (F7) |
| OQ-4 | Multi-project install |
| OQ-5 | Seed issue column validation strictness |
| OQ-6 | Init Mode re-cast behavior |
| OQ-7 | SHA-256 checksum in tarball (F5) |
| OQ-8 | Secret management for MCP env vars (security review) |
| OQ-9 | Partial-bundle as first-class mode (already specced — yes) |
| OQ-10 | `--overwrite` diff preview for customised ceremonies |

---

## Downstream Impact

- **F4 (curated apps):** Can start immediately. Use `aks-feature-kanban` example B as the template for the first curated app.
- **F5 (unified import/export):** Adopt `squadapp.json` as the maximal bundle shape; partial bundles (single-artifact) are valid subsets.
- **F6 (marketplace):** `appId` + `version` is the dedupe key. Marketplace adds global uniqueness enforcement on top.
- **F7 (community):** CI validator uses the JSON Schema at `packages/server/src/services/squad-apps/schema.json`.
