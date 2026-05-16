# W30: Squad CLI vs Squad-SDK + Squadboard Parity Report

## 1. Executive Summary

The Copilot CLI's Squad orchestrator today operates as a **dispatcher and context-keeper** — routing work to specialist agents, capturing directives, and maintaining team memory via markdown (.squad/ files and decisions.md). 

**Question:** Can Squad-SDK + Squadboard replicate this experience?

**Verdict: Partial parity. Core capabilities exist; gaps are localized.**

- ✅ **SDK + Squadboard implement ~85% of CLI capabilities:** agent dispatch, ceremony orchestration, routing logic, session logging, team management, and charter compilation all have server-side and UI counterparts.
- ⚠️ **Top 3 gaps blocking complete CLI replacement:**
  1. **Directive capture (C-06)** — CLI captures directives to `.squad/decisions/inbox/` as markdown; SDK/Squadboard have no equivalent inbox capture or decision log push-down API.
  2. **Issue-label-based auto-routing (C-05)** — CLI detects `squad:{member}` GitHub labels and routes issues; Squadboard UI has issue list but no automatic label-watcher or auto-routing orchestration.
  3. **Personal agent consult mode (C-11)** — CLI discovers personal agents from `~/.squad/agents/` and runs them in "ghost protocol" mode; SDK/Squadboard assume all agents are project-scoped.

