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
