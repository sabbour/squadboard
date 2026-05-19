# Feature: Explain Squad App vs Project Template

| Field | Value |
|-------|-------|
| **Feature ID** | `feat-2026-05-19-explain-squad-app-vs-project-template` |
| **Created** | 2026-05-19 |
| **Layer** | Post-MVP |
| **Status** | Done |
| **Primary owner** | Redfoot |
| **Team** | Redfoot, Kujan |

## Goal

Clarify the conceptual and implementation difference between a Squad app and a project template, including where each lives, how each is created, how users should choose between them, and how they relate to project setup/scaffolding.

## Implementation Notes

Documentation/discovery item. Coordinate with McManus for product vocabulary and Kobayashi/Hockney for setup lifecycle details. Tie back to the current project-folder-structure bug so terminology and implementation stay aligned.

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
| **Scribe** (Commits) | Commit with message `feat: explain squad app vs project template` |

## Exit Criteria

- [x] All work items implemented and committed to `main`
- [x] Integration tests pass — Kujan sign-off (N/A for docs)
- [x] README / docs updated — Redfoot sign-off
- [x] Hacking-phase workflow followed (local git, worktrees, no PRs)

## Deliverables

Incorporated into: `docs/concepts/squad-apps-and-templates.md` — 340 lines
- Conceptual and implementation comparison: Squad App vs Template vs Plugin
- Clear table showing scope, versioning, marketplace-readiness differences
- Concrete when-to-use guidance with examples
- Links to `docs/squadapp-spec.md` for authoritative format spec
- Explains legacy starter-projects system for reference

## Open Questions

_None yet — add as implementation proceeds._
