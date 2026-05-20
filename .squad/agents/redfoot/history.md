## Wave 20 — Docs Simplification & Terminology Cleanup (2026-05-20T23:59:00-07:00)

**Scope:** Remove project-specific language ("Spark") from docs, ensure consistent Squad Apps terminology, verify no screenshots, and validate docs build.

### Deliverables Shipped

1. **Getting-Started Index Updated** — Removed "Spark" from descriptions and page titles
   - Changed "follow the Spark tutorials" to "follow tutorials to master the workflow board"
   - Made learning path and project references generic, but kept instructional clarity

2. **Tutorials Refactored to Generic Project Names**
   - Tutorial 1 (connect-spark → create-project): "Create your project" instead of "Connect Spark"
   - Tutorial 2 (cast-the-team): Generic "your project" language
   - Tutorial 3 (run-the-launch-wave → run-a-workflow): Generic workflow framing
   - Tutorial 4 (connect-tools): Generic project + tool reference
   - All tutorials still use concrete example project names in instructions (e.g., "MyProject"), but descriptions no longer frame Spark as the primary use case

3. **Quickstart Refactored** — Made example more generic
   - Removed "Create the Spark project" framing
   - Changed to "Create your first project"
   - Updated ceremony reference to "default launch-review ceremony" instead of "Spark Launch Review"

4. **Documentation Validation**
   - Verified no embedded screenshots in docs-site (only logo/social-card static assets remain)
   - Confirmed "Squad Apps" terminology used consistently throughout
   - Cost model already uses "ai_credits" (GitHub AI Credits) — no changes needed
   - Docs build passes: `pnpm docs:build` succeeds with 41 pages compiled

5. **Structure Verified**
   - Squad Apps guide (squad-apps.mdx) properly distinguishes Squad Apps from templates
   - Storage/sync documentation (storage-provider.mdx) already provides detailed sync guidance
   - README.md points to correct docs paths without over-emphasizing Spark
   - Terminology consistency verified across all user-guide pages

### Learning

- **Avoid product example names in headings/descriptions**, even if they're helpful in walkthroughs. Use generic "project" language in meta (title, description) but concrete example names in step-by-step instructions. This prevents docs from seeming project-specific while keeping walkthrough clarity.
- **Docs build should be a gate**. Ran `pnpm docs:build` after changes to catch issues early. No broken links or rendering errors appeared.
- **The three-way split matters**: Templates (save local state) vs. Squad Apps (full portable package) vs. upstream Squad plugins (shared skills). Docs already explain this well in the comparison table.

### No Further Docs Added

- **E2E testing guide**: Tutorials already cover end-to-end workflow validation (Tutorial 3). No separate test suite docs needed for docs-site.
- **Release/Publish guide**: `docs/RELEASE-READINESS.md` already covers pre-release checklist. Consider surfacing in docs-site if external teams will publish Squad Apps, but not blocking for current scope.
- **Sync guide**: `storage-provider.mdx` already provides comprehensive sync guidance (four configuration recipes, storage boundary explanation). No collapse needed.

### Next Steps

- Monitor user feedback on whether generic project references feel less welcoming
- Consider adding a "Squad App showcase" index if many Apps emerge
- Revisit E2E testing docs only if users report test coverage gaps

## Wave 19 — Cross-Surface Squad Sync: SDK Contract & Client API (2026-05-20T22:00:00-07:00)

**Scope:** Define and document cross-surface Squad state authority, storage modes, bootstrap semantics, artifact projection, and repair contract. No user-facing API endpoints yet (pending Hockney backend implementation).

### Deliverables Shipped

1. **SDK Sync Ownership Contract** — `packages/server/src/sdk/sync-ownership.ts` (~250 lines)
   - Pure, schema-free contract for authority analysis
   - Defines `SquadSyncStorageContract` (postgresql | filesystem modes)
   - Exports `SquadSyncOwnershipStatus` with bootstrap, projection, surfaces, and repair actions
   - Ceremony defaults marked as **required**, not recommended
   - Ready for backend API consumption; tests pass

2. **Client API Contract** — `packages/client/src/api/squad.ts` (~200 lines updates)
   - TypeScript types for `SquadSyncStatus`, `SquadSyncFileCheck`, drift detection
   - React hooks: `useSquadSyncStatus()` (polling), `useRepairSquadSync()` (mutations)
   - Namespaced under `/api/projects/:projectId/squad-sync`
   - Comment: "intentionally not consumed by visible UI until Hockney lands it"
   - Envelope pattern with `ok: boolean` and structured error handling

