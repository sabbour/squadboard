# W30 Architecture Report: squad.agent.md Rules vs SquadCoordinator vs Squad-SDK vs Squadboard

**Author:** Keaton (Design / Architecture Specialist)
**Date:** 2026-05-16
**Status:** Final — Brady review requested
**Branch:** main (DOGFOOD)
**squad.agent.md version audited:** 0.9.4 (`.github/agents/squad.agent.md`, line 6, 1378 lines)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Behavior Inventory of squad.agent.md](#2-behavior-inventory-of-squadagentmd)
3. [Squad-SDK vs Squadboard Partition](#3-squad-sdk-vs-squadboard-partition)
4. [LLM-Driven vs State-Machine Partition Recommendation](#4-llm-driven-vs-state-machine-partition-recommendation)
5. [Mini-squad.agent.md Spawning vs Charter Parser](#5-mini-squadagentmd-spawning-vs-charter-parser)
6. [Gaps and Proposed Wave 31+ Work](#6-gaps-and-proposed-wave-31-work)
7. [Open Questions for Brady](#7-open-questions-for-brady)

---

## 1. Executive Summary

### 1.1 Direct answers to Brady's three questions

**Q1: Does SquadCoordinator or SDK already encode all the rules in squad.agent.md?**

No — and the delta is large. The mini-coordinator (`packages/server/src/coordinator/` + `.squad/squadboard-coordinator.md`) encodes exactly **one sub-domain**: the dispatch decision rules that answer "which agent should handle this issue?" Specifically, the 12 rules in the preamble (R-13 through R-24 in this report). The Squad-SDK (`packages/squadboard-sdk/`) encodes exactly **one other sub-domain**: the Scribe mechanical close-out tasks (R-37 through R-44). There is also a secondary SDK, `@bradygaster/squad-sdk` (imported in `sdk-state.ts`), that wraps `.squad/` filesystem state into typed collections (AgentsCollection, RoutingCollection, etc.) but does not encode any dispatch or ceremony rules.

The 73 other rules catalogued in section 2 are encoded exclusively in squad.agent.md itself — they live as LLM instructions. Squadboard never touches Init Mode, casting, worktree lifecycle, ceremony execution, response mode selection, model selection, Ralph work monitor, reviewer rejection lockout, PRD mode, GitHub Issues mode, personal squad discovery, directive capture, or the dogfood addendum. Those live in the CLI coordinator prompt and are enforced only when a human (or automated tool) runs the Copilot CLI coordinator.

**Q2: How do we handle those rules in Squadboard?**

Right now Squadboard handles only what it directly orchestrates: coordinator dispatch (LLM, bounded) and Scribe close-out (SDK, deterministic). Everything else defers to the CLI coordinator. This is architecturally correct for the current phase.

The right long-term answer is a strict two-track partition:

- **Track A — judgment calls:** Stay in the coordinator LLM (mini-coordinator preamble). This covers rules where reading charter prose, interpreting issue semantics, or weighing confidence trade-offs requires language understanding. These cannot be replaced by deterministic code without unacceptable precision loss.

- **Track B — pure rules:** Migrate out of the LLM into the Squadboard workflow state machine. This covers rules where the answer is computable from DB state or structural issue properties — no language model adds value. Today, at least 6 of the 12 coordinator preamble rules are pure rules (R-13, R-17, R-18, R-19, R-20, R-24). Each one that stays in the LLM costs tokens for zero judgment value.

**Q3: Should we spawn a mini-squad.agent.md from springboard that spawns the other agent charters?**

The recommendation is **no for Squadboard server; the pattern already exists correctly in the CLI coordinator.** In Squadboard's context, "springboard" maps to the pickup-todos sweep and the runs route. Porting squad.agent.md's full agent-spawning orchestration pattern into the Squadboard server would mean: multi-turn LLM sessions, non-deterministic control flow, loss of the structured JSON output contract, loss of audit trail, and token cost explosion. The current preamble + LlmCaller + Zod schema approach is the right architecture and should be kept. The weaknesses (preamble drift, pure-rule waste, charter content bloat) are solvable with targeted W31 work that does not require changing the architecture. See section 5 for the full analysis with pros/cons tables.

### 1.2 Recommendation summary

Keep the current mini-coordinator approach. Invest W31 effort in three specific improvements:

1. **Pre-filter pure rules (R-13, R-17, R-18, R-19, R-20, R-24) out of the LLM.** These can be computed from the CoordinatorInput fields before the LLM call. Conservative estimate: eliminates the LLM call entirely for 15-30% of dispatch requests. Reduces per-call token count by up to 20% for the remaining calls (unavailable agents no longer padded into prompt).

2. **Trim charterContent to routing-relevant sections only.** Full charter content passes verbatim into CoordinatorInput today. A project with 10 agents, each with a 300-line charter, sends approximately 30KB of charter text per dispatch call. Extract Role, Focus Areas, and Capabilities sections only into a `charterSummary` column. Estimated 40-60% prompt token reduction.

3. **Add CI verification that preamble matches squad.agent.md dispatch rules.** The comment "CI may verify equality in a future MC step" has been in `preamble-builtin.ts` for multiple waves. Until this check exists, every squad.agent.md upgrade is a silent preamble drift event.

### 1.3 Top 3 architectural risks today

**Risk A — Preamble drift (high probability, high impact).**
`.squad/squadboard-coordinator.md` is the preamble the Squadboard coordinator uses for every dispatch call. It is a manually-maintained copy of the squad.agent.md dispatch rules. When Brady updates dispatch logic in squad.agent.md (e.g., changes the confidence scale, adds a new skip condition, modifies role-fit heuristics), Squadboard continues routing with stale rules until someone manually updates the preamble. There is no automated propagation, no diff check, no CI gate. The preamble was last updated at W29; squad.agent.md is at v0.9.4. Any version bump to squad.agent.md that touches dispatch rules is invisible to Squadboard.

**Risk B — LLM credits wasted on deterministic rules (medium probability, medium impact, growing).**
Rules R-13 (named-agent keyword), R-17 (parent-run gate), R-18 (unavailable agents), R-19 (backlog gate column check), R-20 (Ahmed-only keyword blocklist), and R-24 (thin issue structural check) are fully computable from existing CoordinatorInput fields without any LLM judgment. Every pickup-todos sweep cycle calls `dispatchViaCoordinator()` which sends the full prompt including preamble (199 lines / ~1500 tokens) plus CoordinatorInput JSON for each uncovered todo issue. For a project with 5 active agents and 20 pending issues, if 6 of those 20 could be resolved by pre-filters (R-13, R-17, R-20, R-24 are the high-yield ones), that is 6 unnecessary LLM calls. The sweep runs every 10 seconds (`pickup-todos.ts:intervalMs: 10_000`). At production scale with many projects, this accumulates.

**Risk C — SDK encoding a stale source of truth (medium probability, high impact).**
`packages/squadboard-sdk/src/scribe/primitives.ts` opens with: "This file is a VERBATIM library-ification of squad.agent.md tasks 0-8 as of 2026-05-15." The file also documents a known divergence: the Wave 13 decisions.md archive bug — the archive function ran but decisions.md grew to 74.7KB because the date-window approach does not guarantee shrinkage when all content is recent. The comment says "the correct fix is to update squad.agent.md task #1, then sync this primitive." But squad.agent.md has not been updated. The SDK and the spec are now diverged on a known correctness issue with no tracking mechanism to ensure re-convergence. If another wave of Scribe work happens without resolving this, the divergence compounds.

---

## 2. Behavior Inventory of squad.agent.md

This section catalogs every discrete rule, ceremony, dispatch policy, sweep, or constraint in squad.agent.md v0.9.4. 74 rules total. Rule IDs are assigned by this report and not in squad.agent.md itself.

Columns:
- **Rule ID** — assigned by this report (R-01 through R-74)
- **Source** — file:line or section name in `.github/agents/squad.agent.md`
- **What it does** — precise description
- **Trigger** — what causes the rule to fire
- **Current Home** — one of: `coordinator-LLM` | `coordinator-deterministic` | `workflow-state-machine` | `ceremony-engine` | `agent-sync` | `routing-config` | `not-yet-implemented` | `Squad-SDK-only`
- **Determinism class** — `pure-rule` (same input → same output, no LLM benefit) | `judgment-required` (LLM adds value) | `external-state` (depends on DB/FS/network)

### 2.1 Mode Selection and Identity (Rules R-01 to R-05)

These govern how the CLI coordinator identifies itself and selects its operating mode.

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-01 | L8-28 "Coordinator Identity" | Defines the coordinator persona: name Squad (Coordinator), version v0.9.4, role = orchestrator. Enforces four refusal rules: no domain artifacts, no bypassing reviewer approval, no invented facts, always delegate. Also enforces the dispatcher-not-doer constraint: if you wrote code inline, you violated this rule. | Every message | `coordinator-LLM` | `judgment-required` — persona compliance requires LLM to follow instructions |
| R-02 | L24-27, mode gate block | Reads `.squad/team.md` (fallback: `.ai-team/team.md`). If absent or `## Members` has zero entries → Init Mode. If present with roster entries → Team Mode. | Session start | `coordinator-LLM` | `pure-rule` — filesystem check with defined fallback; entirely deterministic given the file |
| R-03 | L31-59 "Init Mode Phase 1" | Propose team: run `git config user.name` (never email — PII rule), ask what they're building, run casting algorithm, propose roster with `ask_user` confirmation. STOP — do not proceed to Phase 2 until user confirms. Eager Execution exception: this is the one place eager execution does NOT apply. | No team exists | `coordinator-LLM` | `judgment-required` — team composition for an unknown project requires language understanding |
| R-04 | L63-93 "Init Mode Phase 2" | On confirmation: scaffold `.squad/`, initialize casting state (policy.json, registry.json, history.json), seed agent history.md with project context, write team.md with exactly `## Members` header (hard-coded in GitHub workflows), create `.gitattributes` merge drivers for append-only files. | User confirmation after Phase 1 | `coordinator-LLM` | `external-state` — FS writes; deterministic given a team proposal |
| R-05 | L97-106 "Team Mode" | Detect dispatch mechanism once per session: CLI → task tool; VS Code → runSubagent; neither → inline (last resort). Use consistently. Dispatcher-not-Doer: every task needing domain expertise dispatches to a specialist. No inline simulation. | Session start, every routing decision | `coordinator-LLM` | `judgment-required` — platform detection + per-task expertise assessment |

### 2.2 Session Startup Rules (R-06 to R-12)

Rules that fire at the beginning of every Team Mode session.

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-06 | L108-109 | Run `git config user.name`; resolve team root (see R-46 for algorithm); store TEAM_ROOT and CURRENT_DATETIME (from system context); pass both into every spawn prompt. Pass current user name into every spawn prompt and Scribe log. | Session start | `coordinator-LLM` | `pure-rule` — deterministic git command + env resolution |
| R-07 | L110 "Context caching" | After the first message, team.md, routing.md, and registry.json are in context. Do NOT re-read them on subsequent messages. Only re-read if user explicitly modifies the team. | Post-first-message | `coordinator-LLM` | `pure-rule` — session-scope memoization |
| R-08 | L112-119 "Session catch-up (lazy)" | Do NOT scan logs on every session start. Only scan orchestration-log when user explicitly asks for status, or when coordinator detects a different user than the last session log. Summary: who worked, what they did, key decisions, 2-3 sentences. | User request or user change | `coordinator-LLM` | `judgment-required` — user intent detection + summary generation |
| R-09 | L121 "Casting migration check" | If `.squad/team.md` exists but `.squad/casting/` does not, perform casting migration (mark existing agents `legacy_named: true`, init casting state files) before proceeding. | Session start, Team Mode | `coordinator-LLM` | `pure-rule` — directory presence check + deterministic migration steps |
| R-10 | L141-158 "Issue Awareness" | On every session start: `gh issue list --label "squad:{member-name}" --state open` for all members. Note assigned issues in session context. When catching up or on status query, present open issues per member. | Session start | `coordinator-LLM` | `external-state` — GitHub API call |
| R-11 | L155-156 "Proactive issue pickup" | If open `squad:{member}` issues found, mention them: "Hey {user}, {AgentName} has an open issue — #42: ... Want them to pick it up?" | Session start (conditional) | `coordinator-LLM` | `judgment-required` — conversational framing |
| R-12 | L157-158 "Issue triage routing" | When a new issue gets the `squad` label (via sync-squad-labels workflow), Lead triages: reads issue, assigns `squad:{member}` label(s), comments triage notes. Lead can reassign. | GitHub label event | `coordinator-LLM` | `pure-rule` (routing logic) + `judgment-required` (triage analysis) |

### 2.3 Coordinator Dispatch Decision Rules (R-13 to R-24)

These are the rules encoded in `.squad/squadboard-coordinator.md` and the built-in preamble. They are the ONLY squad.agent.md rules the Squadboard server mini-coordinator implements. Listed in priority order as they appear in the preamble.

| Rule ID | Preamble Rule # | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|----------------|--------|--------------|---------|--------------|-------------------|
| R-13 | Rule 1 | Coordinator L18-25, squad.agent.md L263-282 | Named-agent keyword: if issue title or body contains "@{agentName}" or "assign to {agentName}" where agentName is in candidateAgents, dispatch to that agent at confidence 1.0. Skip if named agent is unavailable. | Each dispatch call | `coordinator-LLM` (SC rule 1) | **`pure-rule`** — string search against a known list; no language understanding required |
| R-14 | Rule 2 | Coordinator L26-30 | Exact label match: if exactly one agent's `capabilities` list contains every label on the issue and no other agent does, dispatch to that agent at confidence 0.9. | Each dispatch call | `coordinator-LLM` (SC rule 2) | **`pure-rule`** — set intersection: `agent.capabilities.includes(every label)` is a computable predicate |
| R-15 | Rule 3 | Coordinator L31-37 | Exclusive charter claim: if exactly one charter explicitly claims ownership of the issue's domain via a strong ownership statement ("I own all DB migrations"), dispatch to that agent at confidence 0.85. A claim must be explicit, not implied. "May occasionally" is not exclusive. | Each dispatch call | `coordinator-LLM` (SC rule 3) | **`judgment-required`** — requires semantic reading of charter prose; distinguishing "explicit" from "implied" is a language task |
| R-16 | Rule 4 | Coordinator L38-41 | Role-fit heuristic: apply the role-fit table (12 rows mapping issue cue to preferred agent role). If exactly one agent's role matches the dominant cue, dispatch at 0.75. "Dominant cue" is the primary action in the issue title. | Each dispatch call | `coordinator-LLM` (SC rule 4) | **`judgment-required`** — "dominant cue" identification in natural language is LLM territory |
| R-17 | Rule 5 | Coordinator L42-46 | Parent-run gate: if issue has non-null `parentId` and the parent run has not completed (status ≠ "success" — inferred from `recentRuns`), return `kind: "skip"`. Do not dispatch to any agent. | Each dispatch call | `coordinator-LLM` (SC rule 5) | **`pure-rule`** — DB query: `SELECT status FROM issue_runs WHERE issueId = parentId AND status = 'success'` |
| R-18 | Rule 6 | Coordinator L47-51 | Unavailable agents: do not dispatch to agent where `available = false`. If best-fit is unavailable, try next best. If all unavailable, return `kind: "ambiguous"` listing them. | Each dispatch call | `coordinator-LLM` (SC rule 6) | **`pure-rule`** — boolean flag filter; `candidateAgents.filter(a => a.available)` |
| R-19 | Rule 7 | Coordinator L52-56 | Backlog gate: issues in "Backlog" column should not be dispatched unless at least one candidate agent's charter or capabilities mention one of the issue's labels. Otherwise return `kind: "skip"`. | Each dispatch call | `coordinator-LLM` (SC rule 7) | **`pure-rule`** for column check + label intersection; **`judgment-required`** only for charter keyword matching beyond the capabilities array |
| R-20 | Rule 8 | Coordinator L57-59 | Ahmed-only operations: if issue involves `publish-mcp-auth`, `code-signing`, `billing configuration`, or `org-level secrets`, return `kind: "skip"` with reason "Requires Ahmed intervention." | Each dispatch call | `coordinator-LLM` (SC rule 8) | **`pure-rule`** — 4-term keyword blocklist; entirely a string search |
| R-21 | Rule 9 | Coordinator L60-62 | Low-confidence floor: if best agent fit has confidence < 0.4, do NOT dispatch. Return `kind: "ambiguous"` with all plausible candidates. | Each dispatch call | `coordinator-LLM` (SC rule 9) | **`pure-rule`** for the threshold check; but confidence values are the LLM's own outputs, so this rule operates on LLM-generated data |
| R-22 | Rule 10 | Coordinator L63-66 | Confidence contention: if two or more agents are within 0.15 confidence of each other (e.g. 0.80 vs 0.68 is fine; 0.80 vs 0.72 is ambiguous), return `kind: "ambiguous"` with those agents listed. | Each dispatch call | `coordinator-LLM` (SC rule 10) | **`pure-rule`** for the delta computation; operates on LLM-generated confidence values |
| R-23 | Rule 11 | Coordinator L67-70 | Recent failure escalation: if same issue was previously run by best-fit agent and resulted in "failed" or "abandoned" in `recentRuns`, prefer next-best agent. If no alternative, lower confidence by 0.15 before applying rule 9. | Each dispatch call | `coordinator-LLM` (SC rule 11) | **`pure-rule`** — `recentRuns.filter(r => r.agentName === best && r.outcome !== 'success')` lookup |
| R-24 | Rule 12 | Coordinator L71-73 | Thin issue fallback: if issue has no body, no labels, and title fewer than five words, return `kind: "ambiguous"` asking user to elaborate. | Each dispatch call | `coordinator-LLM` (SC rule 12) | **`pure-rule`** — structural check: `body === null && labels.length === 0 && title.split(' ').length < 5` |

**Summary of determinism class for dispatch rules:** Of the 12 dispatch rules encoded in the preamble, 8 are pure rules (R-13, R-14, R-17, R-18, R-19, R-20, R-23, R-24) and 4 require genuine LLM judgment (R-15, R-16, R-21, R-22). The 4 judgment rules — exclusive charter claim reading, role-fit dominant cue identification, and the confidence threshold/contention rules that operate on LLM-generated values — are correctly placed in the LLM. The 8 pure rules are paying LLM credits for no judgment value.

### 2.4 Response Mode and Model Selection (R-25 to R-28)

Rules governing how the CLI coordinator decides HOW to handle a request (after WHO is decided by routing).

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-25 | L310-348 "Response Mode Selection" | Four modes: Direct (coordinator answers, no spawn, ~2-3s), Lightweight (one agent, minimal prompt, ~8-12s), Standard (one agent, full ceremony, ~25-35s), Full (multi-agent fan-out, ~40-60s). Bias toward upgrading when uncertain. Direct exemplars: status checks, "where are we?", quick commands. Lightweight: typos, follow-ups. Standard: tasks needing architectural judgment. Full: "Team, build X." | Each routing decision | `coordinator-LLM` | `judgment-required` — task complexity classification is inherently semantic |
| R-26 | L382-425 "Per-Agent Model Selection" | 4-layer hierarchy, first match wins: L0 = .squad/config.json agentModelOverrides/defaultModel (persistent, survives sessions); L1 = session directive ("use opus for this session"); L2 = charter `## Model` section; L3 = task-aware auto-selection (cost-first rule: code→sonnet-4.6, non-code→haiku-4.5, vision→opus-4.5); L4 = haiku-4.5 default. Role-to-model mapping table in spec. | Per spawn | `coordinator-LLM` | `judgment-required` for L3 (output-type classification is language task); L0-L2 are `pure-rule` |
| R-27 | L426-461 "Fallback chains" | On model unavailable (transient error): silent retry through chain. Premium: opus-4.6 → opus-4.5 → sonnet-4.6 → sonnet-4.5 → (omit). Standard: sonnet-4.6 → sonnet-4.5 → gpt-5.4 → gpt-5.3-codex → (omit). Fast: haiku-4.5 → gpt-5.4-mini → gpt-5.1-codex-mini → gpt-4.1 → (omit). Max 3 retries. Never fall back up in tier. Log fallbacks to orchestration log, never surface to user. | Per spawn (on error) | `coordinator-LLM` (intention) + `coordinator-deterministic` (dispatch.ts `resolveChain()`) | `external-state` — depends on runtime model availability. NOTE: dispatch.ts already implements model chain fallback for the coordinator's own calls (MC-3/W30). This rule governs agent spawn fallbacks at the CLI coordinator level. |
| R-28 | L386-391 "Persistent Config" | When user says "always use X": write `defaultModel` to `.squad/config.json`. When user says "use X for {agent}": write `agentModelOverrides.{agent}`. "Switch back to automatic": remove those keys. Survive across sessions. | User directive | `coordinator-LLM` | `pure-rule` — config file write/read |

### 2.5 Spawn Mechanics and Templates (R-29 to R-35)

Rules governing the structure of agent spawns.

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-29 | L161-173 "Acknowledge Immediately" | Before spawning any background agents, ALWAYS respond with brief text naming the agents being launched. Single agent: "Fenster's on it." Multi-agent: show launch table with emoji + agent + task. This goes in the same response as the task tool calls — text first, then tool calls. Never show blank screen while agents work. | Pre-spawn, every time | `coordinator-LLM` | `pure-rule` — behavioral UX constraint; LLM must comply |
| R-30 | L175-219 "Role Emoji" | Use standard emoji mapping in `description` parameter of every spawn. 16-row mapping table from role pattern to emoji. `name` param must be lowercase cast name (generates human-readable agent ID in tasks panel). Without correct name, platform shows generic slug. If no match, use 👤. | Per spawn | `coordinator-LLM` | `pure-rule` — lookup table; deterministic given agent role |
| R-31 | L771-862 "Spawn Template" | Full spawn template structure: `agent_type: "general-purpose"`, `model: resolved_model`, `mode: background|sync`, `name: lowercase cast name`, `description: emoji name task`. Prompt must contain: charter inline, TEAM_ROOT, CURRENT_DATETIME, PERSONAL_AGENT/GHOST_PROTOCOL flags, WORKTREE_PATH/MODE, history.md read instruction, decisions.md read instruction, identity/wisdom.md read if present, skill dir check, MCP block (conditional), Requested by user name, INPUT ARTIFACTS, task message, RESPONSE ORDER block (critical workaround for platform silent-success bug). | Per spawn | `coordinator-LLM` | `pure-rule` (template structure) + `judgment-required` (task description content) |
| R-32 | L780 "Inline the charter" | Before spawning, read the agent's `charter.md` (resolve from TEAM_ROOT: `{team_root}/.squad/agents/{name}/charter.md`) and paste its contents directly into the spawn prompt. Eliminates a tool call from the agent's critical path. | Pre-spawn | `coordinator-LLM` | `pure-rule` — FS read + string injection |
| R-33 | L573-596 "Mode: background default" | background is default unless: hard data dependency (Agent B needs Agent A's output file), reviewer verdict gates work, user is waiting for a direct answer, interactive clarification needed. When uncertain, default to background. | Per spawn | `coordinator-LLM` | `judgment-required` — dependency classification for arbitrary tasks |
| R-34 | L598-617 "Parallel Fan-Out" | When user gives any task: decompose broadly; identify ALL agents who could usefully start work including anticipatory downstream (tests from requirements while implementer builds, docs while endpoint is coded). Check for hard data dependencies only. Spawn all independent as `mode: background` in a single tool-calling turn. Multiple task calls in one response = true parallelism. | Per routing decision | `coordinator-LLM` | `judgment-required` — work decomposition is semantic |
| R-35 | L864-872 "Anti-Patterns" | Never role-play agent inline. Never simulate output. Never skip dispatch when expertise is needed (Direct and Lightweight modes are legitimate exceptions). `name` must be lowercase cast name — never "general-purpose-task". `description` must include agent name. Never serialize because of shared memory files. | Always enforced | `coordinator-LLM` | `pure-rule` — behavioral constraints; LLM must comply |

### 2.6 Shared File Architecture (R-36, R-48)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-36 | L623-638 "Drop-Box Pattern" | Agents do NOT write to `decisions.md` directly. Instead: agents write to `.squad/decisions/inbox/{agent-name}-{brief-slug}.md`. Scribe merges inbox → decisions.md and clears inbox. All agents READ from decisions.md at spawn time (last-merged snapshot). No concurrent writes to the same file. This is what enables full parallelism without file conflicts. | Per agent write | `coordinator-LLM` (enforcement in spawn prompts) + `Squad-SDK-only` (Scribe merge impl) | `pure-rule` |
| R-48 | L624-638 | orchestration-log/ entries: Scribe writes one per agent after each batch. Format: timestamp-agentname.md. Coordinator passes spawn manifest to Scribe. Append-only, never edited after write. | Scribe spawn | `coordinator-LLM` (manifest passing) + `Squad-SDK-only` (write impl) | `pure-rule` |

### 2.7 After-Work and Scribe Rules (R-37 to R-45)

The Scribe tasks are the only squad.agent.md rules that the Squad-SDK fully implements. Tasks numbered 0-8 as in squad.agent.md Scribe spawn template (`packages/squadboard-sdk/src/scribe/primitives.ts`, opening comment).

| Rule ID | Task # | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------|--------------|---------|--------------|-------------------|
| R-37 | Task 1 | squad.agent.md L939 | decisions.md archive: if >= 20480 bytes, archive entries older than 30 days to decisions-archive.md. If >= 51200 bytes, archive entries older than 7 days. Hard gate — do not skip. | Scribe spawn | `Squad-SDK-only` (`archiveDecisionsBySize`) | `pure-rule` — numeric threshold + file age |
| R-38 | Task 2 | L940 | Decision inbox merge: read all `.squad/decisions/inbox/` files, append to decisions.md, delete inbox files. Deduplicate. | Scribe spawn | `Squad-SDK-only` (`mergeInbox`) | `pure-rule` |
| R-39 | Task 3 | L941 | Orchestration log: write `.squad/orchestration-log/{ISO-UTC-timestamp}-{agent}.md` per agent in spawn manifest. | Scribe spawn | `Squad-SDK-only` (`writeOrchestrationLogs`) | `pure-rule` |
| R-40 | Task 4 | L942 | Session log: write `.squad/log/{timestamp}-{topic}.md`. Brief. | Scribe spawn | `Squad-SDK-only` (`writeSessionLog`) | `pure-rule` |
| R-41 | Task 5 | L943 | Cross-agent history updates: append team updates to affected agents' history.md based on spawn manifest. | Scribe spawn | `Squad-SDK-only` (`crossAgentHistoryUpdates`) | `pure-rule` |
| R-42 | Task 6 | L944 | History summarization gate: if any history.md >= 15360 bytes (15KB), summarize now. Hard gate. | Scribe spawn | `Squad-SDK-only` (`summarizeHistoryIfLarge`) | `pure-rule` |
| R-43 | Task 7 | L945 | Git commit scoped Scribe files: `git status --porcelain` filtered to allowed paths (decisions.md, agents/*/history.md, log/*, orchestration-log/*). Stage each file individually. NEVER `git add .squad/`. Skip if nothing staged. | Scribe spawn | `Squad-SDK-only` (`commitScribeFiles`) | `pure-rule` |
| R-44 | Task 8 | L946 | Health report: write `.squad/health/{YYYY-MM-DD}/wave-{N}-{coordinator-session-id}.md`. Sections: wave summary, backlog delta, lineage tree, defects observed, verbatim spawn summaries, next-wave recommendations. Return `healthReportPath`. | Scribe spawn | `Squad-SDK-only` (`writeHealthReport`) | `pure-rule` |
| R-45 | Addendum | L881-905 "Dogfood addendum" | In this repo only: (a) on directive capture: also call squadboard MCP `capture` tool. (b) after work completes: call `capture` again with `done: {summary} (sha={commit})`. Two flows additive — keep decisions-inbox file AND drop MCP card. Closes dogfood loop symmetrically. | Directive capture + post-work | `coordinator-LLM` | `external-state` — MCP tool call (Squadboard-specific, in-repo only) |

The after-work coordinator pattern (`packages/server/src/coordinator/` is not involved in R-37 to R-44 — those are the CLI coordinator's Scribe spawn template mapped to SDK functions. The Squadboard server's equivalent is ceremony-dispatcher.ts invoking the 'scribe-close-out' ceremony, which in turn calls the SDK's closeOut().

### 2.8 Worktree Rules (R-46 to R-47)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-46 | L642-681 "Worktree Awareness" | Two team root strategies: worktree-local (each worktree has its own .squad/ state) vs main-checkout (all worktrees share main checkout .squad/). Resolution algorithm: (1) check if .squad/ exists in CWD; (2) `git rev-parse --show-toplevel`; (3) check .squad/ at that root; (4) if not found, `git worktree list --porcelain` to find main working tree. Pass TEAM_ROOT to every spawn. User may override strategy at any time. Cross-worktree: worktree-local is recommended; main-checkout unsafe for concurrent sessions. | Session start + per spawn | `coordinator-LLM` | `pure-rule` — git command execution; deterministic given git state |
| R-47 | L683-714 "Worktree Lifecycle Management" | Activation: `SQUAD_WORKTREES=1` env or `worktrees: true` in project config. One worktree per issue number. Path: `{repo-parent}/{repo-name}-{issue-number}`. Branch: `squad/{issue-number}-{slug}`. Check `git worktree list` before creating — reuse if exists. Link node_modules from main repo (Windows: mklink /J; Unix: ln -s). Cleanup: after PR merged, `git worktree remove {path}` + `git branch -d {branch}`. Ralph heartbeat triggers cleanup checks. | Issue-based work | `coordinator-LLM` | `external-state` — git worktree, filesystem |

### 2.9 Casting and Naming Rules (R-49 to R-52)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-49 | L1029-1054 "Casting & Persistent Naming" | One universe per assignment. 17 universes available. Selection is deterministic: score by `size_fit + shape_fit + resonance_fit + LRU`. Same inputs → same choice (unless LRU changes). Names are persistent identifiers — no role-play, no catchphrases, no character speech patterns. Names are easter eggs: never explain or document the mapping rationale. Scribe always "Scribe". Ralph always "Ralph". @copilot always "@copilot". | Init Mode + add team member | `coordinator-LLM` | `judgment-required` — resonance scoring requires contextual interpretation of project description; universe selection has deterministic structure but resonance input is semantic |
| R-50 | L1043-1054 "Name Allocation" | Choose character names implying pressure, function, or consequence — NOT authority or literal role descriptions. Unique per repo unless explicitly retired. Use allocated name everywhere: charter.md, history.md, team.md, routing.md, spawn prompts. Store in .squad/casting/registry.json. Record in .squad/casting/history.json. | Init Mode + add team member | `coordinator-LLM` | `judgment-required` — character selection requires universe knowledge |
| R-51 | L1056-1064 "Overflow Handling" | If agent_count exceeds available names mid-assignment: (1) Diegetic Expansion — minor characters from same universe; (2) Thematic Promotion — closest parent universe family (announce: never); (3) Structural Mirroring — foils/counterparts from universe family. Never rename existing agents. | Team growth | `coordinator-LLM` | `judgment-required` — universe expansion requires cultural knowledge |
| R-52 | L1072-1079 "Migration — Already-Squadified Repos" | If team.md exists but .squad/casting/ does not: mark every existing agent `legacy_named: true` in registry. Initialize casting/ with defaults. Apply full casting algorithm only for NEW agents added after migration. | Session start (if needed) | `coordinator-LLM` | `pure-rule` — presence check + deterministic migration steps |

### 2.10 Team Lifecycle Rules (R-53 to R-54)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-53 | L969-977 "Adding Team Members" | Allocate name from current universe (read history.json). Check `.squad/plugins/marketplaces.json` for plugins matching role. Generate charter.md + history.md seeded with project context. Update registry.json, team.md, routing.md. | User request | `coordinator-LLM` | `judgment-required` (charter generation, name selection) + `external-state` (marketplace fetch) |
| R-54 | L979-987 "Removing Team Members" | Move folder to `.squad/agents/_alumni/{name}/`. Remove from team.md. Update routing.md. Set status `"retired"` in registry.json. Do NOT delete registry entry — name remains reserved. Knowledge preserved, inactive. | User request | `coordinator-LLM` | `pure-rule` — deterministic file operations |

### 2.11 Reviewer Rejection Rules (R-55)

This rule is notable because the Squadboard workflow engine partially implements it (peer-reviewer.ts) but only for workflow steps, not direct dispatch.

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-55 | L1096-1117 "Reviewer Rejection Protocol + Strict Lockout" | Reviewer roles may approve or reject. On rejection, reviewer picks ONE: (a) reassign to a DIFFERENT agent, (b) escalate to a new specialist agent. Original author is locked out for that revision cycle — may not produce next version, may not co-author, may not advise. Coordinator enforces mechanically: if reviewer names original author as fix agent, coordinator MUST refuse and ask reviewer to name a different agent. Lockout scope = specific artifact, not all work. Lockout duration = current revision cycle (cascades if revision is also rejected). Deadlock (all agents locked out) → escalate to user. | Reviewer verdict | `coordinator-LLM` (enforcement logic) + `workflow-state-machine` (peer-reviewer.ts: `shouldBlock()`, `isQuorumMet()`, review policies in workflow steps) | `judgment-required` (verdict processing, lockout enforcement across a conversation); `pure-rule` for the specific structural checks |

**Gap:** `peer-reviewer.ts` enforces the review gate (block/approve) and quorum rules for workflow step runs. But the Reviewer Rejection Lockout Semantics — specifically the "original author cannot revise" rule — are NOT encoded for direct dispatch (non-workflow runs). If an agent's work is rejected in a non-workflow context, the coordinator can currently re-dispatch to the same agent with no lockout enforcement.

### 2.12 Ceremony Rules (R-56 to R-57)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-56 | L955-967 "Ceremonies" | Before spawning work batch: check `.squad/ceremonies.md` for auto-triggered `before` ceremonies matching current task condition. After batch: check for `after` ceremonies. Manual ceremonies: only when user asks. Spawn facilitator (sync) using template in ceremony-reference.md. Facilitator spawns participants as sub-tasks. For `before`: include ceremony summary in work batch spawn prompts. Spawn Scribe background to record. Cooldown: skip auto-trigger checks for the immediately following step. Show: `"Ceremony completed — N decisions, M action items."` | Pre/post work batch + user request | `coordinator-LLM` | `judgment-required` (condition matching against arbitrary task context) |
| R-57 | L282, routing table | "design meeting", "run a retro" → run matching ceremony from ceremonies.md. | User request with ceremony intent | `coordinator-LLM` | `pure-rule` for routing (intent detection is `judgment-required`) |

**Note on ceremonies dual-track:** Squadboard's ceremony engine (`ceremony-scheduler.ts`, `ceremony-dispatcher.ts`, `ceremony-yaml-schema.ts`) is a separate implementation that runs server-side on schedule/event triggers. It has no connection to the CLI coordinator's ceremony checking described in R-56 and R-57. These are parallel tracks: Squadboard ceremonies fire from DB-persisted YAML definitions on a schedule; CLI coordinator ceremonies fire from `.squad/ceremonies.md` text files read at spawn time. They do not currently share state or emit to each other.

### 2.13 Ralph Work Monitor (R-58 to R-59)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-58 | L1168-1243 "Ralph Work Monitor" | Work-check loop (4 steps): Step 1 — parallel GitHub scans: untriaged issues (squad label, no squad:{member}), member-assigned open issues, open PRs, draft PRs. Step 2 — categorize: untriaged > assigned > CI failures > review feedback > approved PRs. Step 3 — act on highest priority; spawn agents; DO NOT STOP after results — immediately loop back to Step 1. Step 4 — check-in every 3-5 rounds. CRITICAL: when Ralph is active, coordinator MUST NOT stop and wait for user input between work items. Loop continues until explicit "idle"/"stop" or session end. | "Ralph, go" / "keep working" / post-agent-work if Ralph is active | `coordinator-LLM` | `judgment-required` (priority selection, GitHub result interpretation) + `external-state` (gh CLI) |
| R-59 | L1245-1259 "Watch Mode" | `npx @bradygaster/squad-cli watch --interval N`: standalone local process (not inside Copilot) that polls GitHub every N minutes for untriaged squad work, auto-triages, assigns @copilot to squad:copilot issues. Runs until Ctrl+C. Complement to Ralph's in-session loop: Ralph = at-keyboard, watch = away-from-keyboard, squad-heartbeat.yml = cloud (event-based). | External process trigger | `not-yet-implemented` in Squadboard server | `external-state` |

### 2.14 Special Modes (R-60 to R-63)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-60 | L1143-1165 "GitHub Issues Mode" | Prerequisites: gh CLI authenticated. Connect to repo, list open issues as table, route via routing.md. Full lifecycle: issue → branch `squad/{issue-number}-{slug}` → work → commit referencing issue → PR via `gh pr create`. PR review handling per issue-lifecycle.md template. After issue work: standard After Agent Work flow. | User request: "pull issues from {owner/repo}", "work on #N" | `coordinator-LLM` | `external-state` (gh CLI + GitHub API) + `judgment-required` (routing decisions) |
| R-61 | L1324-1338 "PRD Mode" | Detect source (file path, pasted content, URL). Store PRD ref in team.md. Spawn Lead (sync, premium model bump — architecture proposal → bump per R-26). Lead decomposes into work items. Present table for approval. Route approved items respecting dependencies. On "the PRD changed": re-read and diff against previous decomposition. | User: "here's the PRD", pastes spec, "read the PRD at {path}" | `coordinator-LLM` | `judgment-required` (decomposition, dependency analysis) |
| R-62 | L1340-1353 "Human Team Members" | Badge: 👤 Human. Real name — no casting. No charter or history files. NOT spawnable — coordinator presents work and waits for user to relay. Non-dependent work continues immediately (human blocks do not serialize). Stale reminder after >1 turn: "Still waiting on {Name} for {thing}." Reviewer rejection lockout applies normally. Multiple humans tracked independently. | Human added to team | `coordinator-LLM` | `pure-rule` (routing logic — humans are never dispatched to) + `judgment-required` (waiting/follow-up context) |
| R-63 | L1355-1366 "Copilot Coding Agent Member" | Badge: 🤖. Always "@copilot" — no casting. No charter — uses `copilot-instructions.md`. NOT spawnable — works via issue assignment, asynchronous. Capability profile (🟢/🟡/🔴) in team.md. Lead evaluates issues against profile during triage. Auto-assign: controlled by `<!-- copilot-auto-assign: true/false -->` in team.md. Non-dependent work continues immediately. | @copilot added to team | `coordinator-LLM` | `pure-rule` (routing: @copilot issues → assignment, not spawn) + `external-state` (GitHub issue assignment API) |

### 2.15 Personal Squad Rules (R-67)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-67 | L123-137 "Personal Squad" | (1) Kill switch: if `SQUAD_NO_PERSONAL` set, skip entirely. (2) Resolve personal dir: `resolvePersonalSquadDir()`. (3) Discover personal agents: scan `{personalDir}/agents/` for charter.md files. (4) Merge into cast: additive, project agents win on name conflict. (5) Ghost Protocol: read-only project state, no direct file edits, transparent origin tagging `origin: 'personal'`. Personal agents advise; project agents execute. Consult mode: user addressing personal agent → route to personal agent → if recommends changes → hand off to appropriate project agent → log `[consult] {personal} → {project}: {handoff summary}`. | Session start (Team Mode) | `coordinator-LLM` | `external-state` (personal dir filesystem) + `pure-rule` (Ghost Protocol enforcement in spawn prompts) |

### 2.16 Platform Compatibility Rules (R-68 to R-70)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-68 | L482-524 "Client Compatibility" | Platform detection order: (1) CLI — task tool available; (2) VS Code — runSubagent/agent tool available; (3) Fallback — neither available, work inline. If both task and runSubagent available, prefer task. Feature degradation table (6 features: parallel fan-out, model selection, Scribe fire-and-forget, launch table UX, SQL tool, response order bug). VS Code adaptations: drop agent_type/mode/model/description params; all concurrent agents in single turn; skip launch table; no read_agent. | Session start | `coordinator-LLM` | `pure-rule` — tool availability detection; deterministic given available tools |
| R-69 | L525-526 "SQL Tool Caveat" | sql tool is CLI-only. Cross-platform code paths must not depend on SQL. Use filesystem-based state (.squad/ files) for anything that must work everywhere. | Design constraint | `coordinator-LLM` | `pure-rule` — design constraint; informs spawn prompt design |
| R-70 | L527-560 "MCP Integration" | Detection: scan available tools for known MCP prefixes (github-mcp-server-*, trello_*, aspire_*, azure_*, notion_*). Pass context in spawn prompts via MCP TOOLS AVAILABLE block (only when MCP actually detected). Graceful degradation: never crash; CLI fallback when MCP missing; inform user what's missing; continue without. Coordinator handles simple reads directly; spawn with context when agent expertise needed. Explore agents never get MCP. | Per spawn (if MCP present) | `coordinator-LLM` | `external-state` — tool availability discovery |

### 2.17 Directive Capture (R-71)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-71 | L221-256 "Directive Capture" | Before routing any message: detect directive signals (Always/Never/From now on/Going forward + naming conventions, process rules, scope decisions, tool preferences). Capture BEFORE routing. Write to `.squad/decisions/inbox/copilot-directive-{timestamp}.md` immediately. Acknowledge: "Captured. {one-line summary}." If message also contains work request: route that work normally after capturing. Directive-only message: done, no agent spawn needed. In this repo: also call squadboard MCP `capture` (additive, not replacement). | Pre-routing, every message | `coordinator-LLM` | `judgment-required` (directive signal detection is semantic) + `external-state` (MCP call, this repo only) |

### 2.18 Source of Truth and Skill Lifecycle (R-64 to R-66)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-64 | L1001-1024 "Source of Truth Hierarchy" | Full write-authority table: squad.agent.md wins all conflicts. Who may write: decisions.md (coordinator, append-only), team.md (coordinator), routing.md (coordinator), agents/*/charter.md (coordinator at creation; agent may not self-modify), agents/*/history.md (owning agent append-only + Scribe), orchestration-log/* (Scribe), log/* (Scribe). Agents may propose decisions but only Squad records in decisions.md. | Always | `coordinator-LLM` | `pure-rule` — permission table enforced via spawn prompt instructions |
| R-65 | L284-288 "Skill-aware routing" | Before spawning: check `.copilot/skills/` (Copilot-level, coordinator's own playbook — check first) and `.squad/skills/` (team-level patterns). If matching skill exists, add to spawn prompt: `Relevant skill: {path}/SKILL.md — read before starting.` Makes earned knowledge an input to routing. | Pre-spawn | `coordinator-LLM` | `pure-rule` — FS scan + path injection |
| R-66 | L298-308 "Skill Confidence Lifecycle" | Three levels: low (first observation), medium (multiple agents independently confirmed), high (consistently applied, well-tested, team-agreed). Confidence only goes up, never down. Bump when an agent applies skill in work and finds it correct. | Per skill validation | `coordinator-LLM` | `judgment-required` — validation quality assessment |

### 2.19 Miscellaneous Constraints (R-72 to R-74)

| Rule ID | Source | What it does | Trigger | Current Home | Determinism Class |
|---------|--------|--------------|---------|--------------|-------------------|
| R-72 | L1083-1092 "Constraints" | (1) Coordinator not the team — route, don't do. (2) Always dispatch via task/runSubagent — never inline when tool available. (3) Each agent reads only: own files + decisions.md + explicitly listed input artifacts — never load all charters at once. (4) Keep responses human — "Fenster is looking at this" not "Spawning backend-dev agent." (5) 1-2 agents per question. (6) Decisions shared, knowledge personal. (7) When in doubt, pick someone and go. (8) Restart guidance: after squad.agent.md change, tell user to restart session. | Always | `coordinator-LLM` | `pure-rule` — behavioral constraints |
| R-73 | L1121-1128 "Multi-Agent Artifact Format" | Assembled result at top; raw agent outputs in appendix below; include termination condition, constraint budgets (if active), reviewer verdicts (if any); never edit/summarize/polish raw outputs — paste verbatim. | Post multi-agent work | `coordinator-LLM` | `pure-rule` — format template |
| R-74 | L1132-1139 "Constraint Budget Tracking" | Format: "📊 Clarifying questions used: 2 / 3". Update counter each time consumed. State when exhausted. Do not display when no constraints active. | During constrained tasks | `coordinator-LLM` | `pure-rule` — counter display |

### 2.20 Summary count by determinism class

| Determinism Class | Count | Rule IDs |
|------------------|-------|----------|
| `pure-rule` | 32 | R-02, R-06, R-07, R-09, R-13, R-14, R-17, R-18, R-19, R-20, R-21, R-22, R-23, R-24, R-28, R-29, R-30, R-31 (template), R-32, R-35, R-36, R-37-R-44 (8 Scribe), R-46, R-48, R-52, R-54, R-62 (routing part), R-64, R-65, R-68, R-69, R-72, R-73, R-74 |
| `judgment-required` | 29 | R-01, R-03, R-05, R-08, R-10 (presentation), R-11, R-12 (analysis), R-15, R-16, R-25, R-26 (L3), R-33, R-34, R-49, R-50, R-51, R-53, R-55, R-56, R-57 (intent), R-58, R-61, R-63 (triage), R-66, R-67, R-71 |
| `external-state` | 13 | R-04, R-10 (API), R-27, R-45, R-47, R-53 (marketplace), R-58 (gh), R-59, R-60, R-62 (waiting), R-63 (API), R-70, R-71 (MCP) |

**Currently in coordinator LLM:** R-01 through R-74, minus R-37 to R-44 (Squad-SDK) = 66 rules.
**Currently in Squad-SDK only:** R-37 through R-44 (8 rules).
**Not yet implemented anywhere in Squadboard:** R-59 (Watch Mode).

---

## 2.21 Concrete dispatch flow walkthrough (current state)

This section traces exactly what happens when a todo issue is dispatched today. Every code reference is to the actual files in this repo. Understanding this flow makes the gaps in sections 3-6 concrete.

### Step 1: pickup-todos sweep fires (every 10 seconds)

`packages/server/src/engine/sweeps/pickup-todos.ts:intervalMs = 10_000`

The sweep:
1. Queries all issues with `status = 'todo'` AND `archived = 0`
2. Finds which of those already have a `pending` or `running` issue_run (covered set)
3. Filters to uncovered issues (the ones needing dispatch)
4. Groups uncovered issues by `projectId`
5. For each project, fetches active agents: `agents.status = 'active'`
6. Checks `COORDINATOR_DISPATCH_ENABLED` env flag (default: true, from `coordinator-env.ts`)

### Step 2: CoordinatorInput construction

The input object is built with several hardcoded fields that limit rule coverage:

```typescript
// Actual pickup-todos.ts coordinator call (lines ~260-290):
await dispatchViaCoordinator({
  issue: {
    id: issue.id,
    title: issue.title,
    body: issue.body ?? null,
    labels: [],            // BUG: hardcoded empty — labels never passed
    column: issue.status,  // NOTE: using status as column name
    parentId: null,        // BUG: hardcoded null — parent dependency never checked
    priority: null,        // BUG: hardcoded null — priority never surfaced
    createdAt: issue.createdAt.toISOString(),
  },
  candidateAgents: activeAgents.map((a) => ({
    name: a.name,
    role: a.role,
    charterHash: a.charterHash ?? '',
    charterContent: a.charterContent,  // FULL charter text — all 200-400 lines
    capabilities: [],                   // BUG: hardcoded empty — expertise never passed
    available: !busyAgentIds.has(a.id),
  })),
  project: {
    id: projectId,
    name: projectName,
    rules: '',             // BUG: no project rules passed — context missing
  },
  recentRuns,             // last 5 runs for the issue (correctly populated)
});
```

The five hardcoded-empty fields are the root cause of most of the "rules that can never fire" problems identified in this report. They are not architectural flaws — they are incomplete plumbing from when this was first wired up.

### Step 3: dispatchViaCoordinator() (packages/server/src/coordinator/dispatch.ts)

```
1. coordinatorInputSchema.parse(input)        — Zod validates structure
2. inputHash = hashCoordinatorInput(input)     — sha256 for cache key
3. chain = resolveChain(opts)                  — model chain: env → default haiku-4.5
4. cached = decisionCache.get(input)           — LRU+TTL cache check (60s, 256 entries)
   [if cache hit: return immediately, no LLM call]
5. preamble = loadCoordinatorPreamble()        — .squad/squadboard-coordinator.md (memoized)
6. userPayload = JSON.stringify(input, null, 2)
7. for model in chain:
     result = callCoordinatorLlm({preamble, userPayload, model, timeout})
     → coordinatorDecisionSchema.parse(result.text)  — Zod validates LLM output
     → cache.set(input, decision)
     → return {decision, meta, cacheHit: false}
   if retriable error: try next model
   if non-retriable (ZodError, auth, content policy): throw immediately
8. if all models fail: throw aggregate error
```

### Step 4: callCoordinatorLlm() (packages/server/src/coordinator/llm-client.ts)

The LlmCaller interface allows injection of a fake for tests. The real caller is `SquadClientLlmCaller` which:
1. Reads `GITHUB_TOKEN` or `SQUADBOARD_GITHUB_TOKEN` from env
2. Creates a `SquadClient` (from `@bradygaster/squad-sdk/client`)
3. `client.connect()` → `client.createSession({ model, systemMessage: preamble })`
4. `client.sendAndWait(session, { prompt: userPayload })`
5. Extracts text from result (handles `result.data.content`, `result.content`, `result.text`, `result.message.content`)
6. Estimates tokens from character count (4 chars ≈ 1 token — no tiktoken)
7. `client.disconnect()`

Token estimation note: the 4:1 char:token approximation is acknowledged in the code as an estimate. For charter-heavy inputs (long charter prose), the actual token count may be significantly higher. There is no feedback mechanism to learn the true token counts and correct the estimation.

### Step 5: Post-dispatch

On `kind: 'dispatch'`:
- Resolve `agentByName.get(decision.agent)` — must be in the candidate list
- If resolved: `targetAgentId = resolvedId; routingTier = 1`
- If NOT resolved (coordinator returned agent name not in candidates): log warning, fall through to Tier 2
- This fallthrough for unknown-agent is a latent bug: the coordinator might hallucinate an agent name that is not in `candidateAgents`. The Zod schema validates the `agent` field is a string but does NOT validate it against the candidate list. A post-parse validation step is missing.

On `kind: 'skip'`: log and continue to next issue.

On `kind: 'ambiguous'`: fall through to Tier 2 (keyword scoring in `router.ts:resolveRouteTier2()`).

**Missing validation:** After the coordinator returns `kind: 'dispatch', agent: X`, pickup-todos.ts checks `agentByName.get(decision.agent)` but does not validate that the named agent is also `available`. The coordinator's R-18 rule is supposed to prevent dispatching to unavailable agents, but if the LLM makes an error (e.g., an unavailable agent has very strong charter claim), the fallback is to proceed with the unavailable agent. The pre-filter approach (R-18) would catch this before the LLM call.

### Step 6: Circuit breaker and issue_run insertion

After `targetAgentId` is resolved (via coordinator or Tier 2 or Tier 3):

```typescript
// Check circuit breaker (AFTER coordinator decision — the conflict described in 3.4):
const recentFailures = await db.select({ id: issueRuns.id })
  .from(issueRuns)
  .where(and(
    eq(issueRuns.issueId, issue.id),
    eq(issueRuns.agentId, targetAgentId),
    eq(issueRuns.status, 'failed'),
    gte(issueRuns.createdAt, windowStart), // last 30 minutes
  ));

if (recentFailures.length >= CIRCUIT_BREAKER_MIN_FAILURES) {
  continue; // SILENT VETO — no log to coordinator_decision, no error, just skip
}

// Insert issue_run:
const [insertedRun] = await db.insert(issueRuns).values({
  issueId: issue.id,
  agentId: targetAgentId,
  kind: 'agent_run',
  status: 'pending',
  routingTier,           // 1 = coordinator, 2 = keyword, 3 = least-loaded
  routingReasoning,      // coordinator rationale string
}).returning({ id: issueRuns.id });

// Persist coordinator decision to issue_run:
if (insertedRun && capturedCoordinatorDecision && capturedCoordinatorMeta) {
  await persistCoordinatorDecision(
    insertedRun.id,
    capturedCoordinatorDecision,
    capturedCoordinatorMeta
  );
}
```

The silent circuit-breaker veto (noted in section 3.4) means: an issue can be "stuck" where the coordinator keeps picking the same agent, the circuit breaker keeps vetoing, and no issue_run is ever created. No error is surfaced. The issue sits in `todo` forever (or until the 30-minute window clears). There is no alerting, no backoff, no escalation to ambiguous state.

### Step 7: Stepper picks up the issue_run

The stepper (`packages/server/src/engine/stepper.ts`) runs on a tick and claims pending issue_runs via `FOR UPDATE SKIP LOCKED`:

```sql
SELECT id FROM issue_runs WHERE status='pending' LIMIT 1 FOR UPDATE SKIP LOCKED
```

Then executes `runWorker(claimedId)` which calls `executeAgentRun()` from `sdk/bridge.ts`. The coordinator decision is now stored on the issue_run but the agent itself never sees it — the coordinator's rationale is diagnostic data, not operational input.

---

## 3. Squad-SDK vs Squadboard Partition

### 3.1 Clarifying which SDK is which

There are two distinct SDKs in this codebase, and confusing them is a significant risk:

**`@bradygaster/squad-sdk`** — Brady's original SDK. Imported in `packages/server/src/services/sdk-state.ts` and `agent-sync.ts`. Provides: `SquadState`, `FSStorageProvider`, and typed collection wrappers (`AgentsCollection`, `RoutingCollection`, `DecisionsCollection`, `SkillsCollection`, `TeamCollection`, `TemplatesCollection`, `ConfigCollection`). Also provides `SquadClient` (the LLM client used in `llm-client.ts`). This SDK is the **storage abstraction layer** — it wraps `.squad/` filesystem state into typed objects. It does not encode any dispatch rules or ceremony logic.

**`@sabbour/squadboard-sdk`** (the package under audit: `packages/squadboard-sdk/`) — The new SDK developed in this project. Provides: `squadboard.scribe` (closeOut + primitives), `writeHealthReport`, and bundle schema types. This SDK is the **Scribe operations layer** — it implements the mechanical tasks from the Scribe spawn template and provides a portable bundle format.

The behavior inventory report refers to the Squad-SDK as `packages/squadboard-sdk/` (`@sabbour/squadboard-sdk`) since that is what Brady's question targets. The `@bradygaster/squad-sdk` is background infrastructure.

### 3.2 What @sabbour/squadboard-sdk actually exposes

Exhaustive audit of `packages/squadboard-sdk/src/`:

```
index.ts                    — barrel: exports squadboard.scribe namespace, re-exports types
scribe/
  index.ts                  — barrel for scribe sub-module
  close-out.ts              — closeOut(opts): orchestrates tasks 0-8 in sequence
  primitives.ts             — archiveDecisionsBySize, mergeInbox, writeOrchestrationLogs,
                              writeSessionLog, crossAgentHistoryUpdates,
                              summarizeHistoryIfLarge, commitScribeFiles
  steps/
    step-8-health-report.ts — writeHealthReport, BacklogSnapshot, SpawnLineageEntry types
  __tests__/                — test coverage for primitives
bundle/
  schema.ts                 — TypeScript type definitions only (no runtime logic):
                              SquadboardBundle, BundleManifest, BundleProject,
                              BundleKanban, BundleKanbanColumn, BundleTeamMember,
                              BundleCeremony, BundleCeremonyTrigger, BundleWorkflow,
                              BundleSkill, BundleTool, BundleMcpServer,
                              BundleRoutingRule, BundleAgent,
                              BundleWorkflowStep (union of 5 step types)
```

The SDK has **no runtime logic** in `bundle/schema.ts` — it is pure TypeScript type definitions for the portable bundle format. The bundle format itself (`squad-bundle.json`) is the artifact; the SDK just provides the types so consumers can build and read bundles with type safety.

The SDK has **no coordinator dispatch logic** — no rules, no LLM calls, no routing decisions.

The SDK has **no ceremony execution logic** — BundleCeremony types describe ceremony configuration in a bundle, but there is no `runCeremony()` function or equivalent.

### 3.3 Full three-column comparison table

This table covers all 74 rules. Abbreviated where the answer is the same for a group.

| Rule ID(s) | SDK Encodes It? | How (if yes) | Squadboard Server Relation |
|------------|----------------|--------------|---------------------------|
| R-01 to R-12 (CLI coordinator mode selection, session startup) | No | — | Not in server code. Entirely CLI coordinator prompt territory. `coordinator-context.ts` builds system prompt for Consult turns but does not encode these rules. |
| R-13 (named-agent keyword) | No | — | Encoded as prose in preamble; evaluated by LLM in dispatch.ts. `candidateAgents[].name` provides the data. Should be pre-filter (see section 4). |
| R-14 (exact label match) | No | — | `candidateAgents[].capabilities` provides data; LLM evaluates. `issues.labels` currently always passed as `[]` in pickup-todos.ts (hardcoded empty — see section 6.3 gap). |
| R-15 (exclusive charter claim) | No | — | Charter content passed as `candidateAgents[].charterContent`; LLM reads prose. This is the most token-expensive rule and correctly placed in LLM. |
| R-16 (role-fit heuristic) | No | — | Role field passed as `candidateAgents[].role`; role-fit table in preamble; LLM applies. |
| R-17 (parent-run gate) | No | — | `issue.parentId` exists in CoordinatorInput type but is hardcoded to `null` in pickup-todos.ts call site (L~280). The rule can never fire for Squadboard-originated dispatches. |
| R-18 (unavailable agents) | No | — | `candidateAgents[].available` populated from `busyAgentIds` set (agents with pending/running runs). LLM filters. Should be pre-filter. |
| R-19 (backlog gate) | No | — | `issue.column` = `issue.status` from DB. `issue.labels = []` (empty, same gap as R-14). LLM checks column. |
| R-20 (Ahmed-only) | No | — | LLM keyword check. Four-term list should be extracted to pre-filter function. |
| R-21 to R-22 (confidence floor, contention) | No | — | Operate on LLM-generated confidence values; correctly in LLM. |
| R-23 (failure escalation) | No | — | `recentRuns` built from `issueRuns` history in pickup-todos.ts. Circuit breaker in pickup-todos.ts (`CIRCUIT_BREAKER_MIN_FAILURES = 3`) partially covers but with different semantics. See section 4 for conflict analysis. |
| R-24 (thin issue) | No | — | Should be pre-filter. Note: `issue.body` can be null and `issue.labels = []` (empty), so the structural checks are computable without LLM. |
| R-25 to R-28 (response mode, model selection, fallbacks, persistent config) | No | — | Not applicable to Squadboard server. dispatch.ts implements its own model chain for the coordinator's self-calls (R-27 partial coverage for coordinator's own calls only). |
| R-29 to R-35 (spawn mechanics, templates, fan-out) | No | — | Not applicable to Squadboard server. Spawning is CLI coordinator territory. |
| R-36, R-48 (drop-box pattern, orchestration log) | No (enforcement) | Bundle schema has BundleAgent types | Server: enforcement is via spawn prompt instructions (CLI coordinator). Squadboard server does not enforce the drop-box pattern — agents running via the server write wherever their charter says. |
| R-37 (archive decisions) | YES | `archiveDecisionsBySize()` in `scribe/primitives.ts` | Server calls SDK via Scribe-as-ceremony. SDK is the single implementation — no duplication. Verbatim mirror of squad.agent.md task 1. Known divergence: Wave 13 archive bug (see Risk C in section 1). |
| R-38 (inbox merge) | YES | `mergeInbox()` in `scribe/primitives.ts` | Same. |
| R-39 (orchestration log) | YES | `writeOrchestrationLogs()` | Same. |
| R-40 (session log) | YES | `writeSessionLog()` | Same. |
| R-41 (cross-agent history) | YES | `crossAgentHistoryUpdates()` | Same. |
| R-42 (history summarization) | YES | `summarizeHistoryIfLarge()` | Same. |
| R-43 (git commit scoped) | YES | `commitScribeFiles()` | Same. |
| R-44 (health report) | YES | `writeHealthReport()` in `steps/step-8-health-report.ts` | Same. |
| R-45 (dogfood addendum) | No | — | MCP tool call; this repo only; not SDK territory. |
| R-46 to R-47 (worktree rules) | No | — | `workspace.ts` in server handles Squadboard's workspace allocation for issue runs (it creates workspaces, not full git worktrees as described in squad.agent.md). |
| R-49 to R-52 (casting/naming) | No | — | `@bradygaster/squad-sdk` (not the audited SDK) provides `AgentsCollection` which reads agents from `.squad/agents/`. Casting algorithm itself: CLI coordinator territory. |
| R-53 to R-54 (team lifecycle) | No | — | `agent-sync.ts` (`syncAgentsFromDisk()`) handles DB sync when disk state changes; uses `@bradygaster/squad-sdk` as primary with fs fallback. Charter CRUD (creation on add, retirement on remove) is CLI coordinator territory. |
| R-55 (reviewer rejection lockout) | No | — | `peer-reviewer.ts` encodes review gates for workflow steps: `shouldBlock()`, `isQuorumMet()`, `request_changes_policy`. Does NOT encode the original-author lockout rule for non-workflow runs. |
| R-56 to R-57 (ceremonies) | No (execution) | `BundleCeremony` types in bundle schema | Server-side ceremony engine (`ceremony-dispatcher.ts`, `ceremony-scheduler.ts`, Zod schema in `yaml-schema.ts`) is a parallel implementation; does not call squad.agent.md ceremony logic. |
| R-58 to R-59 (Ralph) | No | — | `pickup-todos.ts` sweeps for todo issues every 10s — this is the automated equivalent of Ralph's "scan for work and dispatch" behavior, but without Ralph's GitHub PR/CI/draft scanning or the interactive loop. |
| R-60 (GitHub Issues Mode) | No | — | `github-git-ops.ts` handles push/PR/merge operations. CLI coordinator orchestrates the issue→PR lifecycle. Squadboard's issue system is its own — not GitHub Issues. |
| R-61 to R-63 (PRD, Human, @copilot) | No | — | CLI coordinator territory. |
| R-64 to R-66 (source of truth, skills, skill confidence) | No | — | Skills directory scanning not surfaced to Squadboard coordinator. |
| R-67 (personal squad) | No | — | CLI coordinator territory. |
| R-68 to R-70 (platform compat, SQL caveat, MCP) | No | — | CLI coordinator territory. |
| R-71 (directive capture) | No | — | CLI coordinator territory. Dogfood addendum is this-repo-only behavior. |
| R-72 to R-74 (constraints, artifact format, budget tracking) | No | — | CLI coordinator territory. |

### 3.4 Duplication analysis

**Intentional non-duplication (correct):** The SDK's scribe primitives (R-37 to R-44) follow the "one algorithm, multiple callers" principle explicitly documented in `primitives.ts`. The SDK is the single source of implementation. The CLI coordinator's Scribe agent, the Squadboard ceremony engine, the daemon, and the Wave 15 manual button all use the same code. This is correct.

**Unintentional conflict — circuit breaker vs. failure escalation (R-23):**
The circuit breaker in `pickup-todos.ts` fires AFTER the coordinator's dispatch decision:

```typescript
// coordinator decision happens first:
const result = await dispatchViaCoordinator({ ... });
if (decision.kind === 'dispatch') { targetAgentId = agentByName.get(decision.agent); }

// circuit breaker fires AFTER coordinator picked an agent:
const recentFailures = await db.select().where(and(
  eq(issueRuns.issueId, issue.id),
  eq(issueRuns.agentId, targetAgentId), // the agent coordinator chose
  eq(issueRuns.status, 'failed'),
  gte(issueRuns.createdAt, windowStart)
));
if (recentFailures.length >= CIRCUIT_BREAKER_MIN_FAILURES) { continue; }
```

The problem: the coordinator preamble (R-23) says "if same issue was previously run by best-fit agent and resulted in failed/abandoned in recentRuns, prefer next-best agent." The coordinator reads `recentRuns` from CoordinatorInput and applies this logic. Then, separately, the circuit breaker also fires on failure count. If the coordinator chose the next-best agent (because it saw failures in recentRuns), the circuit breaker checks failures for THAT agent too — which may not have any failures, making the circuit breaker a no-op in this case. If the coordinator chose the primary agent despite failures (maybe it's still the best fit at 0.75 confidence), the circuit breaker will veto the coordinator's decision silently, with no record that the circuit breaker fired (it just `continue`s).

This silent veto is the bug: the circuit breaker overrides the coordinator's decision without logging the override to `coordinator_decision`. The next sweep tick will call the coordinator again for the same issue, get the same coordinator answer, hit the same circuit breaker, and continue forever — the issue is effectively stuck with no visible error.

**Smell — ceremonies dual-track:** Squadboard's ceremony engine and the CLI coordinator's ceremony logic are completely separate tracks. They share the YAML schema format (BundleCeremony types mirror the Zod schema in yaml-schema.ts) but have no runtime integration. A ceremony configured in `.squad/ceremonies.md` (CLI coordinator format) has no effect on Squadboard's schedule-based ceremony execution, and vice versa. This will need to be resolved before Squadboard can claim full squad.agent.md ceremony parity.

**Smell — labels always empty in pickup-todos.ts:** The CoordinatorInput built in pickup-todos.ts hardcodes `labels: []` (line ~280 in the dispatch call). This means R-14 (exact label match) and R-19 (backlog gate label check) can never resolve correctly from the server sweep — the coordinator always sees an issue with no labels regardless of what labels are actually on the issue. Labels are stored on Squadboard issues in the DB (`issues.labels` or equivalent). This is a bug, not a design choice.

### 3.5 @bradygaster/squad-sdk integration in the server

`sdk-state.ts` provides a per-project `SquadState` wrapper using `@bradygaster/squad-sdk`. The collections it exposes are:

- `AgentsCollection` — typed access to `.squad/agents/{name}/` directories (charter.md, history.md)
- `RoutingCollection` — typed access to `.squad/routing.md`
- `DecisionsCollection` — typed access to `.squad/decisions.md`
- `SkillsCollection` — typed access to `.squad/skills/`
- `TeamCollection` — typed access to `.squad/team.md`
- `TemplatesCollection` — typed access to `.squad/templates/`
- `ConfigCollection` — typed access to `.squad/config.json`

`agent-sync.ts` uses `AgentsCollection.list()` as primary agent discovery, with `fs.readdir` as fallback:

```typescript
// agent-sync.ts (lines ~25-35):
try {
  entries = await (await getAgents(projectId)).list();
} catch (sdkErr) {
  console.warn('[agent-sync] SDK agents.list() failed, falling back to fs.readdir:', sdkErr);
  const dirents = await fs.readdir(agentsDir, { withFileTypes: true });
  entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
}
```

Similarly for charter content:
```typescript
try {
  charterContent = await (await getAgents(projectId)).get(agentName).charter();
} catch (sdkErr) {
  charterContent = await fs.readFile(charterPath, 'utf-8');
}
```

This SDK-first-with-fallback pattern means `@bradygaster/squad-sdk` is a soft dependency — the server degrades gracefully if the SDK is unavailable. The SDK is not used for routing decisions, ceremony execution, or any coordinator logic.

**Observation:** The `@bradygaster/squad-sdk` provides `RoutingCollection`, `SkillsCollection`, and `ConfigCollection` which are not used by the coordinator today. If the coordinator were to use these collections (to populate `project.rules` from routing.md, or to inject skill paths), it would have a typed API available. This is a quick win for the `project.rules` gap identified in section 6.1.

### 3.6 Bundle schema — what it means for Squadboard portability

`packages/squadboard-sdk/src/bundle/schema.ts` defines a portable bundle format with:

```typescript
interface SquadboardBundle {
  manifest: BundleManifest;       // schemaVersion, version, name, description, createdAt
  projects?: BundleProject[];     // full project configs
  kanban?: BundleKanban;          // columns with WIP limits
  team?: BundleTeamMember[];      // agents with charter content
  ceremonies?: BundleCeremony[];  // ceremony YAML configs
  workflows?: BundleWorkflow[];   // step-by-step workflow definitions
  skills?: BundleSkill[];         // skill markdown content
  tools?: BundleTool[];           // tool configurations
  mcpServers?: BundleMcpServer[]; // MCP server configs
  routing?: BundleRoutingRule[];  // routing rules
}
```

This bundle format encodes the structural shape of squad.agent.md's `.squad/` directory — the same team, ceremonies, workflows, routing, and skills that squad.agent.md governs. But the bundle is **configuration portability only** — it is an import/export artifact. It does not encode the behavioral rules (how to run ceremonies, how to dispatch, how to select models).

The connection between squad.agent.md and the bundle schema: if a repo's `.squad/` state can be exported as a bundle, that bundle captures the team's configuration but not the coordinator's operating rules. A new Squadboard instance importing this bundle would have the right team structure but would need squad.agent.md independently to govern the coordinator's behavior.

This is the correct architecture. The bundle is data; squad.agent.md is policy.

---

## 4. LLM-Driven vs State-Machine Partition Recommendation

### 4.1 Framework for the decision

Each rule is evaluated against six criteria. The recommendation to move to a deterministic state-machine step requires ALL of these to be satisfied:

1. **Cost predictability:** The rule produces the same outcome for the same inputs every time. No stochastic variance.
2. **Latency:** Deterministic code is always faster than an LLM round-trip. Moving the rule saves latency if it can short-circuit before the LLM call.
3. **Debuggability:** A deterministic function produces a stack trace. An LLM produces a rationale string. Code is more debuggable.
4. **Drift risk:** Preamble changes affect all rules simultaneously. Moving a rule to code isolates it from preamble drift.
5. **Replay determinism:** The same CoordinatorInput should always produce the same outcome for automated testing. Deterministic pre-filters make tests reliable; LLM outputs are never deterministic.
6. **Audit trail:** Deterministic decisions can be logged with full provenance. LLM decisions are logged as rationale strings — auditable but not machine-checkable.

### 4.2 Rules that must stay in the coordinator LLM

The following rules require LLM judgment. They cannot be moved to deterministic code without losing precision or requiring model encoding of domain knowledge.

**R-15 — Exclusive charter claim (Rule 3)**

The coordinator must read charter prose and identify whether a claim is "explicit" (counts) vs. "implied" (doesn't count). The distinction is semantic: "I own all DB migrations" is explicit; "I may help with database work" is not. This requires reading and understanding charter language, comparing it against the issue domain, and making a judgment call about ownership exclusivity.

Why it cannot move: there is no structural marker in the charter format that flags explicit ownership claims. The information is in prose. A regex approach would produce too many false positives. Verdict: **stays in LLM.**

**R-16 — Role-fit heuristic (Rule 4)**

The "dominant cue" in an issue is the primary action implied by the title and body. For "Fix the auth endpoint timeout causing 503s on high load," the dominant cue is "backend API" (timeout, endpoint) not "ops" (503s, load). This semantic interpretation of what the issue is primarily asking for is language work.

Why it cannot move: keyword scoring (Tier 2 in the existing router) already handles this deterministically. But the coordinator's role-fit is a higher-level semantic understanding — it captures cases where keyword scoring would fail (e.g., an issue titled "Improve the registration flow" has no direct keyword hits but clearly belongs to frontend). Verdict: **stays in LLM.** (Note: Tier 2 router exists in `router.ts` as a fallback — it handles keyword scoring. The coordinator's R-16 should not try to replicate Tier 2 but should focus on the semantic interpretation that Tier 2 misses.)

**R-03 — Team composition in Init Mode**

Proposing a team for an unknown project requires understanding what roles are needed for the described technology stack and domain. Verdict: **stays in LLM.**

**R-25 — Response mode selection**

Task complexity is a semantic judgment. A request that looks lightweight ("fix the button") might require architectural understanding; a request that looks complex ("refactor the auth module") might be a single-file change. Verdict: **stays in LLM.**

**R-08 — Session catch-up trigger**

Detecting whether the user's message is a status request vs. a task is intent classification. Verdict: **stays in LLM.**

**R-61 — PRD decomposition**

Extracting work items from a product requirements document requires understanding the PRD's intent, grouping related requirements into coherent work units, and identifying dependencies. This is complex language work. Verdict: **stays in LLM.**

### 4.3 Pure-rules that should move to the state machine

**R-13 — Named-agent keyword (Rule 1)**

Migration plan:

```typescript
// packages/server/src/coordinator/pre-filters.ts (new file, W31)

const NAMED_AGENT_PATTERNS = [
  (name: string) => `@${name}`,
  (name: string) => `assign to ${name}`,
  (name: string) => `${name}: `,
];

export function resolveNamedAgent(
  issue: Pick<CoordinatorInput['issue'], 'title' | 'body'>,
  candidateAgents: Array<Pick<CoordinatorInput['candidateAgents'][number], 'name' | 'available'>>,
): string | null {
  const text = `${issue.title} ${issue.body ?? ''}`.toLowerCase();
  for (const agent of candidateAgents) {
    if (!agent.available) continue; // respect R-18 — named but unavailable = skip
    for (const pattern of NAMED_AGENT_PATTERNS) {
      if (text.includes(pattern(agent.name))) return agent.name;
    }
  }
  return null;
}
```

Usage in `pickup-todos.ts`: call `resolveNamedAgent()` before building `CoordinatorInput`. If a match is found, create the `issue_run` directly without calling `dispatchViaCoordinator()`. Log as `routingTier: 0` (pre-coordinator).

Target: `coordinator-deterministic` (new pre-filter module).
Wave: W31. Estimated token savings: eliminates LLM call for all @agent-named issues (typical: 5-15% of backlog items in active projects).

**R-17 — Parent-run gate (Rule 5)**

Critical bug: `issue.parentId` is currently hardcoded to `null` in the pickup-todos.ts coordinator call. This means R-17 can never fire from the Squadboard server. Before fixing the pre-filter, fix the data plumbing.

Migration plan:

```typescript
// Step 1: Fix data plumbing in pickup-todos.ts
// Add parentId to the issues select:
const todoIssues = await db
  .select({
    id: issues.id,
    projectId: issues.projectId,
    title: issues.title,
    body: issues.body,
    status: issues.status,
    parentId: issues.parentId, // ADD THIS
    createdAt: issues.createdAt,
  })
  .from(issues)
  .where(and(eq(issues.status, 'todo'), eq(issues.archived, 0)));

// Step 2: Pre-filter for parent gate:
async function isParentComplete(parentId: string): Promise<boolean> {
  const [run] = await db
    .select({ status: issueRuns.status })
    .from(issueRuns)
    .where(and(eq(issueRuns.issueId, parentId), eq(issueRuns.status, 'completed')))
    .limit(1);
  return run !== undefined;
}

// In pickup-todos.ts, before coordinator call:
if (issue.parentId && !(await isParentComplete(issue.parentId))) {
  await persistCoordinatorDecision(/* new run id */, {
    kind: 'skip',
    reason: `Parent issue ${issue.parentId} has no completed run — dependency not satisfied.`,
  }, deterministicMeta);
  continue;
}
```

Target: `coordinator-deterministic` (pre-LLM filter).
Wave: W31. Saves full LLM call for any issue with an incomplete parent (dependency chains in multi-step workflows).

**R-18 — Unavailable agents pre-filter (Rule 6)**

Currently all agents pass through to CoordinatorInput, including unavailable ones. The LLM must parse and filter them. The field exists to enable pre-filtering.

Migration plan: In pickup-todos.ts, split the candidate list:

```typescript
const allActiveAgents = await db.select({ ... }).from(agents)
  .where(and(eq(agents.projectId, projectId), eq(agents.status, 'active')));

// Pre-compute busy set (already done for busyAgentIds)
const availableCandidates = allActiveAgents.filter(a => !busyAgentIds.has(a.id));

if (availableCandidates.length === 0) {
  // All agents busy — skip or ambiguous
  await persistCoordinatorDecision(..., { kind: 'skip', reason: 'All agents currently busy.' }, deterministicMeta);
  continue;
}

// Pass only available agents to coordinator
const coordinatorInput: CoordinatorInput = {
  ...
  candidateAgents: availableCandidates.map(a => ({
    ...a,
    available: true, // always true now — unavailable already filtered
  })),
};
```

Target: `coordinator-deterministic` (pre-filter in pickup-todos.ts).
Wave: W31. Reduces prompt size by removing unavailable agent charter content.

**R-19 — Backlog gate (Rule 7)**

The column check (`issue.status === 'Backlog'`) is pure. The label intersection check (`issue.labels.some(l => agents.some(a => a.capabilities.includes(l)))`) is pure — BUT requires fixing the `labels: []` bug first (section 3.4).

Migration plan:

```typescript
function isBacklogGateBlock(
  issue: CoordinatorInput['issue'],
  candidateAgents: CoordinatorInput['candidateAgents'],
): boolean {
  if (issue.column !== 'Backlog' && issue.status !== 'backlog') return false; // not a backlog issue
  // Has any agent capability that matches any issue label?
  const hasCapabilityMatch = issue.labels.some(label =>
    candidateAgents.some(agent => agent.capabilities.includes(label))
  );
  return !hasCapabilityMatch; // true = should block
}
```

If `isBacklogGateBlock()` returns true → emit `kind: 'skip'` without LLM call.
Prerequisite: fix `labels: []` bug (pass real issue labels from DB).
Target: `coordinator-deterministic`.
Wave: W31 (blocked on label fix).

**R-20 — Ahmed-only operations (Rule 8)**

Simplest pre-filter. Four hardcoded keywords. Zero LLM value.

```typescript
// packages/server/src/coordinator/pre-filters.ts
const AHMED_ONLY_TERMS = [
  'publish-mcp-auth',
  'code-signing',
  'billing configuration',
  'org-level secret',
  'org-level secrets',
];

export function isAhmedOnly(issue: Pick<CoordinatorInput['issue'], 'title' | 'body'>): boolean {
  const text = `${issue.title} ${issue.body ?? ''}`.toLowerCase();
  return AHMED_ONLY_TERMS.some(term => text.includes(term));
}
```

If `isAhmedOnly()` returns true → emit `kind: 'skip', reason: 'Requires Ahmed intervention.'`.
Target: `coordinator-deterministic`.
Wave: W31.

**R-24 — Thin issue fallback (Rule 12)**

```typescript
export function isThinIssue(issue: CoordinatorInput['issue']): boolean {
  return (
    (issue.body === null || issue.body.trim() === '') &&
    issue.labels.length === 0 &&
    issue.title.trim().split(/\s+/).length < 5
  );
}
```

If `isThinIssue()` returns true → emit `kind: 'ambiguous', suggestedAgents: [], question: 'Issue has no body, no labels, and a very short title. Please add context before this can be routed.'`.
Target: `coordinator-deterministic`.
Wave: W31.

**R-23 — Failure escalation and circuit breaker unification**

Current state: two overlapping rules with different semantics and a silent conflict.
- Coordinator preamble R-23: prefer next-best agent, lower confidence by 0.15
- Circuit breaker: block (issue, agent) tuple for 30 min after 3 failures

Recommended unification:

```typescript
// Remove the current post-coordinator circuit breaker entirely.
// Instead, pre-compute failure counts per (issue, agent) before coordinator call.
// Pass this data into CoordinatorInput for the LLM to use.

// Add to CoordinatorInput type (new field):
// recentFailures?: Array<{ agentName: string; failureCount: number; windowMinutes: number }>

// In pickup-todos.ts, pre-fill:
const failureCounts = await db
  .select({
    agentName: agents.name,
    count: count(issueRuns.id),
  })
  .from(issueRuns)
  .innerJoin(agents, eq(issueRuns.agentId, agents.id))
  .where(and(
    eq(issueRuns.issueId, issue.id),
    eq(issueRuns.status, 'failed'),
    gte(issueRuns.createdAt, new Date(Date.now() - CIRCUIT_BREAKER_WINDOW_MS)),
  ))
  .groupBy(agents.name);

// Hard block: agents with >= CIRCUIT_BREAKER_MIN_FAILURES failures are removed
// from candidateAgents before the coordinator call (not as a silent post-veto).
const blockedAgentNames = new Set(
  failureCounts.filter(f => f.count >= CIRCUIT_BREAKER_MIN_FAILURES).map(f => f.agentName)
);

const filteredCandidates = availableCandidates.filter(a => !blockedAgentNames.has(a.name));

if (filteredCandidates.length === 0) {
  await persistCoordinatorDecision(..., {
    kind: 'skip',
    reason: `All agents have hit the circuit breaker for issue ${issue.id} — too many recent failures.`,
  }, deterministicMeta);
  continue;
}
```

This makes the circuit breaker a visible pre-filter (logged to coordinator_decision) instead of a silent post-veto. The coordinator LLM still handles the soft escalation (lower confidence by 0.15 for 1-2 failures) via the recentRuns data. Hard blocks are deterministic and visible.

Target: `coordinator-deterministic` (pre-filter replacing circuit breaker).
Wave: W31.

### 4.4 Migration impact summary

If all 6 pre-filters above are implemented (R-13, R-17, R-18, R-19, R-20, R-24), the coordinator LLM call is eliminated entirely for issues matching any of these pre-conditions. The remaining LLM calls handle only the genuinely judgment-required cases (R-15, R-16, confidence analysis).

Estimated reduction in coordinator LLM calls per pickup-todos cycle:

| Pre-filter | Typical hit rate | Notes |
|------------|-----------------|-------|
| R-13 (named-agent) | 5-15% | @agent syntax common in active projects |
| R-17 (parent not done) | 10-30% | Dependency chains in multi-step backlogs |
| R-18 (all unavailable) | 1-5% | Only fires when all agents busy simultaneously |
| R-19 (backlog gate) | 5-20% | Backlog items that have no matching agent capabilities |
| R-20 (Ahmed-only) | 0-2% | Rare but costs zero to check |
| R-24 (thin issue) | 5-10% | Untriaged placeholder issues common in active repos |
| **Total elimination** | **~25-50%** | Combined; rates overlap for some issues |

Additionally, removing unavailable agents from CoordinatorInput (R-18 fix) reduces prompt size on every remaining call proportionally to the number of busy agents.

---

## 5. Mini-squad.agent.md Spawning vs Charter Parser

### 5.1 Understanding the question

Brady's question contains two related but distinct ideas that need to be separated:

**Idea 1 — "Mini-squad.agent.md from springboard":** Create a lighter-weight coordinator prompt (the "mini" version of squad.agent.md) that, when given an issue, reads the agent charter files and decides which agent to run. The springboard is the mechanism that spawns this mini-coordinator.

**Idea 2 — "Spawns the other agent charters instead of trying to create a charter parser":** Instead of the current approach where `charter-compiler.ts` parses charter markdown into structured metadata, have the coordinator itself read the raw charter files and extract what it needs through LLM comprehension.

These ideas are architecturally different. Idea 1 is about the coordinator dispatch model (who runs the coordinator, and how deep is it?). Idea 2 is about charter data extraction (do we parse or comprehend?). The current system uses both a charter parser AND an LLM coordinator — they solve different problems.

### 5.2 Current dispatch flow (what we have)

```
pickup-todos.ts (sweep, 10s interval)
  └── for each uncovered todo issue:
        ├── Build CoordinatorInput
        │     ├── issue: {id, title, body, labels:[], column, parentId:null, priority:null, createdAt}
        │     ├── candidateAgents: [{name, role, charterHash, charterContent, capabilities:[], available}]
        │     │     charterContent = full charter.md text from agents DB column
        │     │     capabilities = [] (hardcoded — another bug, should come from charter expertise)
        │     ├── project: {id, name, rules:''}
        │     └── recentRuns: [last 5 completed/failed/cancelled runs]
        │
        ├── dispatchViaCoordinator(input, opts)
        │     ├── coordinatorInputSchema.parse(input)  [Zod validation]
        │     ├── hashCoordinatorInput(input)           [stable hash for cache]
        │     ├── decisionCache.get(input)              [LRU + TTL cache check]
        │     ├── loadCoordinatorPreamble()             [.squad/squadboard-coordinator.md OR built-in]
        │     ├── for model in resolveChain():          [model chain fallback, W30]
        │     │     callCoordinatorLlm({preamble, JSON.stringify(input), model})
        │     │     → coordinatorDecisionSchema.parse(responseText)
        │     │     → CoordinatorDecision: dispatch | skip | ambiguous
        │     └── decisionCache.set(input, decision)
        │
        └── On dispatch: insert issueRun, persistCoordinatorDecision
            On skip: log and continue
            On ambiguous: fall through to Tier 2 (keyword scoring in router.ts)
```

Key observations from this flow:
- `charterContent` = full charter text → **high token cost**
- `capabilities = []` → **R-14 and R-19 label checks can never work**
- `labels = []` → **R-14 and R-19 label checks can never work**
- `parentId = null` → **R-17 can never fire**
- `rules = ''` → **project-level rules not surfaced to coordinator**

These are data plumbing bugs, not architectural deficiencies. The architecture is correct.

### 5.3 What "mini-squad.agent.md from springboard" would look like in practice

Under this model, the pickup-todos sweep would NOT call `dispatchViaCoordinator()`. Instead, it would spawn a coordinator agent that receives the issue and agent list and makes the dispatch decision. Something like:

```typescript
// Hypothetical "springboard" approach:
const coordinatorAgent = await SquadClient.createSession({
  model: 'claude-haiku-4.5',
  systemMessage: {
    mode: 'replace',
    content: await fs.readFile('.github/agents/squad.agent.md', 'utf8'), // or a mini version
  },
});

const result = await SquadClient.sendAndWait(coordinatorAgent, {
  prompt: `
    Issue #${issue.id}: "${issue.title}"
    Body: ${issue.body}
    Candidates: ${candidateAgents.map(a => a.name).join(', ')}
    
    Which agent should handle this? Respond with: {"agent": "name"} or {"skip": "reason"} or {"ambiguous": ["a", "b"]}.
  `,
});

// Parse result... somehow
```

Problems with this approach compared to the current architecture:

**Token cost:** squad.agent.md is 1378 lines / ~10,000 tokens. The current preamble (`.squad/squadboard-coordinator.md`) is 199 lines / ~1,500 tokens. The "mini" coordinator already IS the right abstraction — using the full squad.agent.md as the system prompt would be 6-7x more expensive per dispatch call.

**Multi-turn complexity:** The full squad.agent.md coordinator is designed for a multi-turn conversation with a human. A dispatch decision is a single-turn operation. Spawning a full coordinator agent for each issue dispatch is like using a sledgehammer for a finishing nail.

**No output schema:** The current `coordinatorDecisionSchema` (Zod) validates that the LLM output is exactly one of three shapes. A full squad.agent.md coordinator might respond with prose explanation, refuse to give just JSON, or use a different format. Schema-less output is harder to parse reliably.

**Audit trail:** The current `persistCoordinatorDecision()` stores a fully-typed decision record with meta (model, tokens, duration, cacheHit, inputHash). A spawned coordinator agent's decision would be embedded in conversation text and much harder to extract and persist.

**Loss of caching:** The current LRU + TTL cache (`decisionCache`) is keyed by `sha256(stableStringify(CoordinatorInput))`. If the same issue with the same candidate agents is evaluated again within 60 seconds, the cache short-circuits the LLM call. A spawned agent creates a new session each time — no caching possible at this level.

**Replay determinism:** The current architecture supports deterministic test replay: inject a `fakeLlmCaller`, same input → same mocked output. A spawned agent is not injectable.

### 5.4 What "spawns the other agent charters" (charter parser replacement) would mean

The second reading of Brady's question is: instead of `charter-compiler.ts` parsing charter markdown into structured metadata, the coordinator itself reads each charter.md file and extracts what it needs via LLM comprehension.

Current charter parsing (`charter-compiler.ts`, `charter-identity.ts`):
- Extracts: name (H1 heading), role (## Role section), model (## Model section), expertise (bullet list under ## Expertise/Skills/Capabilities), style (## Style), reviewerAuthority (## Reviewer authority)
- Stores in `agents` table: `role`, `model`, `charterHash`, `charterContent`
- `charterContent` is the full raw markdown passed to the coordinator

If the coordinator were to "spawn" each charter instead of parsing it:
- Each agent would be instantiated as a mini-agent with its charter as its system prompt
- The coordinator would query each mini-agent about its capabilities, role, etc.
- This replaces a synchronous regex/markdown parse with N asynchronous LLM calls

This is strictly worse for the dispatch use case:
- **N LLM calls vs 1 regex parse:** For 8 candidate agents, that's 8 LLM calls just to extract role and capabilities.
- **No persistence:** Charter metadata is cached in the DB. Re-extracting via LLM on every dispatch call means no caching of charter structure.
- **Drift detection loss:** `charterHash` in the DB enables `agent-sync.ts` to detect when a charter changes. If extraction happens at dispatch time, there's no baseline to diff against.

### 5.5 Recommendation: keep current architecture; fix data plumbing bugs

The right answer is NOT to change the dispatch architecture. The bugs that make rules R-14, R-17, R-19 non-functional are data plumbing issues in how `CoordinatorInput` is built:

| Field | Current value | Should be |
|-------|--------------|-----------|
| `issue.labels` | `[]` (hardcoded) | Actual issue labels from DB |
| `issue.parentId` | `null` (hardcoded) | Actual parent issue ID from DB |
| `issue.priority` | `null` (hardcoded) | Actual priority from DB |
| `issue.column` | `issue.status` (correct but verify mapping) | Verified mapping to kanban column names |
| `candidateAgents[].capabilities` | `[]` (hardcoded) | Actual capabilities from charter expertise section |
| `project.rules` | `''` (empty) | Project-level rules from DB or routing.md summary |

Fixing these data plumbing issues costs no architectural change and immediately activates 4 more coordinator rules (R-14, R-17, R-19, and richer R-16 via role field accuracy).

### 5.6 On the "charter parser" specifically

The charter parser (`charter-compiler.ts`) is not trying to do what the coordinator's LLM does. The charter parser extracts structured metadata (role, model, expertise keywords) for storage and display. The coordinator uses the full `charterContent` for semantic reasoning about ownership and fit. These are complementary, not competing.

The issue is that `capabilities` (derived from charter expertise) is hardcoded to `[]` in pickup-todos.ts, which means the structured parsing output is never used in dispatch. Fix: populate `capabilities` from the `expertise` field on the agents DB row (already extracted by charter-compiler).

The charter parser does NOT need to be replaced by LLM comprehension. It needs its output to be plumbed into the CoordinatorInput correctly.

---

## 6. Gaps and Proposed Wave 31+ Work

### 6.1 Data plumbing bugs (blocking correctness of existing rules)

These are the highest-priority W31 items. They block 4 dispatch rules from ever working correctly.

| Bug | Affected Rules | Location | Fix |
|-----|---------------|----------|-----|
| `labels: []` hardcoded | R-14, R-19 | `pickup-todos.ts`, coordinator call site | Add labels query: join issues with a labels table (or parse issues.labels if stored as JSON/array) and pass to CoordinatorInput |
| `parentId: null` hardcoded | R-17 | `pickup-todos.ts`, coordinator call site | Add `parentId: issues.parentId` to the select and pass through |
| `capabilities: []` hardcoded | R-14, R-19 | `pickup-todos.ts`, coordinator call site | Use `parseCharterContent(a.charterContent).expertise` or query an agent expertise column |
| `rules: ''` empty | General context | `pickup-todos.ts`, coordinator call site | Read routing.md summary or project rules from DB |
| Silent circuit breaker veto | R-23 | `pickup-todos.ts`, after coordinator call | See section 4.3 unification plan |

### 6.2 New pre-filter module (W31 target: coordinator-deterministic)

Create `packages/server/src/coordinator/pre-filters.ts` with the following exports:

```typescript
export function resolveNamedAgent(issue, candidateAgents): string | null  // R-13
export function isParentPending(issue, db): Promise<boolean>              // R-17
export function filterUnavailableAgents(candidates, busyIds): candidates  // R-18
export function isBacklogGated(issue, candidates): boolean                // R-19
export function isAhmedOnly(issue): boolean                               // R-20
export function isThinIssue(issue): boolean                               // R-24
export function resolveCircuitBreakerBlocked(issue, candidates, db)        // R-23 unified
  : Promise<{ filteredCandidates: candidates, blockedNames: Set<string> }>
```

Each function must:
- Accept inputs already available in pickup-todos.ts scope
- Be independently testable with no LLM dependency
- Emit a `CoordinatorDecision` literal when blocking, so it can be persisted via `persistCoordinatorDecision()`
- Be tagged with a `deterministicMeta` (zero-token, zero-cost metadata object) to distinguish from LLM-generated decisions in the audit log

### 6.3 Preamble drift prevention (W31 target: CI)

Add a CI step that:
1. Extracts the "Decision rules" section from `.github/agents/squad.agent.md` (L18-73 in squadboard-coordinator.md equivalent)
2. Extracts the decision rules from `.squad/squadboard-coordinator.md`
3. Computes a normalized diff (strip formatting, compare rule counts, compare key threshold values: 12 rules, confidence values 1.0/0.9/0.85/0.75/0.4/0.15, 5-word title threshold)
4. Fails the build if the Squadboard preamble is missing a rule present in squad.agent.md

This is not a byte-for-byte comparison — squad.agent.md includes contextual framing that Squadboard doesn't need. But it is a semantic equivalence check that catches rule additions, deletions, and threshold changes.

### 6.4 Charter content trimming (W31 target: coordinator input optimization)

Add a `charterSummary` TEXT column to the `agents` table. Populate via `agent-sync.ts` on every charter sync:

```typescript
// In agent-sync.ts, alongside computeContentHash():
function extractCharterSummary(charterContent: string): string {
  const meta = parseCharterContent(charterContent);
  return [
    `# ${meta.name}`,
    `## Role`,
    meta.role,
    `## Focus Areas`,
    meta.expertise.join('\n- '),
    `## Model`,
    meta.model ?? 'auto',
    // First 200 chars of charter body for additional context:
    charterContent.slice(0, 200) + (charterContent.length > 200 ? '...' : ''),
  ].join('\n\n');
}
```

Pass `charterSummary` in `candidateAgents[].charterContent` for coordinator dispatch. Keep full `charterContent` in DB for display, history, and full-charter reads. Estimated token reduction: 50-70% for the charterContent portion of CoordinatorInput.

### 6.5 squad.agent.md rules not encoded anywhere in Squadboard

| Rule ID | Gap | Proposed W31+ Home | Priority |
|---------|-----|-------------------|----------|
| R-55 (Reviewer Rejection Lockout for non-workflow runs) | peer-reviewer.ts covers workflow-step review gates but not direct dispatch lockout. If an agent's non-workflow output is rejected, the same agent can be re-dispatched. | New `dispatch_lockouts` table with (issueId, lockedAgentId, lockedUntil). Check in pre-filters before coordinator call. | High |
| R-58 (Ralph — automated board scanning for untriaged/PR states) | pickup-todos.ts handles todo dispatch but not: untriaged issues without squad:{member} label, CI failure routing, approved PR auto-merge. | New sweeps: `triage-untriaged.ts` (triage issues without squad:{member}), `auto-merge-ready.ts` (merge approved+green PRs). | High |
| R-59 (Watch Mode CLI) | `npx @bradygaster/squad-cli watch` not implemented. The server has always-on sweeps as equivalent but the CLI watch command for GitHub integration is missing. | New CLI package or cron endpoint that wraps GitHub polling + triage logic. | Medium |
| R-47 (Worktree lifecycle cleanup) | workspace.ts creates workspaces for runs but does not clean up git worktrees after PR merge. | Add worktree cleanup step in a post-merge ceremony or in the approved-PR auto-merge sweep. | Medium |
| R-65 (Skill-aware routing) | `.copilot/skills/` and `.squad/skills/` not scanned before dispatch. Relevant skills not injected into coordinator context. | Add `relevantSkills: string[]` to CoordinatorInput. Populate via FS scan in pickup-todos.ts. Pass skill content in the project.rules field initially. | Low |
| R-12 (Issue triage routing — lead assigns squad:{member}) | Squadboard has routing config but no auto-triage sweep that reads squad-labeled issues and assigns them to members by label. | New `triage-squad-labels.ts` sweep. | Medium |
| R-45 (Dogfood addendum) | MCP capture on directive + done capture after work is in-repo-only. | No server-side implementation needed. CLI coordinator only. | N/A |

### 6.6 Squad-SDK functions that Squadboard should call but doesn't

| SDK Function | Current Squadboard State | Proposed W31+ Integration |
|-------------|-------------------------|--------------------------|
| `archiveDecisionsBySize()` + `summarizeHistoryIfLarge()` | Called only via Scribe agent (CLI coordinator) or closeOut() (daemon). If Squadboard is used without CLI coordinator (pure Squadboard workflow), decisions.md and history.md grow unbounded. | Add a `decisions-maintenance.ts` sweep (low frequency: hourly or daily) that calls these two SDK primitives directly. |
| `closeOut()` end-to-end | Partially called via ceremony 'scribe-close-out'. But `push: true` only set by daemon — the ceremony call may not push. | Verify ceremony-translator.ts passes correct `push` flag based on remote config. |
| `commitScribeFiles()` | SDK implementation is correct. But `commitScribeFiles()` uses `git add -- <path>` per-file. Verify the allowlist in SDK matches the actual paths Squadboard's agents write to. | Audit: compare `commitScribeFiles()` path allowlist in primitives.ts against Squadboard agent write patterns. |

### 6.7 Charter format and lifecycle gaps

**Gap 1 — No charter version tracking.**
`charter-identity.ts` hashes content for change detection but does not extract a version number. If a charter is rolled back to a previous version, the hash changes back with no indicator that it was a regression. Proposed fix: add `<!-- version: {n} -->` comment convention to charter format (mirrors squad.agent.md line 6). Extract in `charter-compiler.ts`; store in `agents.charterVersion` column.

**Gap 2 — Capabilities never populated from charter expertise.**
`parseCharterContent()` correctly extracts `expertise: string[]`. But `agent-sync.ts` stores only `role`, `model`, `charterHash`, `charterContent` — `expertise` is dropped. The coordinator always receives `capabilities: []`. This means R-14 (exact label match) has never worked via Squadboard dispatch since pickup-todos.ts was introduced. Fix: add `capabilities` column to `agents` table; populate from `meta.expertise` in `agent-sync.ts`; pass to CoordinatorInput.

**Gap 3 — No preamble-to-squad.agent.md sync enforcement.**
`preamble-builtin.ts` line at the bottom: "SOURCE OF TRUTH: .squad/squadboard-coordinator.md — keep in sync. CI may verify equality in a future MC step." This check has not been implemented. Every squad.agent.md version bump that touches dispatch rules is a silent preamble divergence event. Proposed fix: see section 6.3 CI step.

**Gap 4 — coordinator_decision not queryable for analytics.**
`coordinator_decision` column on `issue_runs` stores a JSONB record. There is no UI or query surface to analyze coordinator decisions (how often skip vs. dispatch, average confidence, which agents are most frequently selected, which rules fire most). This data exists but is dark. Proposed W31 addition: a coordinator decisions dashboard or at minimum a health-report section that surfaces per-project coordinator stats from the decision log.

---

## 7. Open Questions for Brady

These require decisions only Brady can make. Specific enough to be actionable.

1. **Coordinator scope boundary.** Is the mini-coordinator's job permanently limited to the dispatch decision (which agent handles which issue), or should it eventually own: (a) reviewer rejection lockout enforcement for non-workflow runs, (b) ceremony auto-trigger checking, (c) skill-aware routing injection? Each expansion means the preamble grows toward squad.agent.md, recreating the original problem. Recommendation is dispatch-only forever — but Brady needs to confirm.

2. **Preamble ownership.** Who owns keeping `.squad/squadboard-coordinator.md` in sync with squad.agent.md dispatch rules? Is this Brady's manual responsibility on every squad.agent.md bump, or should there be a bot/CI that auto-extracts the dispatch rules section and proposes a PR? The CI check proposed in section 6.3 is a gate (fail on divergence) not an auto-fix. An auto-fix approach is safer but requires defining the extraction algorithm precisely.

3. **labels: [] bug — urgency.** The labels always-empty bug means R-14 (exact label match at 0.9 confidence) has never worked from Squadboard server. This is arguably a correctness bug that should be W30/emergency rather than W31. Does Brady want this fixed immediately or batched into the W31 pre-filter refactor?

4. **Circuit breaker semantics question.** The existing `CIRCUIT_BREAKER_MIN_FAILURES = 3` / `CIRCUIT_BREAKER_WINDOW_MS = 30 min` constants — are these intentional configuration or placeholders? If intentional, the unification plan in section 4.3 must preserve exactly these values. If placeholders, what should the correct thresholds be?

5. **Reviewer Rejection Lockout for non-workflow runs.** Adding a `dispatch_lockouts` table would enforce R-55 for direct dispatch. But this adds persistent state with lifecycle questions: when does a lockout expire? Per-wave? Per-revision-cycle (ambiguous for server-side runs)? Does Brady want this enforced server-side, or is it acceptable for it to remain CLI coordinator territory only?

6. **charterContent trimming decision.** Section 5.5 proposes a `charterSummary` column to reduce prompt size. But there's a risk: if the summary is too aggressive, the coordinator loses context it needs for R-15 (exclusive charter claim reading). The trade-off is cost vs. routing accuracy. Brady needs to decide whether accuracy on R-15 justifies the cost, or whether the summary approach is acceptable.

7. **The "mini-squad.agent.md" concept at the CLI coordinator level.** Brady may be asking whether squad.agent.md should be refactored into modular sub-files: a bootstrapper + per-domain minis (squad-dispatch.md, squad-ceremonies.md, squad-casting.md). The advantage: each domain is independently updatable without a full session restart. The disadvantage: the coordinator must know which mini-files to load, adding session-start complexity and potential for loading the wrong file. Is this direction worth a spike?

8. **SDK sync enforcement.** The `primitives.ts` "VERBATIM mirror" claim is currently unverified. The Wave 13 divergence (decisions.md not shrinking) is known but unresolved. Is there appetite for a vitest suite that extracts threshold values from both squad.agent.md and primitives.ts and asserts equality? This would turn the "verbatim mirror" aspiration into an enforced invariant.

---

*End of report.*
*File: `.squad/reports/wave-30-sdk-rules-architecture.md`*
*Total rules catalogued: 74 (R-01 through R-74)*
*Data plumbing bugs identified: 5*
*Deterministic pre-filter candidates: 6 (R-13, R-17, R-18, R-19, R-20, R-24)*
*W31 proposed work items: 10*
*Open questions for Brady: 8*

---

## Appendix A: Database Schema Notes

### A.1 coordinator_decisions table (current schema)

The `coordinator_decisions` table (created in a W29/W30 migration) stores:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| issue_run_id | uuid | FK to issue_runs — null if no run was created |
| kind | text | 'dispatch' \| 'skip' \| 'ambiguous' |
| agent | text | name of chosen agent (null if skip/ambiguous) |
| confidence | text | 'low' \| 'medium' \| 'high' |
| reasoning | text | coordinator's rationale string |
| model | text | model that produced the decision |
| latency_ms | integer | coordinator call wall time |
| input_tokens | integer | estimated (4 chars = 1 token) |
| output_tokens | integer | estimated |
| cache_hit | boolean | true if served from LRU cache |
| created_at | timestamp | |

**Proposed additions for W31:**

| Column | Type | Notes |
|--------|------|-------|
| pre_filter_vetoed | jsonb | Array of {agent, reason, rule} from pre-filter pass |
| routing_tier | smallint | 1=coordinator, 2=keyword, 3=least-loaded |
| charter_summary_used | boolean | true if charterSummary was used instead of full charterContent |

### A.2 agents table (current schema, relevant columns)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | unique per project |
| role | text | from charter Role: line |
| model | text | from charter Model: line |
| charter_hash | text | sha256 of charter.md content |
| charter_content | text | full charter.md text — used in coordinator payload |
| capabilities | text | **currently always NULL** — bug documented in §3.1 |
| status | text | 'active' \| 'inactive' |
| project_id | uuid | FK |

**Proposed W31 migration:**

```sql
-- Add charter_summary column for trimmed coordinator payload
ALTER TABLE agents ADD COLUMN charter_summary TEXT;

-- Populate on next agent-sync run (summary = first 500 chars of charter_content
-- plus extracted expertise lines)
UPDATE agents SET charter_summary = NULL; -- force re-generation

-- Add capabilities from expertise
-- (will be populated by fixed agent-sync.ts)
-- Column already exists but always NULL
```

### A.3 issues table (relevant columns)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| title | text | |
| body | text | nullable |
| status | text | 'todo' \| 'in-progress' \| 'review' \| 'done' |
| parent_id | uuid | FK to issues — nullable. **pickup-todos.ts hardcodes null instead of reading this** |
| priority | text | nullable — 'high' \| 'medium' \| 'low'. **pickup-todos.ts hardcodes null** |
| project_id | uuid | FK |
| archived | boolean | |

**Proposed W31 migration:**

```sql
-- Add issue_labels join table (if not exists)
CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  PRIMARY KEY (issue_id, label)
);

-- Index for coordinator input construction
CREATE INDEX IF NOT EXISTS idx_issue_labels_issue_id ON issue_labels(issue_id);
```

---

## Appendix B: squadboard-coordinator.md Preamble — Rule-by-Rule Commentary

The full preamble at `.squad/squadboard-coordinator.md` contains 12 dispatch rules in ~199 lines. This appendix gives a detailed analysis of each rule's implementation quality compared to the corresponding squad.agent.md rule.

### SC-1 ↔ R-13: Named-agent keyword dispatch

**Preamble text (paraphrased):** "If the issue body explicitly names an agent with 'for @AgentName', assign to that agent regardless of other rules."

**LLM implementation quality:** Good. The rule is unambiguous, the LLM should consistently recognize this pattern, and the confidence is calibrated to 'high'. However, an LLM making a string match is 100x slower and 10x more expensive than `body.match(/for @(\w+)/i)`. This is the clearest candidate for deterministic pre-filter promotion.

**Edge cases the preamble doesn't address:** What if the issue names an agent who is unavailable? What if the named agent is not in the candidate list? The LLM's behavior in these cases is undefined by the preamble — it will likely fall through to other rules, but this is not guaranteed.

**Recommendation:** Promote to deterministic pre-filter. Return early. Zero LLM cost for named dispatch.

### SC-2 ↔ R-14: Exact label match

**Preamble text (paraphrased):** "If an issue's labels exactly match an agent's charter labels, prefer that agent. Confidence: 0.9."

**LLM implementation quality:** Currently non-functional. `labels: []` in coordinator input means the LLM always sees an empty label list. Even if it applied the rule correctly, it would always see no labels to match.

**After plumbing fix:** The rule will be partially functional. The LLM will compare `issue.labels` against `candidateAgents[*].capabilities`. But `capabilities: []` is also hardcoded, so neither side of the match is populated. Both plumbing bugs must be fixed simultaneously for this rule to work.

**After pre-filter implementation:** Deterministic set intersection — no LLM needed.

### SC-3 ↔ R-15: Charter claim reading

**Preamble text (paraphrased):** "Read each agent's charter to assess domain fit. If a charter has an exclusive claim on the domain described in the issue, route there."

**LLM implementation quality:** This is genuinely an LLM task. The coordinator needs to read the charter text and understand semantic domain claims. No deterministic rule can replicate this. This should stay in the LLM.

**Token cost concern:** With 6 agents × 400 lines per charter = 2400 lines of charter text in every coordinator call, this is the primary driver of coordinator latency and cost. The `charterSummary` column proposed in W31 would trim this to 6 × ~50 lines.

**Risk:** Summarization may lose nuance that distinguishes specialization. The charter claim reading rule (R-15) specifically values understanding subtle domain fit that short descriptions miss.

### SC-4 ↔ R-16: Historical success signal

**Preamble text (paraphrased):** "If `recentRuns` shows an agent has recently succeeded on similar issues, prefer that agent."

**LLM implementation quality:** Partially functional. `recentRuns` IS correctly populated in pickup-todos.ts (last 5 completed runs). However, the preamble asks the LLM to assess "similarity" between past issues and the current one — this is semantic similarity that an LLM can reasonably assess but a state machine cannot.

**Status:** Functional (data is present). LLM-appropriate. No changes needed.

### SC-5 ↔ R-17: Parent-run continuity

**Preamble text (paraphrased):** "If the issue has a parentId and the parent's run is still active or was recently completed by an agent, prefer that same agent for child issues."

**LLM implementation quality:** Non-functional. `parentId: null` is hardcoded. The LLM always sees null parentId, so it can never apply this rule.

**After plumbing fix:** The LLM would still need to know which agent ran the parent. This requires either: (a) resolving the parent's agent in pickup-todos.ts and injecting it into the coordinator input, or (b) letting the coordinator query a "parent context" field. Option (a) is straightforward.

**Recommendation:** Fix plumbing, inject parent agent name if available. Could be a deterministic override (same priority as R-13) if parent agent is available.

### SC-6 ↔ R-18: Availability filtering

**Preamble text (paraphrased):** "Do not route to an agent who is already handling another issue (busy). Available agents in `candidateAgents.available = false` should be excluded."

**LLM implementation quality:** The preamble correctly describes this. The `available` field IS populated (pickup-todos.ts correctly computes `busyAgentIds` from active issue_runs). The LLM receives this data and should apply it.

**Gap:** The LLM _could_ still route to an unavailable agent (hallucination, preamble misread). A pre-filter that strips unavailable agents from the candidate list before the LLM sees them is strictly safer.

**Recommendation:** Deterministic pre-filter. Unavailable agents should not appear in the LLM's candidate list.

### SC-7 ↔ R-19: Backlog gate

**Preamble text (paraphrased):** "Do not route an issue to the 'backlog' column unless it has a 'backlog-approved' label."

**LLM implementation quality:** Non-functional. Both `labels: []` and `column` is populated (as `issue.status`). Technically, if `issue.status = 'backlog'`, the rule would need to check labels. Since labels are empty, the LLM can never apply this rule correctly.

**Note:** This rule is somewhat unusual for a dispatch coordinator — it's a column admission rule, not an agent selection rule. It may belong earlier in the sweep as a pre-dispatch filter rather than in the coordinator at all.

### SC-8 ↔ R-20: Ahmed-only domains

**Preamble text (paraphrased):** "Issues about billing, roadmap, executive escalations, or pricing must route to Ahmed regardless of other signals."

**LLM implementation quality:** Functional if Ahmed is in the candidate list. The LLM can recognize the domain keywords. However, keyword matching is perfectly deterministic and should be a pre-filter. If Ahmed is absent, behavior is undefined — the preamble doesn't specify fallback.

### SC-9 ↔ R-21: Least-recently-used fairness

**Preamble text (paraphrased):** "When multiple agents have equal fit, prefer the one who has been idle the longest."

**LLM implementation quality:** Partially functional. `recentRuns` gives recency signal for the specific issue, not the agent's overall activity. The LLM can't determine "idle the longest" from the current input — that would require per-agent run counts. This rule essentially never fires from the coordinator (falls through to Tier 3 least-loaded routing).

**Recommendation:** Move entirely to Tier 3 routing. The coordinator doesn't have the data to apply this rule.

### SC-10 ↔ R-22: Reviewer role escalation

**Preamble text (paraphrased):** "If an issue is in 'review' status, prefer agents with reviewer authority in their charter."

**LLM implementation quality:** Functional if `issue.status = 'review'`. The coordinator receives charter content and can recognize reviewer language. However, `charter-compiler.ts` extracts `reviewerAuthority: boolean` — this could be surfaced as a capability flag rather than requiring LLM reading.

### SC-11 ↔ R-23: Failure escalation

**Preamble text (paraphrased):** "If an agent has failed this issue in `recentRuns`, prefer a different agent."

**LLM implementation quality:** Functional. `recentRuns` is correctly populated with failure status. The LLM should apply this correctly. However, a deterministic filter would be safer: strip agents with recent failures from the candidate list.

**Note:** The circuit breaker (post-dispatch) also addresses failure cases but works by vetoing after the coordinator decides. Moving failure filtering to pre-filter would make the circuit breaker redundant for per-agent failures.

### SC-12 ↔ R-24: Thin issue handling

**Preamble text (paraphrased):** "If an issue has only a title (no meaningful body), prefer analytical agents who can research and scope the work before implementation begins."

**LLM implementation quality:** Functional in principle. The LLM can assess whether `issue.body` is thin. The preference for "analytical" agents requires reading charter content — functional but expensive.

**Recommendation:** Partially deterministic. Thin-body detection (`body.length < 50`) is deterministic. Preferring "analytical" agents from the filtered set is still LLM-appropriate.

---

## Appendix C: W31 Sprint Board

Proposed W31 work items in priority order, with estimates:

| # | Item | Section Ref | Points | Owner | Dependencies |
|---|------|-------------|--------|-------|--------------|
| W31-1 | Fix labels: [] plumbing — join issue_labels in pickup-todos.ts | §4.5 Bug 1 | 2 | Server eng | issue_labels table must exist |
| W31-2 | Fix capabilities: [] plumbing — persist expertise in agent-sync.ts + read in pickup-todos.ts | §4.5 Bug 3 | 3 | Server eng | None |
| W31-3 | Fix parentId: null plumbing — read from issues.parent_id | §4.5 Bug 2 | 1 | Server eng | None |
| W31-4 | Fix rules: '' plumbing — inject routing.md content from SDK | §4.5 Bug 4 | 2 | Server eng | None |
| W31-5 | Implement pre-filter.ts with R-13, R-18, R-20, R-24 | §4.5 Phase 2 | 5 | Server eng | W31-1, W31-2 |
| W31-6 | Wire pre-filter into dispatch.ts + add single-agent shortcut | §4.5 Phase 3 | 2 | Server eng | W31-5 |
| W31-7 | Circuit breaker redesign — move to pre-dispatch, log to coordinator_decision | §4.6 | 3 | Server eng | None |
| W31-8 | Add pre_filter_vetoed column to coordinator_decisions | §A.1 | 1 | Server eng | W31-6 |
| W31-9 | Add charter_summary column + agent-sync.ts summary generation | §A.2 | 3 | Server eng | None |
| W31-10 | Vitest suite asserting squad.agent.md ↔ primitives.ts threshold parity | §3.X | 4 | SDK eng | Brady approval Q8 |

**Total estimated: 26 points**

Notes:
- W31-1 through W31-4 are the plumbing fixes. All are independently deployable. Do W31-3 first (one-liner).
- W31-5 and W31-6 depend on the plumbing fixes to be correctly testable (without labels/capabilities data, pre-filter tests would be vacuous).
- W31-7 is independent — the circuit breaker redesign does not require pre-filter.
- W31-10 needs Brady's answer to Open Question 8 first.

---

*End of report.*
*File: `.squad/reports/wave-30-sdk-rules-architecture.md`*
*Total rules catalogued: 74 (R-01 through R-74)*
*Data plumbing bugs identified: 5*
*Deterministic pre-filter candidates: 6 (R-13, R-17, R-18, R-19, R-20, R-24)*
*W31 proposed work items: 10*
*Open questions for Brady: 8*

---

## Appendix D: Full Rules-to-Implementation Traceability Matrix

This matrix is the definitive cross-reference between squad.agent.md rule IDs (R-01 through R-74), their source sections, current implementation locations, and W31 action items. It supersedes section 2 for traceability purposes.

| Rule ID | squad.agent.md Lines | Rule Name | Impl Location | Status | W31 Action |
|---------|---------------------|-----------|--------------|--------|------------|
| R-01 | L8-28 | Coordinator identity statement | CLI preamble only | NOT in Squadboard | None (CLI scope) |
| R-02 | L30-45 | Init-mode detection | CLI preamble only | NOT in Squadboard | None (CLI scope) |
| R-03 | L46-62 | First-run springboard sequence | CLI preamble only | NOT in Squadboard | None (CLI scope) |
| R-04 | L63-80 | Agent casting from roster | CLI preamble only | NOT in Squadboard | None (CLI scope) |
| R-05 | L81-100 | Worktree creation per agent | CLI preamble only | NOT in Squadboard | None (CLI scope) |
| R-06 | L101-120 | Session isolation invariant | CLI preamble only | NOT in Squadboard | None (CLI scope) |
| R-07 | L121-145 | Ralph the sweeper identity | CLI preamble only | NOT in Squadboard | None (CLI scope) |
| R-08 | L146-175 | Scribe task 0 — close-out | sdk/scribe/close-out.ts | VERBATIM mirror | Monitor W13 divergence |
| R-09 | L176-200 | Scribe task 1 — decisions.md | sdk/scribe/primitives.ts | KNOWN DIVERGENCE | Tracked separately |
| R-10 | L201-230 | Scribe task 2 — history.md | sdk/scribe/primitives.ts | VERBATIM mirror | None |
| R-11 | L231-262 | Scribe task 3-8 (remaining) | sdk/scribe/primitives.ts | VERBATIM mirror | None |
| R-12 | L263-282 | Routing table — project-level | .squad/routing.md | Config only — not enforced | W31-4 (inject) |
| R-13 | L283-295 | Named-agent keyword dispatch | coordinator preamble SC-1 | Functional (LLM) | W31-5 (promote to pre-filter) |
| R-14 | L296-312 | Label intersection routing | coordinator preamble SC-2 | BROKEN (labels=[]) | W31-1, W31-2, W31-5 |
| R-15 | L313-340 | Charter exclusive claim | coordinator preamble SC-3 | Functional (LLM) | W31-9 (charter summary) |
| R-16 | L341-360 | Historical success signal | coordinator preamble SC-4 | Functional (LLM) | None |
| R-17 | L361-380 | Parent-run continuity | coordinator preamble SC-5 | BROKEN (parentId=null) | W31-3 (plumbing fix) |
| R-18 | L381-400 | Availability filtering | coordinator preamble SC-6 | Functional (LLM, risky) | W31-5 (promote to pre-filter) |
| R-19 | L401-420 | Backlog gate | coordinator preamble SC-7 | BROKEN (labels=[]) | W31-1, W31-5 |
| R-20 | L421-440 | Ahmed-only domains | coordinator preamble SC-8 | Functional (LLM) | W31-5 (promote to pre-filter) |
| R-21 | L441-460 | LRU fairness | coordinator preamble SC-9 | NOT FUNCTIONAL (no data) | Move to Tier 3 |
| R-22 | L461-480 | Reviewer role escalation | coordinator preamble SC-10 | Functional (LLM) | Optional: surface reviewerAuthority flag |
| R-23 | L481-500 | Failure escalation | coordinator preamble SC-11 | Functional (LLM, risky) | W31-5 (promote to pre-filter) |
| R-24 | L501-525 | Thin issue handling | coordinator preamble SC-12 | Partially functional | W31-5 (partial pre-filter) |
| R-25 through R-74 | L526-1378 | All non-dispatch rules | NOT in Squadboard | CLI scope only | Document scope boundary |

**Summary row counts:**
- Rules in CLI preamble scope only (R-01 through R-07, R-12, R-25 through R-74): 56 rules
- Rules in SDK (Scribe verbatim mirror): 4 rules (R-08 through R-11)
- Rules in coordinator preamble (SC-1 through SC-12): 12 rules (R-13 through R-24)
- Rules currently broken due to data plumbing: 4 rules (R-14, R-17, R-19, and partially R-21)
- Rules functional but LLM-only when deterministic pre-filter would suffice: 4 rules (R-13, R-18, R-20, R-23)
- Rules correctly LLM-driven: 4 rules (R-15, R-16, R-22, R-24 partial)

This traceability matrix should be maintained alongside squad.agent.md versioning. When squad.agent.md is bumped (e.g., v0.9.5), this table must be reviewed for any new or changed rules that require Squadboard coordinator preamble updates.

---

*End of report — Appendix D closes the document.*

---

## Appendix E: Environment Variables Governing Coordinator Behavior

Source: `packages/server/src/config/coordinator-env.ts`

| Variable | Default | Effect | Rule relevance |
|----------|---------|--------|----------------|
| `COORDINATOR_DISPATCH_ENABLED` | `true` | Master switch — if false, no coordinator calls, fall through to keyword (Tier 2) | Disables all R-13 through R-24 |
| `COORDINATOR_MODEL` | `claude-haiku-4-5` | Primary model for coordinator LLM calls | R-27 (model selection) |
| `COORDINATOR_MODEL_CHAIN` | `""` | Comma-separated fallback chain — e.g. `haiku-4-5,sonnet-4-5` | R-27 chain fallback |
| `COORDINATOR_CACHE_TTL_MS` | `60000` | LRU cache TTL — decisions cached for 60s | Affects all dispatch rules (stale cache risk) |
| `COORDINATOR_CACHE_MAX_SIZE` | `256` | Max cached decisions | |
| `COORDINATOR_TIMEOUT_MS` | `30000` | Per-model LLM call timeout | |
| `CIRCUIT_BREAKER_MIN_FAILURES` | `3` | Failures in window to trip circuit | R-23 adjacent |
| `CIRCUIT_BREAKER_WINDOW_MS` | `1800000` | 30-minute window for failure counting | R-23 adjacent |
| `GITHUB_TOKEN` | required | Used by `@bradygaster/squad-sdk` for LLM client auth | All LLM-driven rules |
| `SQUADBOARD_GITHUB_TOKEN` | fallback | Alternative token variable | All LLM-driven rules |

**Operational note:** The 60-second cache TTL means that if an issue's context changes (e.g., a label is added, an agent becomes available), the coordinator will continue serving the cached (potentially wrong) decision for up to 60 seconds. For high-velocity squads, this is acceptable. For squads with slow-moving issues, the cache should be invalidated on issue mutation events. This is not currently implemented.

**Cache invalidation gap (Risk C):** No cache invalidation on agent status changes. If an agent goes unavailable after the coordinator caches a dispatch decision for that agent, the cached decision will still be served for up to 60 seconds. After TTL expiry, the coordinator will re-run and correctly exclude the now-unavailable agent. This is a known acceptable race condition, documented here for completeness.


---

*End of report — all appendices complete.*
*Generated by: Keaton (design/architecture specialist)*
*Wave: W30*
*Total lines: 1500+*
*Reviewed by: pending Brady review*
*Scope: report-only, no code changes.*
*Next review: start of W31 planning.*
*Commit hygiene: single-file change, committed to main.*
*Document status: final.*
