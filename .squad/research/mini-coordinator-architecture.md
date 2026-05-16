# Mini-Coordinator Architecture — squad.agent.md v0.9.4 Analysis

> **Author:** Keaton (Lead Architect)
> **Date:** 2026-05-16
> **Wave:** W28 design → feeds W29 implementation
> **Status:** Draft for Brady review
> **Source directive:** `copilot-directive-2026-05-16T0410` + `copilot-directive-2026-05-16T0420`

---

## Section 1 — Executive Summary

The mini-coordinator migration replaces squadboard's brittle charter-parsing + hardcoded keyword-scoring dispatch with a **server-resident LLM coordinator agent** (`squadboard-coordinator.md`). Instead of extracting structured fields from charter markdown via regex (which has failed across three parser-hardening waves), dispatch decisions are delegated to a single LLM call that reads raw charter prose directly — the same way the upstream Squad CLI coordinator already works.

**Recommended invocation surface:** One-shot LLM call per dispatch decision (not a long-running daemon). Each call receives: task description, project state snapshot, raw charter contents, and routing hints. It returns a structured JSON decision: chosen agent, model tier, confidence, and steering notes. This keeps costs bounded, failure-blast-radius small, and enables easy retry/fallback.

**Top 3 Risks:**
1. **Latency on pickup-todos sweep.** The 10s sweep interval means a coordinator LLM call (~2-5s on Haiku) eats 20-50% of the sweep budget. Mitigated by batching multiple pending issues per call and caching recent decisions.
2. **Non-deterministic routing regressions.** LLM decisions may vary across identical inputs. Mitigated by structured output schema validation + Tier-1 deterministic rules still taking priority + logging every decision for audit.
3. **Cost creep at scale.** At ~15 dispatches/hour active dogfood rate, Haiku calls add ~$0.15-0.40/day. Acceptable now, but a 10x usage increase needs memoization or batching.

**Top 3 Wins:**
1. **Exit the parser-hardening rathole.** Charter model/role/expertise/style extraction moves to LLM lookup. The parser shrinks to name-from-H1 + file-existence checks (~50 lines instead of ~300).
2. **SDK convergence.** The coordinator-agent pattern aligns with the SDK's `SquadCoordinator` class, enabling future direct SDK integration for dispatch instead of maintaining parallel routing code.
3. **J5 consult unification.** The context-assembly + coordinator-prompt machinery is reusable for consult-mode context injection (J5 stream), eliminating a second context-assembly path.

**Cost/Latency Tradeoff:**
- **Extra cost:** ~$0.15-0.40/day at current dogfood usage (15 dispatches/hr × 8 active hrs × ~$0.002-0.003/call on Haiku). Negligible vs. existing agent run costs (~$2-5/day).
- **Extra latency:** 2-5s per dispatch on Haiku, 8-15s on Sonnet. Acceptable for user-initiated runs; tight for 10s pickup-todos sweep (batch multiple issues per call to stay within budget).

---

## Section 2 — Behavior Inventory

Every coordinator behavior in `squad.agent.md` v0.9.4 (1378 lines), mapped to: current squadboard owner, classification (LLM / state-machine / hybrid), SDK coverage, and migration target.

### Init Mode

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Identify user via `git config user.name` | Init Phase 1 (L10-50) | Not implemented (CLI-only) | State-machine | `resolution.resolveSquad` | N/A — CLI-only ceremony | Squadboard uses project creation flow instead |
| 2 | Ask what user is building | Init Phase 1 (L51-60) | Project creation form (UI) | LLM-driven | No | Stay custom | Interactive UI replaces ask_user gate |
| 3 | Cast a team (propose members) | Init Phase 1 (L61-75) | `curated-roles.ts` + UI | Hybrid | `casting` module | Coordinator proposes, UI confirms | SDK casting module provides universe + allocation |
| 4 | `ask_user` with choices — stop and wait | Init Phase 1 (L76-82) | UI confirmation step | State-machine | No | Stay custom | Squadboard uses HTTP request/response, not ask_user |
| 5 | Create `.squad/` structure on confirmation | Init Phase 2 (L83-88) | `agent-sync.ts` + project setup | State-machine | `resolution.ensureSquadPath` | State-machine | Deterministic file/dir creation |
| 6 | Initialize casting state files | Init Phase 2 (L88-90) | Not implemented | State-machine | `casting` module | State-machine + SDK | `registry.json`, `history.json` creation |
| 7 | Seed agent history files | Init Phase 2 (L90-91) | `agent-sync.ts` creates DB rows | State-machine | `agents/history-shadow` | State-machine | File creation is deterministic |
| 8 | `team.md` generation with `## Members` | Init Phase 2 (L91-93) | Not implemented (manual) | State-machine | `state` module (team collection) | State-machine | Deterministic template |
| 9 | `.gitattributes` union merge entries | Init Phase 2 (L93-94) | Not implemented | State-machine | No | State-machine | Append-only pattern enforcement |
| 10 | Never read/store `git config user.email` | Init Phase 1 (L46) | N/A (no email usage) | State-machine | N/A | Invariant — enforce in code | Privacy constraint |

### Casting & Persistent Naming

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 11 | Universe selection algorithm (size_fit + shape_fit + resonance_fit + LRU) | Casting (L1029-1045) | `curated-roles.ts` wraps SDK roles | Hybrid | `casting` module | Coordinator proposes, SDK validates | Scoring is deterministic but input interpretation is LLM |
| 12 | Unique character name allocation | Casting (L1045-1055) | Not implemented (names from charter H1) | State-machine | `casting` module | SDK casting | Registry lookup is deterministic |
| 13 | Name stored in `registry.json` | Casting (L1055-1060) | DB `agents.name` column | State-machine | `casting` module | State-machine + SDK | Currently DB-backed, could mirror to file |
| 14 | Name snapshot in `history.json` | Casting (L1060-1062) | Not implemented | State-machine | `agents/history-shadow` | State-machine | Append-only file pattern |
| 15 | Overflow handling (no universe switch) | Casting (L1065-1070) | Not implemented | Hybrid | `casting` module | Coordinator decides overflow strategy | Diegetic expansion needs LLM judgment |
| 16 | Names used everywhere (prompts, logs, files) | Casting (L1070-1073) | Partially (DB name used in UI) | State-machine | N/A | State-machine | Consistency enforcement |
| 17 | Scribe/Ralph/@copilot exempt from casting | Casting (L1073-1075) | Hardcoded in `agent-sync.ts` | State-machine | `casting` module | State-machine | Exemption list is static |
| 18 | No reuse unless retired | Casting (L1076-1078) | Not enforced | State-machine | `casting` module | State-machine | Registry constraint |
| 19 | Legacy migration (existing agents → `legacy_named: true`) | Casting (L1079) | Not implemented | State-machine | `casting` module | State-machine | One-time migration |

### Personal Squad (Ghost Protocol)

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 20 | Discover personal agents from personal dir | Personal Squad (L123-128) | Not implemented | State-machine | `agents/personal` (`resolvePersonalAgents`) | State-machine + SDK | SDK has full discovery logic |
| 21 | Merge personal agents additively | Personal Squad (L128-130) | Not implemented | State-machine | `agents/personal` (`mergeSessionCast`) | State-machine + SDK | Deterministic merge |
| 22 | Project agent wins on name conflict | Personal Squad (L130-132) | Not implemented | State-machine | `agents/personal` | State-machine | Deterministic priority |
| 23 | Ghost Protocol: read-only, consult-only | Personal Squad (L132-137) | Not implemented | State-machine | `agents/personal` | State-machine | Enforcement constraint |
| 24 | Origin tagging (`origin: 'personal'`) | Personal Squad (L135) | Not implemented | State-machine | `agents/personal` | State-machine | Metadata tagging |

### Issue Awareness

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 25 | `gh issue list` scan on session start | Issue Awareness (L139-145) | `github-sync-overdue.ts` sweep | State-machine | No | State-machine | CLI/API call is deterministic |
| 26 | `squad:{member}` label routing | Issue Awareness (L145-150) | `router.ts` Tier-1 rules | State-machine | `parsers.matchIssueLabels` | State-machine + SDK parser | Label matching is deterministic |
| 27 | Lead triages new squad-labeled issues | Issue Awareness (L150-155) | `pickup-todos.ts` sweep | Hybrid | `ralph/triage` | Coordinator decides, state-machine enqueues | Triage routing needs judgment |
| 28 | Mention assigned issues in status | Issue Awareness (L155-159) | UI board view | State-machine | No | Stay custom (UI) | Display concern |

### Directive Capture

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 29 | Detect directive intent before routing | Directive Capture (L221-230) | `coordinator-fragment.md` (CLI) + MCP `capture` | LLM-driven | No | Coordinator LLM | Intent detection requires judgment |
| 30 | Capture to `.squad/decisions/inbox/` | Directive Capture (L230-245) | MCP `capture` tool | State-machine | No | State-machine | File write is deterministic |
| 31 | Acknowledge briefly, route embedded work | Directive Capture (L245-250) | MCP `capture` tool | Hybrid | No | Coordinator proposes, state-machine routes | Separation of acknowledgment + routing |
| 32 | Dogfood: call squadboard MCP `capture` | Directive Capture (L250-255) | MCP integration | State-machine | No | State-machine | API call is deterministic |
| 33 | Close-out symmetry (`done:` capture) | Directive Capture (L255-261) | MCP `capture` with `done:` prefix | State-machine | No | State-machine | Deterministic close-out |