3. **Architectural Contract Doc** — `docs/setup/cross-surface-squad-sync-contract.md` (complete)
   - Source-of-truth modes: `fs` (filesystem authority) and `postgresql` (database authority)
   - Bootstrap semantics: one-time import from filesystem on first DB write
   - Projection semantics: `.squad/`, `.github/agents/squad.agent.md`, ceremony defaults generated from authority
   - Drift detection: how to identify when surfaces diverge
   - Startup flows: Squadboard-first vs. CLI-first with examples
   - API namespace decision locked: `/api/projects/:projectId/squad-sync/...`

4. **Implementation Plan Updated** — `docs/setup/cross-surface-sync-implementation-plan.md` (finalized)
   - All API routes defined with pseudo-code and test specs
   - Hockney tasks (H1–H6): schema migration, status endpoint, projection, agent generation, repair
   - Keyser + Fenster tasks (K1–K4): UI components, import workflow, settings panel
   - Kujan tasks (Q1–Q3): end-to-end tests, scenario coverage
   - Ceremony invariant locked: `.squad/ceremonies.md` required; empty ceremonies are health warnings

5. **Feature Docs Updated**
   - `feat-2026-05-19-define-cross-surface-squad-sync-ownership.md` → Status: "In Progress" with implementation status section
   - `feat-2026-05-20-cross-surface-squad-state-authority-and-sync.md` → Status: "In Progress" with split-wave notes

6. **README Section Added** — New "Cross-Surface Squad Sync" section
   - User-facing promise: Squadboard and CLI/Copilot are interchangeable peer clients
   - Storage modes explained (PostgreSQL default, filesystem opt-in)
   - Path 1 (Squadboard-first) and Path 2 (CLI-first) workflows with setup steps
   - Sync status API and repair commands (with note that UI comes in Wave 20)
   - Why this matters: eliminates data loss on mode switch
   - No false claims of continuous mirroring; emphasis on "projection/repair on demand"

7. **CHANGELOG Entry** — Honest entry about foundation work
   - SDK contract + client API complete and ready
   - Backend routes pending Hockney implementation (Wave 20)
   - Clarifies that user-facing behavior is still incoming
   - Flags ceremony defaults as now-required invariant

### Key Principles Locked

1. **Mode-based authority, not continuous sync:** Each project locks to one source-of-truth at creation. We mirror *when asked*, not continuously.
2. **Explicit vs. implicit:** Bootstrap is one-time import; projection is repeatable generation from authoritative state.
3. **No false claims:** SDK & client contracts are complete, but backend routes are pending. Documentation does not call this "working" until Hockney's routes land.
4. **Ceremony invariant:** `.squad/ceremonies.md` must exist and be non-empty. Missing ceremonies are health warnings requiring repair, not valid steady states.
5. **Precision over marketing:** Use "mode-based authority" and "projection/repair on demand" instead of "two-way sync" until end-to-end tests prove both directions work.

### Design Decisions Captured

**Terminology:**
- Authority → source of truth (DB or filesystem)
- Storage mode → postgresql (default) or filesystem (opt-in)
- Bootstrap → one-time import from filesystem when DB is empty
- Projection → generated artifacts (`.squad/`, `.github/agents/squad.agent.md`)
- Drift → when surfaces diverge (missing files, stale content, conflicting state)
- Repair → user-initiated sync or regeneration actions

**API Namespace Decision:**
- Canonical: `/api/projects/:projectId/squad-sync/...`
- Matches existing project-resource conventions
- Avoids overloading generic "sync" or GitHub sync terminology
- Locked in implementation plan and feature docs

**Ceremony Defaults:**
- Seeded from template: `docs/templates/ceremonies-defaults.md`
- 5 built-in ceremonies: Simple Review, Bug Fix, RFC, Spike, Pair Programming
- Required (not recommended) in SDK contract
- Empty ceremonies = drift warning = repair action required

### Doc Debt Resolved

- ✅ "How do I switch from Squadboard to CLI/Copilot without losing my team?" → README section + architecture doc
- ✅ "What's the source of truth?" → Locked in feature specs and contract doc
- ✅ "What happens if I have no ceremonies?" → Now a health warning (SDK defined); repair action available
- ✅ "Is this two-way sync?" → No. It's mode-based authority + projection on demand. Docs use precise language.
- ✅ "What does Hockney need to do?" → Implementation plan has exact routes, schemas, tests

### What's NOT Shipped (Pending Hockney Wave 20)

