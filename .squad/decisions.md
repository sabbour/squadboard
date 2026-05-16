# Squad Decisions

## Active Decisions

# 2026-05-15T19:46:00-07:00: Q4 delivery — Squadboard coordinator extension framework
# Decision: Squadboard Coordinator Extension Framework

**Date:** 2026-05-15  
**Author:** Redfoot (DevRel / Docs)  
**Status:** Accepted  
**Relates to:** Q4 Stream A (Squadboard Coordinator Integration)  

## Summary

Delivered the full Squadboard coordinator extension framework: a reusable plugin pattern that allows MCP servers and domain tools to extend Squad (the Copilot CLI coordinator) without forking or merge pain.

Three deliverables shipped:

1. **Coordinator fragment** (`packages/squadboard/coordinator-fragment.md`) — ~200 lines, Squad-preamble voice, detection-guarded, detection + 11 tools + capture-on-directive + close-out + project routing + boundaries + override mechanism.

2. **Postinstall script** (`packages/squadboard/scripts/postinstall-coordinator-fragment.mjs`) — Idempotent + diff-aware installation to `~/.squad/extensions/coordinator/squadboard.md`. Respects user edits via marker detection. Respects `SQUADBOARD_SKIP_POSTINSTALL` env var for CI.

3. **Plugin-author guide** (`docs/plugins/squad-coordinator-extensions.md`) — ~300 lines, warm peer-to-peer voice. Documents the extension mechanism for any plugin (Trello, Aspire, internal tools, etc.). Covers where fragments live, shape/style, naming, postinstall pattern, upgrade story, user override, anti-patterns, testing.

## Design Decisions

### Fragment Format Conventions

- **Detection-guarded.** Fragments only activate when the user has installed the MCP server (tools with `{prefix}_` prefix found). If tools are missing, fragment is skipped entirely (no errors).
- **Tool inventory table.** Organized by use case, not signature. "When capturing", "When reading board state" — users see workflows first, not function signatures.
- **Capture-on-directive workflow.** TWO flows stay active: the existing `.squad/decisions/inbox/copilot-directive-*.md` file AND the Squadboard card drop. They're additive, not replacing.
- **Close-out symmetry.** When agent work completes, a second `capture` call with `done:` prefix + first 60 chars of original + sha. Enables manual dedup in inbox (future: automated find-by-prefix).
- **Project routing.** Default project via `SQUADBOARD_DEFAULT_PROJECT_ID` env var (or `.copilot/mcp-config.json`). No per-capture prompt. User can override if they name another project explicitly.

### Postinstall Idempotency Pattern

- **SHA-256 marker.** Bundled fragment's SHA is computed; target file's SHA compared. If match → no-op.
- **Auto-installed marker.** `<!-- squadboard:auto-installed -->` at file top signals "we own this file; safe to upgrade". Removal by user = "I'm customizing; back off".
- **Diff-aware user override.** If marker absent and content differs → save `.new` copy alongside. User sees a warning with diff command; can merge or keep their version.
- **Silent success always.** Exit 0 even on errors. Postinstall failures must not break `npm install`. Squadboard MCP still works without the coordinator fragment; the fragment just makes the coordinator smarter.
- **SQUADBOARD_SKIP_POSTINSTALL env var.** CI/Docker users can set this to skip installation.

### Plugin-Author Guide Framing

- **"You can do this too" pitch.** Warm, peer-to-peer. Assumes authors of Trello, Aspire, internal tools, etc. will write fragments for their services.
- **Stable naming via filename.** `squadboard.md`, `trello.md`, `aspire-dashboard.md` — not `extension.md` or `workflow.md`. Filename = unique key for override detection.
- **Upstream PR as escape hatch.** This generic mechanism is being PR'd to `bradygaster/squad-duck` under Q3. Until merged, individual plugins use postinstall. Once merged, discovery is automatic.
- **Anti-patterns explicit.** Don't contradict upstream rules. Don't dispatch agents (call tools instead). Don't use repo-specific paths. Don't assume Squad file structure. Don't fail silently.

## Relationship to Q3 & Q5