### Routing

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 34 | Named-person signal → direct dispatch | Routing (L263-268) | `router.ts` Tier-1 | State-machine | `coordinator.Coordinator` | State-machine (Tier-1 stays) | Exact name match |
| 35 | Personal agent signal | Routing (L268-270) | Not implemented | Hybrid | `agents/personal` | Coordinator decides | Needs personal agent discovery first |
| 36 | Multi-domain signal → fan-out | Routing (L270-272) | `fan-out-adapter.ts` | LLM-driven | `coordinator/fan-out` (`spawnParallel`) | Coordinator decomposes, SDK fan-out executes | Decomposition is LLM judgment |
| 37 | Human member signal | Routing (L272-274) | Not implemented | State-machine | No | State-machine | Route to human = enqueue + wait |
| 38 | @copilot signal | Routing (L274-276) | `router.ts` (agentKind='copilot') | State-machine | No | State-machine | Exact match on @copilot |
| 39 | Ceremony signal | Routing (L276-278) | `ceremonies-due.ts` sweep | State-machine | No | State-machine | Schedule-driven |
| 40 | Issues/backlog signal | Routing (L278-280) | `pickup-todos.ts` sweep | Hybrid | `ralph/triage` | Coordinator triages, state-machine dispatches | |
| 41 | PRD signal | Routing (L280-282) | Not implemented | LLM-driven | No | Coordinator | PRD decomposition needs judgment |
| 42 | Ralph signal | Routing (L282-284) | `pickup-todos.ts` | State-machine | `ralph` module | State-machine + SDK Ralph | Ralph loop is deterministic |
| 43 | General work → Lead | Routing (L284-286) | `router.ts` Tier-2/3 | Hybrid | `coordinator.Coordinator` | Coordinator LLM replaces Tier-2 scoring | Core migration target |
| 44 | Factual question → Direct response | Routing (L286-288) | Not implemented | LLM-driven | `coordinator/direct-response` | Coordinator LLM | Pattern detection |
| 45 | Ambiguous signal | Routing (L288-290) | `router.ts` Tier-3 (LLM specifier) | LLM-driven | `coordinator.Coordinator` | Coordinator LLM | Already LLM-driven in Tier-3 |
| 46 | Multi-agent task → decompose + fan-out | Routing (L290-293) | `fan-out-adapter.ts` | LLM-driven | `coordinator/fan-out` | Coordinator decomposes, SDK executes | |
| 47 | Skill-aware routing (`.copilot/skills/`, `.squad/skills/`) | Routing (L293-295) | Not implemented | Hybrid | `skills` module | Coordinator checks skill index | Skill loading is SM, selection is LLM |
| 48 | Consult mode for personal agents | Routing (L295-297) | `consult-stream.ts` (partial) | Hybrid | `agents/personal` | Coordinator routes, consult layer executes | |

### Skill Confidence Lifecycle

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 49 | Skills have low/medium/high confidence | Skill Confidence (L298-303) | Not implemented | State-machine | `skills` module | State-machine | Enum is deterministic |
| 50 | Confidence only increases, never decreases | Skill Confidence (L303-305) | Not implemented | State-machine | `skills` module | State-machine | Monotonic constraint |
| 51 | Bump on independent validation | Skill Confidence (L305-308) | Not implemented | Hybrid | No | Coordinator judges validation | "Independent validation" needs judgment |

### Response Mode Selection

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 52 | Direct mode (factual/status) | Response Mode (L310-325) | Not implemented (all runs are Full) | LLM-driven | `coordinator/direct-response` | Coordinator LLM | Pattern matching for direct answers |
| 53 | Lightweight mode (small edits, read-only) | Response Mode (L325-340) | Not implemented | LLM-driven | `coordinator/response-tiers` | Coordinator LLM selects tier | |
| 54 | Standard mode (single-agent work) | Response Mode (L340-355) | Default for all runs | Hybrid | `coordinator/response-tiers` | Coordinator LLM selects, SM dispatches | |
| 55 | Full mode (multi-agent, complex) | Response Mode (L355-370) | `fan-out-adapter.ts` | Hybrid | `coordinator/response-tiers` + `fan-out` | Coordinator selects, SDK fan-out | |
| 56 | Upgrade bias when uncertain | Response Mode (L370-375) | Not implemented (always Full) | LLM-driven | `coordinator/response-tiers` | Coordinator LLM | |
| 57 | Never downgrade mid-task | Response Mode (L375-380) | N/A (no tier switching) | State-machine | No | State-machine | Monotonic constraint |

### Per-Agent Model Selection

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 58 | Layer 0: persistent config (`.squad/config.json`) | Model Selection (L382-400) | `model-defaults.ts` (project default) | State-machine | `runtime/config` (`loadConfig`) | State-machine | Config file read is deterministic |
| 59 | Layer 1: session directive | Model Selection (L400-415) | `model-defaults.ts` (session override) | State-machine | `agents/model-selector` | State-machine | Parameter passthrough |
| 60 | Layer 2: charter preference | Model Selection (L415-430) | `charter-compiler.ts` extracts model | State-machine → **Coordinator** | `agents/charter-compiler` + `model-selector` | **Coordinator reads charter prose** | Key migration: stop parsing model from charter |
| 61 | Layer 3: task-aware auto-selection | Model Selection (L430-450) | Not implemented (falls to default) | LLM-driven | `agents/model-selector` (`resolveModel`) | Coordinator LLM | Task complexity → model tier mapping |
| 62 | Layer 4: default fallback | Model Selection (L450-460) | `model-defaults.ts` BUILTIN_FALLBACK | State-machine | `agents/model-selector` | State-machine | Static fallback |
| 63 | Fallback chain (max 3 retries) | Model Selection (L460-470) | `bridge.ts` (partial) | State-machine | `agents/model-selector` (`ModelFallbackExecutor`) | State-machine + SDK | Retry logic is deterministic |
| 64 | Nuclear fallback (omit model param) | Model Selection (L470-475) | Not implemented | State-machine | `agents/model-selector` | State-machine | Last-resort, deterministic |
| 65 | Log fallbacks to orchestration log | Model Selection (L475-478) | `bridge.ts` logs to DB | State-machine | `runtime/telemetry` | State-machine | Deterministic logging |
| 66 | Acknowledge model in spawn output | Model Selection (L478-480) | UI shows model in run details | State-machine | No | State-machine | Display concern |

### Client Compatibility

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 67 | Detect platform (CLI vs VS Code) | Client Compat (L482-495) | N/A (server always CLI-like) | State-machine | `platform` module | N/A | Squadboard is always server context |
| 68 | CLI: use `task` tool | Client Compat (L495-505) | `bridge.ts` → `executeAgentRun` | State-machine | `coordinator/fan-out` | State-machine | |
| 69 | VS Code: use `runSubagent` | Client Compat (L505-515) | N/A | State-machine | `platform` module | N/A | Not applicable to server |
| 70 | SQL tool is CLI-only caveat | Client Compat (L520-525) | N/A | State-machine | No | N/A | Not applicable |

### MCP Integration

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 71 | Detect available MCP prefixes | MCP (L527-535) | `coordinator-fragment.md` (CLI) | State-machine | No | State-machine | Tool enumeration is deterministic |
| 72 | Pass MCP tools block to spawned agents | MCP (L535-545) | `bridge.ts` prompt assembly | State-machine | No | State-machine | Template injection |
| 73 | Route simple MCP ops directly | MCP (L545-550) | MCP capture tool | Hybrid | No | Coordinator decides simplicity | |
| 74 | Explore agents never get MCP | MCP (L550-555) | Not enforced | State-machine | No | State-machine | Invariant |
| 75 | Graceful degradation to CLI equivalents | MCP (L555-560) | Not implemented | Hybrid | No | Coordinator fallback | |

### Eager Execution + Mode Selection

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 76 | Default is background launch | Eager Exec (L562-575) | `bridge.ts` (all runs async) | State-machine | `coordinator/fan-out` | State-machine | Already implemented |
| 77 | Sync only for hard dependencies/gates | Eager Exec (L575-585) | Workflow step dependencies | State-machine | No | State-machine | Dependency graph is deterministic |
| 78 | Include anticipatory downstream work | Eager Exec (L585-590) | Not implemented | LLM-driven | No | Coordinator LLM | Anticipation needs judgment |
| 79 | No eager work in Init Phase 1 | Eager Exec (L590-592) | N/A | State-machine | No | State-machine | Phase gate |
| 80 | Scribe always background | Eager Exec (L592-595) | Not implemented (no Scribe) | State-machine | No | State-machine | Static rule |
| 81 | Uncertain → background | Eager Exec (L595-597) | Default behavior | State-machine | No | State-machine | Default already correct |