- Backend API routes (queue, status, repair, agent generation)
- Schema migration (`projects.storage_provider_mode` column)
- Import/detect workflows in project setup
- UI sync status panel
- End-to-end tests for both start paths

### Success Criteria Met

- ✅ SDK contract pure and schema-free (testable, versioned)
- ✅ Client API ready (types + hooks); no UI consumption yet
- ✅ Architectural semantics fully documented with examples
- ✅ API namespace locked; implementation plan ready
- ✅ README explains user-facing promise without false claims
- ✅ CHANGELOG honest: what's here (contract), what's pending (backend)
- ✅ Feature docs reflect progress (In Progress, not Backlog)
- ✅ No code modifications outside SDK/client/docs (preserve dirty tree)

### Key Insights Locked

1. **Ceremony defaults are non-negotiable:** The SDK now enforces that `.squad/ceremonies.md` exists and has content. This prevents the "empty ceremonies" state from being a valid configuration.
2. **Projection vs. Authority:** Filesystem `.squad/` in PostgreSQL mode is a *projection*, not the source of truth. This distinction is critical for avoiding data loss on direction switches.
3. **Bootstrap once, not repeatedly:** Marked by `__bootstrap_metadata` key. Re-import requires explicit `force: true` API call. Prevents accidental overwrites.
4. **Precise language matters:** "Two-way sync" implies continuous mirroring, which doesn't exist. Using "mode-based authority" and "on-demand projection/repair" is more accurate and sets correct user expectations.
5. **Both start paths must work:** We cannot call this feature complete until both Squadboard-first → CLI continuation AND CLI-first → Squadboard continuation are tested end-to-end.

### Open Items (Handed to Hockney)

- H1: Schema migration — `projects.storage_provider_mode` column
- H2: Bootstrap metadata in `squad_storage`
- H3–H6: Five API endpoints + route mounting
- Hockney's route implementation is a prerequisite for Keyser's UI and Kujan's tests

---

## Wave 13 Learnings — Q4 coordinator framework shipped

**Added by:** Scribe (Wave 13 close-out)  
**Date:** 2026-05-15T19:39:32-07:00

### Q4 delivery complete

Shipped full Squadboard coordinator extension framework: fragment (~200 lines), postinstall script (idempotent + diff-aware), plugin-author guide (~300 lines). All live in tree and documented.

**Dependency flagged:** Q3 task on McManus's plate (upstream PR to squad-duck for generic extension discovery). Your Q4 work assumes that PR eventually lands; Q5 has a fallback patcher if Q3 timeline slips.

---

## Wave 18 — Squad Apps & Templates Documentation (2026-05-19T15:30:00-07:00)

**Scope:** Pending documentation work on Squad Apps, bundles, and template system.

### Deliverables Shipped

1. **`docs/concepts/squad-apps-and-templates.md`** — 340 lines
   - Quick-reference table: Squad App vs Template vs Plugin vs Starter
   - Implementation map: canonical files, modules, discovery flow
   - When-to-use guide with concrete examples
   - Common Q&A section
   - Links to authoritative specs (`squadapp-spec.md`, ceremonies docs, MCP setup)

2. **Feature spec updates** — Two features marked complete:
   - `feat-2026-05-19-document-squad-apps-implementation-map` → Status: Done
   - `feat-2026-05-19-explain-squad-app-vs-project-template` → Status: Done

3. **Terminology decision captured** → `.squad/decisions/inbox/redfoot-squad-apps-terminology.md`
   - Canonical definitions: Squad App, Bundle, Project/Team/Workflow Templates, Starter Projects
   - Locked team notation for consistent vocabulary
   - Evidence trail linking to implementation files

4. **Docs IA updated** → `docs/README.md`
   - Added link to new Squad Apps & Templates concept page

### Key Insights Locked

**Distinction:** Squad Apps (portable bundles with versioning) vs Templates (DB-backed snapshots without versioning).

| Artifact | Scope | Authored | Versioned | Marketplace |
|----------|-------|----------|-----------|------------|
| Squad App | Full project | Devs shipping configs | ✅ SemVer | ✅ (F6+) |
| Project/Team/Workflow Template | Granular slices | End users ("Save" button) | ❌ | ❌ |
| Bundle | Runtime structure | Computed on apply | ✅ (tied to app) | — |
| Starter Project | Full project | Build-time generation | ❌ | — (legacy) |

