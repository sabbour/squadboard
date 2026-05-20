# REDFOOT DOCS AUDIT & OVERHAUL PLAN
**Date:** 2026-05-20T00:55:40Z  
**Status:** PLANNING PHASE — No implementation yet  
**Charter:** DevRel/Docs lead — audit current docs, identify gaps, produce overhaul roadmap

---

## AUDIT FINDINGS

### Current State
- **README.md**: ✅ Solid foundation (100 lines). Covers What It Is, Who It's For, Getting Started, Installation, Init & Run, PostgreSQL launch, Cross-Surface Squad Sync (recent Wave 19 addition).
- **Docusaurus site** (`packages/docs-site/docs/`): ~6,170 lines across 30+ files. Well-structured: getting-started, features, user-guide, reference, developer-guide.
- **Internal docs** (`docs/`): ~15+ files (concepts, ceremonies, setup, features, prd, acceptance-criteria). Well-curated but scattered across three locations.
- **Screenshots**: Only 1 reference to `Screenshot` component in quickstart. Heavy reliance on prose over visual walkthrough.
- **Release & Publish docs**: MISSING. No guidance on:
  - Creating Squad Apps
  - Building & publishing to npm
  - GitHub Actions / CI/CD publishing workflows
  - Testing E2E before publish
  - Initial release process
  - Backwards compatibility / migration guides
- **E2E Testing docs**: MISSING. No user-facing guidance on:
  - Running test suite locally
  - Writing custom E2E tests
  - Reproducing issues from the field
  - Squadboard E2E vs. Playwright vs. SDK tests

### Pain Points (from task)
> "docs are practically unusable"

**Root causes identified:**
1. **Three-tier docs setup is fragmented:**
   - `README.md` (project root) — setup + high-level concept
   - `docs/` (internal, not surfaced in Docusaurus) — architecture, decisions, features
   - `packages/docs-site/docs/` (public Docusaurus) — getting-started, tutorials, reference
   - Users get lost; unclear which to read first

2. **Missing entry points for key user flows:**
   - "I want to create a Squad App and publish it" → No guide
   - "I want to understand E2E testing" → No guide; only internal acceptance-criteria.md
   - "I want to push my work to GitHub" → Partial coverage in GitHub integration docs
   - "I'm installing for the first time" → 5 different places say different things

3. **Screenshots almost entirely absent:**
   - Only 1 MDX file references `<Screenshot>`. Pitch says "show before tell."
   - Quickstart mentions card UI but doesn't show it
   - First-run walkthrough exists but not visually documented

4. **Getting Started is incomplete:**
   - `installation.md` — good
   - `quickstart.mdx` — good outline, missing screenshots
   - `tutorials/` — exists but unclear progression
   - `learning-path.md` — exists but not linked prominently
   - No "what's next" after quickstart beyond a vague link to Product Guide

5. **Release / Publish workflow invisible:**
   - Acceptance criteria exists (internal)
   - CLI scripts exist (`npm:build`, `npm:publish:dry-run` in package.json)
   - No user-facing guide on:
     - When to publish (after which demos?)
     - How to test before publish (E2E, dry-run)
     - What to do if publish fails
     - How to communicate breaking changes

6. **E2E Testing guidance is internal-only:**
   - `docs/acceptance-criteria.md` exists but assumes knowledge
   - `test:e2e` npm script exists but undocumented
   - No "how to write a test" or "how to debug a flaky test" guide
   - Users can't easily reproduce/validate issues

### Success Snapshot
- ✅ README: Shows `npm start` early; clear Node.js prereq; no false claims about maturity
- ✅ Wave 19 additions (Cross-Surface Squad Sync) correctly marked as architectural contract, not user-facing feature yet
- ✅ Terminology locked (pre-alpha, ceremonies, Squad App vs. Template, etc.)
- ✅ MCP installation guide exists and is thorough
- ✅ Ceremonies documentation is complete

---

## PROPOSED OVERHAUL

### Goals
1. **Single, clear entry point** — README as the primary hub
2. **Three-tier structure** — accessible to all users without guessing which tier to read
3. **Show before tell** — screenshots and runnable examples in every major section
4. **Task-driven navigation** — "I want to X" → clear path from landing page
5. **E2E and publishing made visible** — users can find and understand test flows, publish workflows

### New Information Architecture

#### Tier 1: README (Project Root) — Universal Entry
**Target:** Anyone landing on GitHub