### Parallel Fan-Out

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 82 | Decompose broadly, spawn all independent agents in one turn | Fan-Out (L598-610) | `fan-out-adapter.ts` | LLM-driven | `coordinator/fan-out` (`spawnParallel`) | Coordinator decomposes, SDK spawns | Decomposition is LLM judgment |
| 83 | Show launch table immediately | Fan-Out (L610-615) | UI shows run status in real-time | State-machine | No | State-machine | UI concern |
| 84 | Chain follow-ups | Fan-Out (L615-620) | Workflow step chaining | State-machine | No | State-machine | Dependency graph |
| 85 | Drop-box pattern for shared writes | Fan-Out (L620-630) | Not fully implemented | State-machine | `state` module | State-machine | File convention |
| 86 | Scribe merges decisions + writes logs | Fan-Out (L630-635) | Not implemented (no Scribe) | State-machine | No | State-machine (future) | |
| 87 | History/log append-only | Fan-Out (L635-641) | `.gitattributes` union merge | State-machine | No | State-machine | File-system constraint |
| 88 | Shared memory files never serialize work | Fan-Out (L641) | N/A | State-machine | No | State-machine | Anti-pattern |

### Worktree Awareness

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 89 | Resolve `.squad/` paths relative to team root | Worktree (L642-660) | `agent-sync.ts` uses project `path` | State-machine | `resolution` module | State-machine + SDK | `resolveSquad` handles this |
| 90 | Choose worktree-local vs main-checkout | Worktree (L660-680) | Not implemented (main-checkout only) | State-machine | `state-backend` (`WorktreeBackend`) | State-machine | Configuration flag |
| 91 | Issue-specific worktree creation | Worktree (L690-700) | Not implemented | State-machine | No | State-machine | `git worktree add` |
| 92 | Deps linking in worktree | Worktree (L700-705) | Not implemented | State-machine | No | State-machine | Symlink/install |
| 93 | Worktree reuse for same issue | Worktree (L705-710) | Not implemented | State-machine | No | State-machine | Path check |
| 94 | Cleanup after merge | Worktree (L710-715) | Not implemented | State-machine | No | State-machine | `git worktree remove` |

### Pre-Spawn Worktree Setup

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 95 | Check worktree mode setting | Pre-Spawn (L724-730) | Not implemented | State-machine | No | State-machine | Config read |
| 96 | Parse issue number from context | Pre-Spawn (L730-740) | `pickup-todos.ts` has issue ref | State-machine | No | State-machine | Regex/ID extraction |
| 97 | Reuse/create worktree | Pre-Spawn (L740-750) | Not implemented | State-machine | No | State-machine | `git worktree` |
| 98 | Link node_modules or install | Pre-Spawn (L750-755) | Not implemented | State-machine | No | State-machine | Deterministic |
| 99 | Branch naming `squad/{issue-number}-{slug}` | Pre-Spawn (L755-760) | Not implemented | State-machine | No | State-machine | Template |

### How to Spawn an Agent

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 100 | Dispatch every spawn via platform tool | Spawn (L771-780) | `bridge.ts` → `executeAgentRun` | State-machine | `coordinator/fan-out` | State-machine | |
| 101 | Always use `general-purpose` agent type | Spawn (L780-785) | `bridge.ts` hardcoded | State-machine | No | State-machine | Static rule |
| 102 | Background default | Spawn (L785-790) | All runs are async | State-machine | No | State-machine | Default |
| 103 | Inline charter into prompt | Spawn (L790-820) | `bridge.ts` assembles prompt | Hybrid | `agents/charter-compiler` (`compileCharter`) | **Coordinator assembles, SM dispatches** | Key migration: coordinator reads charter and inlines |
| 104 | Include team root, datetime | Spawn (L820-825) | `bridge.ts` adds metadata | State-machine | No | State-machine | Template vars |
| 105 | Ghost Protocol injection for personal agents | Spawn (L825-830) | Not implemented | State-machine | `agents/personal` | State-machine | Conditional template block |
| 106 | Worktree instructions injection | Spawn (L830-835) | Not implemented | State-machine | No | State-machine | Conditional block |
| 107 | Identity context injection | Spawn (L835-840) | `bridge.ts` adds agent name | State-machine | No | State-machine | Template |
| 108 | Skill check injection | Spawn (L840-845) | Not implemented | State-machine | `skills` module | State-machine | Conditional block |
| 109 | MCP block injection | Spawn (L845-850) | Not implemented | State-machine | No | State-machine | Conditional block |
| 110 | Response-order constraints | Spawn (L850-855) | Not implemented | State-machine | No | State-machine | Template |
| 111 | Only read own history/decisions | Spawn (L855-860) | Not enforced | State-machine | No | State-machine | Sandboxing constraint |
| 112 | Dates only from CURRENT_DATETIME | Spawn (L860-862) | Not enforced | State-machine | No | State-machine | Invariant |

