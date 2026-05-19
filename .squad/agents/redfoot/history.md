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
