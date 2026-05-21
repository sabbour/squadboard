# Wave 27 Close-Out Summary

**Date:** 2026-05-16  
**Wave:** 27  
**Status:** ✅ COMPLETE

---

## Headline Outcomes

### 13 Items Delivered

#### Batch 1: Heartbeat Triad (Verbal)
1. **Phantom error rows fix** — sweep.tick events were contaminating ring buffer, producing duplicate phantom entries; eliminated via early-return guard in `startHeartbeatHistory()`.
2. **React duplicate-key warnings fix** — seq counter was incrementing twice per tick; fixed by eliminating phantom entries.
3. **WebSocket proxy path ordering** — dedicated `/api/ws` entry before `/api` catch-all; WS handshake now completes correctly.

#### Batch 1: Server Quad (Hockney)
4. **Conjure hint hard-override** — hint parameter now locks intent before scoring governs response; 8/26 dogfood prompts no longer routed incorrectly despite explicit hint.
5. **MCP curl session guidance** — expanded 404/400 error bodies to include explicit session-capture instructions for curl users.
6. **PG connection cleanup** — wrapped pool.end() in try/catch to swallow ECONNRESET on parent disconnect.
7. **PATCH project fields** — added `name` + `description` columns and validation; Brady's self-register can now rename/describe projects.

#### Batch 2: Ceremony Editor H3 (Keyser)
8. **Auto-connect on palette drop** — new steps inserted after selected node; sequence edge appears implicitly.
9. **Edge delete + reorder** — edges selectable; delete moves target to end (only meaningful operation in linear DAG).
10. **Drag-to-reconnect** — delegates to existing reorder logic; no bespoke drag code.
11. **Smart edge visual feedback** — tooltip shows interaction hints; highlights on hover.

#### Batch 2: Loading Pattern K6 (Kujan)
12. **RTL + E2E coverage** — PageLoading, SectionLoading, InlineLoading, ActionLoading all tested for a11y (role/aria-live/aria-busy/aria-label) + 150ms anti-flash delay.
13. **Canonical pattern on all surfaces** — Playwright proves loading state lands on `/projects/:id/ceremonies` and `/projects/:id/costs`.

#### Hotfix: Critical Bug (Brady's Infinite Loop)
**W27 Hotfix Triple** — Stops pickup-todos sweep from generating 16+ failures in 8 minutes:
- **Bug A — Parser key allowlist** — `**Rationale:**` and other non-model keys no longer extracted as model values; allowlist gates {preferred, model, default}.
- **Bug B — Backtick strip** — inline code (`` `claude-haiku-4.5` ``) now stripped before model validation; `stripInlineMd()` helper applied to all extracted values.
- **Bug C — Circuit breaker** — before re-dispatch, sweep queries for ≥3 failed runs in 30min for same (issue,agent) tuple; if tripped, skip with log-once + no status mutation.
- **Bug E — Bridge boundary validation** — `validateModel()` rejects strings with spaces, backticks, `**`, >40 chars, or invalid format; falls through to project default on rejection.

---

## Hotfix Narrative

### What Broke
Brady reported infinite failure loop: pickup-todos sweep was re-dispatching every 10s on the same stuck issue, generating 16+ failures in 8 minutes. Root cause: three separate failures in charter parsing + no circuit breaker.

### Root Causes Confirmed
1. **Charter parser accepted any bold line as model** — the parser's `case 'model'` path applied bold-match regex to every non-empty line under `## Model`. After a sentinel line (`**Preferred:** auto`), the parser fell through to the next line (`**Rationale:** Coordinator selects ...`), extracted that as the model value, and stored prose as `agent.model`.
2. **Backticks/inline-markdown not stripped** — charter source contained `` `claude-haiku-4.5` `` (inline code). Parser stored it verbatim, SDK rejected it as invalid model ID.
3. **Pickup-todos had no circuit breaker** — failed runs left the issue in status `todo` with no pending/running run, so the sweep re-dispatched on every 10s tick.
4. **Bridge had no boundary validation** — even after parser fix, any future regression would flow garbage straight to SDK.