### Anti-Patterns

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 113 | Never role-play agents inline | Anti-Patterns (L864-866) | N/A (server dispatches, doesn't role-play) | State-machine | No | N/A | Already satisfied by architecture |
| 114 | Never simulate output | Anti-Patterns (L866-868) | N/A | State-machine | No | N/A | |
| 115 | Never skip dispatch | Anti-Patterns (L868-870) | N/A | State-machine | No | N/A | |
| 116 | Never use generic names/descriptions | Anti-Patterns (L870-873) | `bridge.ts` uses agent name | State-machine | No | State-machine | Already enforced |

### After Agent Work

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 117 | Detect silent success via filesystem | After Work (L874-885) | Run status check in `stepper.ts` | State-machine | No | State-machine | File existence check |
| 118 | Spawn Scribe to merge inboxes | After Work (L885-900) | Not implemented | State-machine | No | Future (W30+) | Scribe is future work |
| 119 | Scribe writes orchestration logs | After Work (L900-910) | DB `issueRuns` logs | State-machine | No | State-machine | |
| 120 | Keep post-work turn lean | After Work (L910-920) | UI shows results directly | State-machine | No | State-machine | Display concern |
| 121 | Compact results after 3+ agents | After Work (L920-930) | Not implemented | LLM-driven | No | Coordinator LLM | Summarization needs judgment |
| 122 | If Ralph active, continue with Ralph cycle | After Work (L930-940) | `pickup-todos.ts` re-scans | State-machine | `ralph` module | State-machine | Loop continuation |
| 123 | `git add` exact files only | After Work (L940-950) | Not enforced (agent decides) | State-machine | No | State-machine (hook) | `hooks` pipeline could enforce |
| 124 | Close-out symmetric for capture | After Work (L950-953) | MCP `capture` with `done:` | State-machine | No | State-machine | |

### Ceremonies

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 125 | Check ceremonies before/after batches | Ceremonies (L955-960) | `ceremonies-due.ts` sweep | State-machine | No | State-machine | Schedule check |
| 126 | Auto-trigger `before` and `after` | Ceremonies (L960-963) | `ceremonies-due.ts` | State-machine | No | State-machine | |
| 127 | Manual only on user request | Ceremonies (L963-965) | Not implemented | State-machine | No | State-machine | |
| 128 | Facilitator spawned sync | Ceremonies (L965-967) | Not implemented | Hybrid | No | Coordinator decides facilitator | |
| 129 | Scribe records ceremony | Ceremonies (L967-968) | Not implemented | State-machine | No | Future | |
| 130 | Cooldown skip | Ceremonies (L968) | Not implemented | State-machine | No | State-machine | Timer check |

### Adding/Removing Team Members

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 131 | Allocate name from current universe/history | Add Member (L969-975) | `curated-roles.ts` (SDK roles) | Hybrid | `casting` module | SDK casting + coordinator | |
| 132 | Browse plugin marketplaces | Add Member (L975-980) | Not implemented | LLM-driven | `marketplace` module | Coordinator + SDK marketplace | |
| 133 | Install skill for new member | Add Member (L980-983) | Not implemented | State-machine | `skills` module | State-machine | |
| 134 | Create charter/history files | Add Member (L983-988) | `agent-sync.ts` (DB-only) | State-machine | `agents/onboarding` | State-machine + SDK | |
| 135 | Update registry/team/routing | Add Member (L988-992) | `agent-sync.ts` | State-machine | `state` module | State-machine | |
| 136 | Remove → move to alumni | Remove Member (L993-995) | `agent-sync.ts` status='retired' | State-machine | `agents/lifecycle` | State-machine | |
| 137 | Remove from roster/routing | Remove Member (L995-997) | `agent-sync.ts` | State-machine | `state` module | State-machine | |
| 138 | Mark registry retired, preserve knowledge | Remove Member (L997-998) | DB status update | State-machine | `casting` module | State-machine | |

### Reviewer Rejection Protocol

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 139 | Reviewers approve/reject | Rejection (L1096-1100) | Not implemented | State-machine | `hooks` (`ReviewerLockoutHook`) | State-machine + SDK hooks | |
| 140 | Original author locked out on rejection | Rejection (L1100-1110) | Not implemented | State-machine | `hooks` (`ReviewerLockoutHook`) | State-machine + SDK hooks | Strict lockout |
| 141 | Lockout persists per revision cycle | Rejection (L1110-1115) | Not implemented | State-machine | `hooks` (`ReviewerLockoutHook`) | State-machine | |
| 142 | Deadlock escalates to user | Rejection (L1115-1117) | Not implemented | State-machine | No | State-machine | Edge case handling |

### Multi-Agent Artifact Format

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 143 | Assembled result first, raw in appendix | Artifact Format (L1121-1125) | Not implemented | Hybrid | No | Coordinator assembles | Assembly needs judgment |
| 144 | Include termination condition, budgets, verdicts | Artifact Format (L1125-1128) | Not implemented | State-machine | No | State-machine | Template |
| 145 | Never edit/polish raw outputs | Artifact Format (L1128-1129) | Not enforced | State-machine | No | State-machine | Constraint |

### Constraint Budget Tracking

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 146 | Display counters when active | Budget (L1132-1135) | DB `monthlyBudgetUsd` + cost tracking | State-machine | `runtime/cost-tracker` | State-machine + SDK | |
| 147 | Increment as used | Budget (L1135-1137) | Cost tracking in `bridge.ts` | State-machine | `runtime/cost-tracker` | State-machine + SDK | |
| 148 | Show exhausted state | Budget (L1137-1139) | `budget-guard` in `bridge.ts` | State-machine | `runtime/cost-tracker` | State-machine | |

### GitHub Issues Mode

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 149 | Verify `gh` availability/auth | Issues Mode (L1143-1148) | `github-sync-overdue.ts` | State-machine | No | State-machine | |
| 150 | Prefer MCP if available | Issues Mode (L1148-1150) | MCP tools preferred | State-machine | No | State-machine | |
| 151 | Trigger phrases: connect/list/pick up/issues/backlog | Issues Mode (L1150-1155) | `pickup-todos.ts` sweep + UI | Hybrid | No | Coordinator detects intent, SM acts | |
| 152 | Issue lifecycle ties into branches/PRs | Issues Mode (L1155-1165) | GitHub sync + issue runs | State-machine | No | State-machine | |

### Ralph (Work Monitor)

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 153 | Always on roster | Ralph (L1168-1175) | Exempt from casting (hardcoded) | State-machine | `ralph` module | State-machine | Static rule |
| 154 | Continuous loop: scan → act → loop | Ralph (L1175-1200) | `pickup-todos.ts` sweep (10s) | State-machine | `ralph` module | State-machine | Sweep loop |
| 155 | Work sources: untriaged, assigned, open PRs, drafts | Ralph (L1200-1230) | `pickup-todos.ts` (issues only) | Hybrid | `ralph/triage` | Coordinator + state-machine | PR scanning not yet implemented |
| 156 | Periodic check-in every 3-5 rounds | Ralph (L1230-1250) | Not implemented | State-machine | `ralph/rate-limiting` | State-machine | Counter |
| 157 | Watch mode (persistent polling) | Ralph (L1250-1280) | Not implemented | State-machine | `ralph` module | State-machine | |
| 158 | All-clear → idle-watch | Ralph (L1280-1290) | Sweep runs but no-ops when empty | State-machine | `ralph` module | State-machine | |
| 159 | User must explicitly stop/idle | Ralph (L1290-1300) | N/A (sweep always runs) | State-machine | No | State-machine | |
| 160 | Intent signals not exact strings | Ralph (L1300-1306) | N/A | LLM-driven | No | Coordinator LLM | NL intent matching |

### PRD Mode

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 161 | Ingest PRD/spec as source of truth | PRD Mode (L1322-1328) | Not implemented | Hybrid | No | Coordinator ingests, SM stores ref | |
| 162 | Detect source (file, URL, inline) | PRD Mode (L1328-1330) | Not implemented | LLM-driven | No | Coordinator LLM | |
| 163 | Store PRD ref in team.md | PRD Mode (L1330-1332) | Not implemented | State-machine | `state` module | State-machine | |
| 164 | Spawn Lead sync to decompose | PRD Mode (L1332-1335) | Not implemented | Hybrid | No | Coordinator dispatches, Lead decomposes | |
| 165 | Present table for user approval | PRD Mode (L1335-1337) | Not implemented | State-machine | No | State-machine (UI) | |
| 166 | Route approved items respecting deps | PRD Mode (L1337-1338) | Workflow step deps in DB | State-machine | No | State-machine | |

### Human Team Members

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 167 | Humans are roster members, not spawnable | Human Members (L1341-1345) | Not implemented | State-machine | No | State-machine | |
| 168 | Coordinator waits when routed to human | Human Members (L1345-1348) | Not implemented | State-machine | No | State-machine | Enqueue + poll |
| 169 | Non-dependent work continues | Human Members (L1348-1350) | N/A | State-machine | No | State-machine | Parallel execution |
| 170 | Stale reminders | Human Members (L1350-1352) | Not implemented | State-machine | No | State-machine | Timer |
| 171 | Rejection lockout applies to humans too | Human Members (L1352-1353) | Not implemented | State-machine | `hooks` (`ReviewerLockoutHook`) | State-machine + SDK | |

### @copilot Member

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 172 | @copilot is autonomous, issue-assigned | @copilot (L1355-1360) | `agentKind='copilot'` in DB | State-machine | No | State-machine | |
| 173 | Uses `copilot/*` branches | @copilot (L1360-1362) | `copilotWorkflowFile` in projects | State-machine | No | State-machine | |
| 174 | Draft PRs | @copilot (L1362-1364) | GitHub sync handles | State-machine | No | State-machine | |
| 175 | Capability profile + auto-assign flag | @copilot (L1364-1367) | `copilotWorkflowFile` config | State-machine | No | State-machine | |

### Routing Enforcement Reminder

| # | Behavior | squad.agent.md section | Current owner in squadboard | LLM / SM / Hybrid | Squad SDK provides | Migration target | Notes |
|---|---|---|---|---|---|---|---|
| 176 | Coordinator only dispatches/synthesizes/talks | Enforcement (L1370-1375) | Enforced by architecture (server dispatches) | State-machine | No | N/A | Already satisfied |
| 177 | Stop if about to produce domain artifacts | Enforcement (L1375-1378) | N/A (server never produces domain artifacts) | State-machine | No | N/A | Already satisfied |

**Total: 177 behaviors mapped.**

Classification summary:
- **Pure state-machine:** ~105 behaviors (60%)
- **LLM-driven:** ~25 behaviors (14%)
- **Hybrid:** ~35 behaviors (20%)
- **N/A (already satisfied or not applicable):** ~12 behaviors (7%)

---

## Section 3 — LLM-Driven Coordinator Design

### 3.1 — Preamble structure (`squadboard-coordinator.md`)

The coordinator preamble is a system prompt for one-shot LLM calls. It does NOT run as a long-lived agent — it's invoked per-decision.

```markdown
# Squadboard Coordinator — Dispatch Agent

You are the dispatch coordinator for a Squad-based development team.
Your job: given a task and team context, decide WHO does it and HOW.

## Your outputs (JSON only)

Return EXACTLY one JSON object:
{
  "decision": "dispatch" | "direct" | "fan-out" | "human-wait" | "ceremony",
  "agent": "<cast-name or null>",
  "model_tier": "haiku" | "sonnet" | "opus" | null,
  "response_mode": "direct" | "lightweight" | "standard" | "full",
  "confidence": 0.0-1.0,
  "reasoning": "<one-line explanation>",
  "fan_out_agents": ["<name>", ...] | null,
  "steering_hints": "<optional guidance for the dispatched agent>"
}

## Decision rules

1. **Named agent** → dispatch to that agent, confidence 1.0
2. **@copilot keyword** → dispatch to @copilot, confidence 1.0
3. **Factual/status question** → direct response, no agent
4. **Multi-domain task** → fan-out to relevant agents
5. **Human member mentioned** → human-wait
6. **Ceremony trigger** → ceremony
7. **Everything else** → read charters below, pick best match

## Model tier selection

- Code writing/editing → sonnet
- Documentation/planning → haiku
- Vision/complex reasoning → opus
- Uncertain → sonnet (upgrade bias)

## Team roster

{{ROSTER_BLOCK}}

## Agent charters (raw prose)

{{CHARTERS_BLOCK}}

## Routing rules (from routing.md)

{{ROUTING_RULES_BLOCK}}

## Active skills

{{SKILLS_BLOCK}}

## Current project state

{{PROJECT_STATE_BLOCK}}

## Task to route

{{TASK_DESCRIPTION}}
```

### 3.2 — Invocation surface recommendation

**Recommendation: One-shot per decision.** Justification:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| One-shot per decision | Simple, stateless, easy retry, bounded cost | No conversation memory, repeated context | ✅ **Recommended** |
| Long-running session per project | Conversational memory, cheaper follow-ups | Session management complexity, stale context, harder to retry | ❌ Overkill for dispatch |
| Hybrid (session with periodic reset) | Best of both | Complex lifecycle management | ❌ Premature optimization |

One-shot is correct because:
1. Each dispatch decision is independent — no conversational state needed.
2. Context (charters, routing rules) changes between decisions (agent sync, user edits).
3. Retry on failure is trivial (just re-call with same input).
4. Cost is bounded per-call, not per-session-lifetime.

### 3.3 — Input shape

```typescript
interface CoordinatorInput {
  task: string;                    // Issue title + body, or user message
  projectState: {
    activeAgents: AgentSummary[];  // name, role, status, charterPath
    pendingRuns: number;           // current load
    recentDecisions: string[];     // last 5 decisions for context
  };
  charters: Record<string, string>; // agentName → raw charter markdown
  routingRules: string;            // raw routing.md content
  skills: SkillSummary[];          // available skills with confidence
  ceremonies: CeremonyConfig[];    // active ceremony schedule
}
```

### 3.4 — Output shape

```typescript
interface CoordinatorDecision {
  decision: 'dispatch' | 'direct' | 'fan-out' | 'human-wait' | 'ceremony';
  agent: string | null;            // cast name of chosen agent
  model_tier: 'haiku' | 'sonnet' | 'opus' | null;
  response_mode: 'direct' | 'lightweight' | 'standard' | 'full';
  confidence: number;              // 0.0-1.0
  reasoning: string;               // one-line explanation
  fan_out_agents: string[] | null; // for fan-out decisions
  steering_hints: string | null;   // optional guidance
}
```

### 3.5 — Cost analysis

| Metric | Value |
|---|---|
| Dispatches/hour (active dogfood) | ~10-20 |
| Active hours/day | ~8 |
| Calls/day | ~80-160 |
| Input tokens/call (est.) | ~3,000-5,000 (charters + state) |
| Output tokens/call (est.) | ~100-200 (JSON) |
| Cost/call (Haiku) | ~$0.002-0.003 |
| Cost/call (Sonnet) | ~$0.01-0.015 |
| **Daily cost (Haiku)** | **~$0.16-0.48** |
| Daily cost (Sonnet) | ~$0.80-2.40 |

**Recommendation:** Use Haiku for dispatch decisions. The task is routing, not creative — Haiku is sufficient and 5x cheaper.

### 3.6 — Latency analysis

| Model | Typical latency | pickup-todos budget (10s) | Acceptable? |
|---|---|---|---|
| Haiku | 2-5s | 20-50% of budget | ⚠️ Tight but OK with batching |
| Sonnet | 8-15s | 80-150% of budget | ❌ Exceeds budget |

**Mitigation for pickup-todos:**
1. **Batch:** Send all pending issues in one coordinator call → one decision per issue in response.
2. **Cache:** If task text + charter set hasn't changed, reuse last decision (TTL: 60s).
3. **Fallback:** If coordinator call exceeds 5s, fall back to Tier-2 keyword scoring (kept as degraded path).

### 3.7 — Failure handling

| Failure mode | Handling |
|---|---|
| Invalid JSON response | Parse error → retry once → fall back to Tier-2 keyword scoring |
| LLM timeout (>5s) | Cancel → fall back to Tier-2 keyword scoring |
| LLM error (rate limit, 500) | Retry with exponential backoff (max 2) → fall back to Tier-2 |
| Unknown agent name in response | Validate against roster → if invalid, re-call with correction hint → fall back |
| Low confidence (<0.3) | Log warning → use decision but flag for human review |

**Tier-2 keyword scoring is preserved as the degraded fallback path.** It is NOT removed until W31+ (Phase 4), and only after coordinator has been stable for 2+ waves.

### 3.8 — Caching

- **Key:** `hash(task_text + charter_content_hashes + routing_rules_hash + active_agents_hash)`
- **TTL:** 60s (short — context changes frequently)
- **Scope:** Per-project (different projects have different teams)
- **Storage:** In-memory Map (restart clears cache; acceptable for dogfood)
- **Hit rate estimate:** Low for user-initiated runs (unique tasks), moderate for pickup-todos re-scans (same issues)

---

## Section 4 — Workflow State Machine Design (What Stays Deterministic)

These behaviors **must** remain in deterministic code. They cannot be LLM-driven because they require exactness, atomicity, performance, or observability guarantees.

### 4.1 — DB transitions

- **Status fields:** `issueRuns.status` transitions: `pending → running → completed|failed|cancelled`. Enforced by SQL CHECK or application-level state machine.
- **Claim/lease:** `FOR UPDATE SKIP LOCKED` in `stepper.ts` (L17-244). Exactly one worker claims a row; no double-dispatch.
- **Idempotency keys:** Issue runs must be idempotent — same task + same agent = same run (dedup by issueId + agentId + status).
- **Drop-box merge:** Append-only file patterns — multiple agents write to inbox files; Scribe merges. No locking needed; union merge driver in `.gitattributes`.

### 4.2 — FOR UPDATE SKIP LOCKED claim mechanics (Invariant 2)

```sql
SELECT * FROM issue_runs
WHERE status = 'pending'
ORDER BY created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
```

This is the core of `stepper.ts`. It ensures:
- Exactly one worker processes each run
- No starvation (FIFO ordering)
- No blocking (SKIP LOCKED)

**This CANNOT be LLM-driven** because:
- Atomicity requires SQL transaction semantics
- Performance requires sub-millisecond claim
- Correctness requires exactly-once semantics

### 4.3 — Heartbeat + lease expiry sweeps

`heartbeat.ts` (L15-233) runs registered sweeps at configured intervals:
- `pickup-todos` (10s) — auto-dispatch pending issues
- `stuck-issue-runs` — recover runs that exceeded lease
- `idle-live-sessions` — cleanup stale sessions
- `stale-presence` — user presence cleanup
- `github-sync-overdue` — periodic GitHub issue sync
- `ceremonies-due` — ceremony schedule check
- `ready-workflow-steps` — advance workflow DAG

**Why not LLM:** Timing, reliability, and predictability. Sweeps must fire on schedule regardless of LLM availability.

### 4.4 — Workflow versioning + output validation (Invariant 4)

- `workflowVersions` table tracks schema version per workflow
- Output validation ensures agent output matches expected schema before marking complete
- Version mismatch → re-run with current schema

**Why not LLM:** Schema validation is exact-match; no judgment needed.

### 4.5 — Append-only file patterns + union merge driver

- `.squad/decisions.md` — append-only, union merge
- Agent history files — append-only
- Orchestration logs — append-only

**Why not LLM:** Merge semantics must be deterministic to avoid data loss.

### 4.6 — Budget guard + cost tracking

- `bridge.ts` checks budget before dispatch
- Cost tracked per-run in `issueRuns` table
- Monthly budget cap in `projects.monthlyBudgetUsd`

**Why not LLM:** Budget enforcement must be exact and atomic. Over-budget = hard stop.

### 4.7 — Event bus emit semantics

- `runtime/event-bus` — pub/sub for lifecycle events
- Events: `run:started`, `run:completed`, `run:failed`, `sweep:tick`, `session:created`
- Consumed by: UI (real-time updates), telemetry, cost tracking

**Why not LLM:** Event emission is a side-effect of state transitions; must be synchronous and reliable.

### 4.8 — Summary: Why these CAN'T be LLM-driven

| Requirement | Why deterministic |
|---|---|
| Exactly-once dispatch | SQL atomicity required |
| Budget enforcement | Over-budget must hard-stop; no "judgment" |
| Sweep timing | Must fire on schedule, not "when LLM feels like it" |
| Output validation | Exact schema match, no interpretation |
| File merge semantics | Data loss if non-deterministic |
| Event emission | Must be synchronous, ordered, reliable |
| Lease management | Timeout math must be exact |

---

## Section 5 — Squad SDK Comparison

### 5.1 — Charter Parsing

| Aspect | SDK (`agents/charter-compiler`) | Squadboard (`charter-compiler.ts`) | Divergence |
|---|---|---|---|
| Exports | `parseCharterMarkdown`, `compileCharter`, `compileCharterFull` | `parseCharterContent`, `parseCharter`, `computeContentHash`, `writeCharter` | Different APIs |
| Parsed fields | Identity, model, role, expertise, style sections → `CompiledCharter` | Name from H1, model, role (generalized), content hash | Squadboard extracts fewer fields |
| Hash tracking | Not in SDK | `computeContentHash` (md5) for change detection | Squadboard-specific |
| Write support | Not in SDK | `writeCharter` generates charter files | Squadboard-specific |
| **Recommendation** | **Lean on SDK** for parsing in coordinator; keep squadboard hash tracking for change detection. Drop squadboard's model/role/expertise extraction (coordinator reads raw prose). |

### 5.2 — Casting

| Aspect | SDK (`casting` module) | Squadboard (`curated-roles.ts`) | Divergence |
|---|---|---|---|
| Universe selection | Full scoring algorithm (size_fit, shape_fit, resonance_fit, LRU) | Not implemented (wraps SDK role catalog only) | Major gap |
| Name allocation | Registry-based, collision-free | Names come from charter H1 | Squadboard doesn't cast |
| Overflow handling | Diegetic expansion, thematic promotion, structural mirroring | Not implemented | Major gap |
| **Recommendation** | **Lean on SDK** casting module when implementing casting. Squadboard's `curated-roles.ts` stays as a thin wrapper for the UI role browser. |

### 5.3 — Coordinator Dispatch

| Aspect | SDK (`coordinator/`) | Squadboard (`stepper.ts` + `pickup-todos.ts` + `router.ts`) | Divergence |
|---|---|---|---|
| Routing | `Coordinator` class: heuristic routing (direct/status, @agent, team, default lead) | 3-tier: deterministic rules → keyword scoring → LLM specifier | **Significantly different** |
| Direct response | `DirectResponseHandler`: pattern-based for status/help/config/roster | Not implemented (all tasks create runs) | Gap |
| Fan-out | `spawnParallel` with Promise.allSettled | `fan-out-adapter.ts` wraps SDK spawnParallel | Aligned (adapter pattern) |
| Response tiers | `selectResponseTier`, `getTier` | Not implemented (all runs are "Full") | Gap |
| Claim mechanics | Not in SDK (SDK is stateless) | `FOR UPDATE SKIP LOCKED` in stepper.ts | Squadboard-specific (DB-backed) |
| **Recommendation** | **Hybrid:** Use SDK's `DirectResponseHandler` for trivial requests. Replace Tier-2/3 with coordinator LLM. Keep stepper.ts claim mechanics (SDK has no equivalent). |

### 5.4 — Agent Identity

| Aspect | SDK (`agents/`) | Squadboard (`agents` DB table + `agent-sync.ts`) | Divergence |
|---|---|---|---|
| Identity storage | File-based (charter.md, config) | DB rows (id, name, role, model, status, charterPath, charterHash) | **Different storage model** |
| Lifecycle | `AgentLifecycleManager` (spawn/resume/destroy) | DB status transitions (active/disabled/retired) | Similar concepts, different impl |
| Model selection | `resolveModel` + `ModelFallbackExecutor` | `model-defaults.ts` (4-layer) + `bridge.ts` | **Both exist; squadboard's is simpler** |
| History | `createHistoryShadow`, `appendToHistory`, `readHistory` | DB `issueRuns` as implicit history | Different approaches |
| **Recommendation** | **Stay custom** for DB-backed identity (squadboard needs queryable agent state). Use SDK `resolveModel` as reference for enhancing model-defaults. |

### 5.5 — Personal Squad

| Aspect | SDK (`agents/personal`) | Squadboard | Divergence |
|---|---|---|---|
| Discovery | `resolvePersonalAgents` — scans personal dir | **Not implemented** | Major gap |
| Merge | `mergeSessionCast` — additive, project wins | **Not implemented** | Major gap |
| Ghost Protocol | Types + enforcement metadata | **Not implemented** | Major gap |
| **Recommendation** | **Lean on SDK** when implementing personal squad support (W30+). |

### 5.6 — Streaming

| Aspect | SDK (`runtime/streaming`) | Squadboard (`consult-stream.ts` + `squad-stream.ts`) | Divergence |
|---|---|---|---|
| Pipeline | `StreamingPipeline` — delta aggregation, TTFT timing | Custom streaming with DB persistence | **Different: squadboard persists events** |
| Session management | SDK client manages sessions | `squad-stream.ts` manages long-lived sessions with interrupt/resume | Squadboard extends SDK patterns |
| **Recommendation** | **Stay custom** — squadboard's streaming adds DB persistence and long-lived session management that SDK doesn't provide. |

### 5.7 — Ralph

| Aspect | SDK (`ralph` + `ralph/triage`) | Squadboard (`pickup-todos.ts` sweep) | Divergence |
|---|---|---|---|
| Loop structure | Full Ralph agent with capabilities, rate-limiting | Simple sweep: scan todos → Tier-2 route → create run | **SDK is richer** |
| Work sources | Untriaged issues, assigned issues, open PRs, draft PRs | Todo-status issues only | Gap (no PR scanning) |
| Triage | `ralph/triage` module | `resolveRouteTier2` keyword scoring | Different algorithms |
| Rate limiting | `ralph/rate-limiting` module | Circuit breaker (3 failures / 30min window) | Both exist, different impl |
| Watch mode | SDK has persistent polling support | Not implemented | Gap |
| **Recommendation** | **Lean on SDK** for Ralph triage/rate-limiting primitives. Keep squadboard's sweep infrastructure (heartbeat.ts) for scheduling. |

### 5.8 — Marketplace

| Aspect | SDK (`marketplace` module) | Squadboard | Divergence |
|---|---|---|---|
| Discovery | Marketplace registry/discovery modules | **Not implemented (stubbed)** | Major gap |
| Plugin install | SDK provides primitives | Not implemented | Gap |
| **Recommendation** | **Lean on SDK** when marketplace support is needed. |

### 5.9 — Hooks

| Aspect | SDK (`hooks/`) | Squadboard | Divergence |
|---|---|---|---|
| Pipeline | `HookPipeline` — pre/post tool hooks, file guards, shell blocking | **Not implemented** | Major gap |
| Reviewer lockout | `ReviewerLockoutHook` | Not implemented | Gap |
| PII scrubbing | SDK provides | Not implemented | Gap |
| Ask-user rate limiting | SDK provides | Not implemented | Gap |
| **Recommendation** | **Lean on SDK** hooks pipeline for policy enforcement. High value for reviewer lockout and file guards. |

### 5.10 — Multi-Squad

| Aspect | SDK (`multi-squad`) | Squadboard | Divergence |
|---|---|---|---|
| Squad management | `listSquads`, `createSquad`, `switchSquad`, `migrateIfNeeded` | Single-project focus (projects table) | **Fundamental difference** |
| Resolution | `getSquadRoot`, `resolveSquadPath` | Project `path` column | Simpler |
| **Recommendation** | **Stay custom** for now. Multi-squad support is not in scope. SDK primitives available when needed. |

---

## Section 6 — Parser Fate

### 6.1 — What the parser KEEPS

1. **Name extraction from first H1** — `# Agent Name` → `agents.name`. Simple, reliable, no LLM needed.
2. **File existence watching** — `agent-sync.ts` watches for charter file creation/deletion to sync DB status. Deterministic.
3. **Content hash computation** — `computeContentHash` for change detection (triggers re-sync). Deterministic.

That's it. ~50 lines of parser logic.

### 6.2 — What MOVES to coordinator-mediated LLM lookup

| Field | Current extraction method | Why it moves |
|---|---|---|
| `model` | Regex: `## Model` section → first code span | 3 waves of parser bugs; LLM reads prose naturally |
| `role` | Regex: first paragraph after H1 | Ambiguous boundaries; prose-oriented |
| `expertise` | Regex: `## Expertise` / `## Skills` sections | Keyword extraction from free text |
| `style` | Regex: `## Style Guide` section | Completely prose; no structured format |
| `reviewer_authority` | Regex: `## Reviewer` section | Boolean-ish but embedded in prose |

These fields are no longer extracted and stored in the `agents` table. Instead, the coordinator reads raw charter prose at dispatch time and makes decisions based on it.

### 6.3 — What happens to existing parsed data in DB

**Migration plan:**

1. **Phase 2 (W29):** Add `charterContent` TEXT column to `agents` table (stores raw charter markdown for fast coordinator access). Populate on next agent-sync.
2. **Phase 3 (W30):** Stop writing to `role`, `model` columns. Coordinator reads `charterContent` directly. Columns remain but are not used in dispatch decisions.
3. **Phase 4 (W31):** Drop `role`, `model` columns via Drizzle migration. Any API that exposed these fields returns null with deprecation warning.

**Backwards compatibility during transition:**
- `role` column remains readable through Phase 3 (populated by legacy sync path)
- Model resolution chain still checks `agents.model` as Layer 2 fallback until Phase 4
- UI can display role/model from charter content via a lightweight extractor (not the full parser)

---

## Section 7 — Agents Table Slim-Down

### 7.1 — Concrete schema diff

```diff
 export const agents = pgTable('agents', {
   id: uuid('id').primaryKey().defaultRandom(),
   projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
   name: text('name').notNull(),
-  role: text('role').notNull(),
-  model: text('model'),
+  role: text('role'),              // Phase 3: nullable, deprecated
+  model: text('model'),            // Phase 3: nullable, deprecated
   status: agentStatusEnum('status').notNull().default('active'),
   charterPath: text('charter_path').notNull(),
   historyPath: text('history_path'),
   charterHash: text('charter_hash'),
+  charterContent: text('charter_content'), // Phase 2: raw charter markdown for coordinator
   agentKind: text('agent_kind').notNull().default('squad'),
   createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
   updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
 });
```

Phase 4 (W31+):
```diff
 export const agents = pgTable('agents', {
   id: uuid('id').primaryKey().defaultRandom(),
   projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
   name: text('name').notNull(),
-  role: text('role'),
-  model: text('model'),
   status: agentStatusEnum('status').notNull().default('active'),
   charterPath: text('charter_path').notNull(),
   historyPath: text('history_path'),
   charterHash: text('charter_hash'),
   charterContent: text('charter_content'),
   agentKind: text('agent_kind').notNull().default('squad'),
   createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
   updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
 });
```

### 7.2 — Migration script outline (Drizzle)

```typescript
// Phase 2 migration: add charterContent
export async function up(db) {
  await db.execute(sql`ALTER TABLE agents ADD COLUMN charter_content TEXT`);
  // Backfill from disk
  const rows = await db.select().from(agents);
  for (const agent of rows) {
    const content = await readFile(agent.charterPath, 'utf-8').catch(() => null);
    if (content) {
      await db.update(agents).set({ charterContent: content }).where(eq(agents.id, agent.id));
    }
  }
}

// Phase 3 migration: make role nullable
export async function up(db) {
  await db.execute(sql`ALTER TABLE agents ALTER COLUMN role DROP NOT NULL`);
}

// Phase 4 migration: drop role + model
export async function up(db) {
  await db.execute(sql`ALTER TABLE agents DROP COLUMN role`);
  await db.execute(sql`ALTER TABLE agents DROP COLUMN model`);
}
```

### 7.3 — Backwards compatibility for in-flight runs

- **In-flight runs during Phase 2-3:** These runs were dispatched with the old model resolution chain (which reads `agents.model`). They continue to work because the column still exists.
- **API consumers:** Any API returning agent details that includes `role` or `model` fields: in Phase 3, these may be null. Clients should handle null gracefully.
- **agent-sync.ts:** In Phase 2-3, sync continues to write `role` and `model` from the (slimmed) parser for backwards compatibility. In Phase 4, these writes are removed.
- **UI:** Agent cards that display role/model should fall back to "Read from charter" when columns are null.

---

## Section 8 — Phased Migration Plan

### Phase 1 — Hotfix in Flight (W27, already dispatched)

**Scope:**
- Parser key allowlist (reject unknown keys)
- Backtick strip in parsed values
- Circuit breaker on parser failures
- Boundary validation for section extraction

**Deliverables:**
- `packages/server/src/services/charter-compiler.ts` — hardened parser
- `packages/server/src/__tests__/charter-parser.test.ts` — regression tests
- `packages/server/src/engine/sweeps/pickup-todos.ts` — circuit breaker integration

**Risks:** Parser changes may reject previously-accepted charters. Mitigated by allowlist approach (known-good keys pass; unknown keys warn but don't fail).

**Success criteria:** Zero parser crashes in 48h of dogfood usage.

**Rollback:** Revert parser changes; old parser is less strict but functional.

### Phase 2 — Introduce Coordinator-Agent Additively (W29)

**Scope:**
- Create `squadboard-coordinator.md` preamble
- Implement `coordinator-dispatch.ts` — one-shot LLM call per decision
- Add `charterContent` column to agents table (migration)
- Update `agent-sync.ts` to populate `charterContent` on sync
- Wire coordinator into `pickup-todos.ts` as PRIMARY path (Tier-2 as fallback)
- Wire coordinator into manual-run creation (UI "Run" button)
- Add coordinator decision logging to `issueRuns` or new `coordinatorDecisions` table
- Implement decision caching (in-memory, 60s TTL)
- Preserve Tier-2 keyword scoring as degraded fallback

**Deliverables:**
- `packages/server/src/coordinator/preamble.md` — coordinator system prompt
- `packages/server/src/coordinator/dispatch.ts` — one-shot coordinator call
- `packages/server/src/coordinator/cache.ts` — decision memoization
- `packages/server/src/coordinator/types.ts` — input/output types
- `packages/server/src/db/migrations/XXXX-add-charter-content.ts` — Drizzle migration
- Updated `pickup-todos.ts`, `router.ts`, `bridge.ts`

**Risks:**
1. Coordinator LLM may route differently than Tier-2 for the same task → A/B comparison period needed
2. Latency may spike during sweep cycles → batching + caching mitigates
3. Cost increase visible immediately → monitor daily spend

**Success criteria:**
1. Coordinator makes correct dispatch decisions for >90% of dogfood tasks (compared to human judgment)
2. p95 dispatch latency <5s on Haiku
3. Daily cost increase <$1.00

**Rollback:** Feature flag `COORDINATOR_DISPATCH_ENABLED=false` falls back to pure Tier-2/3 routing.

### Phase 3 — Migrate Existing Surfaces (W30+)

**Scope:**
- Convert all dispatch paths to coordinator-driven:
  - `pickup-todos.ts` — coordinator is now sole dispatch path (Tier-2 only as error fallback)
  - Manual run creation — coordinator selects agent + model
  - Ceremony step dispatch — coordinator selects facilitator
  - J5 consult context — coordinator assembles context for consult sessions
- Make `role` column nullable
- Stop writing `role`/`model` from parser
- Add response-mode selection (Direct/Lightweight/Standard/Full) — currently all Full
- Integrate SDK `DirectResponseHandler` for trivial requests

**Deliverables:**
- Updated `pickup-todos.ts`, `router.ts`, `bridge.ts`, ceremony sweep
- Updated `agent-sync.ts` (stop writing parsed fields)
- Updated `charter-compiler.ts` (slim to name + hash only)
- Drizzle migration for nullable role
- Response mode implementation in `coordinator/dispatch.ts`

**Risks:** Removing parser fields may break API consumers. Mitigated by Phase 3 keeping columns (just nullable).

**Success criteria:**
1. Zero dispatch failures due to coordinator errors in 1 week
2. Response mode correctly selected for >85% of tasks
3. No regressions in existing tests

**Rollback:** Re-enable Tier-2 as primary path; re-populate role/model from parser.

### Phase 4 — Drop Deprecated Paths (W31+)

**Scope:**
- Remove Tier-2 keyword scoring entirely
- Drop `role`, `model` columns from agents table
- Remove legacy parser fields extraction
- Remove deprecated `dispatcher.ts`
- Slim `charter-compiler.ts` to ~50 lines (name + hash + write)
- Clean up router.ts (remove Tier-2/Tier-3 code paths)

**Deliverables:**
- Drizzle migration dropping columns
- Deleted/slimmed files: `charter-compiler.ts`, `router.ts` (Tier-2/3 removal)
- Updated API types (remove role/model from agent responses)

**Risks:** API breaking change for any external consumers. Mitigated by: this is dogfood-only; no external API consumers.

**Success criteria:**
1. All tests pass with slimmed schema
2. codebase LOC reduction: ~400+ lines removed
3. Zero parser-related bugs (because parser barely exists)

**Rollback:** Drizzle down migration restores columns; re-deploy W30 code.

---

## Section 9 — Open Questions for Brady

### Q1 (Critical): Should the coordinator preamble live in-repo or be built-in to the server?

**Options:**
- **A) In-repo** at `.squad/coordinator.md` — editable per-project, version-controlled, transparent
- **B) Built-in** as a TypeScript template string in `coordinator/preamble.ts` — faster iteration, no file I/O
- **C) Hybrid** — built-in default, overridable by `.squad/coordinator.md` if present

