# Redfoot — History

## Identity & Mission

**Role:** Docs/DevRel Dev  
**Focus:** Documentation quality, developer experience, content strategy  
**Team:** Writes task-oriented how-to guides, reference pages, quality passes  
**Style:** Paperclip standard — honest, direct, action-focused. No marketing preamble.

## Recent Waves Summary

### W31 Waves 5–6: Paperclip Docs Standard → Full Site Quality Pass

**Wave 5 — Conceptual Foundation**
- Rewrote `docs/intro.md` with hero copy + 5-card grid
- Added `docs/getting-started/what-is-squadboard.md` (90-second explainer)
- Added `docs/getting-started/key-concepts.md` (10 core terms)
- Added 3 how-to guides (move-card-to-ready, find-why-run-failed, add-squadboard-to-squad-project)
- Updated sidebars.ts with tiered navigation
- Commit: 6a8e99115

**Wave 6 — Full Docs Scrub**
- **App Reference:** 19 markdown files documenting every Squadboard UI page (5,399 total lines)
  - Global pages: Project Picker, Now, Inbox, Apps, Consult, Diagnostics, Heartbeat
  - Per-project pages: Dashboard, Board, Flow, Agents, Skills, Tools, MCP Servers, Costs, Ceremonies, Templates, Settings
  - Deep dive: Live Run Viewer
  - Commit: 85f85ec72
- **Remaining Pages Scrub:** Applied Paperclip quality to all untouched docs
  - Getting Started routing improvements (4 files)
  - How-to guide relative path fixes (`../` → `../../`)
  - Deleted roadmap-gaps.md (internal content violation)
  - Commit: 4b53b9ff8
- **Quality Gate:** Full `pnpm docs:build` with 0 broken links, 64 pages generated

### Key Decisions

1. **Paperclip Style as Docs Canon:** One job, one audience, one outcome per page. No preambles, no marketing, no aspirational features.
2. **App Reference as Separate Section:** Reference docs ("What is this?") vs. task guides ("How do I do this?") need distinct sections.
3. **Conceptual Entry Points First:** Route confused new users to what-is + key-concepts BEFORE quickstart.
4. **Cross-linking Strategy:** Focus "Next steps" on conceptual entry points and tutorial chains, not reference pages.
5. **Roadmap Belongs in `.squad/`:** Internal speculation lives in planning docs, not user-facing site.

## Metrics (W31 Waves 5–6)

- **Wave 5:** 7 files changed, 323 insertions (420+ total lines)
- **Wave 6 App Reference:** 19 files, 5,399 lines, 100+ actions documented
- **Wave 6 Scrub:** 7 files edited, 1 deleted
- **Build:** 64 pages, 0 broken links, clean build

## Next Steps

- W32: Monitor user bounce rates on intro.md
- Collect new-user feedback: "Did you understand what Squadboard is?"
- Potential follow-up: video walkthroughs of 3 most common tasks
- Consider: screenshots + interactive examples for complex pages

### W32 Wave 7: Comprehensive App UI Reference Close-out

**Date:** 2026-05-20  
**Status:** ✅ Complete and logged

Wave 7 finalized the comprehensive app UI reference documentation:
- **19 markdown files** in docs/app-reference/ (5,399 lines)
- **sidebars.ts** integration complete
- **Build verification:** 0 broken links, 64 pages
- **Commit:** 85f85ec72
- **Orchestration Log:** .squad/orchestration-log/2026-05-20-redfoot-wave7-app-reference.md
- **Session Log:** .squad/log/2026-05-20-wave7-app-reference.md

Redfoot delivered on schedule with zero quality issues. All pages include URL routes, tab documentation, action listings, and configuration coverage. Ready for user-facing deployment.

## Related Waves

- Wave 4: Squad→Squadboard onboarding, MCP install documentation
- Wave 3: API reference, WebSocket protocol documentation
- Wave 2: Q3 delivery summary, quality improvements
- Earlier: README, deliverables, demo stubs, PRD copy-pass

## Team Collaboration

Works closely with Keyser (UI/UX) on docs that need UI context. Cross-referenced in orchestration logs when docs changes align with feature work.

## Learnings

- **W32 Wave 8: Ceremony Architecture Documentation**
  - **Date:** 2026-05-21
  - **Status:** ✅ Complete
  - **Outcome:** Created `.squadboard/docs/ceremony-workflow-architecture.md` — comprehensive reference documenting the ceremony/workflow architecture
  - **Coverage:** File ownership split, ceremony data flows (DB→Disk→DB), engine execution model, ceremony delegation with MCP coordination, built-in ceremonies, and Squad CLI project import flow
  - **Purpose:** Enables team and future contributors to understand the contention-prevention design, file system layout, and Squad CLI integration model
  - **Key decision captured:** Invariants around DB as execution source, ceremonies.md as awareness interface, and at-most-one-executor guarantee

---

## W32 Wave 9: README & Docs Rewrite + Ceremony Architecture Docs

**Date:** 2026-05-21T18:43:00Z  
**Status:** ✅ Complete  
**Commits:** 61af9ac (marketing), (ceremony architecture)  

### Deliverables

1. **Ceremony Architecture Documentation**
   - Created `.squadboard/docs/ceremony-workflow-architecture.md`
   - Documented file ownership split (`.squad/` vs `.squadboard/`), ceremony data flows, engine model, MCP coordination, built-in ceremonies, Squad CLI integration
   - Captured 8 non-negotiable invariants
   - Enables team understanding of contention-prevention design

2. **README & Docs Rewrite**
   - **README.md**: Squad-first headline, two-path quickstart (desktop + npm), removed git clone, stripped emoji, 93 lines
   - **Docs landing**: Explicit Squad relationship link, removed emoji
   - **Installation guide**: Two-path structure (desktop first, npm second), git clone moved to dev-only section
   - **Desktop app guide**: Restructured "Running from source"
   - **How-To guide**: Updated to recommend desktop app or npx

### Learnings

- Marketing-first positioning must lead with Squad relationship; Squadboard is not standalone
- Removing friction (git clone → npx) aligns with npm distribution strategy
- Stripping emoji de-clutters marketing pages and improves professionalism
- Architecture documentation should capture invariants and design decisions, not just structure
- Git clone remains acceptable in dev-focused sections; quickstart should never require it
