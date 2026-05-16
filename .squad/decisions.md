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
# 2026-05-15T22:22:00-07:00: Directive — SDK must implement Scribe's EXACT algorithm

**By:** Ahmed (via Copilot Coordinator)
**Course-correction for:** Wave 14 q8-scribe-as-ceremony (Kobayashi spawn at 22:14)

## What Ahmed said

> "you need to implement the exact algorithm of scribe into the sdk"

## What this corrects

In my original Wave 14 dispatch prompt to Kobayashi, I told him to:
- Library-ify Scribe's mechanical primitives (correct)
- AND "fix the archive-gate bug" by making it more aggressive than the bare 7-day rule (INCORRECT — this was me overstepping)

## The rule

`squadboard.scribe.closeOut()` must implement the EXACT 9-step algorithm currently in squad.agent.md's Scribe spawn template (tasks 0–8):

0. PRE-CHECK: Stat decisions.md size + count inbox files
1. DECISIONS ARCHIVE: HARD GATE — `>= 20480` → archive older-than-30-days; `>= 51200` → archive older-than-7-days. NO additional aggressive policy unless the source rule changes.
2. DECISION INBOX: Merge inbox/* → decisions.md, delete, dedupe
3. ORCHESTRATION LOG: One file per agent in spawn manifest
4. SESSION LOG: Brief topic summary
5. CROSS-AGENT HISTORY: Append updates to affected agents' history.md
6. HISTORY SUMMARIZATION: HARD GATE at 15360 bytes
7. GIT COMMIT: Allowed-paths whitelist, individual `git add -- <path>`, `-F` message, no broad globs
8. HEALTH REPORT

## Why

Source-of-truth single point: squad.agent.md is the authoritative spec for Scribe behavior. The SDK is the LIBRARY-IFIED version of that spec. If the gate logic is buggy/insufficient, the FIX goes upstream into squad.agent.md FIRST, then the SDK mirrors it. The SDK never silently diverges from the agent spec — that would split Scribe into two implementations.

This is the "Scribe stays one agent" principle: one source of truth for the algorithm, multiple callers (CLI / daemon / button).

## Consequence

Kobayashi mid-task received this clarification via write_agent follow-up before he shipped an "improved" archive gate.

---

# 2026-05-15T22:12:00-07:00: Decision — Standalone Coordinator = Autonomous Daemon (Q6)

**By:** Ahmed (via Copilot Coordinator)
**Resolves:** Q6 (standalone coordinator model: Manual-only / Autonomous-daemon / Hybrid)

## Decision

**B — Autonomous daemon.** When squadboard runs standalone (no CLI coordinator), a background daemon process drives the ceremony cadence.

## Architecture

```
┌─────────────────────────────────────────────┐
│  squadboard-daemon (process)                │
│  ┌──────────────────────────────────────┐   │
│  │ Scheduler (cron-like)                │   │
│  │  - every N hours                     │   │
│  │  - every N merged PRs                │   │
│  │  - every N closed cards              │   │
│  └────────────────┬─────────────────────┘   │
│                   │ triggers                 │
│  ┌────────────────▼─────────────────────┐   │
│  │ Ceremony invoker                     │   │
│  │  - resolves ceremony from registry   │   │
│  │  - calls SDK (squadboard.scribe.…)   │   │
│  │  - logs result                       │   │
│  └────────────────┬─────────────────────┘   │
│                   │                          │
│  ┌────────────────▼─────────────────────┐   │
│  │ Commit/push loop                     │   │
│  │  - stage Scribe outputs              │   │
│  │  - commit                            │   │
│  │  - push (if configured)              │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Detection rules (daemon is standalone-only)

The daemon MUST be a no-op when any of these conditions hold:
- `SQUADBOARD_COORDINATOR=cli` set (explicit CLI mode)
- CLI coordinator heartbeat detected (e.g., file lock at `~/.squadboard/coord.lock` updated in the last 5 min)
- `DATABASE_URL` points to a non-local PG (hosted mode — separate orchestrator likely)

Otherwise, the daemon runs the schedule. This prevents double-fire when the user is actively coordinating via CLI.

## Manual override (Q9 reframed)

The "End Wave" button on the project page becomes a **manual trigger** that forces the ceremony immediately, ignoring the schedule. Useful when:
- The user wants to ship a wave before the next schedule tick
- The daemon is paused/disabled and the user wants a one-shot
- Power-user override

## Implications

- **Q7 unblocked:** `q7-coord-daemon-scaffold` is now Wave-14 candidate. Scope: process harness + scheduler + ceremony invoker + commit/push loop + detection guards.
- **Q9 reframed:** `q9-end-wave-button` is the manual override on top of the daemon, not the primary mechanism. Lower priority than q7.
- **Q8 still primary:** Both the daemon (q7) and the button (q9) call into the same SDK function (`squadboard.scribe.closeOut()` from q8). q8 must ship first or alongside q7.
- **Defaults:** daemon-on by default for standalone, off in CLI mode. User can `squadboard daemon disable` to opt out.

---

# 2026-05-15T22:05:00-07:00: Decision — Keep PGlite as default

**By:** Ahmed (via Copilot Coordinator)
**Supersedes:** `.squad/decisions/inbox/copilot-correction-2026-05-15T22-00-pg-misread.md` (resolved)

## Decision

**Default local database stays PGlite** (`@electric-sql/pglite@0.4.5`, in-process WASM PostgreSQL).

## Context

Ahmed reviewed the three options (revert to embedded-postgres / keep PGlite / BYO-only PostgreSQL) after I surfaced my misread of his original "no use embedded pg" directive. He picked **keep PGlite**.

## Rationale (per Ahmed's pick)

- PGlite IS PostgreSQL — same SQL surface, same schema features (gen_random_uuid, JSONB, enums, ON CONFLICT, partial indexes), all 17/17 verified by Hockney's spike (commit `ca257838`).
- Local-first single-user kanban fits PGlite's single-connection model.
- Electron/standalone packaging is dramatically simpler with no per-platform Postgres binaries.
- `DATABASE_URL` still routes to real PostgreSQL for cloud/team/multi-user deployments — production unaffected.

## Implications

- Commit `ca257838` (the PGlite swap) is now ratified.
- `db/.deprecated/postgres.ts` can be deleted in a future cleanup wave — no rollback planned.
- `@sabbour/squadboard` distribution story: zero-config (`npx`), 5MB WASM, no port collisions, no native binary downloads.
- Document `DATABASE_URL` override clearly in the install docs so teams/cloud users know the upgrade path.
- **Wave 14 priority:** ship `q1-followup-data-migration` — foo's 166 bulk-ported cards are stranded in the legacy `~/.squadboard/data/` embedded-PG cluster and invisible to the new PGlite cluster. Migrator must export from legacy cluster → import into PGlite cluster on first boot.

---

# 2026-05-15T22:00:00-07:00: Correction — PG directive parse error

**By:** Copilot (Coordinator), correcting prior interpretation
**Requested by:** Ahmed

## What I got wrong

On 2026-05-15T19:50 I captured Ahmed's "no use embedded pg" as the directive "do not use embedded Postgres" and dispatched Hockney to swap `embedded-postgres` for **PGlite** (commit `ca257838`). The actual meaning was: **"No — use PostgreSQL (and not SQLite)"** — i.e., Ahmed was rejecting the hypothetical SQLite alternative I had floated, not rejecting embedded-Postgres.

## What this means

- The Wave 13 PGlite swap was based on a misinterpretation.
- However, **PGlite IS PostgreSQL** — it is the PostgreSQL source code compiled to WebAssembly. It speaks identical SQL, supports the same features (gen_random_uuid, JSONB, enums, ON CONFLICT, partial indexes — all 17/17 verified in Hockney's spike). Semantically Ahmed's intent ("use PostgreSQL") is still satisfied.
- The implementation runtime, however, is different from what we had (`embedded-postgres` is a Node module that downloads + runs the real PostgreSQL binary; PGlite is the WASM in-process variant).

## Three real options for Ahmed

| Option | Default UX | Cloud UX | Tradeoffs |
|---|---|---|---|
| **A. Revert to `embedded-postgres`** | npm install downloads PG binary per platform; server spawns localhost:54321 | DATABASE_URL → cloud PG | Real PG runtime locally. ~50MB. Per-platform binaries. Port-collision risk. Largest Stream-L (Electron) packaging risk re-introduced. |
| **B. Keep PGlite** (current state, `ca257838`) | npm install pulls 5MB WASM; runs in-process | DATABASE_URL → cloud PG | Real PostgreSQL semantically. No per-platform binaries. Single connection (fine for solo-user kanban; problematic for multi-user). |
| **C. BYO PostgreSQL only** | User installs PostgreSQL themselves; squadboard connects via DATABASE_URL or fails to boot | Same as A/B | True real-PG, full multi-connection. Worst zero-config UX — `npx @sabbour/squadboard init` now requires a separate install step. |

DATABASE_URL override has always worked across A/B/C — production / cloud / shared-instance deployments connect to real Postgres regardless of which default we pick.

## Recommendation

**B (keep PGlite) for the default zero-config experience**, because:
- Squadboard is local-first and primarily single-user; PGlite's single-connection model fits.
- The Stream-L (Electron) packaging story is dramatically simpler (no per-platform binaries).
- Schema is unchanged — exact same Drizzle definitions, exact same SQL, exact same migrations.
- We still document + support DATABASE_URL → real Postgres for teams/cloud.

**If Ahmed wants A**, the revert is mechanical: `git revert ca257838`, restore `db/postgres.ts` from `db/.deprecated/postgres.ts`, drop `@electric-sql/pglite` from deps, re-add `embedded-postgres`. ~30 minutes of work.

**If Ahmed wants C**, document BYO + remove the embedded default entirely. Slightly more work because seed/dev scripts assume a one-command boot.

## Action

Pending Ahmed's direction. Until he picks, treat commit `ca257838` as provisional.

---

# 2026-05-15T19:39:32-07:00: Hockney — PGlite replaces embedded-postgres in server

**Author:** Hockney
**Date:** 2026-05-15T19:39:32-07:00
**Status:** Implemented
**Wave:** Wave 13 (Q1 PGlite migration spike + swap)

Ahmed directed that the standalone server must move off `embedded-postgres`. The coordinator's agreed replacement: **PGlite** (`@electric-sql/pglite`) — pure-WASM Postgres, ~5 MB, no per-platform native binaries, in-process, Drizzle has first-class `drizzle-orm/pglite` adapter.

## What Changed

### Files added / modified

| File | Action | Summary |
|------|--------|---------|
| `packages/server/src/db/pglite.ts` | **NEW** | PGlite engine: `startPglite()`, `stopPglite()`, `createPoolAdapter()`, shutdown handlers. `startEmbeddedPostgres` re-exported as alias for backward compat. |
| `packages/server/src/db/index.ts` | **MODIFIED** | Drizzle driver swapped from `drizzle-orm/node-postgres` to `drizzle-orm/pglite`. `_pool` is now always `PoolLike` (PGlite adapter or wrapped pg.Pool). `initDb()` branches on `PGLITE_SENTINEL` vs real connection string. |
| `packages/server/src/index.ts` | **MODIFIED** | Import updated: `postgres.js` → `pglite.js`; `startEmbeddedPostgres` → `startPglite`. |
| `packages/server/src/cli/bulk-import.ts` | **MODIFIED** | Same import/call update. |
| `packages/server/src/mcp/index.ts` | **MODIFIED** | Same import update. |
| `packages/server/src/scripts/seed-wave10-backlog.ts` | **MODIFIED** | Same import update. |
| `packages/server/src/db/.deprecated/postgres.ts` | **MOVED** | Old embedded-postgres code preserved in `.deprecated/` (not compiled). |
| `packages/server/src/scripts/pglite-spike.ts` | **NEW** | Feasibility spike script (17 tests, all pass). |
| `packages/server/package.json` | **MODIFIED** | Added `@electric-sql/pglite ^0.4.5`. Removed `embedded-postgres`. `pg` retained for DATABASE_URL external-Postgres fallback. |

### Drizzle driver swap

```
Before:  import { drizzle } from 'drizzle-orm/node-postgres';  (Pool-based)
After:   import { drizzle } from 'drizzle-orm/pglite';          (PGlite-direct)
```

When `DATABASE_URL` is set (CI / cloud), a real `pg.Pool` is still created, passed to `drizzle-orm/node-postgres`, and wrapped in a `PoolLike` adapter so `getPool()` callers remain unchanged.

### Key design decisions

1. **`query()` vs `exec()` routing**: PGlite's `query()` uses the extended query (prepared statement) protocol and rejects multi-statement SQL. The pool adapter detects param-less calls and routes them through `pglite.exec()` (simple protocol, multi-statement OK). Parameterized calls (`query(sql, params)`) use `pglite.query()` for safety.

2. **`rowCount` ↔ `affectedRows` mapping**: PGlite returns `affectedRows`; pg returns `rowCount`. The adapter maps them transparently. Sweeper code that reads `.rowCount` continues to work.

3. **Data directory**: `~/.squadboard/data/pglite/` — keeps the parent dir unchanged; the `pglite` subdir reserves space for a one-time migrator (see Open follow-ups).

## PGlite version pinned

`@electric-sql/pglite@0.4.5`

## Schema compatibility table (spike results)

| Feature | Status | Notes |
|---------|--------|-------|
| `gen_random_uuid()` as column DEFAULT | ✅ PASS | Bundled pgcrypto in PGlite |
| `TIMESTAMPTZ` columns | ✅ PASS | Full round-trip |
| `JSONB` columns (`DEFAULT '{}'::jsonb`, `DEFAULT '[]'::jsonb`) | ✅ PASS | |
| Custom ENUM types via `DO $$ BEGIN CREATE TYPE … END $$` | ✅ PASS | |
| `ON DELETE CASCADE` foreign keys | ✅ PASS | Cascade verified by deleting parent |
| `ALTER TYPE … ADD VALUE IF NOT EXISTS` inside `DO $$ BEGIN … END $$` | ✅ PASS | |
| `CREATE INDEX … WHERE …` (partial indexes) | ✅ PASS | |
| `CREATE UNIQUE INDEX … WHERE scope = 'system'` (partial unique index) | ✅ PASS | |
| `INSERT … ON CONFLICT (slug) WHERE scope = 'system' DO UPDATE` | ✅ PASS | Partial-index conflict, upsert, re-ran to exercise both paths |
| `DO $$ BEGIN ALTER TABLE … ADD CONSTRAINT … EXCEPTION WHEN duplicate_object THEN NULL END $$` | ✅ PASS | |
| `IF EXISTS (SELECT 1 FROM information_schema.tables …)` | ✅ PASS | |
| `SELECT … FROM pg_type WHERE typname = '…'` | ✅ PASS | |
| `ALTER TABLE … ALTER COLUMN … TYPE TEXT USING status::TEXT` + `DROP TYPE` | ✅ PASS | Dynamic-columns migration |
| `BYTEA` column type | ✅ PASS | |
| `NUMERIC(10, 2)` / `NUMERIC(12, 6)` / `NUMERIC(5, 4)` | ✅ PASS | |
| Positional `$1`/`$2` parameterized queries | ✅ PASS | |
| `affectedRows` (pg's `rowCount` equivalent) | ✅ PASS | Mapped in pool adapter |
| Multi-statement SQL blocks (DDL migrations) | ✅ PASS | Requires `exec()` not `query()` — handled in adapter |

**Total: 17/17 PASS. Zero incompatibilities.**

One behavioral difference discovered and handled: PGlite `query()` uses the extended protocol (single statement only). Multi-statement DDL blocks must go through `exec()`. The pool adapter automatically routes based on whether params are provided.

## Data-migration story (deferred)

Existing users with data in the old `~/.squadboard/data/` embedded-postgres cluster are not automatically migrated. A one-time migrator is deferred (see Open follow-ups). On first boot with an empty `~/.squadboard/data/pglite/`, the server runs `bootstrapSchema()` as normal — fresh start. Existing data stays in the old dir untouched.

## Known PGlite limitations to watch

| Concern | Detail |
|---------|--------|
| **Single connection** | PGlite is in-process with no real connection pooling. `pool.connect()` returns a thin wrapper over the same instance. Concurrent transactions are serialized. For squadboard's current single-process architecture this is fine. |
| **No network access** | PGlite can't be queried by external tools (psql, pgAdmin). Use `drizzle-kit studio` or add a diagnostic route. |
| **WASM startup ~400ms** | Acceptable for a local server; not suitable for Lambda/edge cold starts. |
| **Memory footprint** | PGlite keeps the entire DB in WASM memory. For very large boards this could grow; monitor with `process.memoryUsage()`. |
| **`BEGIN`/`COMMIT`/`ROLLBACK` via exec()** | Callers using `client.query('BEGIN')` / `client.query('COMMIT')` will route through `exec()` (no params). PGlite handles these correctly as single-statement SQL. |
| **No `FOR UPDATE SKIP LOCKED` parallel** | PGlite is single-connection; `SELECT … FOR UPDATE SKIP LOCKED` works but concurrent callers serialize naturally. The stepper invariant is safe. |

## Open follow-ups

### q1-followup-data-migration (file as SQL todo)

**Title:** One-time migrator: embedded-postgres → PGlite

**Description:** On first boot of the new server, check if `~/.squadboard/data/postgres/` exists (legacy embedded-postgres cluster). If so:
1. Start the old cluster on a temporary port (or use `pg_dump` directly against the cluster directory).
2. Pipe the dump into PGlite via `exec()`.
3. Rename `~/.squadboard/data/postgres/` to `~/.squadboard/data/postgres.legacy` to prevent re-migration.
This unblocks users who have existing squadboard board data from the embedded-postgres era (issue history, projects, agents, ceremonies).

**Priority:** Medium (blocks users with pre-migration data).
**Owner:** Hockney
**Blocked by:** Nothing (PGlite is now live; migrator can land in Wave 14).

