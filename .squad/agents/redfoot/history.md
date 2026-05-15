# Redfoot — History

## Core Context

- **Project:** Squadboard — local-first kanban + workflow board for [Squad](https://github.com/bradygaster/squad) agents
- **Package:** `@sabbour/squadboard` · Local install: `npx @sabbour/squadboard init` · MIT · Self-hosted
- **Role:** DevRel / Docs
- **Joined:** 2026-05-14T08:17:03Z
- **Hired by:** Ahmed Sabbour
- **PRD:** `/home/asabbour/.copilot/session-state/b22555db-ec9d-4ffd-9266-4553cda5bb11/research/squad-web-design-v4.md`

## Audience I write for

From PRD §1.2:
- **Solo developers** running 1–3 Squad agents who want a board, not a terminal log
- **Small teams** sharing a `.squad/` directory who need workflow gates without inventing them in agent prompts
- **Agent builders** shipping workflows as first-class artifacts — versioned, auditable, demonstrable

The line that frames every doc: *"If you have one agent and one task at a time, you don't need this; `squad chat` is fine."*

## What I'll never do (PRD §1.4)

- Position Squadboard as a Squad replacement
- Position it as a Coordinator wrapper
- Frame it as CI/CD, generic chat UI, multi-tenant SaaS, or a marketplace

## Roadmap I deliver against

Every demo ships with:
- A 30-second elevator pitch ("what's new")
- A getting-started walkthrough (commands + screenshots)
- An entry in CHANGELOG.md
- An update to the relevant section of the README

Major doc cuts:
- **Demo 1** — README + first-install guide
- **Demo 6** — Workflow YAML cookbook (first version)
- **Demo 9** — Reviews & approvals guide
- **Demo 10** — Fan-out + handoff cookbook entry
- **Demo 11** — Workflow editor walkthrough
- **Demo 14** — MCP tool reference
- **Demo 15** — GitHub sync setup guide

## Learnings

- **2026-05-14 PRD Copy Pass (tagged):** Tagged to perform copy pass on `docs/prd.md` (voice/clarity, no content changes — the five invariants are paste-locked and canonical).
- **2026-05-14 PRD Copy Pass (completed):** Completed copy pass on `docs/prd.md`. 5 surgical edits, ~1% shrink (12,331 → 12,195 bytes), no content changes. Tightened vision, simplified scope/architecture, polished tech-stack links, removed instructional trailer. ✅ Approved as publish-ready for hacking phase.
- **2026-05-14 Top-level README (completed):** Authored `README.md` at project root (5,024 bytes). Hero banner (horizontal SVG) + 10 sections (show-before-tell: quick-start precedes architecture). Both SVGs referenced per brand guidelines. All content sourced from PRD; zero invention. Hacking-phase compliant (no contributing/CI badges). Decision file + decision inbox entry logged. Ready for Scribe commit.
- **2026-05-14 README merged:** Decision entry merged into `decisions.md` by Scribe. Inbox file deleted. README + brand assets (both SVGs + square PNG) committed. Skipped Windows NTFS metadata files (`:Zone.Identifier`, `:sec.endpointdlp` — DLP scanner artifacts).
- **2026-05-14 Demo stubs (completed):** Created 15 per-demo user-facing doc stubs in `docs/demos/` (demo-01 through demo-15). Each stub: status 🔴, layer, prerequisites, "Run it" commands (mostly TBD for hacking phase), observables from PRD. Stubs follow template exactly. Pattern: `demo-NN-{slug}.md`. Decision file logged to inbox.
- **2026-05-14 Getting Started section (completed):** Added comprehensive `## Getting Started` section to README.md (157 lines, 6 subsections). Covers prerequisites (Node ≥20, pnpm ≥8, no external DB), installation (clone + pnpm install), initialization (auto-managed at startup), dual-start paths (full app or components), CLI reference (squadboard init / mcp), MCP integration for Claude Desktop / Cursor with config snippets, GitHub sync setup (UI + curl API), production build, and dev database studio. All commands sourced from actual package.json scripts and source code inspection. Inserted after intro, before "What you get", maintaining scannability via fenced code blocks and headings. Commit: `bdc2ab1`. ✅
- **2026-05-14 MCP docs fix (completed):** Removed all Claude Desktop and Cursor references from README MCP Integration section. Rewrote to show VS Code (with MCP extension) and GitHub Copilot CLI integration separately. Both use the same stdio JSON config format — `.vscode/mcp.json` (project-level, commit to repo) vs. `~/.copilot/mcp-config.json` (user-level). Clarified that `squadboard mcp` CLI command starts the stdio server. Config paths updated to `node packages/cli/dist/index.js mcp` with guidance on path adjustment. Commit: `3c93923`. ✅

- **2026-05-14 MCP docs (backlog batch 1):** Integrated into backlog batch 1 orchestration. Decision recorded, inbox entry merged to decisions.md. Team session log updated.

## Wave 10 Docs Refresh — 2026-05-15

- **Scope:** Wave 10 (Streams A–E) introduced dogfood loop, cost multipliers, templates, agent lifecycle semantics, and ceremony redesigns. Docs needed refresh to cover MCP `capture` tool, `list_agents` status filtering (disabled vs retired), cost models, templates, and end-to-end setup.

- **Files changed:**
  - `packages/server/src/mcp/README.md` — Updated `list_agents` table entry to mention status filtering. Added detailed "Tool Reference" section with examples for `list_agents` (B9 semantics: active | disabled | retired | all) and `capture` (A4 dogfood loop). Added link to `.squad/dogfood.md`.
  - `docs/mcp-config-example.json` — Created as a reference template for `.copilot/mcp-config.json` setup, with `SQUADBOARD_DEFAULT_PROJECT_ID` placeholder.
  - `README.md` (root) — Added three subsections after "Build for Production":
    - **Dogfood Mode** — When running under Copilot CLI with Squad coordinator, directives auto-capture to Squadboard board. References `.squad/dogfood.md` and MCP tool reference.
    - **Cost Tracking** — Explains two cost models (legacy USD vs GitHub Copilot multipliers). Shows env var + API methods to switch. Points to `packages/server/src/sdk/cost-tracker.ts`.
    - **Templates** — Brief section on save-as-template API + on-disk mirror at `.squad/squadboard/templates/`. Shows curl example.
  - `CHANGELOG.md` — Created with Wave 10 section. Grouped features by stream (A: Dogfood, B: Semantics, D: Pricing/Ceremony/Templates, E: Docs). Added "Upgrade Notes" subsection with explicit instructions for `SQUADBOARD_COST_MODEL` env var and dogfood setup. Created template for future releases (0.1.0 initial hacking phase, versioning guidelines).

- **Verification:**
  - `pnpm build` passed all 4 workspace projects with no regressions. ✅
  - Skimmed each doc for "first 60 seconds rule" (runnable command early):
    - MCP README: Transport table + tool list appears early, followed by examples. ✅
    - Root README: Prerequisites, clone, `pnpm install`, `pnpm run dev` in first 70 lines. ✅
    - CHANGELOG: Human-readable for operators; "Upgrade Notes" subsection makes migration path explicit. ✅

- **Patterns discovered:**
  - Wave 10 docs bridge three audiences: (1) End users (Dogfood, Cost Tracking, Templates), (2) MCP clients (tool reference + examples), (3) Operators (CHANGELOG upgrade notes). Each section explicitly references upstream docs (`.squad/dogfood.md`, `packages/server/src/sdk/cost-tracker.ts`).
  - `capture` tool docs are critical entry point for understanding the dogfood loop; must be co-located with `list_agents` + project-ID resolution.
  - CHANGELOG format: Group by stream/feature, then list concrete changes, then provide operator-facing upgrade notes with code samples.

- **Open questions for Kujan (CHANGELOG coordination):**
  - Should the Wave 10 section header stay generic ("Wave 10: Dogfood + Multipliers + Templates") or reference specific streams/PRs?
  - Are there additional breaking changes or deprecations I should surface in the Upgrade Notes (e.g., any config format changes, deprecated endpoints)?
  - Should CHANGELOG include commit hashes / PR references, or keep it narrative-only for now (hacking phase)?
  - Is the 0.1.0 template appropriate for this release, or should we wait for a formal v1.0 roadmap?