### Fix Strategy
- **Immediate (W27 hotfix):** hardened parser (allowlist + backtick strip) + circuit breaker + bridge boundary validation. Still needed to stop today's failure loop.
- **Long-term (W28 design, W29 impl):** replace charter parser with mini-coordinator-agent dispatch. Parser will shrink to name-from-H1 + file existence; coordinator LLM call handles model/role/expertise/style. Eliminates the rathole entirely.

### Circuit Breaker Design
Before inserting a new `issue_runs` row, the sweep queries for ≥`CIRCUIT_BREAKER_MIN_FAILURES` (3) runs with `status='failed'` in the last `CIRCUIT_BREAKER_WINDOW_MS` (30 min) for the exact `(issue_id, agent_id)` tuple. If tripped:
- Log once per (issue, agent) pair
- Skip dispatch (no status mutation, no acted/errors increment)
- User re-arms via UI

Stale DB data (agents persisted with bad model strings) will be corrected on next agent-sync pass (runs on server boot + per project). Server restart flushes poisoned rows.

---

## Design Doc Deliverables

### 1. Jump Into Session (W28 Research — Keaton)
**Location:** `.squad/research/jump-into-session-design.md`  
**12 W28 Implementation Items Identified**

**Recommendation:** Stream `issue_run` agent execution as real-time event bus + WebSocket + optional steering injection.

**Why:** Reuses existing patterns (event bus, WS rooms, RunningLiveSession); minimal schema (one new table); coordinator-ready for both current dispatch AND future mini-coordinator; graceful fallback if steering fails mid-development.

**W28 Scope:**
- Streaming `issue_run` events during execution
- LiveRunViewer UI (header, metrics, event stream, steering input)
- Steering injection endpoint + active session registry
- Board card "Watch" button for running runs
- Coordinator telemetry surface (placeholder; coordinator logic lands W28+)

**Phase 2 (deferred):**
- Audit table (use event history for now)
- Multi-user locking (queue + toast for now)

---

### 2. Mini-Coordinator Architecture (W28 Design — Keaton)
**Location:** `.squad/research/mini-coordinator-architecture.md`  
**14 W29 Implementation Items + 3 Open Brady Questions**

**Key Findings:**
1. **60% of coordinator behaviors are pure state-machine** — only ~14% are truly LLM-driven (routing judgment, fan-out decomposition, intent detection). Coordinator LLM call is narrow and well-scoped: agent selection + model tier + response mode.
2. **Tier-2 keyword scoring is the primary migration target** — replaced by one-shot Haiku coordinator call (~$0.002/call, 2-5s latency). Tier-2 becomes degraded fallback.
3. **SDK has untapped primitives** — DirectResponseHandler, ReviewerLockoutHook, HookPipeline, ralph/triage, casting, agents/personal all exist but unused by squadboard.
4. **Parser shrinks to ~50 lines** — only name-from-H1 + file existence + content hash survive. Model/role/expertise/style/reviewer-authority extraction moves to coordinator-mediated LLM lookup.
5. **Phased migration across 4 waves (W27-W31+)** — W29 introduces coordinator additively alongside Tier-2; W30 makes it primary; W31 drops deprecated paths. Feature flag for rollback at every phase.

**W29 Scope:** 14 implementation items (~2-3 days)
- Coordinator types + preamble + dispatch function
- Wire into pickup-todos and manual runs
- Coordinator telemetry integration

---

## Test Count Delta

### Server Tests
- **Before W27:** ~472 tests across 36 files
- **After W27:** 500 tests across 36 files
- **Delta:** +28 tests
- **Breakdown:**
  - Hotfix (parser + circuit breaker + validation): +7 test cases
  - Server Quad (Conjure hint + curl + pg + PATCH): +5 test cases
  - Heartbeat Triad (ring buffer + seq + WS): +12 test cases (includes implicit from graceful-shutdown)
  - Other improvements: +4 test cases

### Client Tests
- **Before W27:** 41 tests across 7 files
- **After W27:** 53 tests across 7 files
- **Delta:** +12 tests
- **Breakdown:**
  - H3 Ceremony Editor (connection UX): +5 tests (RTL + interaction)
  - K6 Loading Pattern (a11y + E2E): +7 tests (RTL); +5 tests (E2E in 10-loading-pattern.spec.ts)
  - Total added: +12 client unit tests