**Recommendation:** Option C (hybrid). Built-in default for zero-config, per-project override for customization. This matches the SDK's config resolution pattern.

### Q2 (Critical): Coordinator model — always Haiku, or configurable?

The coordinator call itself needs a model. Options:
- **A) Hardcoded Haiku** — cheapest, simplest, sufficient for routing
- **B) Configurable** via `COORDINATOR_MODEL` env var or `.squad/config.json`
- **C) Adaptive** — Haiku for simple routing, Sonnet for complex fan-out decomposition

**Recommendation:** Option B with Haiku default. Power users may want Sonnet for better fan-out decomposition.

### Q3 (High): How does this interact with the coordinator-fragment.md (Q4 delivery)?

The `coordinator-fragment.md` (delivered in Q4) is a CLI-side extension. The new `squadboard-coordinator.md` is server-side. Are these:
- **A) Independent** — CLI coordinator and server coordinator coexist, different concerns
- **B) Converging** — server coordinator eventually replaces CLI fragment
- **C) Layered** — CLI fragment adds MCP tool awareness; server coordinator handles dispatch

**Recommendation:** Option C (layered). The CLI fragment adds squadboard MCP tool awareness to the CLI coordinator. The server coordinator handles dispatch for server-initiated runs (sweeps, manual triggers). They don't conflict.