**Current state:** ~100 lines, good structure  
**Proposed changes:**
- ✅ Keep: What It Is, Who It's For, prerequisites, Installation, Init & Run
- ✅ Keep: Pre-alpha warning
- ✅ Add (new section): "**Typical Workflows**" — 3 quick bullet links:
  - "First Time? Start → [Getting Started](#getting-started)"
  - "Creating a Squad App? → [Squad Apps Guide](#squad-apps)"
  - "Publishing a Release? → [Release Checklist](#release-checklist)"
- ✅ Reorganize: Move Getting Started section higher (before Post-Install)
- ✅ Add: Link to live docs site (http://localhost:3002 or https://docs.squadboard...)
- ✅ Add: "Testing E2E" subsection with link to test guide

**New subsections:**
1. `### Getting Started` (linked guide from docs-site)
2. `### Create Your First Squad App` (linked guide from docs-site)
3. `### Run Tests & Validate Changes` (linked guide from docs-site)
4. `### Publishing a Release` (linked guide from docs-site)

#### Tier 2: Live Docs Site (`packages/docs-site/docs/`)
**Target:** Users reading inside the app or on the web

**New top-level structure:**
```
docs/
├── getting-started/
│   ├── index.mdx          (hub: 3-path decision tree)
│   ├── installation.md    ✅ (exists, no change)
│   ├── quickstart.mdx     ✅ (exists, ADD SCREENSHOTS)
│   └── tutorials/         ✅ (exists, link clearly from hub)
│
├── guides/                🆕 (NEW)
│   ├── create-squad-app.mdx          🆕 (5–7 min read)
│   ├── publish-and-release.mdx       🆕 (10–15 min read)
│   ├── testing-e2e.mdx               🆕 (10–15 min read)
│   ├── push-to-github.mdx            🆕 (5–7 min read, link existing GitHub docs)
│   └── troubleshooting-setup.mdx     🆕 (diagnostic flowchart)
│
├── features/              ✅ (exists, reorganize)
│   ├── overview.mdx       ✅
│   ├── board-and-runs.mdx ✅
│   ├── ceremonies-and-automation.mdx ✅
│   ├── integrations.mdx   ✅
│   ├── reliability-and-ui.mdx ✅
│   ├── agents-and-workspaces.mdx ✅
│   └── roadmap-gaps.md    ✅
│
├── user-guide/            ✅ (exists, no structural change)
├── reference/             ✅ (exists, no structural change)
├── developer-guide/       ✅ (exists, no structural change)
```

**Immediate updates (HIGH PRIORITY):**
1. `getting-started/index.mdx` — Add hub/decision tree at top: "What do you want to do?"
2. `getting-started/quickstart.mdx` — Add 4–6 key screenshots (board, agent confirmation, card creation, ceremony)
3. Create `guides/create-squad-app.mdx` — Steps: init template, customize ceremonies.md, test locally, export bundle, publish
4. Create `guides/publish-and-release.mdx` — Release checklist: tests pass, dry-run, CHANGELOG update, version bump, publish
5. Create `guides/testing-e2e.mdx` — How to run `pnpm test:e2e`, write tests, debug failures
6. Create `guides/push-to-github.mdx` — Link + extend existing GitHub integration docs

#### Tier 3: Internal Docs (`docs/`) — Architecture & Decisions
**Target:** Builders, architects, maintainers

**Status:** Well-curated but not surfaced. Make discoverable:
- Add link in Docusaurus (Developer Guide) to `/docs` overview
- Create `docs/README.md` (document catalog) — already exists, is good
- Keep all existing files; add table-of-contents links

---

## SPECIFIC FILES TO UPDATE

### Phase 1: HIGH PRIORITY (Week 1)

| File | Action | Owner | Effort | Notes |
|------|--------|-------|--------|-------|
| `README.md` | ✏️ Add workflow section + 3 quick links | Redfoot | 20 min | Adds "Getting Started", "Squad Apps", "Release" as visual anchors |
| `packages/docs-site/docs/getting-started/index.mdx` | ✏️ Add hub/decision tree | Redfoot | 30 min | "Choose your path: Setup, Create App, Test, Release" |
| `packages/docs-site/docs/getting-started/quickstart.mdx` | ✏️ Add 4 screenshots + captions | Fenster | 1 hr | Board view, agent roster, card creation, ceremony result |
| `packages/docs-site/docs/guides/create-squad-app.mdx` | 🆕 Create new guide | Redfoot | 2 hrs | Template → customize → test → export → publish (runnable commands) |
| `packages/docs-site/docs/guides/publish-and-release.mdx` | 🆕 Create new guide | Redfoot | 2 hrs | Checklist: tests, dry-run, CHANGELOG, version, publish steps |
| `packages/docs-site/docs/guides/testing-e2e.mdx` | 🆕 Create new guide | Redfoot | 2.5 hrs | How to run, write, debug E2E tests; failure scenarios |

**Total effort:** ~8 hours (1 day + screenshots from Fenster)

### Phase 2: MEDIUM PRIORITY (Week 2)

| File | Action | Owner | Effort | Notes |
|------|--------|-------|--------|-------|
| `packages/docs-site/docs/guides/push-to-github.mdx` | 🆕 Create new guide | Redfoot | 1 hr | Orchestrate existing GitHub docs + new workflow examples |
| `packages/docs-site/docs/guides/troubleshooting-setup.mdx` | 🆕 Create guide | Redfoot | 2 hrs | Flowchart: "pnpm start fails?" → diagnosis tree |
| `docs/README.md` | ✏️ Update with discoverability | Redfoot | 30 min | Add link from Docusaurus developer guide |
| `packages/docs-site/docs/developer-guide/` | ✏️ Add "Docs Architecture" page | Redfoot | 1 hr | Explain Tier 1/2/3 structure to new builders |

**Total effort:** ~5 hours

### Phase 3: LOW PRIORITY (Ongoing)

| Action | Owner | Notes |
|--------|-------|-------|
| Screenshot audit & refresh | Fenster | Review all 30+ pages; tag missing screenshots with 🖼️ TODO |
| Update tutorials with more visual flow | Fenster | Add screenshots to each tutorial step |
| Link cross-references | Redfoot | Ensure no dead links between tiers |
| Release notes template | Redfoot | Create `RELEASE_TEMPLATE.md` for standard release copy |

---

## ACCEPTANCE CRITERIA

### ✅ Docs Audit
- [x] Current state mapped (3 tiers, 6,170 lines, 30+ files)
- [x] Pain points identified (fragmentation, missing entry points, no E2E/publish guidance)
- [x] Success snapshot documented (good README, solid Wave 19 docs, clear terminology)

### ✅ Overhaul Plan
- [x] New IA proposed (Tier 1/2/3, reorganized getting-started, new guides)
- [x] High-priority files listed (6 files, 8 hours)
- [x] Medium-priority files listed (4 files, 5 hours)
- [x] Low-priority files listed (ongoing)

### ✅ User-Facing Guidance (To Be Implemented)
- [ ] "Getting Started" page loads from README with clear 3-path decision tree
- [ ] "Create Squad App" guide includes 4+ runnable commands and 2 example outputs
- [ ] "Publish & Release" guide includes pre-flight checklist + dry-run example
- [ ] "Testing E2E" guide shows how to run, write, debug with copy-paste examples
- [ ] All new guides have 1+ screenshot or visual diagram
- [ ] Quickstart now has 4+ step-by-step screenshots
- [ ] Docusaurus builds with no warnings; internal link check passes

### ✅ Team Handoff Readiness
- [ ] Plan reviewed by Ahmed (requestor) and Quinn (PM context)
- [ ] Screenshot needs communicated to Fenster
- [ ] Plan captures all 3 user pain points: E2E tests, Squad App creation, GitHub publishing
- [ ] No conflicting changes to .squad/ files or CI/CD

---

## OPEN QUESTIONS FOR STEERING

1. **Screenshots hosted where?**  
   Should new guide screenshots live in `/assets/screenshots/` or `packages/docs-site/static/img/`?

2. **E2E Test coverage gaps?**  
   Which workflows should E2E tests definitely cover before publishing? (Basic project → squad app export → publish?)

3. **Release cadence?**  
   When does the first npm publish happen? After Demo 15 (GitHub Sync), or earlier?

4. **Squad App marketplace?**  
   Does publish guidance assume GitHub Releases + npm, or also marketplace registry?

---

## DECISION CAPTURED

- ✅ **Tier 1/2/3 separation** is canonical; all team docs will follow this pattern going forward
- ✅ **README is the universal hub**; all other tiers link upward
- ✅ **Show before tell** principle locked: new guides must include runnable commands + output examples
- ✅ **E2E tests and publishing are user-facing concerns** (not internal-only); docs must make them discoverable

