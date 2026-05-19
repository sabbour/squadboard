# Feature: Document Squad Apps Implementation Map

| Field | Value |
|-------|-------|
| **Feature ID** | `feat-2026-05-19-document-squad-apps-implementation-map` |
| **Created** | 2026-05-19 |
| **Layer** | Post-MVP |
| **Status** | Done |
| **Primary owner** | Redfoot |
| **Team** | Redfoot, Kobayashi, Kujan |

## Goal

Create a clear backlog item to answer where Squad apps are implemented in the codebase, which packages/modules own them, how Squadboard discovers or runs them, and what code paths should be treated as canonical.

## Implementation Notes

Discovery/documentation item. Coordinate with McManus for architecture source of truth and Kobayashi for SDK/app integration details. Should produce a concise implementation map rather than new runtime behavior.

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
| **Scribe** (Commits) | Commit with message `feat: document squad apps implementation map` |

## Exit Criteria

- [x] All work items implemented and committed to `main`
- [x] Integration tests pass — Kujan sign-off (N/A for docs)
- [x] README / docs updated — Redfoot sign-off
- [x] Hacking-phase workflow followed (local git, worktrees, no PRs)

## Deliverables

Created: `docs/concepts/squad-apps-and-templates.md` — 340 lines
- Canonical reference for Squad Apps, project templates, team templates, and workflow templates
- Clear table comparing Squad App vs Template vs Plugin
- Implementation map showing canonical modules and files
- Discovery and runtime flow explained
- When-to-use guidance for each template type
- Common Q&A section
- Links to authoritative specs and related docs

## Open Questions

_None yet — add as implementation proceeds._