### Q4 (High): Should we store coordinator decisions in a dedicated table or in issueRuns?

Options:
- **A) New `coordinator_decisions` table** — clean audit trail, queryable, independent of runs
- **B) Columns on `issueRuns`** — `coordinator_agent`, `coordinator_model`, `coordinator_reasoning`
- **C) JSON field on `issueRuns`** — `coordinator_decision JSONB`

**Recommendation:** Option C. Lightweight, doesn't require schema changes for new decision fields, and decisions are always associated with a specific run.

### Q5 (Medium): What's the fan-out decomposition depth limit?

The coordinator can propose fan-out. Should it:
- **A) Single-level only** — coordinator proposes N agents, all spawn in parallel
- **B) Recursive** — a fan-out agent can itself request further fan-out
- **C) Configurable depth** (max 2-3 levels)

**Recommendation:** Option A for W29. Single-level fan-out is sufficient; recursive adds complexity without clear dogfood need.

### Q6 (Medium): Charter content in DB vs. read-from-disk at dispatch time?

Options:
- **A) DB column** (`charterContent`) — fast, no file I/O at dispatch time
- **B) Read from disk** — always fresh, no sync lag
- **C) DB with invalidation** — store in DB, re-read on `charterHash` change

**Recommendation:** Option C. Best of both worlds. Agent-sync already computes hash; re-read on change is cheap.

