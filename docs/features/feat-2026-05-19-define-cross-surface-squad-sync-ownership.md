# Feature: Define cross-surface Squad sync ownership

| Field | Value |
|-------|-------|
| **Feature ID** | `feat-2026-05-19-define-cross-surface-squad-sync-ownership` |
| **Created** | 2026-05-19 |
| **Layer** | Foundation |
| **Status** | Backlog |
| **Primary owner** | McManus |
| **Team** | McManus, Hockney, Kobayashi, Keyser, Kujan, Redfoot |

## Goal

Define and implement the source-of-truth contract for Squad/Squadboard sync across surfaces. Users need coherent behavior whether they start in Squadboard then switch to Copilot CLI/CLI clients, or start in Copilot/CLI and later add Squadboard. Cover missing agent governance files when starting from Squadboard, empty ceremonies defaults, whether the Squad SDK owns bootstrap/sync behavior, who owns actual runtime behavior, and what mechanism keeps filesystem, database, MCP, and client surfaces consistent.

## Schema Changes

May require explicit persisted sync/source-of-truth metadata for each project/team, including storage provider/mode and bootstrap status. Investigate before changing schema.

## API Changes

May require setup/sync/status endpoints that report source-of-truth mode, generated governance artifacts, ceremonies availability, and drift between Squadboard DB/MCP state and filesystem/client state.

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

- [ ] All work items implemented and committed to `main`
- [ ] Integration tests pass — Kujan sign-off
- [ ] README / docs updated — Redfoot sign-off
- [ ] Hacking-phase workflow followed (local git, worktrees, no PRs)

## Keyser frontend proposal — 2026-05-19

Backend support for a full sync-health panel is not present yet, so the frontend should not render a static or guessed status. The smallest honest visible path is a future **Settings → Sync status** section once Hockney exposes:

- `GET /api/projects/:projectId/squad-sync/status`
- `POST /api/projects/:projectId/squad-sync/repair`

The client contract is now drafted in `packages/client/src/api/squad.ts`. The status response must cover source of truth, storage mode/runtime, governance projection files present/missing, ceremonies defaults present/missing, drift detected, and repair availability.

Open backend dependency: return evidence-backed values only. If a surface is not measurable, return `unknown` with a message rather than letting the UI infer it.

## Open Questions

- Should governance repair create `.github/agents/squad.agent.md`, client-specific MCP files, or both?
- Should ceremony defaults be seeded from built-in bundles, SDK templates, or a dedicated server fixture?