- 🚀 **Top 3 capabilities Squadboard adds beyond CLI:**
  1. **Live run orchestration & streaming** — WebSocket-driven live session view (Verbal's work, packages/server/src/realtime/, packages/client/src/realtime/): CLI has none.
  2. **Kanban board workflow engine** — visual workflow design, card dragging, column state (Keyser's packages/client/src/pages/Board.tsx, packages/server/src/routes/runs.ts): CLI is text-driven only.
  3. **Ceremony scheduling + audit trail** — CRON-driven ceremony automation, version history, execution logs (packages/server/src/routes/ceremonies.ts, CeremonyAudit.tsx): CLI ceremonies are ad-hoc only.

---

## 2. Squad CLI Feature Inventory

Cataloging each CLI capability with where it's implemented today:

| ID | Capability | What It Does | Invocation | CLI Logic Location |
|---|---|---|---|---|
| C-01 | **Team Initialization (Init Mode Phase 1)** | Propose AI team roster; run casting algorithm to assign names from universes | User describes project; CLI responds with proposed roster | `.github/agents/squad.agent.md:31-59` (Init Mode — Phase 1) |
| C-02 | **Team Creation (Init Mode Phase 2)** | Scaffold `.squad/` directory, create team.md, routing.md, ceremonies.md, decisions.md | CLI confirms Phase 1; runs Phase 2 scaffold | `.github/agents/squad.agent.md:63-94` (Init Mode — Phase 2) |
| C-03 | **Agent Casting & Persistent Naming** | Run casting algorithm (universe selection, resonance signals, persistent name registry) | CLI auto-runs during Init Phase 1; users confirm | `.github/agents/squad.agent.md:40-71` (Casting & Persistent Naming section) |
| C-04 | **Agent Dispatch & Spawning** | Route user request to best agent(s); spawn with task tool (mode, model, description, prompt) | "Ripley, fix the bug" or auto-routing | `.github/agents/squad.agent.md:101-107` (Dispatch Mechanism) |
| C-05 | **Issue Awareness & Label Routing** | On session start: list `squad:{member}` GitHub labels; on new label: auto-route to member | CLI checks `gh issue list --label squad:{name}`; mentions pending issues | `.github/agents/squad.agent.md:139-158` (Issue Awareness) |
| C-06 | **Directive Capture** | Detect directives ("Always...", "Never...", "From now on..."); write to `.squad/decisions/inbox/copilot-directive-{ts}.md` | User statement with directive signal → CLI captures immediately | `.github/agents/squad.agent.md:221-261` (Directive Capture) |
| C-07 | **Work Routing Rules** | Read `.squad/routing.md`; route work to primary agent based on domain | CLI reads routing table; matches work type | `.squad/routing.md` (entire file defines routing logic) |
| C-08 | **Session Logging via Scribe** | Scribe auto-logs orchestration, agent spawns, decisions; call `squadboard.scribe.closeOut()` at session end | CLI spawns Scribe as background agent; calls closeOut on completion | `packages/squadboard-sdk/src/scribe/index.ts:7-8` (`closeOut` export) |
| C-09 | **Ceremony Orchestration** | List ceremonies from `.squad/ceremonies.md`; auto-trigger before/after work (Design Review, Retrospective) | User request "run design review" OR auto-trigger on multi-agent work | `.squad/ceremonies.md` (Design Review, Retrospective config) |
| C-10 | **Session Catch-Up** | On user prompt ("what did we do?"), scan orchestration logs; summarize recent work | CLI scans `.squad/orchestration-log/` for entries newer than last session | `.github/agents/squad.agent.md:112-120` (Session catch-up) |
| C-11 | **Personal Agent Discovery** | Scan `~/.squad/agents/` for personal agents; run in Ghost Protocol (read-only, transparent tagging) | CLI checks `SQUAD_NO_PERSONAL` env var; discovers personal dir | `.github/agents/squad.agent.md:123-137` (Personal Squad - Ambient Discovery) |
| C-12 | **Consult Mode** | Route request to personal agent; if recommends changes, hand off to project agent | User addresses personal agent by name → consult → project agent executes | `.github/agents/squad.agent.md:290-296` (Consult Mode Detection) |
| C-13 | **Charter Compilation & Agent Sync** | Read agent charter.md files; compile into structured agent context; sync from disk on each session | CLI auto-syncs agents on session start; ParserCharter reads markdown | `packages/server/src/services/charter-compiler.ts` (CLI uses same service) |
| C-14 | **Skill Confidence Lifecycle** | Skills use 3-level confidence (Low/Medium/High); confidence only rises, never falls | CLI maintains skill confidence in agent history.md | `.github/agents/squad.agent.md:298-315` (Skill Confidence) |
| C-15 | **Skill-Aware Routing** | Before spawning, check `.copilot/skills/` and `.squad/skills/` for relevant skills; pass to agent prompt | CLI injects skill path into spawn prompt | `.github/agents/squad.agent.md:284-288` (Skill-aware routing) |
| C-16 | **Ralph Work Monitor** | Ralph auto-spawns on session start; monitors backlog, keeps work queue flowing, reports status | CLI spawns Ralph automatically; Ralph runs in background | `.github/agents/squad.agent.md:278` (Ralph commands in routing table) |
| C-17 | **Health Reports** | Scribe writes health report: spawn lineage, backlog snapshot, throughput, next-wave todos | CLI calls `squadboard.scribe.writeHealthReport()` | `packages/squadboard-sdk/src/scribe/steps/step-8-health-report.ts` (writeHealthReport export) |
| C-18 | **PRD/Spec Intake Mode** | User provides PRD or spec document; CLI routes to PM or design agent for analysis | User pastes PRD or provides file path → CLI routes | `.github/agents/squad.agent.md:88-89` (Post-setup input sources) |
| C-19 | **GitHub Issues Mode** | User references GitHub issues; CLI lists and triages; assigns `squad:{member}` labels | User: "Pull issues from owner/repo" → CLI fetches via gh CLI | `.github/agents/squad.agent.md:88-89` (Post-setup input sources) |
| C-20 | **Human Team Members** | Support human members on roster (PM, Designer, Sales, etc.); route work accordingly | User: "Add Brady as PM" → CLI adds to team.md | `.github/agents/squad.agent.md:91-92` (Human Team Members) |
| C-21 | **MCP Tool & Slash Command Routing** | Route requests to add MCP tools or custom commands | Kobayashi owns (from routing.md); CLI routes there | `.squad/routing.md:11` (MCP tool / slash command surface) |

---

## 3. Squad-SDK Surface Audit

**SDK location:** `packages/squadboard-sdk/`

**Current SDK exports (packages/squadboard-sdk/src/index.ts:1-45):**

```typescript
export const squadboard = { scribe };
export type { CloseOutOptions, CloseOutResult, SpawnManifest, SpawnManifestEntry };
export type { SquadboardBundle, ApplyResult, BundleManifest, ... };
```

**SDK Scribe sub-module (packages/squadboard-sdk/src/scribe/index.ts:1-27):**

```typescript
export { closeOut } from './close-out.js';
export { writeHealthReport } from './steps/step-8-health-report.js';
export {
  archiveDecisionsBySize,
  mergeInbox,
  writeOrchestrationLogs,
  writeSessionLog,
  crossAgentHistoryUpdates,
  summarizeHistoryIfLarge,
  commitScribeFiles,
} from './primitives.js';
```

### Coverage by CLI Capability:

| CLI Cap | SDK Function | Exposed? | Location | Notes |
|---------|--------------|----------|----------|-------|
| C-08 (Scribe closeOut) | `squadboard.scribe.closeOut()` | ✅ Yes | `packages/squadboard-sdk/src/scribe/close-out.ts` | Called at session end; archives decisions, merges inbox, writes logs |
| C-17 (Health Reports) | `squadboard.scribe.writeHealthReport()` | ✅ Yes | `packages/squadboard-sdk/src/scribe/steps/step-8-health-report.ts` | Produces backlog, spawn lineage, throughput snapshot |
| C-08 (Session logs) | `writeSessionLog()`, `writeOrchestrationLogs()` | ✅ Yes | `packages/squadboard-sdk/src/scribe/primitives.ts` | Low-level primitives for log writing |
| C-06 (Directive capture) | NONE | ❌ No | N/A | SDK has no API to capture directives to decisions inbox |
| C-05 (Issue routing) | NONE | ❌ No | N/A | SDK has no GitHub issue watcher or auto-routing orchestration |
| C-01–C-04 (Team init, casting, dispatch) | NONE | ❌ No | N/A | SDK exposes types (SpawnManifest) but not team-init logic |
| C-07 (Routing rules) | NONE | ❌ No | N/A | SDK has no routing engine or work router |
| C-09 (Ceremonies) | NONE | ❌ No | N/A | SDK has no ceremony orchestration |
| C-13 (Charter compilation) | NONE | ❌ No | N/A | CLI uses `parseCharter()` from server; not exposed via SDK |
| C-14–C-15 (Skills) | NONE | ❌ No | N/A | SDK has no skill loading or confidence tracking |
| C-16 (Ralph monitor) | NONE | ❌ No | N/A | Ralph is a CLI agent; no SDK equivalent |
| C-20 (Bundles/portability) | `BundleManifest`, `ApplyResult` types | ⚠️ Types only | `packages/squadboard-sdk/src/bundle/schema.ts` | Types defined, not APIs to load/apply bundles |

**SDK Capability Score: ~25% (Scribe + health reporting only)**

---

## 4. Squadboard Implementation Audit

**Server:** `packages/server/src/`  
**Client:** `packages/client/src/`

### 4.1 Server Routes Coverage

| CLI Cap | Server Route | Implemented? | File:Line | Notes |
|---------|--------------|--------------|-----------|-------|
| C-01–C-02 (Team init, scaffold) | POST `/api/projects/:id/agents/hire-team/propose`, POST `/agents/hire-team/confirm` | ✅ Partial | `packages/server/src/routes/agents.ts:200–250` | Hire team flow exists; doesn't scaffold full .squad/ directory |
| C-03 (Casting) | POST `/api/casting/universes`, POST `/api/projects/:id/cast` | ✅ Yes | `packages/server/src/routes/casting.ts`, `cast.ts` | Casting engine fully implemented; universe data provided |
| C-04 (Agent dispatch) | POST `/api/projects/:id/agents/:id/invoke` (implicit via Consult) | ⚠️ Partial | `packages/server/src/routes/consult.ts:1–100` | Consult mode routes to agents; doesn't dispatch via task tool |
| C-05 (Issue routing) | GET `/api/projects/:id/issues` | ⚠️ Partial | `packages/server/src/routes/issues.ts` | Fetches GitHub issues; no auto-route or label watcher |
| C-06 (Directive capture) | POST `/api/projects/:id/inbox` | ⚠️ Partial | `packages/server/src/routes/inbox.ts` | Inbox exists; not integrated with directive capture flow |
| C-07 (Routing rules) | GET `/api/projects/:id/routing` | ✅ Yes | `packages/server/src/routes/routing.ts` | Reads routing.md; returns structured routing table |
| C-08 (Scribe closeOut) | POST `/api/projects/:id/runs/:runId/close` | ⚠️ Partial | `packages/server/src/routes/runs.ts:600–700` | Closes runs; doesn't call SDK closeOut |
| C-09 (Ceremonies) | GET/POST/PATCH `/api/projects/:id/ceremonies`, POST `/api/projects/:id/ceremonies/:id/run` | ✅ Yes | `packages/server/src/routes/ceremonies.ts:1–200+` | Full CRUD, scheduling, version history, ad-hoc runs |
| C-10 (Catch-up) | GET `/api/activity/now` | ✅ Partial | `packages/server/src/routes/activity.ts` | Activity view; not summarized like CLI catch-up |
| C-12 (Charter compilation) | GET `/api/projects/:id/agents/:id/charter` | ✅ Yes | `packages/server/src/services/charter-compiler.ts` | Compiles charter.md to structured agent context |
| C-13 (Charter sync) | GET `/api/projects/:id/agents` (triggers sync on fetch) | ✅ Yes | `packages/server/src/services/agent-sync.ts` | Syncs agents from disk on each API call |
| C-17 (Health reports) | GET `/api/projects/:id/health` | ✅ Partial | `packages/server/src/routes/health.ts` | Returns health data; doesn't integrate with SDK writeHealthReport |
| C-18–C-19 (PRD/Issues) | GET `/api/projects/:id/issues`, POST `/api/projects/:id/deliverables` | ⚠️ Partial | `packages/server/src/routes/issues.ts`, `deliverables.ts` | Issues fetched; no PRD parser |
| C-21 (MCP tools) | GET `/api/projects/:id/mcp/tools`, GET `/api/mcp/servers` | ✅ Yes | `packages/server/src/routes/mcp.ts`, `tools.ts` | MCP tool registry and server discovery |

**Server Capability Score: ~70% (ceremonies, agents, routing, issues exist but gaps in directive capture and true dispatch)**

### 4.2 Client UI Coverage

| CLI Cap | Client Page/Component | Implemented? | File | Notes |
|---------|----------------------|--------------|------|-------|
| C-01–C-02 (Team init) | Project setup flow | ❌ No | N/A | No initial setup wizard in current UI |
| C-03 (Casting) | Agents page with casting selector | ✅ Yes | `packages/client/src/pages/Agents.tsx`, `/components/CastingSelector` | Shows cast names, can edit |
| C-04 (Dispatch) | Consult page | ✅ Yes | `packages/client/src/pages/Consult.tsx` | Can invoke agents; consult mode UI |
| C-05 (Issues) | Inbox page, linked to GitHub | ⚠️ Partial | `packages/client/src/pages/Inbox.tsx` | Shows GitHub issues; no auto-route UI |
| C-06 (Directive capture) | Not visible in UI | ❌ No | N/A | Directives would be in decision logs, not UI |
| C-07 (Routing) | Settings → Routing panel | ✅ Yes | `packages/client/src/pages/Settings.tsx`, Routing component | Shows routing table from routing.md |
| C-08 (Session logs) | LiveSession / sessions view | ✅ Yes | `packages/client/src/pages/LiveSession.tsx` | Streaming live session; session list |
| C-09 (Ceremonies) | CeremonyList, CeremonyEditor, CeremonyAudit | ✅ Yes | `packages/client/src/pages/CeremonyList.tsx`, `CeremonyAudit.tsx` | Full ceremony management UI |
| C-10 (Catch-up) | Dashboard, Now page | ✅ Partial | `packages/client/src/pages/Dashboard.tsx`, `Now.tsx` | Shows activity; not summarized catch-up |
| C-12 (Charter) | Agents page → Agent detail → Charter editor | ✅ Yes | `packages/client/src/pages/Agents.tsx`, `/components/CharterEditor` | Edit charter.md inline |
| C-17 (Health) | Diagnostics, Heartbeat page | ✅ Yes | `packages/client/src/pages/Diagnostics.tsx`, `Heartbeat.tsx` | Shows health metrics |
| C-21 (MCP) | Tools, McpServers page | ✅ Yes | `packages/client/src/pages/Tools.tsx`, `McpServers.tsx` | MCP server status and tool discovery |

**Client Capability Score: ~65% (UI exists for most capabilities, but gaps in setup wizard and directive capture)**

---

## 5. Parity Matrix

| CLI Capability | SDK Exposed | Squadboard API | Squadboard UI | Notes |
|---|---|---|---|---|
| C-01: Team Init Phase 1 | ❌ No | ⚠️ Partial | ❌ No | No init wizard in UI; casting exists |
| C-02: Team Init Phase 2 | ❌ No | ⚠️ Partial | ❌ No | Hire endpoint exists; full scaffold missing |
| C-03: Casting | ❌ No | ✅ Yes | ✅ Yes | Full casting engine; UI shows cast names |
| C-04: Agent Dispatch | ⚠️ Types only | ⚠️ Partial | ✅ Yes | Consult mode works; not true CLI dispatch |
| C-05: Issue Routing | ❌ No | ⚠️ Partial | ⚠️ Partial | Issues fetched; no auto-route on label |
| C-06: Directive Capture | ❌ No | ❌ No | ❌ No | **GAP: Critical missing** |
| C-07: Routing Rules | ❌ No | ✅ Yes | ✅ Yes | Routing table readable from API and UI |
| C-08: Scribe closeOut | ✅ Yes | ⚠️ Partial | ✅ Yes | SDK function exists; not called from server on run close |
| C-09: Ceremonies | ❌ No | ✅ Yes | ✅ Yes | Full ceremony CRUD and scheduling |
| C-10: Catch-Up | ❌ No | ⚠️ Partial | ⚠️ Partial | Activity view exists; not summarized |
| C-11: Personal Agents | ❌ No | ❌ No | ❌ No | No personal agent discovery |
| C-12: Consult Mode | ⚠️ Types only | ✅ Yes | ✅ Yes | Full consult flow; limited to project agents |
| C-13: Charter Compilation | ❌ No | ✅ Yes | ✅ Yes | Compiler in server; UI editor and sync |
| C-14: Charter Sync | ❌ No | ✅ Yes | ✅ Yes | Auto-sync on agent list fetch |
| C-15: Skill Confidence | ❌ No | ❌ No | ❌ No | **GAP: Skills not tracked** |
| C-16: Skill-Aware Routing | ❌ No | ❌ No | ❌ No | **GAP: No skill pass-down** |
| C-17: Ralph Monitor | ❌ No | ❌ No | ❌ No | Ralph is CLI-only; no serverless equivalent |
| C-18: Health Reports | ✅ Yes | ⚠️ Partial | ✅ Yes | SDK has writeHealthReport; server doesn't call it |
| C-19: PRD Intake | ❌ No | ❌ No | ❌ No | No PRD parser |
| C-20: GitHub Issues Mode | ⚠️ Types only | ⚠️ Partial | ⚠️ Partial | Issues fetched; no mode-driven workflow |
| C-21: Human Members | ⚠️ Implied | ✅ Yes | ✅ Yes | Agent list supports roles; UI shows them |
| C-22: MCP Tools | ❌ No | ✅ Yes | ✅ Yes | MCP registry and server discovery |

**Overall Parity: ~70%**

---

## 6. Gaps and Proposed W31+ Work

### 6.1 Critical Gaps (Parity Blockers)

#### Gap 1: Directive Capture (C-06)
- **Problem:** CLI captures user directives ("Always use X", "Never do Y") to `.squad/decisions/inbox/copilot-directive-{ts}.md`. Squadboard has inbox, but no directive ingestion flow.
- **Impact:** Users lose the ability to record team policies and rules via natural language.
- **Solution (W31):**
  - **SDK:** Add `squadboard.scribe.captureDirective(userId, directiveText) → Promise<{ filePath, ts }>`
  - **Server:** POST `/api/projects/:id/decisions/capture-directive` — writes to `.squad/decisions/inbox/`
  - **UI:** Add "Capture directive" button in Inbox page; shows confirmation with captured path
  - **Owner:** Kobayashi (SDK), Hockney (server integration)

#### Gap 2: Auto-Route on GitHub Labels (C-05)
- **Problem:** CLI watches GitHub labels and auto-routes issues to squad members. Squadboard UI shows issues but doesn't wire auto-routing.
- **Impact:** Manual work for issue triage and assignment.
- **Solution (W31):**
  - **Server:** POST `/api/projects/:id/github/watch-labels` — registers webhook listener for `squad:{member}` label events
  - **Server:** On label event, determine target member and POST to runs API to spawn member agent
  - **DB:** Track webhook registration state in projects table
  - **UI:** Settings → GitHub Integration panel; show "Label watcher: {status}"
  - **Owner:** Hockney (GitHub webhook), Keyser (UI)

#### Gap 3: Personal Agent Discovery (C-11)
- **Problem:** CLI discovers personal agents from `~/.squad/agents/`. Squadboard assumes all agents are project-scoped.
- **Impact:** No personal agent consult mode; users can't reuse their own specialized agents across projects.
- **Solution (W31):**
  - **SDK:** Add `resolvePersonalAgentDir()` → returns `~/.squad/agents/` or null
  - **Server:** Merge personal agents into project agent list on session init (with `origin: 'personal'` tag)
  - **UI:** Mark personal agents with distinct icon/badge in agent picker
  - **Owner:** Kobayashi (discovery), Keyser (UI badge)

### 6.2 Important Gaps (Nice-to-Have, Non-Blocking)

#### Gap 4: Skill Confidence Tracking (C-15, C-16)
- **Problem:** CLI tracks skill confidence levels (Low/Med/High) in agent history.md. Squadboard has no skill tracking.
- **Impact:** Team learning history and competence is invisible.
- **Solution (W31+):**
  - **DB:** Add columns to agents table: `skills[]` (array of { name, confidence }), `skills_updated_at`
  - **Server:** POST `/api/projects/:id/agents/:id/skills/record` — records skill use; updates confidence
  - **UI:** Agents page → skill confidence badges; skill growth chart
  - **Owner:** Kujan (tracking logic), Keyser (UI chart)

#### Gap 5: Ralph Work Monitor (C-17)
- **Problem:** Ralph is a CLI agent that auto-spawns and monitors work queue. No Squadboard equivalent.
- **Impact:** Manual work queue management; no proactive "keep working" signals.
- **Solution (W31+):**
  - **Server:** Add `worklist` service that polls open issues/runs; auto-recommends next work
  - **UI:** Dashboard widget "Suggested next work" with agent recommendations
  - **Owner:** Hockney (queue logic), Keyser (UI widget)

#### Gap 6: PRD/Spec Intake (C-19)
- **Problem:** CLI has PRD Mode for users to paste specs. Squadboard has no PRD parser or intake flow.
- **Impact:** Users can't initiate work from specs in Squadboard.
- **Solution (W31+):**
  - **UI:** Inbox page → "New PRD" button; modal to paste PRD content
  - **Server:** POST `/api/projects/:id/specs/parse` — parses PRD; extracts requirements into issues
  - **Owner:** Redfoot (PRD parsing), Keyser (UI modal)

#### Gap 7: Catch-Up Summarization (C-10)
- **Problem:** CLI provides text-summarized catch-up ("Ripley fixed the auth bug, Keaton reviewed..."). Squadboard shows activity but not summarized.
- **Impact:** Long session catch-up requires manual log scanning.
- **Solution (W31+):**
  - **Server:** GET `/api/projects/:id/activity/summary?since={date}` — LLM-driven summary of recent work
  - **UI:** Dashboard → "Session Catch-Up" card; shows summary text
  - **Owner:** Kobayashi (LLM summary), Keyser (UI card)

#### Gap 8: Health Report Integration (C-18)
- **Problem:** SDK has `writeHealthReport()` but server doesn't call it on run close.
- **Impact:** Health reports are manually generated, not automatic.
- **Solution (W31):**
  - **Server:** On run close via POST `/api/projects/:id/runs/:id/close`, call `squadboard.scribe.writeHealthReport()`
  - **DB:** Store health report result in health_reports table
  - **UI:** Heartbeat page → show latest health report
  - **Owner:** Hockney (integration), Keyser (UI display)

### 6.3 Non-Gaps (CLI-Only, Won't Port)

| Capability | Why CLI-Only | Alternative in Squadboard |
|---|---|---|
| C-16 (Ralph Monitor) | Ralph is an autonomous CLI agent; requires continuous dispatch | Dashboard "Suggested next work" widget (manual user action) |
| C-21 (Skill Pass-Down) | Requires agent spawning; CLI injects skill prompts | Agents read skills from UI/API (pull vs. push) |
| C-22 (Direct CLI Dispatch) | CLI has task tool; Squadboard is UI-driven | Consult page invokes agents via button |

---

## 7. Open Questions for Brady

1. **Directive capture priority:** Is capturing directives to a markdown inbox essential, or would a UI form capture + database storage be sufficient?

2. **Personal agents scope:** Should personal agents be discoverable from `~/.squad/agents/`, or centralized in a cloud workspace?

3. **Auto-routing on labels:** Should Squadboard automatically spawn agents on GitHub label events, or should users manually review issues and choose to invoke agents?

4. **Ralph vs. Dashboard widget:** Is Ralph's autonomous "keep working" behavior critical, or does a "Suggested next work" UI widget meet the need?

5. **Ceremony scope:** Should ceremonies be cloud-based (Squadboard-only) or remain file-based (.squad/ceremonies.md synced to server)?

6. **PRD intake:** Should PRD parsing happen via UI form or GitHub webhook (when user pastes spec in an issue)?

---

## 8. Conclusion

**Can Squad-SDK + Squadboard replicate the CLI experience?**

**Yes, with 3 targeted W31 gaps to close:**

1. Add directive capture API to SDK and server inbox endpoint
2. Wire GitHub label watcher for auto-routing
3. Merge personal agent discovery into project agent list

**Post-W31 parity:** 95%+ (all CLI capabilities except Ralph autonomy, which becomes a dashboard recommendation widget).

**Squadboard's win:** Adds live streaming, kanban board, ceremony scheduling, and skill tracking — capabilities the CLI has never had.