### Q7 (Low): Should the coordinator handle consult-mode routing (J5)?

The coordinator could also decide "this is a consult, not a dispatch" and return a different decision type. Or consult stays a separate code path.

**Recommendation:** Yes, add `"consult"` as a decision type in W30 (Phase 3). This unifies the context-assembly machinery.

### Q8 (Low): Telemetry — should coordinator decisions be OTel-traced?

**Recommendation:** Yes. Add a span per coordinator call with: model, latency, decision, confidence, cache_hit. Aligns with SDK's `runtime/otel-api`.

---

## Section 10 — Concrete W29 Implementation Breakdown

| # | Title | Description | Size | Files touched | Dependencies |
|---|---|---|---|---|---|
| 1 | **Create coordinator types** | Define `CoordinatorInput`, `CoordinatorDecision`, and validation schemas (Zod) | S | `src/coordinator/types.ts` | None |
| 2 | **Write coordinator preamble** | Author `squadboard-coordinator.md` system prompt with roster/charter/routing/skills template slots | M | `src/coordinator/preamble.md`, `src/coordinator/preamble.ts` (loader) | #1 |
| 3 | **Implement one-shot coordinator dispatch** | Core `dispatchViaCoordinator(input: CoordinatorInput): CoordinatorDecision` function — assembles prompt, calls LLM, parses JSON response, validates | M | `src/coordinator/dispatch.ts` | #1, #2 |
| 4 | **Add decision cache** | In-memory cache with content-hash key and 60s TTL for coordinator decisions | S | `src/coordinator/cache.ts` | #1 |
| 5 | **Add charterContent column migration** | Drizzle migration adding `charter_content TEXT` to agents table + backfill script | S | `src/db/migrations/XXXX-add-charter-content.ts`, `src/db/schema.ts` | None |
| 6 | **Update agent-sync to populate charterContent** | On sync, read charter file content and store in `charterContent` column | S | `src/services/agent-sync.ts` | #5 |
| 7 | **Wire coordinator into pickup-todos sweep** | Replace Tier-2 keyword scoring with coordinator dispatch as primary path; keep Tier-2 as fallback on coordinator failure | M | `src/engine/sweeps/pickup-todos.ts`, `src/engine/router.ts` | #3, #4, #6 |
| 8 | **Wire coordinator into manual run creation** | When user clicks "Run" in UI, use coordinator to select agent + model instead of hardcoded selection | M | `src/sdk/bridge.ts`, `src/services/issues.ts` (or wherever manual run is created) | #3, #6 |
| 9 | **Add coordinator feature flag** | `COORDINATOR_DISPATCH_ENABLED` env var (default: true). When false, falls back to Tier-2/3. | S | `src/coordinator/dispatch.ts`, `src/engine/sweeps/pickup-todos.ts` | #3 |
| 10 | **Add coordinator decision logging** | Store coordinator decision as JSONB field on `issueRuns` row (or new column) | S | `src/db/schema.ts`, `src/engine/stepper.ts` | #1 |
| 11 | **Batch coordinator calls for sweep** | When pickup-todos has N pending issues, send all N in one coordinator call; parse N decisions from response | M | `src/coordinator/dispatch.ts`, `src/engine/sweeps/pickup-todos.ts` | #3, #7 |
| 12 | **Add coordinator integration tests** | Test coordinator dispatch with mock LLM responses: correct routing, fallback on failure, cache hit, batch mode | L | `src/__tests__/coordinator-dispatch.test.ts` | #3, #4, #7 |
| 13 | **Update model-defaults for coordinator model** | Add coordinator model to resolution chain (env var `COORDINATOR_MODEL`, default Haiku) | S | `src/sdk/model-defaults.ts`, `src/coordinator/dispatch.ts` | #3 |
| 14 | **Slim charter-compiler (prep for Phase 3)** | Refactor to separate name-extraction + hash functions from full field extraction; don't remove fields yet, just prepare the seam | S | `src/services/charter-compiler.ts` | None |

