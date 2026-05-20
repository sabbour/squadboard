## W22 Lesson — Squad Apps Spec Delivery

**Date:** 2026-05-16  
**Wave:** 22

Squad Apps spec authored (docs/squadapp-spec.md, 1100 lines) — anchors Stream F (F4 curated apps, F5 import/export, F6 marketplace).

**Key patterns from this work:**
1. **Distribution format as superset of runtime format.** Existing `squad-bundle.json` becomes the runtime representation; new `squadapp.json` adds appId, tags, homepage, requires, seedIssues, README on top. Reuse existing idempotency patterns.

2. **Design for downstream clarity.** Define 10 open questions (OQ-1 through OQ-10) as *deferred* to later streams, not blockers. F4 can start immediately on curated apps; F5/F6 address registry, secrets, and schema discovery without blocking F4.

3. **Fixed artifact creation order prevents foreign-key violations.** Order: project → kanban → skills → tools → mcp → team → routing → ceremonies → workflows → seed issues. This mirrors existing bundle-loader patterns.

4. **Collision handling: skip-with-warning default.** Matches user expectations from built-in templates. Provide `--overwrite`, `--fail-on-conflict`, and `--dry-run` opts for CI flexibility.

5. **Document with worked examples.** Two examples: minimal (bug-repro-starter: one skill + ceremony) and full (aks-feature-kanban: 4 agents, 3 ceremonies, 2 skills, 1 tool, 1 MCP, routing, seed issues). Concrete enough for F4 to copy-paste immediately.

**Downstream:** F5 will adopt squadapp as maximal bundle shape; F6 adds global registry on top; F7 uses JSON schema for CI validation. All three can proceed in parallel.

---

## W24 Close-Out

**Date:** 2026-05-16  
**Status:** Completed

### Summary

McManus delivered F5 — spec gap fixes + schema updates (commit ffdd71cb). Work was completed on disk, but agent session cleared before commit. Coordinator executed orphan-commit pass with proper co-author attribution.

### Lineage

- **Todo:** f5-spec-gaps
- **Commit:** ffdd71cb
- **Pattern:** Orphan completion (silent success / agent runtime eviction)

### Notes

Part of the three-agent L/F pattern in W24. All three (Hockney/Kobayashi/McManus) completed work before session eviction, and coordinator handled uniformly.

---

## Learnings

### 2026-05-19T14:47:51.758-07:00 — Squad ↔ Squadboard two-way sync status

- Produced architecture report `.squad/reports/two-way-sync-status.md`.
- Key architecture call: do not describe PostgreSQL-backed `.squad` state as continuous two-way sync. Current behavior is mode authority: filesystem mode owns real `.squad/`; PostgreSQL mode owns `squad_storage` after first filesystem import; external clients use hosted PostgreSQL or the Squadboard MCP/API broker.
- Key dogfood call: make `captureDirective()` / `POST /api/inbox/directive-captures` the single coordinator seam for directive markdown, DB inbox, MCP capture, and close-out status.
- Hot lanes to avoid duplicating: Kobayashi owns cast agents staying active; Kujan owns retired-agent and project-root structure regression sign-off; Hockney owns PGlite `issue_runs` repair and storage launch wiring.
- Validation evidence: focused server suite for agent-sync, project structure, directive capture, PostgreSQL provider, and PGlite run-claim/catalog repair passed 97 tests.

### 2026-05-19T21:56:17Z — Two-Way Sync Architecture Review + Audit Skill Delivery

Completed architecture-level review of backlog ↔ board sync, MCP capture, decision flow, and storage provider unification.

**Deliverables:**
1. **Sync Status Report** — Reviewed all sync layers; recommended directive capture as single dogfood seam; mode-authoritative `.squad` filesystem strategy.
2. **Reusable Audit Skill** — Structured checklist for future two-way sync audits; generalizable across teams.
3. **Validation Artifacts** — Audit confirmed no circular dependencies; directive flow is clean; no product code required for this audit.

**Recommendations Recorded:**
- Treat `.squad` filesystem as mode-authoritative; board as eventual consumer
- Avoid continuous two-way sync overhead; adopt directive capture as standard feature intake seam
- Use `captureDirective()` / `POST /api/inbox/directive-captures` for unified coordinator routing

**Test Results:** Focused server suite (7 files, 97 tests) passed; markdown formatting clean; git diff --check passed.

