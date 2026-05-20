# Feature: Live run monitoring console

| Field | Value |
|-------|-------|
| **Feature ID** | `feat-2026-05-20-live-run-monitoring-console` |
| **Created** | 2026-05-20 |
| **Layer** | Board UI |
| **Status** | Backlog |
| **Primary owner** | Keyser |
| **Team** | Keyser, Kobayashi, Kujan, Redfoot |

## Goal

Improve the run viewer so users can understand an agent or workflow run while it is happening, not just inspect a collapsed log after failure. The UI should show active status, agent/step identity, elapsed time, cost/workspace metadata, streamed timeline/log events, recovery/restart markers, errors, and outputs/flow context across running, failed, completed, and empty states.

## Schema Changes

Prefer existing run/event tables first. Add fields only if Hockney finds the current event contract cannot expose timestamps, recovery markers, status transitions, cost, workspace, or output metadata safely.

## API Changes

Use existing live run stream/endpoints if sufficient; otherwise add small run-event contract extensions with focused server tests.

## UI Changes

Update LiveRunViewer/RunHistory and related run components/hooks to render a high-signal live console with timeline, metrics, streamed event rows, recovery/error treatment, and preserved Outputs/Flow inspection.

## Implementation Notes

Dogfood request from Ahmed with screenshot showing the current Runs tab as too sparse: a failed Kujan run only shows a dark log card with '[auto-dispatched by pickup-ready sweep]' and '[recovered: server restarted]'. Keep local hacking workflow: no PR/push, commit focused changes with tests.

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
| **Scribe** (Commits) | Commit with message `feat: live run monitoring console` |

## Exit Criteria

- [ ] All work items implemented and committed to `main`
- [ ] Integration tests pass — Kujan sign-off
- [ ] README / docs updated — Redfoot sign-off
- [ ] Hacking-phase workflow followed (local git, worktrees, no PRs)

## Open Questions

_None yet — add as implementation proceeds._