**Discovery implementation:**
- **Bundles:** `packages/server/src/services/builtin-bundles.ts` lazy-scans `bundles/` on first API call
- **API:** `packages/server/src/routes/templates.ts` serves all template endpoints
- **Frontend:** `packages/client/src/pages/Templates.tsx` + `packages/client/src/api/templates.ts` (hooks)

**Pre-alpha labeling:** README.md already flags "Alpha software warning" with clear expectations. No additional labeling needed beyond what Hockney/Verbal manage in release copy.

### Design Principles Established

- **Terminology is precise:** Squad Apps ≠ Bundles ≠ Templates. Each has a specific meaning.
- **Implementation is discoverable:** Canonical files and modules are listed in implementation map for builders extending the system.
- **User guidance is concrete:** "When to use each" section includes real-world examples (legal doc review, Q3 sprint clone, standard agent roster, RFC ceremony).

### Doc Debt Resolved

- ✅ "Where are Squad Apps implemented?" → `packages/server/src/services/builtin-bundles.ts`
- ✅ "How does Squadboard discover them?" → Lazy scan + in-memory cache on `GET /api/templates/builtin-projects`
- ✅ "What's the difference between a Squad App and a project template?" → Published in new concept page
- ✅ "When should users choose each?" → When-to-use section with 4 concrete examples

### Success Criteria Met

- ✅ Clear implementation map (canonical files, modules, discovery flow)
- ✅ Conceptual distinction (Squad App vs Template vs Plugin) explained with tables
- ✅ When-to-use guidance tied to real examples
- ✅ Terminology locked for team (decision captured in inbox)
- ✅ Pre-alpha status already present in README
- ✅ Links to authoritative specs (squadapp-spec.md, ceremonies.md, MCP setup)
- ✅ Feature specs marked Done

### Next Steps (Flagged)

- **F4 (Wave 24+):** Curate built-in Squad Apps for `bundles/` directory
- **F5 (Wave 25+):** Automated export → Squad App workflow; git URL installer
- **F6 (Wave 26+):** Squad App marketplace + upgrade path
- **Starters migration:** Migrate legacy starters to Squad App format per W25 roadmap

---

## Wave 18 (Continued) — Release Readiness: Pre-Alpha Copy Normalization (2026-05-19T15:45:00-07:00)

**Scope:** Fix Kujan's rejection of Hockney's release-readiness work; normalize 13 remaining `alpha` references to `pre-alpha` in public docs.

**Context:** Hockney locked out (reviewer rejection lockout); Redfoot owns copy fix independently (no code changes, no workflow/package mechanics touched).

### Deliverables Shipped

1. **Normalized 10 product maturity `alpha` → `pre-alpha` references:**
   - packages/docs-site/docs/user-guide/built-ins.mdx (1 ref)
   - packages/docs-site/docs/user-guide/security.md (1 ref)
   - packages/docs-site/docs/user-guide/coordinator-loops.mdx (1 ref)
   - packages/docs-site/docs/user-guide/copilot-squad-coexistence.md (1 ref)
   - packages/docs-site/docs/reference/index.mdx (1 ref)
   - packages/docs-site/docs/reference/faq.md (2 refs)
   - packages/docs-site/docs/features/roadmap-gaps.md (3 refs in title/description/intro)
   - packages/docs-site/docs/getting-started/index.mdx (1 ref)

2. **Validation:**
   - ✅ Docusaurus build succeeded cleanly
   - ✅ No remaining product maturity `alpha` references (without "pre-") in public docs
   - ✅ All 10 normalized to `pre-alpha`
   - ✅ README.md already correct (not counted in the 13 Kujan flagged)

3. **Decision captured** → `.squad/decisions/inbox/redfoot-prealpha-copy-normalization.md`
   - Terminology locked: `pre-alpha` (not `alpha`) in all user-facing copy
   - Rationale: Consistent with SemVer 0.1.0-prealpha.0 and existing README labeling
   - Scope: Docusaurus site, README.md, release notes

### Key Insight

Squadboard's product maturity label must be consistent: **pre-alpha** (experimental, breaking changes expected) not **alpha** (more stable).

### Success Criteria Met

- ✅ All 10 product maturity `alpha` references normalized to `pre-alpha`
- ✅ Docusaurus build passes
- ✅ No code/package/workflow changes (Hockney's scope, not Redfoot's)
- ✅ Terminology decision locked for team
- ✅ Ready for Hockney to resume release-readiness work

## Team Update — undefined

Run: w18

- **verbal**: Stream G phase 2A (G2.3 comment + G2.5 merge PR with CI gate + G2.6 card badges)
- **keyser**: Settings batch (Backup/Restore UI + GitHub Integration Settings)