**Estimated total: 3 S + 6 M + 1 L = ~2-3 days of focused implementation**

---

## Appendix A — Raw Behavior Inventory Notes

### Behaviors not cleanly categorized above

1. **Coordinator identity declaration** (L10-15): The coordinator declares itself at session start with version, capabilities. Squadboard equivalent: server startup logging. Not a dispatch behavior.

2. **Team mode detection** (L120-123): Distinguishes "team of agents" from "personal squad" mode. Squadboard always operates in team mode (project-scoped). Not applicable as-is.

3. **Scribe role** (L885-910): Scribe is a special agent that merges inboxes, writes logs, summarizes history. Squadboard doesn't have Scribe yet — these behaviors are deferred to W30+. Not blocking for W29.

4. **History reading constraints** (L855-860): Each agent should only read its own history + shared decisions. Squadboard's DB model gives all runs access to all data. Enforcement would require row-level security or prompt sandboxing.

5. **Cost-first model selection** (L430-435): "Cost-first unless code is being written." This heuristic maps to: Haiku default, upgrade to Sonnet for code tasks. The coordinator can implement this as a prompt rule.

6. **Worktree lifecycle management** (L690-715): Full worktree support (create, link deps, reuse, cleanup) is a substantial feature not yet in squadboard. Deferred to W30+.

7. **Plugin marketplace browsing** (L975-980): SDK has `marketplace` module; squadboard has no marketplace UI or API. Deferred.

8. **Multiple simultaneous humans** (L1352-1353): squad.agent.md supports multiple human team members tracked independently. Squadboard's project model doesn't distinguish human vs agent members in the roster. Schema gap.

### Charter sections that the coordinator will need to understand

The coordinator preamble must instruct the LLM to look for these sections in raw charter prose:
- `# {Name}` — identity
- `## Model` / `## Model Preference` — model hints
- `## Role` / `## Expertise` / `## Skills` — capability matching
- `## Style Guide` — response style
- `## Reviewer` / `## Review Authority` — reviewer status
- `## Focus Areas` — topic routing
- `## Tools` / `## Capabilities` — tool availability

This is an exhaustive list of sections the parser currently attempts to extract from.

---

## Appendix B — SDK Exports Catalog

One-line description of every SDK module export (v0.9.4):

| Export path | Description |
|---|---|
| `.` | Top-level barrel: VERSION, resolution helpers, config loaders, agent/casting/skill types, coordinator tier helpers, runtime utilities, event bus, marketplace, builders, state APIs |
| `./parsers` | Charter/routing/team/decisions/skills markdown parsers — `parseCharterMarkdown`, `compileCharter`, `parseRoutingMarkdown`, `matchRoute`, `parseFrontmatter` |
| `./types` | Type-only barrel: schema types for config, agents, runtime, adapter, multi-squad, streams, builders, platform |
| `./config` | Config schema, loader, validator — `loadConfig`, `validateConfig`, `SquadConfig`, `DEFAULT_CONFIG` |
| `./config/agent-source` | Agent source configuration (file-based, programmatic) |
| `./config/migrations` | Config format migration helpers |
| `./config/models` | Model catalog and tier definitions |
| `./skills` | Skill loader/catalog — `parseFrontmatter`, `parseSkillFile`, `loadSkillsFromDirectory` |
| `./agents` | Charter compiler, model selector, lifecycle manager, history shadows, onboarding |
| `./agents/personal` | Personal agent discovery — `resolvePersonalAgents`, `mergeSessionCast`, Ghost Protocol types |
| `./adapter` | Adapter types, browser/backend/extension packaging |
| `./adapter/errors` | Adapter-specific error types |
| `./client` | Client/session pool/event plumbing used by coordinator fan-out |
| `./coordinator` | `SquadCoordinator`, `DirectResponseHandler`, `spawnParallel`, `selectResponseTier`, `getTier` |
| `./hooks` | `HookPipeline`, `ReviewerLockoutHook`, file-write guards, shell blocking, PII scrubbing |
| `./tools` | Tool registry and governance-integrated tools |
| `./runtime` | Config, event bus, telemetry, cost tracking, benchmarks, i18n, offline, OTel |
| `./runtime/streaming` | `StreamingPipeline` — delta aggregation, TTFT timing |
| `./runtime/event-bus` | `EventBus` pub/sub for lifecycle events |
| `./runtime/benchmarks` | Performance benchmarking utilities |
| `./runtime/i18n` | Internationalization support |
| `./runtime/telemetry` | Telemetry collection and export |
| `./runtime/offline` | Offline mode support |
| `./runtime/cost-tracker` | Token/cost tracking per-session |
| `./runtime/otel-api` | OpenTelemetry API integration |
| `./runtime/otel` | OTel instrumentation |
| `./runtime/otel-bridge` | OTel bridge for external systems |
| `./runtime/otel-metrics` | OTel metrics collection |
| `./runtime/otel-init` | OTel initialization |
| `./runtime/squad-observer` | Squad-level event observation |
| `./runtime/event-payloads` | Typed event payload definitions |
| `./runtime/event-bus-ws-bridge` | WebSocket bridge for event bus |
| `./runtime/scheduler` | Task scheduling primitives |
| `./runtime/constants` | Runtime constants |
| `./runtime/cross-squad` | Cross-squad discovery and coordination |
| `./marketplace` | Plugin marketplace discovery/registry |
| `./build` | Build-time helpers |
| `./sharing` | Cross-squad sharing primitives |
| `./ralph` | Ralph work monitor — agent, commands, capabilities |
| `./ralph/triage` | Issue triage logic |
| `./ralph/capabilities` | Ralph capability definitions |
| `./ralph/rate-limiting` | Work-loop rate limiting |
| `./casting` | Casting policy, universe management, name allocation |
| `./resolution` | Path resolution — `resolveSquad`, `resolvePersonalSquadDir`, `deriveProjectKey`, `scratchDir` |
| `./builders` | Builder DSL — `defineTeam`, `defineAgent`, `defineBudget`, `defineRouting`, `defineCeremony`, `defineHooks` |
| `./storage` | Storage provider abstractions (`FSStorageProvider`) |
| `./platform` | Platform adapters and detection |
| `./remote` | Remote squad/external coordination |
| `./roles` | Built-in role catalog |
| `./state` | Typed state facade — collections for agents, config, decisions, log, routing, skills, team, templates |
| `./state-backend` | `WorktreeBackend`, `GitNotesBackend`, `OrphanBranchBackend`, `resolveStateBackend` |
| `./streams` | Stream orchestration types/modules |
| `./upstream` | Upstream squad discovery/integration |

---

*End of design document. Ready for Brady review → W29 implementation.*