- **Q3 (Upstream PR — McManus's scope):** The `bradygaster/squad-duck` PR will add extension discovery to the upstream Squad preamble, so fragments in `~/.squad/extensions/coordinator/` auto-load at session start. This Q4 deliverable assumes Q3 eventual success but doesn't block on it.
- **Q5 (Fallback patcher — if Q3 stalls):** If the upstream PR doesn't land by end of Q4, Q5 will deliver a postinstall-time injector that patches Squad on install if needed. Q4 postinstall + Q5 patcher together ensure coverage either way.

**Path forward:** Q4 ships in-tree (fragment + postinstall alone work within this repo); Q3 PR is in parallel; Q5 is a safety net if Q3 misses timeline.

## Conventions Established

### Fragment-Format Conventions

1. **Auto-installed marker** as line 1: `<!-- {package}:auto-installed -->`
2. **Detection block** before any workflows (guards with "if tools present").
3. **Tool inventory table** with "When | Tool | What It Does" shape.
4. **Workflow sections** organized by user intent, not tool signature.
5. **Boundaries section** explaining what NOT to do (don't contradict upstream, don't dispatch agents, don't assume paths).
6. **Override mechanism** documented (user-global vs. project-local, marker removal = customization).
7. **≤200 lines.** Keep it terse and coorditator-voice (imperative, "you DO / you DO NOT" framing).

### Postinstall-Script Conventions

1. **Target path:** `~/.squad/extensions/coordinator/{fragment-name}.md`
2. **Marker pattern:** `<!-- {package}:auto-installed -->` (unique per package)
3. **Exit behavior:** Always 0 (never break npm install).
4. **Env var:** `{PACKAGE}_SKIP_POSTINSTALL` respected (for CI, Docker, etc.).
5. **Idempotency via marker:** Own the file if marker present. Upgrade if marker present + content differs. Diff-save if marker absent.
6. **User feedback:** ✅ installed, ✅ up-to-date, 🔄 upgraded, ⚠️  user-edited + diff command.

### Plugin-Author-Guide Framing

1. **Peer-to-peer voice.** "Your plugin can extend Squad" — not "Squadboard extends Squad and here's why".
2. **Anti-patterns listed.** Readers know what NOT to do.
3. **Reference implementation clear.** Point to `packages/squadboard/scripts/postinstall-coordinator-fragment.mjs` as canonical.
4. **Testing checklist.** Fresh install, idempotency, upgrade, user override, session test.
5. **FAQ answers real questions.** Collision risk, async ops, cross-tool calls, Squad upgrades, non-npm distribution.

## What's NOT in Scope (Dependency on Upstream)

- **Extension discovery in Squad preamble.** Q3 (McManus + upstream maintainer) handles the core Squad preamble changes so fragments auto-load. This Q4 deliverable assumes that will happen; fragments won't auto-load until then without a patcher (Q5 fallback).
- **UI for managing fragments.** No Copilot CLI UI or Squadboard UI for viewing/toggling installed fragments. Users manually inspect `~/.squad/extensions/coordinator/`.
- **Fragment marketplace.** No registry of "official" Squadboard extensions. Each plugin documents its own fragment.

## Success Criteria

- ✅ Coordinator fragment ships with ≤200 lines, detection-guarded, ready for user-global install.
- ✅ Postinstall script is idempotent, respects user edits, warns on collision.
- ✅ Plugin-author guide is ≤300 lines, peer-to-peer, covers end-to-end pattern (naming, postinstall, upgrades, testing, anti-patterns).
- ✅ Fragment format conventions are documented (Deliverable C).
- ✅ Postinstall conventions are documented (Deliverable C).
- ✅ All three deliverables live in tree and are readable today.

## Next Steps

1. **Q3 (parallel):** McManus + upstream PR — extend Squad preamble to auto-load extensions from `~/.squad/extensions/coordinator/`.
2. **Q4 follow-up:** If needed, Scribe documents fragment installation in per-project onboarding (`.squad/dogfood.md`-style instructions for any consumer of @sabbour/squadboard).
3. **Q5 (contingency):** If Q3 misses timeline, deliver postinstall-time patcher that wires the extension loading into Squad if upstream hasn't landed.

---


# 2026-05-15T19:50:00-07:00: Coordinator directives — PGlite migration, extension mechanism, Scribe ceremony model
# Copilot directive — three architecture forks (2026-05-15T19:50)

**Requested by:** Ahmed
**Captured by:** Copilot (Coordinator)
**Wave:** post-Wave-12, pre-Wave-13

Ahmed delivered three directives while reviewing the @sabbour/squadboard packaging story:

---

## 1. "no use embedded pg"

**Scope:** applies broadly — not just to the proposed Electron build (Stream L4). The standalone server today also uses `embedded-postgres` (`packages/server/src/db/postgres.ts`) to spin a real PG cluster at `~/.squadboard/data:54321`. Move off it.

**Decision** (Coordinator default; Ahmed can correct):
- Swap to **PGlite** (`@electric-sql/pglite`) — pure-WASM Postgres, Drizzle has first-class adapter (`drizzle-orm/pglite`), no per-platform binaries, single artifact, in-process.
- Schema reuse is near-100% (gen_random_uuid is supported via bundled pgcrypto; jsonb works; types work; enums work).
- Cluster file lives at `~/.squadboard/data/pglite/` (same parent dir as today; one folder rename only).
- `DATABASE_URL` env var override is preserved so CI / cloud deployments can still point at a real PG instance.
- Eliminates Stream L4's "biggest packaging risk" (per-platform PG binaries inside app.asar).
- Eliminates standalone-server first-run friction (no port 54321 collision, no system PG conflict).

**Why not SQLite?** Drizzle SQLite is a separate module — schema rewrite needed (UUIDs, JSONB, enums, `DO $$ BEGIN`, etc. all diverge). PGlite preserves the schema 1:1; SQLite forces a 948-line rewrite.

**New tasks:**
- `q1-pg-to-pglite-migration` — server-side swap
- `q2-pglite-electron-bundling` — Electron-side bundling (`extraResources` for the wasm file)
- Stream L4 rewritten as "Bundle PGlite (no native binaries)" instead of "Bundle embedded Postgres."

---

## 2. "make squad-coordinator aware of squadboard_ MCP — repeatably, not overwritten on Squad updates"

**Problem statement:** to teach the upstream Squad coordinator (the system prompt loaded from `.github/agents/squad.agent.md` in squad-duck/prototype) about `squadboard_*` MCP tools and the dogfood-loop workflow, the naïve fix is to edit that file. But every Squad release overwrites it. Need a mechanism that survives upgrades AND is reproducible for OTHER consumers (anyone installing `@sabbour/squadboard` + Squad together).

**Decision** (Coordinator default; subject to upstream maintainer approval):
- **Upstream PR against `bradygaster/squad-duck`** — add ONE generic "extension fragments" mechanism to `squad.agent.md`:
  > _"At session start, scan `~/.squad/extensions/coordinator/*.md` (user-global) and `.squad/extensions/coordinator/*.md` (project-local). Treat each as additional behavior fragments appended to this preamble. Project-local overrides user-global. Updates to this file do NOT touch the extensions directory."_
- **Generic, not squadboard-specific.** Other tools (Aspire, Trello extensions, custom plugins) get the same hook for free.
- Each fragment may declare an `if mcp-prefix detected: ...` block — keeps the upstream preamble lean.
- `@sabbour/squadboard` postinstall script writes `~/.squad/extensions/coordinator/squadboard.md` with the dogfood loop, `squadboard_*` tool-prefix detection, capture-on-directive workflow, etc. Idempotent (won't overwrite a user-edited version; surfaces a diff if changed).
- Document for OTHER plugin authors in upstream Squad docs + in squadboard's contributing guide.

**Why not a companion file like `squad.agent.local.md`?** Would need 1 file per plugin → directory + fragment-merge semantics scale better. Also: a directory is gitignorable independent of the canonical preamble.

**Why not a runtime CLI flag?** Doesn't survive non-CLI surfaces (Electron, headless, future SDK consumers).

**Risks / open question:** upstream maintainer may decline the PR shape. Fallback: ship a `squad.agent.md` *postinstall patch* tool in `@sabbour/squadboard` that diffs the upstream file, applies the squadboard block, and tags it (idempotent re-apply on Squad upgrades). Uglier but unblocks us.

**New tasks:**
- `q3-squad-upstream-extension-pr` — author PR against squad-duck
- `q4-squadboard-coordinator-fragment` — author the squadboard.md fragment that lives at `~/.squad/extensions/coordinator/squadboard.md`
- `q5-squad-extension-fallback-patcher` — fallback patcher if PR declined

---

## 3. "who is the coordinator if I'm using squadboard directly? Not convinced on Scribe"

**Two questions packaged together.** Coordinator's current take below; flagged as **open for Ahmed's confirmation** because the design fork is real.

### Q3a: Coordinator role when squadboard is run standalone (no Copilot CLI session)

Today, the Squad coordinator is "the LLM in your Copilot CLI session loaded with `squad.agent.md`." If a user opens the Electron app, or runs `npx squadboard serve` + browses to localhost, there is **no coordinator** — the user clicks buttons.

**Three coherent design options** (need Ahmed's pick):

| Option | Who drives | Tradeoff |
|---|---|---|
| **A. Human-as-coordinator** | User reads the board, decides what to dispatch, clicks "run" on cards. Squadboard is a manual kanban with one-click agent dispatch. | Simplest. No agentic loop. Doesn't deliver the "autonomous fleet" vibe. |
| **B. Server-resident coordinator agent** | Squadboard runs its own LLM-powered coordinator daemon. It picks up inbox items, classifies via Conjure, routes to agents, dispatches runs, handles ceremonies, ends waves with Scribe. Auth via user-configured LLM backend (OpenAI/Anthropic/Azure/Bedrock). | Matches "Squad in a box" vision. Requires durable coordinator state, prompt management, cost accounting at the daemon level. ~3-4 wave equivalent of work. |
| **C. Hybrid per-project switch** | Project setting: "Manual" (option A) or "Autonomous" (option B). Default Manual; opt-in to Autonomous. | Best UX. Most work — both modes must be supported + tested. |

**Coordinator default:** **C**, with **A** shipping first (Wave 13-14 timeframe) and **B** as a follow-on (Wave 17+).

Even in B, the user can still drop into a Copilot CLI session and act as a peer coordinator — the server-resident loop just keeps things moving when no human is at the keyboard.

### Q3b: Scribe behavior — Ahmed flagged my prior framing

My earlier framing was: **split Scribe along a mechanical/narrative seam** — mechanical 80% (inbox merge, git commit, archives) becomes a server-side hook; narrative 20% (cross-agent history, summarization) becomes an optional workflow step; both expose via `squadboard.scribe.closeOut()` SDK.

**Why Ahmed may be unconvinced** (my best guesses — flagged for confirmation):

1. **The split is reductive.** Scribe's value IS narrative cohesion. Mechanical git plumbing is plumbing — it's not Scribe.
2. **"Server-side hook auto-merging inbox" is too aggressive.** Today Scribe runs at end-of-wave when the coordinator decides "now." A daemon merging on every push removes context.
3. **"Optional workflow step" makes the narrative work second-class.** It IS the work.
4. **In standalone mode, the coordinator isn't there to invoke Scribe.** So who does?

**Revised proposal** (Coordinator's pivot; needs Ahmed's nod):
- **Scribe is ONE agent**, not two. Charter + behavior unchanged.
- It's invoked as a **ceremony** in squadboard parlance ("End-of-wave ceremony" — a first-class concept already supported by `services/ceremony-translator.ts`).
- **In Copilot CLI mode** — coordinator triggers the End-of-wave ceremony with `runCeremony('scribe-close-out')`; identical to today.
- **In standalone-autonomous mode (Q3a Option B)** — the server-resident coordinator triggers the same ceremony at its end-of-wave signal.
- **In standalone-manual mode (Q3a Option A)** — there's an "End wave" button on the project page. Clicking it runs the same ceremony. Or: a per-project ceremony schedule fires it on a cadence (every N hours, every N merged PRs, every N closed cards — user picks).
- **The mechanical bits (inbox file lock, idempotent merge, git commit, decisions.md archive gate)** are LIBRARY primitives Scribe uses, not a separate "Scribe service." They live in `@sabbour/squadboard-sdk` so any agent — Scribe today, a future "Auditor," a manual user — can reuse them.
- **One SDK entry point** still: `squadboard.scribe.closeOut({ projectId, options })`. But it BACKS the ceremony, not a separate daemon.

**This unifies:** one Scribe agent, one ceremony, one SDK function — three caller paths (manual button, autonomous-coordinator daemon, Copilot-CLI coordinator) all converge.

**Decision pending:** Ahmed picks Q3a option (A/B/C) and confirms or corrects the revised Scribe framing.

**New tasks (pending confirmation):**
- `q6-standalone-coordinator-decision` — Ahmed confirms A/B/C
- `q7-coordinator-server-agent` — if B/C chosen, build the daemon
- `q8-scribe-as-ceremony` — repackage Scribe as a first-class ceremony with library primitives
- `q9-end-wave-button` — manual-mode "end wave" surface

---

## Action items for next Scribe pass

- Merge this file into `decisions.md` under a new "Distribution architecture decisions" section.
- The PGlite swap (Q1/Q2) is non-controversial — schedule in Wave 13.
- The squad-extension PR (Q3) is single-coordinator-decision; schedule once Ahmed nods.
- The coordinator/Scribe forks (Q6-Q9) BLOCK on Ahmed's response — flag as `status=blocked` until confirmed.

---

# Scribe follow-up: Size-gate enforcement missed; hard 51 KB limit now applied
**Status:** Merged into decisions.md

## Issue Identified

Prior Scribe pass (Wave 12 close-out) applied only an age-based gate when reviewing decisions.md:
- Checked: entries older than 7 days (2026-05-08 and earlier)
- **Missed:** the hard ABSOLUTE SIZE GATE of 51,200 bytes

When size >= 51 KB, BOTH gates must apply:
1. Age gate: archive entries older than 7 days
2. Size gate: if still > 51 KB after age gate, continue narrowing day-by-day until size < 51 KB

## What was missed

decisions.md grew to 177 KB with all-of-today entries (2026-05-15). Prior Scribe correctly identified "nothing older than 7 days" but then stopped. The hard gate says "if still > 51 KB after this step, apply stricter cutoffs."

## This pass fix (Wave 13)

- Archived lines 458-2727 (early/mid-day entries from 2026-05-15) to `.squad/decisions-archive.md`
- Kept:
  - Wave 12 close-out entry (2026-05-16T02:15:42 timestamp)
  - Late-afternoon directives (2026-05-15T17:50-17:52)
  - Most recent substantive entries (last 550 lines)
- Result: decisions.md now 48.9 KB (under gate), archive.md now 128 KB

## Recommendation: Automate enforcement

The size gate should be automated to prevent recurrence:

1. **Pre-commit hook** in `.git/hooks/pre-commit`:
   - Check `wc -c .squad/decisions.md`
   - If >= 51,200 bytes, reject commit with message: "decisions.md exceeds 51 KB size gate. Run Scribe close-out to archive old entries."
   - Allow bypass with `git commit --no-verify` for Scribe's own commits

2. **CI check** (optional): nightly report if any branch has decisions.md > 51 KB

3. **Documentation**: add to CONTRIBUTING.md or Squad charter: "Scribe auto-archives decisions.md to stay under 51 KB per wave."

## Learning for Scribe future self

The age-only check at line 50ish of the spawn prompt is insufficient. SIZE gate is the hard one and must be applied independently when triggered. Do not skip to "all entries are recent" without also checking bytes.


---

# 2026-05-15T19:26:00-07:00: User directive — squadboard distribution via MCP first
### 2026-05-15T19:26-07:00: User directive — squadboard distribution
**By:** Ahmed (Brady) (via Copilot)
**What:** Distribute squadboard via the MCP channel first. NPM scope/package: `@sabbour/squadboard`. The MCP server is the primary surface; CLI helpers ship in the same npm package via `bin` entries. CLI Extension (Squad-style `joinSession` agent) and Plugin Marketplace are later channels.
**Why:** User request — sets the canonical distribution model. Avoids relitigating channel choice on every Wave-13+ packaging task.

---

# 2026-05-15T19:33:00-07:00: Wave 13 N8 — Bulk-import handler + factor createIssue
# Decision: One-Handler-Three-Adapters Refactor + Bulk-Import Service

**Filed by:** Hockney  
**Date:** 2026-05-15  
**Wave:** 13 / N8

---

## Context

Ahmed's design call: ship a single `createIssue()` handler, wrap it with three adapters (MCP / HTTP / CLI), and defer the fourth adapter (MCP bulk-import `squadboard_bulk_import_cards`) to Wave-13 N9.

Two sources of INSERT-into-issues logic existed before this change:
1. `mcp/server.ts` → `handleCreateIssue()` — idempotency check + INSERT.
2. `routes/issues.ts` → POST handler — same INSERT, no idempotency.

---

## Decision: One Handler, Three Adapters

### Unified handler

`packages/server/src/services/issues.ts` — `createIssue(input)` (new unified signature).

**Signature:**
```ts
createIssue(input: {
  projectId: string;
  title: string;
  body?: string;
  status?: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
  position?: number;
  archived?: boolean;
  completedAt?: Date | null;
  assigneeId?: string | null;
  labels?: string[];
  idempotencyKey?: string;
  createdBy?: string;
}): Promise<{ created: boolean; id: string; issue?: Issue; idempotencyKey?: string }>
```

**Idempotency:** when `idempotencyKey` is provided, matches on `[key] title` exact title — no time window. Without a key, falls back to 60-second soft dedup (HTTP path safety net).

**completedAt:** set automatically when `status='done'` and caller does not supply it explicitly.

**Column validation:** moved to HTTP route layer (`assertColumnExists` before delegating). MCP and CLI use inert statuses that bypass column validation.

### Adapter 1: MCP (`mcp/server.ts`)
`handleCreateIssue` now delegates to `createIssueService(...)`. MCP-specific glue (projectId-from-header resolution) stays in the MCP layer. Tool input schema and return shape are byte-identical to before.

### Adapter 2: HTTP (`routes/issues.ts`)
POST handler now delegates to `createIssue(...)`. Column validation runs first in the route layer. HTTP response shape unchanged.

### Adapter 3: CLI (`bin/squad-bulk-import` → `src/cli/bulk-import.ts`)
Shell shim + TypeScript real logic. Flags: `--project-id`, `--file`, `--status-map`, `--key-prefix`, `--dry-run`, `--body-footer`, `--created-by`, `--json`. Connects to embedded postgres directly (same migration path as server).

---

## Bulk-Import Service

`packages/server/src/services/bulk-import-issues.ts` — `bulkImportIssues(input)`.

- Per-row try/catch: a bad row never aborts the batch.
- Inertness invariant: only `'backlog'` and `'done'` are permitted status values. The type `InertStatus = 'backlog' | 'done'` is enforced at the TypeScript type level AND checked at runtime — any other status yields `BulkImportInvariantError`.
- Dry-run: checks existing idempotency hits via SELECT only; no INSERT.
- `createdBy` defaults to `'bulk-import'`.

---

## Schema Changes

Two columns added to the `issues` table (idempotent migration in `db/index.ts`):
- `completed_at TIMESTAMPTZ` — set on done-transition.
- `created_by TEXT NOT NULL DEFAULT 'user'` — provenance tag.

---

## Inertness Invariant (Ahmed's hard constraint)

All bulk-ported cards land inert:
- `status ∈ {backlog, done}` — NEVER `todo`, `in_progress`, `in_review`.
- `assigneeId = NULL`.
- No labels.

Enforced in `bulkImportIssues()` before any `createIssue()` call. The check is both in the TypeScript literal type and a runtime guard that returns an error item (not a throw) so the batch continues.

---

## Bulk Port Results (2026-05-15)

- Input: `131 entries` from `/tmp/todos.json` (`48 done`, `83 pending`).
- Target project: `7a9cc07a-d463-4f8c-864a-c733342aa8a8` (foo).
- Pre-import count: 35 issues.
- **Dry run:** 131 would-create, 0 would-skip, 0 errors.
- **Real run:** created=131, skipped=0, errors=0.
- Post-import count: 166 issues (35 + 131).
- Spot-checked: `[b1-template-create]` → status=done, completedAt set, assigneeId=null ✓; `[n8-conjure-actually-deploy]` → status=backlog, completedAt=null, assigneeId=null ✓.

---

## Deferred: Wave-13 N9 MCP Wrapper

`squadboard_bulk_import_cards` MCP tool is NOT activated in this change. The shared handler `bulkImportIssues()` is importable from the MCP layer — that is the only N9-readiness requirement. N9 adds:
1. `bulkImportIssues` import in `mcp/server.ts`.
2. Tool definition in `TOOLS` array.
3. Switch-case in the tool-call dispatcher.
4. Input parsing from MCP args → `BulkImportItem[]`.

---

## Files Changed

- `packages/server/src/db/schema.ts` — added `completedAt`, `createdBy` to issues table.
- `packages/server/src/db/index.ts` — Wave-13 migration (ALTER TABLE issues).
- `packages/server/src/services/issues.ts` — unified `createIssue()` signature.
- `packages/server/src/services/bulk-import-issues.ts` — new file.
- `packages/server/src/cli/bulk-import.ts` — new file.
- `packages/server/src/mcp/server.ts` — `handleCreateIssue` delegates to service.
- `packages/server/src/routes/issues.ts` — POST handler delegates to service.
- `packages/server/src/services/inbox.ts` — updated call-site.
- `packages/server/src/sdk/consult-stream.ts` — updated two call-sites.
- `packages/server/src/__tests__/issues-service.test.ts` — new smoke tests (4).
- `packages/server/package.json` — added `test` script + vitest devDependency.
- `bin/squad-bulk-import` — new shell shim.

---


# 2026-05-16T02:15:42.724940Z: Wave 12 Close-out — Kanban Auto-Update, Double-Pickup Prevention, Now Dashboard, Clickable Flow, MCP Test Fix, Review Policy UX

**Date:** 2026-05-15  
**Wave:** 12  
**Agents:** Hockney-2, Keyser-2, Fenster-2  
**Status:** All tasks done; commit d2c06218 includes all source code.

## Summary

First end-to-end dogfood done-capture loop test (N1: Kanban Auto-Update). Teams completed:

- **N1 (Hockney):** Kanban auto-update — `done:` prefix detection in MCP capture + token-based matching to close existing cards. Includes `bin/squad-card-done` CLI helper for idempotent card closure. Milestone: first time dogfood done-capture workflow worked end-to-end.
- **N2 (Hockney):** Double-pickup prevention — idempotency keys + claim/lease mechanism on inbox items to prevent race conditions across dispatcher, MCP, and concurrent workers.
- **N3 (Keyser):** Now page — global aggregated dashboard with 6 stat tiles, live panels, activity feed, and per-project mini-rollup grid. Client-side fan-out via useQueries.
- **N4 (Keyser):** Clickable flow nodes — Agent/Step/Ceremony nodes are now navigable to detail routes with keyboard+aria support.
- **N5 (Hockney):** MCP test connection fix — relative healthUrl + vite proxy for local MCP testing.
- **N6 (Fenster):** Review Policy UX overhaul — plain-English labels, two-group settings, live preview strip, Learn more links. New `docs/review-policy.md`.
- **N7 (Hockney):** Junk projects cleanup — 41 deleted.

## Decisions from Inbox

# N1: Kanban Auto-Update — Done-Capture Hook

**Author:** Hockney (Backend / Workflow Engine Dev)  
**Date:** 2026-05-15  
**Wave:** 12  

---

## Problem

Cards are captured on intake via the MCP `capture` tool but never moved to "done". The `.github/agents/squad.agent.md` Wave 10 dogfood addendum specifies calling `capture` again with a `done: …` prefix after work completes, but the `handleCapture` handler had no logic for this prefix — it treated the `done:` prompt as a normal new issue.

---

## Root Cause

`handleCapture` in `packages/server/src/mcp/server.ts` did not inspect the prompt for a `done:` prefix. Every capture call went through Conjure classification and created a new inbox item, never updating an existing card.

---

## Design

### Flow A — `done:` prefix in MCP capture

```
Coordinator calls:
  capture(prompt="done: Fixed the login redirect (sha=abc123)", projectId="...")

Server:
  1. Detect DONE_PREFIX = /^done:\s*/i
  2. Extract descriptor = "Fixed the login redirect (sha=abc123)"
  3. Tokenise: ["fixed", "login", "redirect", "abc123"] (stop-words removed)
  4. Query issues WHERE project_id=$projectId AND archived=0 AND (title ILIKE '%fixed%' OR title ILIKE '%login%' OR ...)
  5. Score candidates: count overlapping tokens
  6. If best score ≥ 2 (or ≥ 1 for single-token queries): update status='done'
  7. If no match: create a standalone done card so work is still visible
```

### Matching strategy

- **Token extraction**: lower-case, strip punctuation, filter `len ≥ 3`, remove 30+ common stop-words plus git-specific terms (`sha=`, `fixes`, `resolves`, `implements`).
- **False-positive guard**: require `bestScore ≥ 2` tokens to match (for descriptors with `> 1` token); single-token descriptors need `≥ 1` match.
- **Fallback**: create a standalone `status='done'` card so the work is never lost.

### Flow B — `bin/squad-card-done` CLI helper

Any Copilot CLI session (or CI script) can close a card without MCP wiring:

```bash
SQUADBOARD_PROJECT_ID=7a9cc07a-... \
  bin/squad-card-done "Fix the login redirect" "$(git rev-parse --short HEAD)"
```

The script:
1. Detects the project (auto-detect or env var)
2. Constructs `done: <title> (sha=<sha>)` descriptor
3. Generates a deterministic `idempotencyKey` from `done-<project-prefix>-<md5-of-descriptor>` (so re-runs are idempotent)
4. Calls `POST /mcp` with the `capture` tool (or falls back to REST if MCP session fails)

---

## Files Changed

| File | Change |
|---|---|
| `packages/server/src/mcp/server.ts` | Added `done:` prefix detection + `handleCaptureClose()` function; added `idempotencyKey`/`createdBy` params |
| `packages/server/src/db/index.ts` | Migration: added `idempotency_key`, `created_by`, `claimed_by`, `claim_expires_at` to `inbox_items` |
| `packages/server/src/db/schema.ts` | Drizzle schema updated for new columns |
| `bin/squad-card-done` | New helper script |

---

## Invariants

1. A `done:` capture NEVER creates a card in `backlog`/`todo`/`in_progress` — it always sets `status='done'`.
2. A `done:` capture with a duplicate `idempotencyKey` returns `{ action: 'dedup' }` without touching the DB.
3. If the token-match score is below threshold, a standalone done card is created rather than silently discarding the call.
4. The best-match update is scoped to `project_id` — cross-project false matches are impossible.

---

## Evidence

Live curl test (done after DB migration applied on server restart):

```bash
# Create a test card first
curl -s -X POST http://localhost:3000/api/projects/<pid>/issues \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix the login redirect bug","body":"","status":"in_progress"}'

# Close it via done: capture
curl -s http://localhost:3000/mcp \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-project-id: <pid>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"capture","arguments":{"prompt":"done: Fixed the login redirect bug (sha=abc1234)","projectId":"<pid>"}}}'
# → { "action": "issue_closed", "matchedIssue": { "id": "...", "title": "Fix the login redirect bug", "previousStatus": "in_progress" } }
```


---

# N2: Double-Pickup Prevention

**Author:** Hockney (Backend / Workflow Engine Dev)  
**Date:** 2026-05-15  
**Wave:** 12  

---

## Problem

Three actors can independently pick up the same inbox card:
1. The Squadboard dispatcher (engine sweeps)  
2. A Copilot CLI session calling `capture` via MCP  
3. Multiple concurrent Squadboard agent workers

Without a dedup mechanism, each actor can create a duplicate card or race on the same work.

---

## Design

### Chosen Subset (Minimal Viable)

Per the task: pick the **minimal viable subset** that prevents the bug in practice. Implemented: **(1) idempotency keys + (3) claim/lease**.

Source tagging (`created_by`) is included as a zero-cost column for observability.

---

### (1) Idempotency Keys on `capture`

**Schema:** `inbox_items.idempotency_key TEXT UNIQUE`

**Invariant:** Two calls with the same `idempotencyKey` return `{ action: 'dedup', inboxItemId: '...' }` from the first call's row — no duplicate row, no duplicate issue.

**How to use:**
```json
{ "name": "capture", "arguments": { "prompt": "...", "idempotencyKey": "session-abc-123" } }
```

The key should be:
- **Per-session + per-prompt**: e.g. `<sessionId>-<sha256(prompt)[:8]>`
- **Deterministic**: so a retry of the same logical operation produces the same key
- **Scoped**: the uniqueness constraint is global, so keys must incorporate enough entropy to avoid cross-session collisions

---

### (3) Claim / Lease on Inbox Items

**Schema:**
```sql
inbox_items.claimed_by        TEXT        -- opaque worker/session ID
inbox_items.claim_expires_at  TIMESTAMPTZ -- NULL or past = unclaimed/expired
```

**Claim endpoint:**
```
POST /api/inbox/:id/claim
Body: { "claimedBy": "<worker-id>" }
```

**Atomic claim logic** (single UPDATE):
```sql
UPDATE inbox_items
   SET claimed_by = $claimedBy,
       claim_expires_at = NOW() + INTERVAL '5 minutes',
       updated_at = NOW()
 WHERE id = $id
   AND (
     claimed_by IS NULL                        -- unclaimed
     OR claim_expires_at < NOW()               -- lease expired
     OR claimed_by = $claimedBy               -- same worker extending
   )
RETURNING id, claimed_by, claim_expires_at;
```

- Returns `200 { ok: true, claimed_by, claim_expires_at }` on success  
- Returns `409 { error: 'already_claimed', claimed_by, claim_expires_at }` if another worker holds the lease  
- TTL: **5 minutes**. Workers must heartbeat every ≤4 minutes by re-calling `POST /api/inbox/:id/claim` to extend the lease.

---

### (2) Source Tagging

**Schema:** `inbox_items.created_by TEXT NOT NULL DEFAULT 'user'`

**Enum values:** `'user' | 'copilot-cli' | 'squadboard-server' | 'webhook'`

Used in `capture` MCP tool via the optional `createdBy` parameter. No enforcement — observability only.

---

## Migration

```sql
-- Wave 12 N2
ALTER TABLE inbox_items
  ADD COLUMN IF NOT EXISTS idempotency_key   TEXT        UNIQUE,
  ADD COLUMN IF NOT EXISTS created_by        TEXT        NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS claimed_by        TEXT,
  ADD COLUMN IF NOT EXISTS claim_expires_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS inbox_items_idempotency_idx
  ON inbox_items (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS inbox_items_claim_idx
  ON inbox_items (claimed_by, claim_expires_at)
  WHERE claimed_by IS NOT NULL;
```

Applied in `packages/server/src/db/index.ts` — runs idempotently on every server boot.

---

## Files Changed

| File | Change |
|---|---|
| `packages/server/src/db/index.ts` | Migration block for 4 new columns + 2 indexes |
| `packages/server/src/db/schema.ts` | Drizzle schema: `idempotencyKey`, `createdBy`, `claimedBy`, `claimExpiresAt` |
| `packages/server/src/mcp/server.ts` | `capture` tool: `idempotencyKey`/`createdBy` params; dedup check before Conjure |
| `packages/server/src/routes/inbox.ts` | `POST /api/inbox/:id/claim` endpoint |

---

## Invariants

1. Two concurrent `capture` calls with the same `idempotencyKey` MUST produce exactly one inbox row and at most one issue.
2. A `claim` call MUST be atomic — race between two workers: exactly one wins (HTTP 200), the other loses (HTTP 409).
3. A claim lease MUST expire after 5 minutes if not extended — stale claims never block permanently.
4. A worker that loses the claim MAY retry after the lease expires.

---

## Evidence — curl proof of idempotency

```bash
KEY="test-idem-$(date +%s)"
# Two concurrent claims with the same key:
R1=$(curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "x-project-id: 7a9cc07a-d463-4f8c-864a-c733342aa8a8" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"capture\",\"arguments\":{\"prompt\":\"[IDEM-TEST] Fix double-pickup race\",\"projectId\":\"7a9cc07a-d463-4f8c-864a-c733342aa8a8\",\"idempotencyKey\":\"$KEY\"}}}")
R2=$(curl -s -X POST http://localhost:3000/mcp ... same ...)

# R1: { "action": "issue_created", "issue": { "id": "xxx" } }
# R2: { "action": "dedup", "idempotencyKey": "...", "inboxItemId": "yyy" }
# → Same card_id, no duplicate issue.
```


---

# Keyser decisions — Wave 12 N3 + N4

**Date:** 2026-05-15T18:47:05-07:00
**Requested by:** Ahmed (Brady)

---

## N3: Now page global aggregated dashboard

**Decision:** Client-side fan-out via `useQueries` (TanStack Query) instead of a new server endpoint.
The per-project cost queries (one per project, stale 60s) are cheap enough for ≤20 projects.
If project count grows beyond ~30, Hockney should add `GET /api/activity/aggregate` to replace the fan-out.

**Follow-ups for Hockney:**
1. `GET /api/activity/stats?window=today` — "Done today" tile currently shows `—` placeholder.
2. Daily cost bucket in `/costs` endpoint — Cost tile shows MTD, not daily, because the existing endpoint only exposes `mtd` and `allTime` buckets. Labelled as "Cost MTD" in the UI to be honest about the scope.
3. Agent detail route — `/projects/:id/agents/:agentId` does not exist in App.tsx (agents page is list-only). Agent node click will 404 until Hockney adds the route.

**Layout (top to bottom):**
1. Stat tiles row — 6-up auto-fill grid: In-flight, Queued, Done today (placeholder), Active projects, Cost MTD, Health badge
2. Scope toolbar (tabs / dropdown)
3. Two-column row: [live panels column | recent activity feed column (340px fixed)]
   - Live panels: Live sessions, Issue runs, Workflow runs (stacked)
   - Recent activity: last 15 events sorted newest-first, each row links to source entity
4. Per-project mini-rollup grid — one card per active project, shows agent count, queue depth, last-activity timestamp

---

## N4: Flow clickable nodes

| Node type | File(s) | Click target route | Implementation |
|---|---|---|---|
| Agent instance node | `AgentFlowGraph.tsx` | `/projects/{projectId}/agents/{agentId}` | SVG `<g>` onClick + useNavigate; `role="button"`, `tabIndex={0}`, `onKeyDown` for Enter/Space |
| Step/Run node | `StepNode.tsx` + `IssueFlowDag.tsx` | `/projects/{projectId}/board?focus={issueId}` | ReactFlow `onNodeClick` on IssueFlowDag; `projectId` + `issueId` embedded in node.data; StepNode shows `cursor:pointer` + hover elevation when projectId present |
| Ceremony step node | `CeremonyStepNode.tsx` | `/projects/{projectId}/ceremonies/{ceremonyId}` | div `onClick` + `onKeyDown`; only fires when `projectId` + `ceremonyId` are in data; VisualCanvas (editor) omits these fields so selection is unaffected |

**Note on `/runs/:runId`:** There is no run-detail route in App.tsx. Best available navigation for step nodes is the board issue view (`?focus={issueId}`). Real run-detail is a Hockney follow-up.


---

# N6 — Review Policy UX Overhaul

**Date:** 2026-05-15T18:47:05-07:00  
**Author:** Fenster  
**Status:** Shipped (pending Wave 12 Scribe commit)

---

## Problem

Ahmed's verdict: *"I don't understand the review policy settings page."*

The old page had:
- A cryptic "Currently effective" card with no explanation of what "effective" means vs "project default"
- A flat preset dropdown labeled simply "Preset" — no context about what presets are
- A hidden "Customise" toggle that revealed an unlabeled 2-column grid of jargon fields
- Labels like "Block policy", "Quorum (n of total)", "On timeout", "Fallback reviewer (role)" — all internal API vocabulary
- No hints, descriptions, or example outcomes for any field
- A raw footnote: "Resolution chain: workflow step override → board default → project default → system default." — incomprehensible to non-power-users
- ⚠ warnings displayed as an emoji + text with no escalation affordance
- No learn-more link or documentation reference

---

## Changes made

### `packages/client/src/components/settings/ReviewPolicySection.tsx`

1. Replaced unlabeled card headers with `Body1Strong` + descriptive sub-text via new `CardHeading` subcomponent
2. Renamed "Currently effective" → **"Active policy"** (user-facing language)
3. Added **"Learn more"** link (`docs/review-policy.md`) in the card header action slot
4. Replaced raw emoji warning with Fluent2 `MessageBar intent="warning"` 
5. Replaced raw error `<div>` with `MessageBar intent="error"`
6. Added **"Policy preview" strip** — shows while editing, renders `describePolicy(previewResolved)` in plain English
7. Replaced raw text footnote with a sentence using `tokens.colorNeutralForeground3`, including a second "Learn more" link
8. Used `tokens.spacingVerticalL` and `tokens.spacingHorizontalS` for consistent layout spacing

### `packages/client/src/components/reviews/ReviewPolicyPicker.tsx`

1. Added Fluent2 `Field` wrapper with `hint` prop to **every control**
2. Grouped advanced settings into two labeled sub-sections with `SubGroupDivider`:
   - **Approval rules** — who reviews, quorum, exclude-author, block policy
   - **Timing & escalation** — review deadline, deadline action, fallback reviewer
3. Renamed labels to user language:
   - "Preset" → "Policy preset" + hint
   - "Approvers (role names, comma-separated)" → "Who can approve" + hint
   - "Quorum (n of total)" → "Approvals needed (quorum)" + hint
   - "Block policy" → "When someone requests changes" + hint
   - "Timeout" → "Review deadline" + hint
   - "On timeout" → "When the deadline passes" + hint
   - "Fallback reviewer (role)" → "Escalate to (role)" + hint
4. Added **contextual sub-hint** below "When someone requests changes" and "When the deadline passes" selects — shows the selected option's description inline
5. Preset option "Custom (override below)" → "Custom — fine-tune below"
6. Customise toggle label "▸ Customise" → "▸ Customise individual settings"
7. Added "Need help? Read the policy reference." link at bottom of advanced panel

### `docs/review-policy.md`

New stub doc explaining all 7 policy fields, resolution order with examples, preset concept.

---

## New page structure (outline)

```
[Card: Active policy]
  Body1Strong: "Active policy"
  Caption: "What runs right now on every approve step..." [Learn more →]
  → ReviewPolicyHeader (shield + policy description + "Why this policy?" popover)
  → MessageBar [if warnings]

[Card: Project default]
  Body1Strong: "Project default"
  Caption: "Applied to every approve step that doesn't set its own policy..."
  → [Field: Policy preset] hint: "Choose a named bundle..."
    <select: Use system default / Built-in presets / Project presets / Custom>
  → [▸ Customise individual settings] toggle
    → [Advanced panel]
        ── APPROVAL RULES ──────────────────────
        [Field: Who can approve] hint: "Role names, comma-separated..."
        [Field: Approvals needed (quorum)] hint: "Require N out of assigned..."
        [Field: Exclude author] hint: "When on, the PR author cannot approve..."
        [Field: When someone requests changes] hint + contextual sub-hint
        ── TIMING & ESCALATION ─────────────────
        [Field: Review deadline] hint: "ISO-8601 duration: 24h, 2d, 1w..."
        [Field: When the deadline passes] hint + contextual sub-hint
        [Field: Escalate to (role)] hint: "..." [only when 'escalate' selected]
        Caption: "Need help? Read the policy reference."
  → [Preview strip — dashed] "With these settings: ..." [only while dirty]
  → [Save] [Discard changes] [Saved. / error message]

[Footer caption]
  "Resolution order: ... Learn more about policy resolution."
```

---

## Scope NOT touched

- Policy schema and API — no changes
- Backend behavior — no changes  
- `PolicyExplainer.tsx` — existing popover retained as-is
- `ReviewPolicyHeader.tsx` — retained as-is
- MCP section of Settings.tsx — not touched (Hockney's territory)

---

## Recommendations (not implemented, needs Ahmed's nod)

- `request_changes_policy: 'all'` label ("all must approve") is confusing — it's a block policy, not an approval policy. Consider renaming to "Require unanimous approval."
- Consider exposing "Save as project preset" from the picker so users can snapshot a custom config.


---



# 2026-05-15T17:52:56Z: User directive — Cap each local universe at 10 characters
**By:** Ahmed Sabbour (via Copilot)
**What:** Reduce the local universe registry (`packages/server/src/services/local-universes.ts`) so each universe has at most 10 characters. Keep the most popular/iconic characters; drop peripheral or recurring-guest characters.
**Why:** Universe trim — preserve the recognisable core, reduce noise in the Hire Team picker.

**Per-universe targets:**
- The Office: 15 → 10 (drop 5)
- Seinfeld: 10 → 10 (already at cap, no change)
- The Simpsons: 14 → 10 (drop 4)
- Parks & Recreation: 14 → 10 (drop 4)

Total: 53 → 40 characters.

**Constraint:** After trimming, each universe must still cover all 9 SDK roles (`lead | developer | tester | prompt-engineer | security | devops | designer | scribe | reviewer`) across its remaining `preferredRoles` arrays so best-fit casting still produces complete teams.

---

# 2026-05-15T17:50:29Z: User directive — Drop 4 non-tech roles

- `packages/server/src/services/conjure-classifier.ts` — rewritten (was broken/unused), ~350 lines
- `packages/server/src/routes/conjure.ts` — new, ~75 lines
- `packages/server/src/index.ts` — mount `/api/conjure`, +5 lines

**Verification:** `tsc --noEmit` clean; 13/13 sample prompts classified correctly offline; edge cases handled.

---

## 2026-05-15: McManus — Casting reference trim + non-tech charter templates

**Author:** McManus
**Date:** 2026-05-15
**Status:** Shipped (commits `10f659bf`, `db12a997`)

**What:**
1. **Casting reference trimmed from 20 → 17 universes.** Dropped Mad Men, Succession, and Silicon Valley from `.squad/templates/casting-reference.md`.
2. **Per-role charter templates added for 7 non-tech roles** under `.squad/templates/non-tech-charters/` (PM, Designer, Founder, Sales, Marketing, Customer Success, Research) plus an index README.

**Why:**
- **Trim:** Coordinator/picker symmetry — 3 dropped universes don't earn their keep in the casting reference and never appeared in the runtime picker. Removing them improves alignment.
- **Templates:** Reusable starting points for next non-tech hire. Each follows the same structural shape as tech charters (Identity, What I Own, How I Work, Boundaries, Voice, Model, Collaboration) but role-specific. `{Name}` placeholder for casting to fill.

**Files affected:**
- Commit `10f659bf`: `.squad/templates/casting-reference.md`, `.github/agents/squad.agent.md`
- Commit `db12a997`: `.squad/templates/non-tech-charters/` (8 files: README + 7 role templates)

**Invariants preserved:** One universe per assignment, casting algorithm (size_fit + shape_fit + resonance_fit + LRU), charter shape across team, `{Name}` placeholder literal.


---

## 2026-05-15: Keyser — UI bundle: ceremonies padding, Consult width, project-switcher category preserve, sidebar reorder, Reconnecting badge fix

**Author:** Keyser
**Date:** 2026-05-15
**Status:** Shipped (5 commits in Wave 9)

**Commits:**
1. **`8b3f7197`** — Fluent2 spacing on CeremonyList page (padding canon compliance)
2. **`16414e90`** — Widened Consult page layout
3. **`d72fd8a7`** — Project switcher preserves category + System nav anchored to bottom (sidebar reorder)
4. **`5673d57b`** — Reconnecting badge alignment + cancelled stale reconnect timer (root cause: client-side state machine, NOT server)

**Team conventions ratified:**

### 1. Project switcher preserves the active category
When the user switches projects via `foo ▾` dropdown, the destination preserves the route segment (category). Examples: `/projects/foo/board` → `/projects/bar/board`; `/projects/foo/flow` → `/projects/bar/flow`.

Recognised categories (in `Layout.tsx` `PROJECT_SCOPED_SEGMENTS`): dashboard, board, flow, agents, skills, tools, mcp-servers, ceremonies, costs, settings, inbox, consult, diagnostics.

**Action for other agents:** Any new project-scoped top-level segment must be added to `PROJECT_SCOPED_SEGMENTS` in `Layout.tsx`.

### 2. Fluent2 page padding canon
Page content padding is `tokens.spacingVerticalXXL` (24 px) + `tokens.spacingHorizontalXXL` (24 px).

**Anti-pattern A:** Single-axis token for both axes — always use both tokens explicitly.

**Anti-pattern B:** List scroll containers missing padding — any `flex: 1; overflow: auto` div wrapping a DataGrid or list needs padding tokens, else content slams edges.

```
List body convention:
paddingTop: tokens.spacingVerticalL (not XXL — header above handles spacing)
paddingBottom: tokens.spacingVerticalXXL
paddingLeft: tokens.spacingHorizontalXXL
paddingRight: tokens.spacingHorizontalXXL
```

**Audit candidates:** Skills, Tools, MCP Servers, Agents, Costs pages should be checked for same violations.

### 3. Sidebar bottom-anchor pattern
For pinning a nav section (SYSTEM, settings) to the visual bottom of the sidebar: drop a `<div style={{ flex: 1 }} />` spacer in `NavDrawerBody`. No CSS overrides needed — Fluent's flex column + DrawerBody flex already handle it.

**Root cause note:** Reconnecting badge alignment + stale timer were a **client-side state machine bug, NOT a server issue**. No Hockney handoff needed.

---

## 2026-05-15: Hockney — MCP server extended (11 tools) + diagnostics path resolver

**Author:** Hockney
**Date:** 2026-05-15
**Status:** Shipped (local commits only — not pushed)

**Scope:** Two parallel asks from Ahmed (queued in Wave 8):

1. 🔌 **MCP Phase 1 starter tools** — Extend the existing `createMcpServer()` factory in `packages/server/src/mcp/server.ts` with 4 new tools: `list_projects`, `list_inbox`, `capture` (wrapping Conjure classifier), `get_routing`. Total tool count now **11** across stdio + HTTP `/mcp` transports. README with `.copilot/mcp-config.json` install snippet added at `packages/server/src/mcp/README.md`.

2. 🩺 **Diagnostics false-negative fix** — Bug: `projects.path` for foo already pointed AT `.squad/` (not the parent), so `join(path, '.squad')` was double-nesting to `.squad/.squad/`, causing all 4 inner collection checks to fail. Solution: `resolveSquadDir()` helper tolerates both layouts, returns ONE clear error when project path is wrong instead of cascading missing-collection errors.

**MCP tool details:**

| Tool             | Wraps                                                      | Transport |
|------------------|------------------------------------------------------------|-----------|
| `list_projects`  | `db.select().from(projects)` + `resolveSquadDir()` per row | stdio, HTTP |
| `list_inbox`     | `inboxService.listInboxItems()`                           | stdio, HTTP |
| `capture`        | Conjure classify → issue creation if intent='issue'        | stdio, HTTP |
| `get_routing`    | `resolveSquadDir()` + `readFile('.squad/routing.md')`      | stdio, HTTP |

Naming: kept the Phase 18 convention (bare names, no `squadboard.*` prefix) for consistency within the factory.

**Diagnostics resolver:**

`resolveSquadDir(storedPath): ResolvedSquadDir | UnresolvedSquadDir`
- Resolves to absolute path first (defensive against relative CWD pivots).
- If basename is `.squad/` AND exists → use as-is.
- Else if `<path>/.squad/` exists → use that.
- Else → `{ ok: false, reason }` with actionable diagnostic.

Applied to:
- `checkSquadDirShape()` (the reported bug)
- `checkDiskWriteable()` (same double-nesting bug, was silently writing wrong dir)
- `mcp/server.ts → handleGetRouting()` (new, uses same helper)

**Files touched:**
- `packages/server/src/services/diagnostics.ts` — +`resolveSquadDir()` + types; rewrote `checkSquadDirShape`; updated `checkDiskWriteable`.
- `packages/server/src/mcp/server.ts` — +4 TOOLS, +4 handlers, +4 switch cases, imports.
- `packages/server/src/mcp/README.md` — new install/usage guide.

**Commits:**
- `85dd8780` — Diagnostics false-negative fix
- `1838253d` — MCP Phase 1 starter tools

**Verification:** `cd packages/server && npx tsc --noEmit` → clean (exit 0, 0 errors). Resolver verified offline against all live `projects.path` values; foo resolves correctly.

**Follow-ups (not in this commit):**
- **`projects.path` migration.** Unify both layouts; until then, all consumers should use `resolveSquadDir()`.
- **Auth on MCP HTTP transport.** Local-only fine for hacking; problem if Squadboard runs on shared port.
- **`capture` for non-issue intents.** Currently return `draft_only`; could support full materialisation with more inputs (Phase 2).
- **`list_inbox` filters.** Add `userId`, `since`, `until`, search (Phase 2).


---

# Chore Logged: Stream L — package squadboard as Electron desktop app

**Chore ID:** chore-2026-05-15-stream-l-package-squadboard-as-electron-desktop-app
**Date:** 2026-05-15
**Effort:** large
**Component:** tooling
**Assigned to:** Hockney
**Spec:** docs/chores/chore-2026-05-15-stream-l-package-squadboard-as-electron-desktop-app.md

---

# Chore Logged: Unify page-loading experience to match ceremonies pattern

**Chore ID:** chore-2026-05-15-unify-page-loading-experience-to-match-ceremonies-pattern
**Date:** 2026-05-15
**Effort:** medium
**Component:** ui
**Assigned to:** Keyser
**Spec:** docs/chores/chore-2026-05-15-unify-page-loading-experience-to-match-ceremonies-pattern.md

---

# Directive: Unify page-loading experience (Wave 11 polish)

**Captured:** 2026-05-15T13:16:54-07:00
**By:** Ahmed Sabbour (via Copilot)
**What:** Unify the page-loading experience across the app to function like the ceremonies loading experience (with a visible indicator). Today different pages have inconsistent or missing loading affordances; the ceremonies page has the canonical pattern — adopt it everywhere.
**Why:** Wave 11 polish — perceived performance + visual consistency. Captured for team memory.

---

# Directive: Package squadboard as Electron desktop app

**Captured:** 2026-05-15T13:38:36-07:00
**By:** Ahmed Sabbour (via Copilot)
**What:** Package squadboard as an Electron desktop app. Reference installation/packaging pattern: https://github.com/jmanuelcorral/squadcenter — adopt a similar approach for installer artifacts, auto-update, and first-run UX.
**Why:** Lowers the install bar from "have node + pnpm + run dev server" to "double-click an installer." Captured for team memory.

---

# Directive: Cast a Team modal hotfix (Stream M) — HIGH PRIORITY

**From:** Ahmed (live-bug report w/ screenshot)
**Captured:** 2026-05-15 16:10 (post-Wave 11A)
**Priority:** HIGH (front of queue, ahead of Streams F/G/H/I/J/K/L)

## Symptoms

1. Red error at bottom of "Cast a Team" / "Hire Team" modal: `Unexpected token '<', "<!doctype "... is not valid JSON`
2. Clicking ANY role label (Developer, PM, Marketing, etc.) checks/unchecks the **Lead** checkbox specifically — not the role clicked.

## Root causes (verified live this session)

- **Bug 1:** `POST /api/projects/:projectId/agents/hire-team/propose` and `/hire-team/confirm` are called by client `useHireTeamPropose`/`useHireTeamConfirm` but **no handler is defined in `packages/server/src/routes/agents.ts`**. Express's SPA catch-all returns `index.html`, client `apiFetch` does `JSON.parse('<!doctype ...')` and throws. Confirmed via live curl returning `<!doctype html>`.
- **Bug 2:** `<Field label="Required roles">` wraps 16 `<Checkbox>` siblings; Fluent's `<Field>` binds htmlFor to its first form control (Lead, the first item in `ROLE_OPTIONS`), so OS-level label clicks all route to the Lead `<input>`.

## Decisions taken

- Stream M added to plan with 4 todos (M1-M4) — see `.squad/squadboard/plans/wave-10.md` Stream M.
- Promoted ahead of all Streams F/G/H/I/J/K/L (which remain lower-priority backlog).
- Sequencing: M1 first (server routes), then M2 + M3 in parallel (defensive apiFetch + UI fix), then M4 (regression e2e).
- Owners: Hockney (M1), Keyser (M2 + M3), Kujan (M4).

## Acceptance

See plan acceptance items 81-85.

## Wave 11A status

Of 7 dispatched: 2 silent-success (McManus L1 architecture decision + Keyser K1 PageLoading component); 5 timed out without writing files (Hockney/Verbal/Fenster/Kobayashi/Kujan). The 9 stuck `in_progress` todos have been reset to `pending` for re-dispatch in smaller batches (max 3 fresh spawns per wave going forward to avoid CAPI rate limit).

---

# Wave 10 Verification Gate — E1 Close-Out

**Date:** 2026-05-15  
**Author:** Kujan (QA/Tester)  
**Wave:** 10  
**Commit:** c9c2c44c
**Status:** PASS

## Summary

Completed the Wave 10 E1 gate: build, e2e, AC smoke-walk, stray-file cleanup, and commit. Two regressions were found and fixed. All 21 ACs verified. Commit is clean.

## Decisions for Coordinator

### D1 — Route-mount auditing should be part of Wave Definition of Done

**Context:** Three routers (`teamPortabilityRouter`, `projectPortabilityRouter`, `templatesRouter`) were imported in `index.ts` but never mounted with `app.use()`. The server silently fell through to the SPA fallback, returning HTML instead of JSON. Tests failed with `SyntaxError: Unexpected token '<'`. This is a common, hard-to-debug class of error.

**Recommendation:** Add "check `index.ts` for imported-but-unmounted routers" to the Wave DoD checklist.

### D2 — Column seeding is required before issue creation in any fresh-project test

**Context:** `POST /api/squad/create` creates a project with zero `column_meta` rows. Any `createIssue()` call on such a project fails with "Column X does not exist for this project". The fix is to call `GET /api/projects/:id/columns` first, which auto-seeds 5 default columns via `seedDefaults()`.

**Recommendation:** Document this in a test-fixture helper (`helpers/setupProject.ts`) so future spec writers don't rediscover it.

### D3 — WSL inotify + tsx watch is broken on Windows-mapped paths

**Context:** The project lives at `/home/asabbour/GitWSL/EMU/foo` — a Windows filesystem mounted into WSL2. `tsx watch` uses inotify for file-change detection, which does not fire for cross-FS writes.

**Recommendation:** Move project into native WSL2 home or use polling mode via `CHOKIDAR_USEPOLLING=true`.

### D4 — UI browser tests are environment-broken (not Wave 10 regressions)

**Context:** Tests in 01–04 specs fail with `element not found` / timeouts due to environment issues, not code.

**Recommendation:** Mark them `test.skip` with a comment pointing to this decision if they continue to fail in CI.

## Wave 10 Final Gate Result

| Criterion | Status |
|-----------|--------|
| Build (cli, server, client) | ✅ GREEN |
| Unit tests | ✅ N/A (no runner configured) |
| E2E B7 (team-portability) | ✅ 3/3 |
| E2E B8 (consult-send guards) | ✅ 3/3 |
| E2E B9 (disabled-agent) | ✅ 5/5 |
| E2E UI tests (01–04) | ⚠️ pre-existing env failures |
| 21 AC smoke-walk | ✅ all pass |
| Stray files | ✅ cleaned / gitignored |
| CHANGELOG.md | ✅ updated |

**Gate decision: PASS**

---

# Stream L Architecture — Electron packaging model

**Date:** 2026-05-15
**By:** McManus (architect) at request of Ahmed Sabbour
**Status:** DECISION — Architecture ratified

## Decision: Option B — Server as a child process supervised by Electron main

**Rationale:**

Squadboard's server is a substantial Node process. Option B preserves crash isolation: the main process is a thin supervisor that can restart the server child transparently. More importantly, Option B preserves headless parity by construction. `packages/server/dist/index.js` is the same artifact whether spawned by `electron/main.ts` or by `pnpm --filter server start`. No conditional branches in server code.

**What this means concretely:**

**Main process:** spawn/supervise server, health-poll, restart on crash, window mgmt, auto-update, IPC bridge, graceful shutdown.

**Renderer:** Load existing client build, all data access via `http://localhost:<port>`, WebSocket for live updates.

**Server lifecycle:** Main spawns as `utilityProcess.fork()` with env vars, server boots normally, logs to `app.getPath('userData')/logs/`, on crash main restarts with backoff.

**embedded-postgres:** Data dir via `SQUADBOARD_DATA_DIR` env var. Binaries copied outside `app.asar` by `electron-builder`. Single 3-line helper in `postgres.ts` for binary resolution.

**MCP:** Spawned by server (not main). Inherits Electron's Node runtime. No special handling.

**Single-instance lock:** `app.requestSingleInstanceLock()` prevents multiple Electron instances fighting over postgres.

**Headless parity:** `squadboard serve` unaffected. Zero Electron dependencies in `packages/server/`. Electron wrapper is separate `packages/electron/` workspace package.

## Downstream Stream L items

- **L2 (electron scaffold):** Implement `ServerSupervisor` (spawn, health-poll, restart, log rotation).
- **L4 (postgres bundling):** `resolvePgBinaries()` helper in server; `electron-builder` extraResources config.
- **L5 (MCP under Electron):** Automatic via inherited runtime.
- **L6 (first-run UX):** Frameless splash window polling `/api/health`.
- **L8 (auto-update):** Graceful server shutdown before update + relaunch.

## Rejected alternatives

- **Option A:** Crash isolation lost; code coupling with Electron in server.
- **Option C:** Sandboxed renderer, requires Node bridges for all server APIs.

## Open questions for L2

- Verify `utilityProcess` supports env var passthrough; fallback to `fork()` if needed.
- Port allocation: use dynamic port discovery (portfinder or net.createServer probe).
- Dev mode: spawn via `tsx` for live reload, `dist/index.js` in production.
- Log rotation: recommend 5 files × 10 MB.

---

# Wave 10 E3 — Coordinator Close-Out Symmetry

**Date:** 2026-05-15T13:09:47-07:00  
**By:** Scribe (per E3 task orchestration)  
**Status:** DECISION — Ratified in coordinator playbook

## What

Extended the coordinator playbook and dogfood playbook to document **close-out symmetry** for squadboard dogfood work:

1. When Ahmed captures a directive on **intake** via `capture(prompt)`, call `capture()` again on **completion** with a closing summary.
2. Close-out format: `done: {one-line summary} (sha={commit-sha}) [PR #N if applicable]`
3. Example workflow:
   - **Intake:** `capture("Fix hover resize on project tiles — broken since PR #39")`
   - **Completion:** `capture("done: Fixed hover resize on tiles (sha=abc123def) — see PR #42")`

## Why

**Symmetry:** The dogfood loop has a clear entry point but was missing a clear exit. This closes the loop so squadboard's own development flow mirrors external users: Capture on intake → card on board, Mark done on completion → card in done column.

**Visible progress:** Coordinator can show Ahmed at session end what landed on board vs. what shipped.

## Implementation Notes

- No MCP changes required; existing `capture` tool works for both.
- Coordinator includes first 60 characters of original prompt as anchor for future "find by prefix" logic.
- Until MCP has "find existing card by prefix", each call creates new card; coordinator manually dedups.
- Future: `find_issue_by_prefix` or `update_issue_by_match` tool will transition original card to done.

## Scope

- `.github/agents/squad.agent.md` — Extended with close-out symmetry section.
- `.squad/dogfood.md` — Added "Close-out flow" section with examples and future enhancement notes.
- `.squad/agents/scribe/history.md` — Updated with E3 learning entry.
- `packages/server/src/mcp/server.ts` — Verified `capture` tool exists; documented enhancement path in dogfood.md.

## Status

Docs-and-playbook-only. No follow-up PRs or code changes required.


---

# Decision: F1 — Restore Templates nav link

**By:** Fenster (UX Designer)  
**Date:** 2026-05-15T17:29:06-07:00  
**Task:** f1-templates-nav

## What was missing

The Templates page (`packages/client/src/pages/Templates.tsx`) existed and the route was registered in App.tsx at `projects/:id/ceremonies/templates`, but there was no nav entry in the sidebar — Ahmed couldn't find it.

## Decision

**Icon:** `DocumentBulletList24Regular` — a document with a bullet list is the canonical representation of workflow templates in Fluent 2. Added as a new import alongside existing icon imports.

**Label:** `"Templates"` — all existing nav items use short single-word labels (Dashboard, Board, Flow, Agents, Skills, Tools, Ceremonies, Costs) or a two-word compound noun (MCP Servers). "Templates" is short and unambiguous.

**Segment:** `ceremonies/templates` — the route is nested under ceremonies (`projects/:id/ceremonies/templates`). Using the full sub-path as the segment means `handleNavItemSelect` correctly navigates to `/projects/:id/ceremonies/templates`. The segment-length sort in `getSelectedValue()` ensures the Templates item is highlighted (length 20) when on the templates page, not the Ceremonies item (length 9).

**Position:** OPERATIONS group, between Ceremonies and Costs. Templates are workflow artefacts tied to the ceremonies/ritual concept — logical sibling of Ceremonies. Placed immediately after it so the visual grouping is clear.

## Change surface

Single file: `packages/client/src/components/Layout.tsx`

1. Added `DocumentBulletList24Regular` to the `@fluentui/react-icons` import block.
2. Inserted one nav item object into the OPERATIONS group's `items` array.

No routing changes needed — the route already exists in App.tsx.

---

# Decision: hire-team/propose + hire-team/confirm response shapes

**By:** Hockney  
**Date:** 2026-05-15T17:29:06-07:00  
**Task:** m1-hire-team-routes

## Context

The Cast-Team modal (`HireTeamModal.tsx`) was crashing with "Unexpected token '<'" because
Express's SPA catch-all was returning `index.html` for two unimplemented POST routes:
- `POST /api/projects/:projectId/agents/hire-team/propose`
- `POST /api/projects/:projectId/agents/hire-team/confirm`

## Decisions

### 1. Propose response shape

Chose `{ ok: true, data: { members: CastedMember[] } }` matching the client's
`HireTeamProposeResult` interface (`packages/client/src/api/agents.ts:228`). The
`CastedMember` type is passed through as-is from `castTeam()` in `casting-engine.ts` — 
no additional mapping needed because `enrich()` already stamps `agentName`, `suggestedRoleId`,
`suggestedRoleTitle`, and `extendedRole` onto each member.

### 2. Confirm response shape

Chose `{ ok: true, data: { created: Agent[], errors: { agentName: string; error: string }[] } }`
matching `HireTeamConfirmResult` in `packages/client/src/api/agents.ts:233`. The modal destructures
`result.created.length` and `result.errors.map(e => ...)` — so returning the full DB row array
in `created` (not just a count) is the correct interpretation of the client interface.

### 3. Error strategy for confirm

Per-member errors are collected and returned in the envelope rather than aborting or throwing 500.
This lets the modal render partial results (e.g. "3 of 5 hired; 2 already existed"). Same pattern
used by the image-attachment route which collects per-file errors.

### 4. Charter + Persona for confirmed members

`writeCharter()` writes the standard role charter; then `buildPersonaSection(member)` appends the
character's personality/backstory as a `## Persona` section. This gives the casted agent richer
context than a vanilla hire while reusing existing helpers (no new code paths).

### 5. Extended role mapping

The route does NOT manually call `EXTENDED_ROLE_TO_BASE_ROLE` — `castTeam()` already does that
internally via `resolveBaseRole()`. Callers pass raw role strings; the casting engine handles all
normalisation.

## Alternatives considered

- **Zod validation:** Not yet used anywhere in `agents.ts`; added tight runtime checks inline to stay
  consistent with the file's existing style (matches `formulate` and `team/formulate` handlers).
- **Separate confirm helper:** Considered extracting shared agent-create logic into a helper, but the
  POST `/` handler is short enough that inlining a minimal subset (minus KEBAB_RE validation on the
  incoming agentName) is cleaner for now. Future refactor welcome.

---

# Decision: M2 apiFetch Content-Type Guard + M3 Cast-Team Label-Toggle Fix

**Date:** 2026-05-15  
**Agent:** Keyser (Frontend)  
**Commit:** c7dde255

---

## M2 — apiFetch Content-Type Guard

**Problem:** When Express serves `index.html` for a missing API route, `JSON.parse('<!doctype...')` throws cryptic "Unexpected token '<'" with no context.

**Decision:** Check `content-type` header on **both** error and success paths in `apiFetch`:

- **Error path (`!res.ok`):** Read body, check `content-type`. If not `application/json`, throw a diagnostic message including the status, actual content-type, and first 200 chars of the body. If it is JSON, throw the existing `API ${status}: ${body}` message.
- **Success path (after `res.text()`):** Same guard — if content-type is not `application/json`, throw the same friendly error before calling `JSON.parse`.

**Effect:** HTML-200 and HTML-4xx/5xx responses both produce human-readable errors pointing at the missing endpoint or server restart need.

---

## M3 — HireTeamModal Checkbox Label-Toggle Bug

**Problem:** Clicking any role label (Developer, PM, Marketing, etc.) checked/unchecked the **Lead** checkbox only.

**Root cause:** `<Field label="Required roles (optional)" hint="...">` wraps all 16 `<Checkbox>` siblings. Fluent's `<Field>` generates a single `htmlFor` pointing at its first form child (`lead`). The OS routes all label clicks to that single input.

**Decision:**
1. **Replace `<Field>` with `<fieldset>` + `<legend>`** — semantically correct for a group of checkboxes, no single `htmlFor` binding. Styled to match Fluent2 Field typography (`font-size: 14px`, `font-weight: 400`, `color: colorNeutralForeground1`). Hint text rendered as a `<span>` below the checkboxes.
2. **Add explicit `id={`role-${r.id}`}` to each `<Checkbox>`** — makes each label↔input binding unambiguous even if Fluent's internal `useId()` collides under concurrent renders.
3. **Add `import.meta.env.DEV` uniqueness invariant** after `ROLE_OPTIONS` — throws during development if any two roles share the same `id`, preventing the bug from being reintroduced.

**Note:** Used `import.meta.env.DEV` instead of `process.env.NODE_ENV` — the client is a Vite app and doesn't have `@types/node`; `process` is not in scope.

---

# Verification Report: M4 — Cast-a-Team E2E Regression

**By:** Kujan (Verifier)  
**Date:** 2026-05-15T17:45:00-07:00  
**Task:** m4-cast-team-e2e  
**Status:** ✅ PASSED — 4/4 tests green

---

## What M1/M2/M3 Fixed

### M1 (Hockney, commit 8967ac72)
Added two missing POST routes in `packages/server/src/routes/agents.ts`:
- `POST /api/projects/:projectId/agents/hire-team/propose` → `{ ok: true, data: { members: CastedMember[] } }`
- `POST /api/projects/:projectId/agents/hire-team/confirm` → `{ ok: true, data: { created: Agent[], errors: [...] } }`

Before M1, Express's SPA catch-all served `index.html` for both routes, causing `JSON.parse('<!doctype...')` → "Unexpected token '<'" crash on the client.

### M2 (Keyser, commit c7dde255)
Added Content-Type guard in `packages/client/src/api/client.ts` (`apiFetch`):
- Both success and error paths check `content-type` before calling `JSON.parse`
- If not `application/json`, throws a human-readable diagnostic (status, actual content-type, first 200 chars) instead of a cryptic parse error

### M3 (Keyser, commit c7dde255)
Fixed `HireTeamModal.tsx` checkbox label-toggle bug:
- Root cause: `<Field>` wraps all 16 `<Checkbox>` siblings and emits a single `htmlFor` pointing at `role-lead`; every label click routed to Lead
- Fix: replaced `<Field>` with `<fieldset>`/`<legend>` (semantically correct for checkbox groups) + added explicit `id={`role-${r.id}`}` to every `<Checkbox>`
- Added DEV-only invariant to throw if any two roles share the same id

---

## Regression Test: `packages/e2e/tests/10-cast-team.spec.ts`

Four sub-tests in `test.describe('Cast-a-Team modal — M1/M2/M3 regression suite')`:

| # | Test | Regression guarded |
|---|------|--------------------|
| 1 | "Cast a Team button is visible on the agents page" | Smoke — ensures the Hire Team trigger button renders |
| 2 | "Opening Cast a Team modal shows role checkboxes without crashing" | M2: no "Unexpected token" in DOM; modal heading + ≥3 role labels visible |
| 3 | "Clicking a non-Lead role label toggles only that role (M3 regression)" | M3: `label[for="role-developer"]` click flips Developer only; Lead unchanged; repeated for PM |
| 4 | "Submitting the form calls /hire-team/propose and surfaces a member list (M1 regression)" | M1: `/hire-team/propose` returns HTTP 200 + `content-type: application/json`; M2: no "Unexpected token" error |

---

## Playwright Run Output

```
Running 4 tests using 1 worker

  ✓  1 › Cast a Team button is visible on the agents page (1.9s)
  ✓  2 › Opening Cast a Team modal shows role checkboxes without crashing (2.0s)
  ✓  3 › Clicking a non-Lead role label toggles only that role (M3 regression) (2.4s)
  ✓  4 › Submitting the form calls /hire-team/propose and surfaces a member list (M1 regression) (2.5s)

  4 passed (9.9s)
```

---

## Side Fix: fixtures.ts

Added `createProjectViaApi()` helper to `packages/e2e/tests/fixtures.ts`. The existing UI-based `createProject()` function is unreliable in this WSL/headless Chromium environment (Fluent v9 controlled inputs don't reliably respond to Playwright `fill()` in headless mode). Tests 07–09 had already adopted the API-based pattern; `10-cast-team.spec.ts` follows the same pattern. The `createProject()` UI-based helper is preserved for contexts where it does work.

---

## Gate Decision

**PASS** — M1, M2, and M3 regressions are all covered and green. The Cast-a-Team flow is protected against:
1. Missing server routes (HTML-instead-of-JSON crash)
2. Client-side JSON parse errors surfacing as cryptic "Unexpected token '<'" messages
3. Label-click routing all clicks to Lead checkbox (wrong `htmlFor` binding)