**Scope:** Four related deliverables to close docs gap after 16 waves of heavy build.

### Deliverables Shipped (4 files)

1. **README.md rewrite** — 8 required sections: What It Is, Who It's For, Getting Started, First Run (60-second walkthrough), Concepts at a Glance, Features Summary, Squad Integration, Links. Embedded feature list; replaced Architecture section with links to PRD.

2. **`/docs/concepts/ceremonies.md`** — 370 lines. TL;DR, mental model (ASCII diagram), 5 built-in ceremonies (Simple Review, Bug Fix, RFC, Spike, Pair-Programming), trigger types, custom YAML example, Ceremony vs Workflow Q&A, lifecycle, workflow step catalogue (11 steps), linking to saved workflows, common patterns, links.
   - **Sourced from:** McManus W16 decision (Model C split: ceremonies are triggers; workflows are execution graphs).

3. **`/docs/features.md`** — 280 lines. Feature breakdown by subsystem: Workflow Engine, Project Bundles, Ceremonies, GitHub Integration (W16+W17), Reliability, Real-time UI, SDK+MCP, Conjure, Project Settings, Database, CLI, Roadmap (W18+).
   - **Sourced from:** Git commits (W15–W17), package.json, MCP server tools, decision files.

4. **`/docs/setup/mcp-install.md`** — 440 lines. Quick start (Copilot CLI + VS Code snippets), 10-tool table, auth (stdio vs HTTP), config examples, per-tool reference (list_projects through get_routing), troubleshooting (connectivity, discovery, auth, project resolution), links.
   - **Sourced from:** `packages/server/src/mcp/server.ts` (canonical tool list).

### Design Principles Established

- **Show before tell:** Commands first, prose second. Every doc starts with runnable code.
- **Voice:** Warm, peer-to-peer. Treat reader as busy developer. No adjectives; verbs + nouns + outcomes.
- **Hierarchy:** README → concepts → features → setup. Each doc links, doesn't duplicate.
- **Audit trail:** Feature list sourced from code (MCP tools, package.json, commits), not guessed. Concepts tied to McManus W16 decision (Model C).

### Doc Debt Inventoried (Wave 18+)

10 features not yet documented:
- Workflow Editor UI (Demo 11, Hockney)
- Advanced fan-out patterns (Hockney)
- Webhook listener / external wait_event (Verbal)
- Cost dashboards + forecasting (Hockney)
- Agent leaderboard (Hockney)
- Burndown charts (Hockney)
- Custom PR merge strategies (Verbal, W17 in progress)
- Cloud backup (S3, Azure Blob)
- RBAC for multi-tenant (TBD)
- Audit log exports (TBD)

### Key Decisions Locked

1. **Ceremony nomenclature:** McManus W16 Model C is now canonical. Ceremonies = triggers; Workflows = steps.
2. **5 built-in ceremonies:** Simple Review, Bug Fix, RFC, Spike, Pair-Programming (curated per McManus W16; removed 4 others to community pool).
3. **MCP tool count:** 10 tools documented (per Phase 18 in server.ts). Project-scoped tools support `projectId` args + HTTP header fallback.
4. **README structure:** 8 sections (What It Is, Who It's For, Getting Started, First Run, Concepts, Features, Squad Integration, Links). No Architecture section (replaced with PRD link).

### Screenshot Needs (Flagged to Fenster)

- First Run walkthrough (kanban, ceremony drawer, live output)
- Ceremony Templates tab (5 built-ins)
- Workflow step catalogue (visual legend)
- MCP in action (Copilot CLI tool call)

### Success Criteria Met

- ✅ README passes "60-second rule" (commands early)
- ✅ Ceremonies page: mental model + all 5 built-ins + examples
- ✅ Features list: audit-sourced from code (W15–W17)
- ✅ MCP docs: all 10 tools + troubleshooting
- ✅ All docs follow show-before-tell style
- ✅ Links checked; no duplicate content

### Decision File

Created `.squad/decisions/inbox/redfoot-w17-docs-catchup.md` documenting:
- All 4 deliverables (files, changes, sourcing)
- Design decisions (hierarchy, voice, audit trail)
- Open doc debt (10 items for W18+)
- Screenshot needs (for Fenster)
- Success criteria (all met)


## Team Update — undefined

Run: w17

- **verbal**: Stream G phase 2A (G2.3 comment + G2.5 merge PR with CI gate + G2.6 card badges)
- **keyser**: Settings batch (Backup/Restore UI + GitHub Integration Settings)
