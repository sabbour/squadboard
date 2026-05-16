/**
 * @sabbour/squadboard-sdk — bundle/schema.ts
 *
 * TypeScript type definitions for the Squadboard Bundle format.
 *
 * A bundle is a portable, self-describing artifact that captures an entire
 * project configuration: kanban columns, team charters, ceremonies,
 * workflows, skills, tools, MCP servers, and routing rules. It can be
 * applied to any Squadboard instance to reproduce the full setup
 * idempotently.
 *
 * FORMAT (hybrid):
 *   - Root manifest: `squad-bundle.json`
 *   - Large markdown bodies (> 4 KB) are split to
 *     `bundle/{section}/{id}.md` and referenced via a relative `bodyPath`
 *     field. Bodies ≤ 4 KB are inlined in the manifest JSON.
 *
 * VERSIONING:
 *   - `manifest.schemaVersion` (integer): bumped on breaking format changes.
 *   - `manifest.version` (semver string): content version, author-controlled.
 *
 * COMPATIBILITY:
 *   - Loaders MUST ignore unknown top-level sections (forward-compat).
 *   - Loaders SHOULD warn when `schemaVersion` is newer than supported.
 */
export {};
//# sourceMappingURL=schema.js.map