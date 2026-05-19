# Feature: Common PostgreSQL Storage Provider

| Field | Value |
|-------|-------|
| **Feature ID** | `feat-2026-05-19-common-postgresql-storage-provider` |
| **Created** | 2026-05-19 |
| **Layer** | Foundation |
| **Status** | Backlog |
| **Primary owner** | Hockney |
| **Team** | Hockney, Kobayashi, Keyser, Kujan, Redfoot |

## Goal

Rename the current PGlite-specific Squad StorageProvider to a common PostgreSQL provider, configure Squadboard to use PostgreSQL as the default shared provider, and document how Squad CLI/Copilot can use the same state through either a compatible direct provider configuration or the Squadboard MCP broker.

## Schema Changes

Reuse existing squad_storage table; verify migrations and Drizzle schema are compatible with both PGlite and standalone PostgreSQL.

## API Changes

No new HTTP endpoints expected unless config/status surfacing already exists; preserve current SDK state service behavior while renaming/configuring provider selection.

## UI Changes

No UI required for this slice unless existing settings/storage docs surface provider names.

## Implementation Notes

Keep local-first defaults safe by using embedded PGlite-backed PostgreSQL by default and preserving explicit filesystem fallback. Rename PGliteStorageProvider to PostgreSQLStorageProvider conceptually and in public config/docs; support only the canonical `postgresql` value for explicit DB-backed storage and `fs` for fallback. Do not preserve a pglite compatibility alias; non-canonical values must remain filesystem-backed. Explain that external Squad CLI/Copilot need a compatible provider config or Squadboard MCP/API bridge to share the database.

## Specialist Assignments

| Specialist | Responsibility |
|------------|---------------|
| **Hockney** (Backend) | Schema migration, API endpoints, business logic |
| **Kobayashi** (SDK/Services) | Agent SDK integration, service layer, compiler |
| **Keyser** (Frontend) | React components, TanStack Query hooks, routing |
| **Verbal** (Real-time) | WebSocket events, live-feed updates |
| **Fenster** (UX) | Component design, dark-mode, empty states |
| **Kujan** (QA) | Integration tests, engine-invariant checks |
| **Redfoot** (Docs) | README sections, demo scripts, user-facing copy |
| **Scribe** (Commits) | Commit with message `feat: common postgresql storage provider` |

## Exit Criteria

- [ ] All work items implemented and committed to `main`
- [ ] Integration tests pass — Kujan sign-off
- [ ] README / docs updated — Redfoot sign-off
- [ ] Hacking-phase workflow followed (local git, worktrees, no PRs)

## Open Questions

_None yet — add as implementation proceeds._
