# Feature: Define cross-surface Squad sync ownership

| Field | Value |
|-------|-------|
| **Feature ID** | `feat-2026-05-19-define-cross-surface-squad-sync-ownership` |
| **Created** | 2026-05-19 |
| **Layer** | Foundation |
| **Status** | In Progress |
| **Primary owner** | McManus |
| **Team** | McManus, Hockney, Kobayashi, Keyser, Kujan, Redfoot |

## Goal

Define and implement the source-of-truth contract for Squad/Squadboard sync across surfaces. Users need coherent behavior whether they start in Squadboard then switch to Copilot CLI/CLI clients, or start in Copilot/CLI and later add Squadboard. Cover missing agent governance files when starting from Squadboard, empty ceremonies defaults, whether the Squad SDK owns bootstrap/sync behavior, who owns actual runtime behavior, and what mechanism keeps filesystem, database, MCP, and client surfaces consistent.

## Schema Changes

May require explicit persisted sync/source-of-truth metadata for each project/team, including storage provider/mode and bootstrap status. Investigate before changing schema.

## API Changes

Use the project-scoped `/api/projects/:projectId/squad-sync/...` namespace for sync endpoints that report source-of-truth mode, generated governance artifacts, ceremonies availability, and drift between Squadboard DB/MCP state and filesystem/client state.

## UI Changes

May require a project sync/status panel explaining source of truth, bootstrap health, missing files, ceremonies status, and repair actions.

## Implementation Notes

Key questions: If a project starts in Squadboard, should Squadboard generate `.github/agents/squad.agent.md` or equivalent client-specific agent files? Should default ceremonies be seeded instead of empty? What should the Squad SDK own: canonical team state, bootstrap projection, or runtime behavior? If a project starts in Copilot/CLI and later adds Squadboard, does filesystem `.squad/` remain authoritative or does Squadboard import then own state? Define explicit modes and one repair/sync command rather than implicit partial mirroring. Tie to existing `.squad/reports/two-way-sync-status.md` findings.

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
| **Scribe** (Commits) | Commit with message `feat: define cross-surface squad sync ownership` |

## Exit Criteria

- [x] SDK contract (`sync-ownership.ts`) implemented and committed — defines authority, storage modes, artifact specs
- [x] Client API types (`squad.ts`) implemented — hooks `useSquadSyncStatus()` and `useRepairSquadSync()` ready
- [x] Namespace decision locked (`/api/projects/:projectId/squad-sync/...`)
- [x] Contract doc updated (`cross-surface-squad-sync-contract.md`) with source-of-truth modes and projection artifacts
- [x] Implementation plan updated with finalized API routes, test specs, and ceremony invariants
- [ ] Backend API endpoints (`packages/server/src/routes/squad-sync.ts`) — Hockney implementation pending
- [ ] UI components and integration tests — Keyser & Kujan implementation pending
- [ ] README section on cross-surface sync — Redfoot sign-off
- [ ] Hacking-phase workflow followed (local git, worktrees, no PRs)

## Keyser frontend proposal — 2026-05-19

Backend support for a full sync-health panel is not present yet, so the frontend should not render a static or guessed status. The smallest honest visible path is a future **Settings → Sync status** section once Hockney exposes:

- `GET /api/projects/:projectId/squad-sync/status`
- `POST /api/projects/:projectId/squad-sync/repair`

The client contract is now drafted in `packages/client/src/api/squad.ts`. The status response must cover source of truth, storage mode/runtime, governance projection files present/missing, ceremonies defaults present/missing, drift detected, and repair availability.

Namespace decision: `squad-sync` is the canonical resource segment. It matches existing project-resource route conventions and avoids overloading generic sync or GitHub sync terminology.

Open backend dependency: return evidence-backed values only. If a surface is not measurable, return `unknown` with a message rather than letting the UI infer it.

## Open Questions

- Should governance repair create `.github/agents/squad.agent.md`, client-specific MCP files, or both?
- Should ceremony defaults be seeded from built-in bundles, SDK templates, or a dedicated server fixture?

## Implementation Status (2026-05-20)

### Completed

**McManus — Architecture & SDK contract:**
- Locked source-of-truth modes: `fs` (filesystem authority) and `postgresql` (database authority)
- Defined artifact specs: `.squad/`, `.github/agents/squad.agent.md`, `.squad/ceremonies.md`, and projection presence checks
- Documented repair actions and bootstrap idempotency semantics
- Decision file: `docs/setup/cross-surface-squad-sync-contract.md`

**Kobayashi — SDK Implementation:**
- Implemented `packages/server/src/sdk/sync-ownership.ts` — Pure, schema-free SDK contract for ownership analysis
- Defines `SquadSyncStorageContract`, `SquadSyncOwnershipStatus`, and repair action types
- Exports contract version and core ownership functions
- Ceremony defaults marked as required (not recommended) — missing or empty ceremonies are health warnings

**Keyser — Frontend Contract:**
- Defined client API types in `packages/client/src/api/squad.ts`
- Implemented `useSquadSyncStatus()` hook for polling status
- Implemented `useRepairSquadSync()` mutation for repair actions
- Namespaced under `/api/projects/:projectId/squad-sync` with clear TypeScript envelopes
- Comment: "intentionally not consumed by visible UI until Hockney lands it" — ready for backend

**Redfoot — Documentation:**
- Updated contract doc with full bootstrap/projection semantics
- Updated implementation plan with finalized API routes and test specs
- Updated this feature doc with exact criteria
- Added cross-surface sync section to README (coming)

### Pending

**Hockney — Backend API Routes:**
- `packages/server/src/routes/squad-sync.ts` — not yet created
- `/api/projects/:projectId/squad-sync/status` — drift detection report
- `/api/projects/:projectId/squad-sync/project-squad-to-fs` — DB → filesystem projection
- `/api/projects/:projectId/squad-sync/generate-github-agent` — render and push agent file
- `/api/projects/:projectId/squad-sync/repair` — user-initiated repair actions
- Schema migration: `projects.storage_provider_mode` column
- Tests: 5 integration test files per implementation plan

**Keyser + Fenster — Frontend UI:**
- Project Settings → Team Sync panel
- Drift display with per-surface repair buttons
- Bootstrap status badge and refresh controls
- Create/import workflows that offer sync mode selection

**Kujan — QA:**
- End-to-end tests: Squadboard-first → CLI switch, CLI-first → Squadboard switch
- Drift detection verification
- Ceremony preservation across modes
- Repair action idempotency
