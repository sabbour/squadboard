# Squadboard Orchestration Log

Permanent record of deployment waves, specialist coordination, and team fanouts.

---

## Wave 8 (2026-05-15T18:08:24Z)

**Scope:** Conjure backend Phase 1 + non-tech governance.

**Specialists:**
1. **Hockney-7 (Conjure backend)** — `/api/conjure/classify` endpoint, hybrid rule+LLM classifier, 6 Phase 1 intents, graceful fallback. Commit: `feat(server): add /api/conjure/classify endpoint for intent routing` (SHA local, not pushed).
2. **McManus-7 (Non-tech charters + trim)** — Casting reference trimmed 20→17 universes (dropped Mad Men, Succession, Silicon Valley). Per-role charter templates added for 7 non-tech roles. Commits: `10f659bf`, `db12a997`.
3. **Fenster-5 (Conjure UX design)** — Design shipped as commit `96cebec1` without a separate decision file; referenced in orchestration log.

**Directives captured:**
- **Copilot (2026-05-15T18:00:22Z):** Drop upstream PRs to bradygaster/squad. Scope stays internal.
- **Copilot (2026-05-15T18:08:24Z):** UX consistency rules (project switcher preserves category, system menu at bottom, Fluent2 compliance) + 2 queued asks (MCP endpoints, diagnostics health check bug).

**Queued work:**
- Hockney: MCP server endpoints (Squadboard API as MCP) — after Conjure backend ships.
- Hockney: Diagnostics `.squad/` directory check bug — after Conjure backend ships.
- Keyser: Conjure frontend integration (modal, FAB rewire) — waits for Fenster design + Hockney backend.

**Status:** All deliverables local-only (hacking phase, no upstream push).

---

## Wave 9 (2026-05-15T18:20:52Z)

**Scope:** Keyser UI bundle — ceremonies padding, Consult width, project-switcher category preservation, sidebar reorder (System nav anchored to bottom), Reconnecting badge alignment + stale reconnect timer cancellation.

**Specialists:**
1. **Keyser-5 (Frontend UI)** — 5 commits in sequence: Fluent2 spacing canon (CeremonyList), Consult page width, project-switcher category preserve + System nav bottom-anchor, Reconnecting badge align + stale timer cancel. Commits: `8b3f7197`, `16414e90`, `d72fd8a7`, `5673d57b`.

**Conventions ratified:**
- **Project switcher preserves category.** When switching projects, route segment is preserved (`/projects/foo/board` → `/projects/bar/board`). New project-scoped segments must be added to `PROJECT_SCOPED_SEGMENTS` in `Layout.tsx`.
- **Fluent2 page padding canon.** Use both vertical and horizontal tokens explicitly; list scroll containers need padding; no single-axis token tricks.
- **Sidebar bottom-anchor.** Use `<div style={{ flex: 1 }} />` spacer in `NavDrawerBody` to pin SYSTEM menu to visual bottom. No CSS overrides needed.

**Root cause discovery:** Reconnecting badge + stale timer bug was **client-side state machine**, NOT server. No handoff to Hockney required.

**Status:** All deliverables local-only (hacking phase, no upstream push).

---

## Wave 10 (2026-05-15T18:27:32Z)

**Scope:** MCP Phase 1 starter tools + diagnostics path resolver.

**Specialists:**
1. **Hockney-8 (MCP + diagnostics)** — Extended `createMcpServer()` factory: +4 tools (`list_projects`, `list_inbox`, `capture`, `get_routing`), total now 11 across stdio + HTTP. Diagnostics false-negative bug fixed via `resolveSquadDir()` helper (tolerated `.squad/` vs `parent/.squad/` layouts). Commits: `85dd8780` (diagnostics), `1838253d` (MCP tools). README added at `packages/server/src/mcp/README.md`.

**Directives captured:**
- None new; Wave 8 queued asks now delivered.

**Status:** All deliverables local-only (hacking phase, no upstream push).

