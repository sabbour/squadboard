# Feature: Cross-surface Squad state authority and sync

| Field | Value |
|-------|-------|
| **Feature ID** | `feat-2026-05-20-cross-surface-squad-state-authority-and-sync` |
| **Created** | 2026-05-20 |
| **Layer** | Foundation |
| **Status** | In Progress |
| **Primary owner** | Kobayashi |
| **Team** | Kobayashi, Hockney, Keyser, Fenster, Kujan, Redfoot |

## Goal

Define and implement how Squad state stays usable and consistent when a project starts in Squadboard and later opens in CLI/Copilot, or starts in CLI/Copilot and later gets added to Squadboard. Today, Squadboard-first projects may have no .github/agents/squad.agent.md / agent.md entrypoint for Copilot clients, ceremonies can be empty, and CLI-first projects raise the opposite question: whether filesystem .squad, Squadboard's database, the Squad SDK, or generated agent files own the actual behavior. The outcome must make the source of truth explicit, keep both surfaces in sync, and ensure users never lose Squad behavior when moving between clients.

## Core Requirement

Squadboard and CLI/Copilot modes are interchangeable. A user can start with either client and continue working in the other without losing Squad behavior, agent identity, ceremonies, backlog context, decisions, or sync authority. This is the acceptance bar: no client is a secondary import/export viewer, and neither surface may depend on a one-time handoff to remain correct.

## Schema Changes

Likely extend project/squad storage metadata with state authority, sync mode, generated-client-artifact status, last sync timestamps/checksums, and diagnostics for filesystem vs DB divergence.

## API Changes

Expose sync/status operations that can hydrate missing CLI/Copilot artifacts from canonical Squad state, import existing .squad state into Squadboard, report drift, and run a safe reconcile operation.

## UI Changes

Add project-level sync/status UX showing the active source of truth, missing artifacts (agent.md, ceremonies, generated client files), last sync result, and guided actions to repair or export.

## Implementation Notes

McManus owns source-of-truth decision; Kobayashi owns SDK/client artifact contract; Hockney owns durable storage/sync metadata; Kujan must add bidirectional scenario coverage. Use existing two-way-sync-audit skill. Do not call one-time import 'two-way sync' unless reverse/export/status paths exist. Every design must prove both start orders: Squadboard-first → CLI/Copilot continuation, and CLI/Copilot-first → Squadboard continuation.

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
| **Scribe** (Commits) | Commit with message `feat: cross-surface squad state authority and sync` |

## Exit Criteria

- [x] SDK contract defines authority, modes, bootstrap, projection, and repair semantics (feat-2026-05-19)
- [x] SDK projection/API DTO contract covers Squadboard-first and CLI/Copilot-first start orders
- [x] Client API contract ready for backend implementation (squad.ts)
- [x] Source-of-truth modes locked and documented
- [ ] Backend API endpoints fully operational (Hockney implementation)
- [ ] CLI-first import workflow enhanced to offer mode selection (Hockney + Keyser)
- [ ] Squadboard-first project bootstrap seeded with ceremony defaults (Hockney)
- [ ] Sync status UI and repair panel live (Keyser + Fenster)
- [ ] All integration tests passing (Kujan)
- [ ] README section live documenting both start paths (Redfoot)
- [ ] Feature closed after ship verification

## Implementation Notes

Deliverable is truthfully split across two waves:
1. **Wave 18–19 (Completed):** Source-of-truth decision, SDK contract, client types, namespace decision, comprehensive docs.
2. **Wave 20+ (Pending):** Backend routes, UI, end-to-end tests, README section.

Do not call this "two-way sync" until both directions (Squadboard-first → CLI continuation AND CLI-first → Squadboard continuation) are working end-to-end with tests. Use precise language: "mode-based authority" and "projection/repair on demand" rather than "continuous mirroring."

## Open Questions

_None yet — add as implementation proceeds._