### E2E Tests
- **Existing Playwright slate:** maintained
- **New:** 10-loading-pattern.spec.ts — 5 scenarios (ceremonies loading, costs loading, no bare text, PageHeader wrap, canonical everywhere)

---

## Outstanding Open Questions for Brady

### From Mini-Coordinator Architecture (Section 9)

**Q1: Coordinator Preamble Location — Built-in, In-Repo, or Hybrid?**

Options:
- **Built-in** — `squadboard-coordinator.md` ships inside server package, immutable per release
- **In-repo** — User authors `.squad/squadboard-coordinator.md`, overridable per project
- **Hybrid (recommended by Keaton)** — Built-in default ships; if user provides `.squad/squadboard-coordinator.md`, that overrides

*Default if no answer:* Apply Keaton's recommendation (Hybrid).

---

**Q2: Coordinator Model — Hardcoded Haiku, or Configurable?**

Options:
- **Hardcoded Haiku** — Simple, cost-bounded, predictable
- **Configurable (recommended by Keaton)** — `COORDINATOR_MODEL` env var, Haiku default; allows Sonnet experimentation if needed

*Default if no answer:* Apply Keaton's recommendation (Configurable with Haiku default).

---

**Q3: CLI's `coordinator-fragment.md` Interaction — Independent, Converging, or Layered?**

Options:
- **Independent** — Two separate preambles evolve separately
- **Converging** — Long-term: one shared preamble in SDK, both CLI + Squadboard consume
- **Layered (recommended by Keaton)** — Squadboard preamble extends/composes with CLI fragment; CLI adds MCP awareness, server-side coordinator handles dispatch

*Default if no answer:* Apply Keaton's recommendation (Layered).

---

## W28 Forward Look

### Carried Forward (No Longer Urgent Post-Hotfix)
- **J3** — Ceremony metadata + labeling
- **J5** — Mirror SquadCoordinator in consult context
  - *Note:* J5 now aligns with W29 mini-coordinator migration; shares same context-assembly machinery

### W28 Scope (Backlog)
- **Jump Into Session design** (12 implementation items, ~8-10 hrs)
  - Stream issue_run events + LiveRunViewer + steering injection + Watch button + coordinator telemetry placeholder
- **Mini-Coordinator design doc** (already delivered; awaiting Brady's 3 decisions)
- **Backlog grooming results** (18 items slotted W28-W36; no dispatch yet)

### W29 Unblock (Pending Brady Decisions)
- **Mini-Coordinator implementation** (14 items, ~2-3 days)
  - Introduces coordinator additively alongside Tier-2
  - Integrates with J5 consult context + W28 jump-into-session steering
  - Feature flag for rollback

---

## Commits

- **W27 batch-1 + heartbeat triad:** `28c4822c` + `402ecaf0` + `9e142518` + `42e88d59`
- **W27 hotfix triple:** `2ac47487` + `12169c76` (concurrent agent work; messy hygiene but code correct on main)
- **W27 close-out:** This commit (inbox merge + wave summary)

---

## Metrics at a Glance

| Metric | Value |
|--------|-------|
| Items Completed | 13 (4 pre-hotfix + 1 hotfix triple + 5 H3 + 3 K6) |
| Tests Added | 28 server + 12 client + 5 E2E |
| Test Coverage Delta | Server: 472 → 500; Client: 41 → 53 |
| Design Docs Delivered | 2 (jump-into-session + mini-coordinator-architecture) |
| Open Brady Questions | 3 (coordinator location, model, CLI integration) |
| Circuit Breaker Window | 30 minutes; 3 failures triggers |
| Parser Scope Shrink (W29) | 1378 → ~50 lines (85% reduction) |
| Hotfix Root Causes Fixed | 4 (key allowlist, backtick strip, circuit breaker, boundary validation) |

---

## Sign-Off

Wave 27 closed with 13 items delivered, 1 critical hotfix shipped (Brady's infinite loop stopped), 2 architectural design docs ready for W28–W29 execution, and 3 key decisions awaiting Brady confirmation for W29 unblock.

Ready for W28.