**Key Learning:** Architecture reviews thrive when treating decision flow (not just code flow) as first-class. Dogfood seam identification prevents infinite sync rathole.

---

### 2026-05-19 — Cross-Surface Squad Sync Authority Contract

Authored the foundational architecture contract for cross-surface Squad management: **mode-based authority** (filesystem vs. database), **explicit bootstrap/projection**, and **drift detection**.

**Deliverables:**
1. **Architecture document** — `docs/setup/cross-surface-squad-sync-contract.md` (20KB)
   - Two start paths (Squadboard-first, CLI-first) with explicit flows
   - Storage mode semantics: `fs` (filesystem authority) vs. `postgresql` (database authority)
   - Bootstrap is one-time import (idempotent); projection is repeatable generation
   - Client artifacts (`.github/agents/squad.agent.md`, ceremonies defaults) are generated projections
   - Drift detection via explicit API: `GET /api/projects/:id/sync/status`
   - Four repair endpoints for user-initiated sync

2. **Decision record** — `.squad/decisions/inbox/mcmanus-cross-surface-sync-contract.md`
   - Ownership matrix for each component
   - Specialist assignments (Hockney, Kobayashi, Keyser, Kujan, Redfoot)
   - API contract, implementation checklist, migration path for existing projects

3. **Key insights:**
   - SDK is passive (provides storage backends); application decides authority
   - No continuous two-way mirroring; explicit seams prevent silent divergence
   - Ceremonies are never empty; defaults seeded on bootstrap
   - Users choose storage mode at creation; one authority per project lifetime
   - Retroactive projects default to `fs` mode (safe); offer upgrade to `postgresql` on opt-in

**Ownership clarification:**
- Squadboard generates client artifacts, not imports them
- Storage mode determines where `.squad/` is truth
- Sync is orchestrated by application (four explicit API endpoints), not SDK
- CLI defaults to filesystem; Squadboard defaults to database

**Next steps for specialists:**
- Hockney: Schema migration + API endpoints
- Kobayashi: SDK documentation + bootstrap integration tests
- Keyser: Team Sync settings panel
- Kujan: Regression tests across both start paths
- Redfoot: User-facing setup guide + linked docs

---

## 2026-05-20T01:35:26Z — Cross-Surface Interchangeability Directive

**Status:** Decision capture and team coordination

User directive (Ahmed): **Squadboard and CLI/Copilot modes are interchangeable. A user can start with either client and continue in the other.**

Produced two related decisions:
1. **mcmanus-cross-surface-authority.md** — Authority and sync model permitting both surfaces as equal entry points
2. **mcmanus-cross-surface-sync-contract.md** — Sync authority and bootstrap contract (existing, now cited in context of interchangeability)

Kobayashi simultaneously authored SDK/client artifact contract to support this directive.

**Key insight:** Previous mode-authority rule remains, but interchangeability requires both clients to read and write through the same active authority for each project. No surface is first-class; both are co-equal.

### 2026-05-20 — Deep Architecture & Dead Code Review

Full codebase audit (467 TS files, 250 production source files) across all 8 packages.

**Key Findings:**
- 17 dead-code items identified (11 high-confidence server files, 4 client, 2 low-priority)
- 8 architecture issues (Electron broken main/renderer, layering violations, shutdown races)
- 11 security gaps — top 2 critical: WebSocket auth bypass and non-atomic workflow advancement
- 6 documentation gaps — 3 published packages missing README entirely

**Top 5 Recommendations:**
1. Fix WS auth bypass (unauthenticated realtime access)
2. Add DB transactions to workflow runner + sweeper (race conditions corrupt state)
3. Delete ~1500 lines dead code (dispatcher, hook-pipeline, irl-gallery, user-paths, etc.)
4. Fix Electron main entry + renderer stub (ships broken)
5. Add input validation + path containment (Zod on routes, realpath checks)

**Patterns learned:**
- Dead code clusters around superseded subsystems (Phase 3 dispatcher, IRL gallery, hook pipeline). Each had a replacement but the old code was never cleaned up.
- Security gaps cluster at boundary crossings: HTTP↔WS, service↔filesystem, and where the single-token auth model meets multi-surface (CLI/Electron/web) access.
- Race conditions are concentrated in the engine layer where multi-step DB operations lack transactions.
- The Electron package is architecturally incomplete — README claims client embedding but the renderer is a health-check stub.

**Deliverable:** `.squad/decisions/inbox/mcmanus-deep-review-architecture.md`
